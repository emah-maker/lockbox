// index.ts -- Phone Box's Cloud Functions. Two scheduled jobs, no HTTP
// endpoints and no callables: everything this backend does is driven by the
// clock and by documents the clients have already written under their own
// uid, so there is no request surface to authenticate or abuse.
//
//   sendDueReminders    -- every minute: find scheduled-session reminders
//                          whose moment has arrived, push them to the user's
//                          registered devices, mark them handled.
//   collectPushReceipts -- every 15 minutes: redeem the ticket ids that send
//                          left behind for their delivery receipts, and
//                          delete the tokens those report as gone. See
//                          expoPush.ts's header for why acceptance and
//                          delivery are two separate answers.
//   pruneOldReminders   -- daily: drop scheduled-session documents whose day
//                          is long past, mirroring the pruning both clients
//                          already do locally.
//
// WHY A SERVER AT ALL, when the phone app already schedules these locally:
// a local notification can only exist on a device that has seen the plan. A
// session scheduled on the website dashboard reaches the phone only after
// the app is next opened and syncs -- which might be after the session was
// supposed to start. This closes that gap, and adds browser delivery for
// someone working at a desk. The phone's own local notification stays the
// primary path where it exists (it is exact and needs no network), and the
// per-device `localReminderIds` list is what stops the two from doubling up
// -- see reminders.ts's PushTokenDoc.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type Query } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { fetchExpoReceipts, sendExpoPush, type ExpoMessage, type PushResult } from './expoPush';
import { sendWebPush } from './webPush';
import {
  isSendable,
  reminderContent,
  tokensForReminder,
  type DueReminder,
  type PushTokenDoc,
  type RemoteScheduledSession,
} from './reminders';

initializeApp();

const db = getFirestore();

const REGION = 'us-central1';

/** How late a reminder may be and still be worth sending. Past this it is
 * marked handled without delivery -- see reminders.ts's isSendable for why
 * that is the honest outcome rather than a very late notification. Sized to
 * absorb an outage of a few hours without silently swallowing anything the
 * user would still have wanted. */
const GRACE_MS = 2 * 60 * 60 * 1000;

/** Safety valve on one run's fan-out. A run that somehow finds thousands of
 * due reminders (a clock jump, a restored backup) should deliver a bounded
 * slice and let the next tick take the rest, not spend the whole function
 * timeout in one pass. */
const MAX_REMINDERS_PER_RUN = 500;

/** How many marks in a row may fail before this run stops trying. One
 * failure is a blip worth retrying; three in a row is Firestore being down,
 * and at that point every further reminder costs two more doomed RPCs
 * apiece. With a full batch that is up to 1000 of them against a dead
 * backend, which is a good way to spend the whole 120s timeout achieving
 * nothing. Stopping early leaves the rest unmarked and unsent, so the next
 * tick simply picks them up. */
const MAX_CONSECUTIVE_MARK_FAILURES = 3;

/** Where a web-push notification lands when tapped. */
const DASHBOARD_URL = 'https://phonebox-d14b7.web.app/dashboard.html';

/** Where a sent message's ticket id waits to be redeemed for its receipt.
 * A top-level collection rather than a subcollection of the user, because
 * this job queries across every pending ticket at once; firestore.rules'
 * deny-by-default catchall already puts it out of every client's reach. */
const TICKETS = 'pushTickets';

/** How long a ticket must sit before it is worth asking about. Expo does not
 * have a receipt the instant it accepts a message, and asking too early just
 * gets an omission -- harmless, but it spends a request to learn nothing. */
const RECEIPT_DELAY_MS = 5 * 60 * 1000;

/** A ticket this old is abandoned. Expo keeps receipts for about a day, so
 * past that the answer is never coming and the row would otherwise be
 * re-queried forever. Dropped WITHOUT touching its token: no receipt is no
 * evidence, and this path may only ever delete a token on a receipt that
 * actually said DeviceNotRegistered. */
const TICKET_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Bound on one receipts run -- the same safety valve MAX_REMINDERS_PER_RUN
 * is for the sender. */
const MAX_TICKETS_PER_RUN = 1000;

/** Scheduled-session documents older than this are deleted server-side.
 * Matches SCHEDULED_PRUNE_MS in app/src/schedule/scheduledSessions.ts -- the
 * clients prune their own copies on the same schedule, and a mismatch would
 * mean one side resurrecting what the other just dropped. */
const PRUNE_MS = 30 * 24 * 60 * 60 * 1000;

