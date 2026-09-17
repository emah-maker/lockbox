// scheduledSessionsSync.ts -- two-way sync of planned focus sessions with
// users/{uid}/scheduledSessions/{planId}.
//
// Individual documents, not one array field. Goals are stored as a single
// goals/config document because nothing but the two clients ever reads them;
// scheduled sessions are read by a backend job that has to find what is due
// across ALL users every minute (functions/src/index.ts's readDueReminders,
// a collection-group query). An array field would force that job to read
// every user's document on every tick.
//
// Merge rule: per-document last-write-wins on `updatedAt`, which is far
// simpler than goals' array merge (sync/goalMerge.ts) and is enough here --
// each plan is an independent row, so there is no whole-collection clock to
// reconcile, only the plans themselves.
//
// Deletions use the store's own tombstones rather than a `deleted` field on
// the remote document. A plain remote delete would be invisible to a device
// that was offline when it happened: that device still holds the plan
// locally, pushes it back on its next sync, and the plan silently returns --
// along with its reminder. See useScheduleStore's `deletedIds`.
import { doc, collection, getDocs, writeBatch, deleteDoc } from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '../auth/firebase';
import { useScheduleStore } from '../store/useScheduleStore';
import { reminderFireMs, isValidDateKey, TIME_RE, type ScheduledSession } from '../schedule/scheduledSessions';
import { formatClockTime } from '../ui/time';

const BATCH_LIMIT = 500; // Firestore's per-batch write limit

/**
 * The remote shape. Every field here is validated by app/firestore.rules;
 * keep the two in step -- a field added here without a matching entry in that
 * rule's `hasOnly` allow-list is rejected outright, which surfaces as writes
 * silently failing.
 */
interface RemotePlan {
  date: string;
  time: string;
  /** The absolute moment the reminder should fire. Computed HERE, on the
   * device that knows the user's timezone, because it is the only field the
   * backend queries on -- see functions/src/reminders.ts for what that
   * implies when a user later changes timezone. */
  fireAtMs: number;
  /** Pre-formatted local clock time for the notification body. Written by
   * the client because only it knows the device locale; the server would
   * have to guess, and would tell a 24h-locale user "2:30 PM". */
  timeLabel: string;
  /** IANA zone the two fields above were derived in. Diagnostic only today
   * -- nothing reads it -- but without it a mis-fired reminder is
   * un-debuggable after the fact. */
  tz: string;
  topic: string | null;
  leadMinutes: number;
  plannedS?: number;
  note?: string;
  done: boolean;
  /** Server-written once pushed. The client writes `null` on create and on
   * every edit, which is what re-arms an edited plan. */
  notifiedAt: number | null;
  updatedAt: number;
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toRemote(plan: ScheduledSession): RemotePlan {
  return {
    date: plan.date,
    time: plan.time,
    fireAtMs: reminderFireMs(plan),
    timeLabel: formatClockTime(plan.time),
    tz: localTimeZone(),
    topic: plan.topic,
    leadMinutes: plan.leadMinutes,
    // Firestore rejects `undefined` outright, so optional fields are spread
    // in only when present rather than written as undefined.
    ...(plan.plannedS !== undefined ? { plannedS: plan.plannedS } : {}),
    ...(plan.note ? { note: plan.note } : {}),
    done: !!plan.done,
    notifiedAt: null,
    updatedAt: plan.updatedAt,
  };
}

/** Untrusted -> local. Returns null for anything malformed rather than
 * letting a bad remote document into the store, the same boundary-validation
 * posture goals/goalSanitize.ts takes for its own remote shape. */
function fromRemote(id: string, data: unknown): ScheduledSession | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<RemotePlan>;
  // The VALUES, not just the types. A string was all this asked for, and
  // app/firestore.rules only checks the shape ('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  // and '^[0-9]{2}:[0-9]{2}$'), which '2026-02-30' and '25:00' both satisfy.
  // An impossible day then came all the way in: sessionsOnDay and the
  // calendar's day sheet key off the date STRING, so the plan listed under a
  // cell the calendar never renders, while scheduledStartMs rolled Feb 30
  // forward and armed its reminder for Mar 2 -- neither day showing the user
  // what would actually happen. It only healed on the next local write,
  // when pruneScheduledSessions dropped it for a NaN start.
  //
  // isValidDateKey is the schedule module's own rule (see its comment, which
  // names this function as the untrusted caller it was exported for), not a
  // second copy of it here: the app's authoring path already rejects exactly
  // these values, and a boundary that disagreed with the authoring path
  // would be its own bug.
  if (typeof d.date !== 'string' || !isValidDateKey(d.date)) return null;
  if (typeof d.time !== 'string' || !TIME_RE.test(d.time)) return null;
  if (typeof d.leadMinutes !== 'number' || !Number.isFinite(d.leadMinutes)) return null;
  return {
    id,
    date: d.date,
    time: d.time,
    topic: typeof d.topic === 'string' ? d.topic : null,
    leadMinutes: Math.round(d.leadMinutes),
    ...(typeof d.plannedS === 'number' ? { plannedS: d.plannedS } : {}),
    ...(typeof d.note === 'string' && d.note ? { note: d.note } : {}),
    ...(d.done ? { done: true } : {}),
    // No createdAt on the wire -- it has no consumer, and updatedAt is the
    // only clock the merge below compares.
    createdAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
  };
}

