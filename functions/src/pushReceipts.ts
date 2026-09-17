// pushReceipts.ts -- the second half of Expo delivery: redeeming the ticket
// ids a send left behind for their DELIVERY receipts, and dropping the tokens
// those report as gone.
//
// Separate from index.ts because it is a separate conversation with the push
// service, on its own schedule, with its own failure rules -- and because the
// rules are the delicate part. A receipt is the only evidence that may cost a
// token its document, so most of what follows is about refusing to act on
// anything weaker than one: an id the service omitted, a request that failed,
// a delivery error that was not about the registration. See expoPush.ts's
// header for why acceptance and delivery are two different answers.
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { fetchExpoReceipts, type PushResult } from './expoPush';
import type { PushTokenDoc } from './reminders';

/**
 * The Firestore handle, asked for per call rather than held in a module-scope
 * `const db = getFirestore()`.
 *
 * It WAS that const, and that made the whole backend undeployable. index.ts
 * imports this file -- for recordTickets, and to re-export collectPushReceipts
 * -- at the top of its own body, above its `initializeApp()`; an import runs
 * the imported module to completion before any of the importing module's own
 * statements, so `getFirestore()` fired here while no app existed yet and
 * threw `app/no-app` with index.ts still half-loaded. Firebase LOADS that
 * entry point to discover what to deploy, so the blast radius was all three
 * jobs rather than this one, and the only symptom was a deploy dying in
 * function discovery. Nothing local saw it coming: the types are correct so
 * `tsc` passes either way, and the ordering does not exist until something
 * actually requires index.ts -- which, until index.test.ts, nothing did.
 *
 * A plain function and not a memoized getter, because there is nothing left to
 * memoize: firebase-admin caches the Firestore service on the app itself, so
 * every call after the first hands back the same instance. All this buys is
 * that the lookup happens when a handler runs -- by which point initializeApp()
 * has certainly been called -- instead of during import. That is also why this
 * is the fix rather than moving index.ts's `initializeApp()` above its
 * imports: an import order is a thing a later edit, or a formatter, can
 * silently undo, whereas a handle that is never taken early cannot be taken
 * early by accident.
 */
function db(): Firestore {
  return getFirestore();
}

const REGION = 'us-central1';

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
 * denied this collection by the rules -- so collectPushReceipts is the only
 * thing that can clean up after it, which is why that job drops any ticket
 * whose token document has gone (findOrphanedTickets). A ticket therefore
 * outlives the account it names by at most one run of that job, not by
 * TICKET_MAX_AGE_MS.
 */
export async function recordTickets(
  uid: string,
  results: PushResult[],
  expoTargets: (PushTokenDoc & { id: string })[],
): Promise<void> {
  const byToken = new Map(expoTargets.map((t) => [t.token, t.id]));
  const pending = results.filter((r) => r.ticketId && byToken.has(r.token));
  if (pending.length === 0) return;

  try {
    const batch = db().batch();
    const now = Date.now();
    for (const r of pending) {
      batch.set(db().collection(TICKETS).doc(r.ticketId!), {
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
    const snap = await db()
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

    // Anything still pending whose token document is already gone. Such a
    // ticket can never do anything again -- its only power is to delete a
    // token that no longer exists -- so waiting out TICKET_MAX_AGE_MS just
    // leaves a row naming a uid and a dead push address sitting around for a
    // day. The case that matters is account deletion: firestoreSync's
    // deleteAllUserData removes pushTokens, but it runs as the CLIENT and the
    // rules deny it this collection, so this is the only path that can clean
    // up after it. Bounds that residue at one run of this job rather than a
    // day.
    for (const id of settled) tickets.delete(id);
    const orphaned = await findOrphanedTickets(tickets);

    await deleteTickets([...settled, ...expired, ...orphaned]);
    logger.info('collectPushReceipts finished', {
      asked: tickets.size + settled.length,
      settled: settled.length,
      expired: expired.length,
      orphaned: orphaned.length,
      deadTokens: dead,
    });
  },
);

/**
 * The ids of tickets whose token document no longer exists.
 *
 * Grouped by uid so this costs one collection read per USER with tickets
 * outstanding, not one read per ticket -- a user's pushTokens collection
 * holds a handful of documents at most (one per device), and the same
 * snapshot answers for every ticket that user has pending.
 *
 * A read that fails yields nothing rather than a guess: on this path,
 * "cannot tell" must mean "keep the ticket", since deleting it would drop a
 * receipt that might still have had a dead token to report.
 */
async function findOrphanedTickets(pending: Map<string, TicketDoc>): Promise<string[]> {
  if (pending.size === 0) return [];

  const byUid = new Map<string, { ticketId: string; tokenId: string }[]>();
  for (const [ticketId, ticket] of pending) {
    const bucket = byUid.get(ticket.uid);
    if (bucket) bucket.push({ ticketId, tokenId: ticket.tokenId });
    else byUid.set(ticket.uid, [{ ticketId, tokenId: ticket.tokenId }]);
  }

  const orphaned: string[] = [];
  for (const [uid, entries] of byUid) {
    try {
      const snap = await db().collection('users').doc(uid).collection('pushTokens').get();
      const live = new Set(snap.docs.map((d) => d.id));
      for (const { ticketId, tokenId } of entries) {
        if (!live.has(tokenId)) orphaned.push(ticketId);
      }
    } catch (e) {
      logger.warn('could not check for orphaned push tickets', { uid, error: String(e) });
    }
  }
  return orphaned;
}

/**
 * Deletes the token document a receipt condemned -- but only if it still
 * holds the token that receipt was about. See recordTickets for why that
 * check is the point rather than a nicety.
 */
async function deleteTokenIfUnchanged(ticket: TicketDoc): Promise<boolean> {
  const ref = db().collection('users').doc(ticket.uid).collection('pushTokens').doc(ticket.tokenId);
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
    const batch = db().batch();
    for (const id of ids.slice(i, i + 500)) batch.delete(db().collection(TICKETS).doc(id));
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