export const sendDueReminders = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: REGION,
    timeoutSeconds: 120,
    // One instance at a time. Two overlapping runs would both read the same
    // pending reminders before either had marked them, and push duplicates.
    //
    // Note what this does and does not buy. It removes duplicates caused by
    // CONCURRENCY. It cannot make delivery at-most-once, because the push is
    // sent before the document is marked and nothing can make those two
    // atomic across two different services -- if the process dies in between,
    // the next tick sees an unmarked reminder still inside its grace window
    // and sends it again. That ordering is the deliberate choice: marking
    // first would turn the same crash into a reminder that is never sent at
    // all, and a reminder arriving twice is a far better failure than one
    // that silently never arrives (the same asymmetry reminders.ts states for
    // localReminderIds). markNotified below narrows the window as far as it
    // can by retrying the mark rather than giving up on the first error.
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const nowMs = Date.now();
    const due = await readDueReminders(nowMs);
    if (due.length === 0) return;

    // Grouped by user because the token lookup is per-user: a user with three
    // reminders in the same minute should cost one tokens read, not three.
    const byUid = new Map<string, DueReminder[]>();
    for (const item of due) {
      const bucket = byUid.get(item.uid);
      if (bucket) bucket.push(item);
      else byUid.set(item.uid, [item]);
    }

    let delivered = 0;
    let skipped = 0;
    for (const [uid, reminders] of byUid) {
      try {
        const counts = await deliverForUser(uid, reminders);
        delivered += counts.delivered;
        skipped += counts.skipped;
      } catch (e) {
        // One user's failure must not abort everyone else's reminders. Their
        // documents stay unmarked, so the next tick retries them.
        logger.error('reminder delivery failed for a user', { uid, error: String(e) });
      }
    }

    logger.info('sendDueReminders finished', { due: due.length, delivered, skipped });
  },
);

/**
 * Every pending reminder whose moment has arrived, across all users.
 *
 * A collection-group query, which is why scheduled sessions are stored as
 * individual documents under `users/{uid}/scheduledSessions/{id}` rather
 * than as one array field the way goals are: an array in a per-user document
 * would force this job to read every user's document every minute, whereas
 * this reads only what is actually due. See firestore.indexes.json for the
 * composite index the three clauses below require.
 *
 * The lower `fireAtMs` bound matters as much as the upper one: without it
 * this query's result set would grow forever with every reminder that was
 * never marked (a user who revoked notifications, a document written by a
 * broken client), and every run would re-read all of them.
 */
async function readDueReminders(nowMs: number): Promise<DueReminder[]> {
  const q: Query = db
    .collectionGroup('scheduledSessions')
    .where('done', '==', false)
    .where('notifiedAt', '==', null)
    .where('fireAtMs', '>', nowMs - GRACE_MS)
    .where('fireAtMs', '<=', nowMs)
    .orderBy('fireAtMs')
    .limit(MAX_REMINDERS_PER_RUN);

  const snap = await q.get();
  const out: DueReminder[] = [];
  for (const docSnap of snap.docs) {
    // users/{uid}/scheduledSessions/{planId} -- the grandparent document is
    // the user. A collection-group match from anywhere else in the tree
    // can't happen today, but reading the uid out of the path (rather than
    // trusting a field on the document) means a client can never address
    // someone else's devices by writing a uid of its own choosing.
    const uid = docSnap.ref.parent.parent?.id;
    if (!uid) continue;
    const plan = docSnap.data() as RemoteScheduledSession;
    if (!isSendable(plan, nowMs, GRACE_MS)) continue;
    out.push({ uid, planId: docSnap.id, plan });
  }
  return out;
}

/** Pushes one user's due reminders and marks them handled. */
async function deliverForUser(uid: string, reminders: DueReminder[]): Promise<{ delivered: number; skipped: number }> {
  const tokenSnap = await db.collection('users').doc(uid).collection('pushTokens').get();
  const tokens = tokenSnap.docs.map((d) => ({ id: d.id, ...(d.data() as PushTokenDoc) }));

  let delivered = 0;
  let skipped = 0;
  let consecutiveMarkFailures = 0;
  const deadTokens = new Set<string>();

  for (const { planId, plan } of reminders) {
    const targets = tokensForReminder(planId, tokens);
    const content = reminderContent(plan);

    const expo = targets.filter((t) => t.transport === 'expo');
    const web = targets.filter((t) => t.transport === 'webpush');

    const expoMessages: ExpoMessage[] = expo.map((t) => ({
      to: t.token,
      title: content.title,
      body: content.body,
      data: { kind: 'session-reminder', planId },
    }));

    const results: PushResult[] = [
      ...(expoMessages.length > 0 ? await sendExpoPush(expoMessages) : []),
      ...(web.length > 0 ? await sendWebPush(web, content, DASHBOARD_URL) : []),
    ];

    for (const r of results) {
      if (r.unregistered) deadTokens.add(r.token);
    }
    if (results.some((r) => r.ok)) delivered += 1;
    else skipped += 1;

    // Park the ticket ids for collectPushReceipts. Its own failure is logged
    // and swallowed: a ticket that does not get stored costs one missed
    // chance to notice a dead token, which is strictly better than letting
    // that interfere with the reminders still queued behind it.
    await recordTickets(uid, results, expo);

    // Marked regardless of whether anything was actually delivered. The
    // alternative -- retry until something succeeds -- means a user with no
    // registered device, or one whose only device already covers this
    // locally, gets their reminder re-attempted every minute for the whole
    // grace window, forever, for a push that is never going to have anywhere
    // to go. Delivery here is best-effort by design; the phone's own local
    // notification is the path that carries a real guarantee.
    if (await markNotified(uid, planId)) {
      consecutiveMarkFailures = 0;
    } else if ((consecutiveMarkFailures += 1) >= MAX_CONSECUTIVE_MARK_FAILURES) {
      logger.error('giving up this run: too many consecutive mark failures', { uid });
      break;
    }
  }

  await removeDeadTokens(uid, tokens, deadTokens);
  return { delivered, skipped };
}