/** Signed-in uid, or null. Never throws -- Auth may not be initialized. */
function currentUid(): string | null {
  try {
    return getFirebaseAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

/**
 * Full reconcile: pull every remote plan, merge it against the local set,
 * apply the result locally, and push back whatever the remote side is
 * missing or holds an older copy of. Called from firestoreSync.ts's
 * runMigrationAndSync on sign-in.
 */
export async function syncScheduledSessions(uid: string, guard: () => void): Promise<void> {
  const db = getDb();
  const colRef = collection(db, 'users', uid, 'scheduledSessions');
  const snap = await getDocs(colRef);

  const state = useScheduleStore.getState();
  const localById = new Map(state.scheduled.map((p) => [p.id, p]));
  const deleted = state.deletedIds;

  const merged = new Map(localById);
  const staleRemote: string[] = [];

  for (const docSnap of snap.docs) {
    // A plan this device deleted while the other side still holds it: the
    // tombstone wins, and the remote copy is removed rather than pulled back
    // in. Without this, deleting a plan on the phone and opening the
    // dashboard would resurrect it.
    if (deleted[docSnap.id] !== undefined) {
      staleRemote.push(docSnap.id);
      continue;
    }
    const remote = fromRemote(docSnap.id, docSnap.data());
    if (!remote) {
      staleRemote.push(docSnap.id);
      continue;
    }
    const local = localById.get(docSnap.id);
    // Ties go to the local copy: an equal clock means the two are the same
    // write, so there is nothing to gain from replacing the object.
    if (!local || remote.updatedAt > local.updatedAt) merged.set(docSnap.id, remote);
  }

  // Throws if the user signed out (or switched accounts, or deleted the
  // account) while the read above was in flight -- see firestoreSync.ts's
  // makeSyncGuard. Without it, this line writes the previous account's plans,
  // and the reminders derived from them, back onto a device that has just
  // been wiped.
  guard();
  useScheduleStore.getState().applyRemoteScheduledSessions(Array.from(merged.values()));

  // Push back everything the remote side doesn't have, or has an older copy
  // of -- read from the store rather than from `merged`, since applying just
  // pruned anything aged out (schedule/scheduledSessions.ts's
  // pruneScheduledSessions) and the remote copy should match what this
  // device actually holds.
  const remoteClocks = new Map(
    snap.docs.map((d) => [d.id, (d.data() as Partial<RemotePlan>).updatedAt ?? -1]),
  );
  const toPush = useScheduleStore
    .getState()
    .scheduled.filter((p) => (remoteClocks.get(p.id) ?? -1) < p.updatedAt);

  await commitBatched(uid, toPush, [...staleRemote, ...Object.keys(deleted)]);
}

/** Writes `plans` and deletes `removeIds`, chunked at Firestore's batch
 * limit. Shared by the full sync above and the incremental push below. */
async function commitBatched(uid: string, plans: ScheduledSession[], removeIds: string[]): Promise<void> {
  if (plans.length === 0 && removeIds.length === 0) return;
  const db = getDb();
  const colRef = collection(db, 'users', uid, 'scheduledSessions');

  let batch = writeBatch(db);
  let count = 0;
  const flush = async () => {
    if (count > 0) await batch.commit();
    batch = writeBatch(db);
    count = 0;
  };

  for (const plan of plans) {
    batch.set(doc(colRef, plan.id), toRemote(plan));
    if (++count === BATCH_LIMIT) await flush();
  }
  for (const id of removeIds) {
    batch.delete(doc(colRef, id));
    if (++count === BATCH_LIMIT) await flush();
  }
  if (count > 0) await batch.commit();
}

/**
 * Incremental push after a local mutation -- called from
 * scheduledSessionsSyncBridge.ts with exactly the plans that changed.
 * No-op while signed out (the plans stay local, and the next sign-in's full
 * sync uploads them).
 *
 * Takes a list rather than reading the whole local set, and that is a
 * correctness requirement, not an optimization. toRemote writes
 * `notifiedAt: null` -- deliberately, since a client write is what re-arms an
 * EDITED plan -- so a write is not idempotent against a document the reminder
 * job has already marked as sent. Rewriting the whole set on every mutation
 * therefore re-armed every other plan in it, and the backend delivered their
 * reminders a second time (anything still inside its grace window and not
 * ticked done). Only what the user actually touched should be re-armed.
 *
 * Nothing is deleted from here, for the same "only what this mutation did"
 * reason. This used to pass every key of the store's `deletedIds` as batch
 * deletes, and tombstones are kept for 30 days (useScheduleStore's
 * pruneTombstones), so moving one plan half an hour later committed dozens
 * of deletes for documents removed days ago and long gone from Firestore.
 * The two callers that legitimately need a delete already have one: the
 * bridge removes the plan the user just deleted via
 * deleteRemoteScheduledSession below, and syncScheduledSessions above
 * reconciles the whole backlog against an actual listing of what the remote
 * side still holds -- which is the only place that comparison can be made
 * rather than guessed at.
 */
export async function pushScheduledSessions(plans: ScheduledSession[]): Promise<void> {
  const uid = currentUid();
  if (!uid) return;
  await commitBatched(uid, plans, []);
}

/**
 * Removes one plan's remote document immediately, so a deletion made while
 * online doesn't wait for the next full sync. Best-effort: the tombstone in
 * the store is what guarantees the deletion eventually sticks even if this
 * call never lands.
 */
export async function deleteRemoteScheduledSession(planId: string): Promise<void> {
  const uid = currentUid();
  if (!uid) return;
  try {
    await deleteDoc(doc(getDb(), 'users', uid, 'scheduledSessions', planId));
  } catch {
    // Offline or denied -- the tombstone retries on the next push.
  }
}