/**
 * Marks one reminder handled, retrying once.
 *
 * Never throws, and that is the point. This used to be a bare awaited
 * `set()`, so a transient Firestore error on ONE reminder propagated out of
 * deliverForUser and was caught by the per-user handler in sendDueReminders
 * -- abandoning every remaining reminder for that user in the same run.
 * Worse for the reminder that had just been pushed: its document stayed
 * unmarked, so the next tick found it due and sent it a second time. A
 * failed mark is the one error here that actively causes a duplicate, which
 * makes it the one worth retrying.
 *
 * Returns whether the mark landed, so the caller can tell a one-off blip
 * (retry, carry on) from Firestore being down (stop -- see
 * MAX_CONSECUTIVE_MARK_FAILURES).
 */
async function markNotified(uid: string, planId: string): Promise<boolean> {
  const ref = db.collection('users').doc(uid).collection('scheduledSessions').doc(planId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await ref.set({ notifiedAt: Date.now() }, { merge: true });
      return true;
    } catch (e) {
      if (attempt === 1) {
        // Out of retries. The reminder was already delivered, so the cost of
        // giving up here is a possible duplicate on a later tick -- logged
        // rather than thrown, because taking down the rest of this user's
        // reminders would guarantee more duplicates, not fewer.
        logger.error('could not mark a reminder handled; it may be re-sent', {
          uid,
          planId,
          error: String(e),
        });
      }
    }
  }
  return false;
}

/** Deletes token documents whose push service told us the registration is
 * gone (app uninstalled, browser permission revoked). Left in place, they
 * would be re-sent to on every reminder forever. */
async function removeDeadTokens(
  uid: string,
  tokens: (PushTokenDoc & { id: string })[],
  dead: Set<string>,
): Promise<void> {
  if (dead.size === 0) return;
  const doomed = tokens.filter((t) => dead.has(t.token));
  await Promise.all(
    doomed.map((t) =>
      db
        .collection('users')
        .doc(uid)
        .collection('pushTokens')
        .doc(t.id)
        .delete()
        .catch((e) => logger.warn('could not delete a dead push token', { uid, error: String(e) })),
    ),
  );
  logger.info('removed dead push tokens', { uid, count: doomed.length });
}

/**
 * Files one ticket document per ACCEPTED expo message, so its delivery
 * outcome can be looked up later.
 *
 * Keyed BY the ticket id, which makes the write idempotent: re-storing an id
 * already present simply overwrites itself rather than queueing the same
 * lookup twice.
 *
 * `tokenId` is stored alongside the token VALUE deliberately. The id makes
 * the eventual delete a direct addressing rather than a scan; the value is
 * what makes it safe. By the time a receipt says "gone", that device may have
 * re-registered under the same document with a fresh token, and deleting it
 * then would unsubscribe a working device over a receipt about a token it no
 * longer has. (An `updatedAt` comparison would not do instead: an Expo token
 * is stable for an install, so an ordinary re-registration rewrites the same
 * value, and treating that as "changed" would block a deletion that is in
 * fact correct.)
 *
 * ACCOUNT DELETION. These rows are backend-only and are not reachable by
 * firestoreSync.ts's deleteAllUserData, which runs as the client and is
 * denied this collection by the rules. So a ticket can outlive the account it
 * names -- by at most TICKET_MAX_AGE_MS, after which it is dropped
 * unconditionally. What it holds in the meantime is a uid and a push token
 * that deleteAllUserData has already unregistered: an address that no longer
 * addresses anything, in a collection no client can read. Bounded and inert
 * rather than zero, and worth stating because it is invisible from the
 * client half of the deletion path.
 */
async function recordTickets(
  uid: string,
  results: PushResult[],
  expoTargets: (PushTokenDoc & { id: string })[],
): Promise<void> {
  const byToken = new Map(expoTargets.map((t) => [t.token, t.id]));
  const pending = results.filter((r) => r.ticketId && byToken.has(r.token));
  if (pending.length === 0) return;

  try {
    const batch = db.batch();
    const now = Date.now();
    for (const r of pending) {
      batch.set(db.collection(TICKETS).doc(r.ticketId!), {
        uid,
        tokenId: byToken.get(r.token),
        token: r.token,
        createdAt: now,
      });
    }
    await batch.commit();
  } catch (e) {
    logger.warn('could not record push tickets', { uid, error: String(e) });
  }
}

interface TicketDoc {
  uid: string;
  tokenId: string;
  token: string;
  createdAt: number;
}

export const collectPushReceipts = onSchedule(
  {
    // Not every minute: nothing a user sees depends on a receipt, and asking
    // before Expo has one spends a request to learn nothing.
    schedule: 'every 15 minutes',
    region: REGION,
    timeoutSeconds: 120,
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const nowMs = Date.now();
    const snap = await db
      .collection(TICKETS)
      .where('createdAt', '<=', nowMs - RECEIPT_DELAY_MS)
      .orderBy('createdAt')
      .limit(MAX_TICKETS_PER_RUN)
      .get();
    if (snap.empty) return;

    const tickets = new Map<string, TicketDoc>();
    const expired: string[] = [];
    for (const d of snap.docs) {
      const data = d.data() as TicketDoc;
      if (typeof data?.token !== 'string' || typeof data?.uid !== 'string' || typeof data?.tokenId !== 'string') {
        expired.push(d.id); // malformed: nothing to look up, nothing to keep
        continue;
      }
      if (nowMs - (data.createdAt ?? 0) > TICKET_MAX_AGE_MS) {
        expired.push(d.id);
        continue;
      }
      tickets.set(d.id, data);
    }

    const outcomes = await fetchExpoReceipts([...tickets.keys()]);

    // Only ids Expo actually answered about are settled. Anything omitted is
    // left exactly where it is, to be asked about again next run -- see
    // fetchExpoReceipts for why that distinction is load-bearing.
    const settled: string[] = [];
    let dead = 0;
    for (const outcome of outcomes) {
      const ticket = tickets.get(outcome.ticketId);
      if (!ticket) continue;
      settled.push(outcome.ticketId);
      if (!outcome.unregistered) continue;
      if (await deleteTokenIfUnchanged(ticket)) dead += 1;
    }

    await deleteTickets([...settled, ...expired]);
    logger.info('collectPushReceipts finished', {
      asked: tickets.size,
      settled: settled.length,
      expired: expired.length,
      deadTokens: dead,
    });
  },
);

/**
 * Deletes the token document a receipt condemned -- but only if it still
 * holds the token that receipt was about. See recordTickets for why that
 * check is the point rather than a nicety.
 */
async function deleteTokenIfUnchanged(ticket: TicketDoc): Promise<boolean> {
  const ref = db.collection('users').doc(ticket.uid).collection('pushTokens').doc(ticket.tokenId);
  try {
    const snap = await ref.get();
    if (!snap.exists) return false;
    if ((snap.data() as PushTokenDoc)?.token !== ticket.token) return false; // re-registered since
    await ref.delete();
    return true;
  } catch (e) {
    logger.warn('could not delete a token a receipt reported gone', { uid: ticket.uid, error: String(e) });
    return false;
  }
}

async function deleteTickets(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + 500)) batch.delete(db.collection(TICKETS).doc(id));
    try {
      await batch.commit();
    } catch (e) {
      // A ticket that fails to delete is simply re-read next run: the receipt
      // lookup is idempotent, and TICKET_MAX_AGE_MS bounds how long it can
      // keep coming back.
      logger.warn('could not delete redeemed push tickets', { error: String(e) });
    }
  }
}

export const pruneOldReminders = onSchedule(
  { schedule: 'every day 04:00', region: REGION, timeoutSeconds: 300, maxInstances: 1, retryCount: 0 },
  async () => {
    const cutoff = Date.now() - PRUNE_MS;
    const snap = await db
      .collectionGroup('scheduledSessions')
      .where('fireAtMs', '<', cutoff)
      .limit(2000)
      .get();
    if (snap.empty) return;

    // Chunked at Firestore's 500-writes-per-batch limit.
    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = db.batch();
      for (const d of snap.docs.slice(i, i + 500)) batch.delete(d.ref);
      await batch.commit();
    }
    logger.info('pruneOldReminders removed old plans', { count: snap.docs.length });
  },
);
