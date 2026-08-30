// sessionsSync.ts -- the session-history half of the Firestore sync:
// the full additive-union reconcile on sign-in, and the incremental pushes
// that follow a newly-logged session or a retag.
//
// Split from firestoreSync.ts, which keeps settings, goals, the sign-in
// orchestration and account deletion. The seam is a real one rather than a
// line count: session history merges by DETERMINISTIC DOCUMENT ID and is
// purely additive (sessionMerge.ts), whereas settings and goals are
// last-write-wins on a store clock. Nothing here reads or writes a
// settings/goals clock, and nothing there reads a session.
//
// Every inbound write takes the caller's `guard` -- see firestoreSync.ts's
// makeSyncGuard for the sign-out race it exists to stop.
import {
  doc,
  updateDoc,
  deleteField,
  collection,
  getDocs,
  query,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '../auth/firebase';
import {
  loadSessions,
  replaceSessions,
  clearSessions,
  MIN_LOGGED_SESSION_S,
  type LoggedSession,
} from '../stats/sessionHistory';
import { useStore } from '../store/useStore';
import { getJSON } from '../storage/storage';

/** Mirrors useStore.ts's own AsyncStorage key. */
const LAST_DEVICE_KEY = 'lastDeviceId';
import { sessionDocId, mergeSessionsPreferLocalTopic, type SessionRetag } from './sessionMerge';
import { markSessionsSeen } from './sessionsSyncBridge';
import { BATCH_LIMIT, pushTarget } from './syncCommon';

interface RemoteSession {
  startedAt: number;
  plannedS: number;
  actualS: number;
  outcome: 'completed' | 'overridden';
  topic?: string;
  topicUpdatedAt?: number;
}

// Best-effort: the box's own BLE peripheral id, as last recorded by
// useStore.ts on connect. Local session records don't currently carry a
// per-session deviceId of their own, so this uses the most-recently-known
// box id as the deviceId component of every session's deterministic doc ID
// -- see this implementation's report for the noted limitation (multi-box
// accounts could, in principle, attribute an old session to whichever box
// most recently connected).
async function currentDeviceId(): Promise<string> {
  return (await getJSON<string | null>(LAST_DEVICE_KEY, null)) ?? 'unknown-device';
}

/** Additive-union merge of session history, deduped by deterministic doc ID (§4.2). */
export async function syncSessions(uid: string, guard: () => void): Promise<void> {
  const db = getDb();
  const deviceId = await currentDeviceId();
  const [localSessions, remoteSnap] = await Promise.all([
    loadSessions(),
    getDocs(query(collection(db, 'users', uid, 'sessions'), orderBy('startedAt'))),
  ]);

  const remoteEntries = remoteSnap.docs
    .map((d) => {
      const data = d.data() as RemoteSession;
      return {
        id: d.id,
        session: {
          startedAt: data.startedAt,
          plannedS: data.plannedS,
          actualS: data.actualS,
          outcome: data.outcome,
          topic: data.topic,
          topicUpdatedAt: data.topicUpdatedAt,
        },
      };
    })
    // A remote doc under a minute shouldn't count as real focus time any
    // more than a local one -- see sessionHistory.ts's loadSessions. Without
    // this, a sub-minute session written by another device (or from before
    // this threshold existed) would sync in and re-inflate stats on every
    // device, since it never passes through buildLoggedSessions' own filter.
    .filter((e) => e.session.actualS >= MIN_LOGGED_SESSION_S);
  const { merged: mergedList, toUpload, toRetag } = mergeSessionsPreferLocalTopic(localSessions, remoteEntries, deviceId);

  // Write the full reconciled set back to local storage (replace, not
  // append -- appendSessions would double-count sessions already present).
  guard();
  const stored = await replaceSessions(mergedList);
  // Checked AGAIN, because this is the only guarded write in the whole sync
  // path with a real await between the check and the commit -- every other
  // one (applyRemoteSettings, applyRemoteGoals,
  // applyRemoteScheduledSessions) mutates its store synchronously the
  // instant after its guard, leaving no window at all. Here the storage
  // write yields the event loop, so a sign-out can land in between and the
  // two lines below would push this account's history straight into the live
  // store the Stats/Dashboard/Calendar screens read -- the guard having
  // already waved it through a moment earlier.
  try {
    guard();
  } catch (e) {
    // The write above may also have raced clearLocalAccountData's own
    // clearSessions() on the same storage key, in which case this account's
    // history is now sitting in storage on a device that just signed out.
    // Only undo it when NOBODY is signed in: after an account SWITCH the new
    // user's own sync owns this key (its ensureLocalDataScopedTo has already
    // wiped and its merge will overwrite wholesale), and clearing here would
    // be deleting their data to clean up ours.
    if (!getFirebaseAuth().currentUser) await clearSessions();
    throw e;
  }
  // Mirror into the live store too -- StatsScreen/DashboardScreen/
  // CalendarScreen read useStore.sessions, not AsyncStorage directly, so
  // without this they keep showing whichever account's data was in memory
  // before this sync ran. markSessionsSeen must run first: it stops
  // sessionsSyncBridge's push subscription from treating cross-device
  // sessions it hasn't personally seen as newly-logged and re-uploading them
  // under this device's doc-id namespace (see that function's own comment).
  markSessionsSeen(stored);
  useStore.getState().setSessions(stored);

  // Idempotent set() at each deterministic ID -- re-running after a crash or
  // retry never creates a duplicate. Chunked to Firestore's batch limit.
  for (let i = 0; i < toUpload.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const { id, session } of toUpload.slice(i, i + BATCH_LIMIT)) {
      batch.set(doc(db, 'users', uid, 'sessions', id), sessionPayload(session));
    }
    await batch.commit();
  }

  await pushTopicRetags(uid, toRetag);
}

function sessionPayload(s: LoggedSession) {
  return {
    startedAt: s.startedAt,
    plannedS: s.plannedS,
    actualS: s.actualS,
    outcome: s.outcome,
    ...(s.topic ? { topic: s.topic } : {}),
    ...(s.topicUpdatedAt ? { topicUpdatedAt: s.topicUpdatedAt } : {}),
  };
}

/** Pushes a batch of local retags (topic edits on sessions that already exist
 * remotely -- see sessionMerge.ts's toRetag) as scoped Firestore `update`s,
 * matching firestore.rules' sessions `update` rule (topic + topicUpdatedAt
 * only). Uses updateDoc's field-path semantics, not a full set(), so this
 * never risks re-sending (and rules-rejecting a change to) the immutable
 * startedAt/plannedS/actualS/outcome fields. `deleteField()` clears a topic
 * rather than writing `undefined`, which the Firestore SDK rejects outright. */
async function pushTopicRetags(uid: string, retags: SessionRetag[]): Promise<void> {
  if (!retags.length) return;
  const db = getDb();
  for (let i = 0; i < retags.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const { id, topic, topicUpdatedAt } of retags.slice(i, i + BATCH_LIMIT)) {
      batch.update(doc(db, 'users', uid, 'sessions', id), {
        topic: topic ?? deleteField(),
        topicUpdatedAt,
      });
    }
    await batch.commit();
  }
}

/**
 * Incremental push for newly-logged sessions (called from useStore.ts's
 * handleHistory right after a local appendSessions -- §4.3). No-op if
 * signed out. Best-effort: a failure here just means the next full sync
 * (syncSessions, run on the next sign-in/syncNow) catches up.
 */
export async function pushNewSessions(sessions: LoggedSession[]): Promise<void> {
  if (!sessions.length) return;
  const target = pushTarget();
  if (!target) return;
  const db = getDb();
  const deviceId = await currentDeviceId();
  const batch = writeBatch(db);
  for (const s of sessions) {
    batch.set(doc(db, 'users', target.uid, 'sessions', sessionDocId(deviceId, s)), sessionPayload(s));
  }
  await batch.commit();
}

/**
 * Incremental push for a single local retag (called from
 * sync/sessionsSyncBridge.ts when it notices an already-synced session's
 * topic/topicUpdatedAt changed -- mirrors pushNewSessions' "best-effort now,
 * next full sync catches up on failure" pattern). No-op if signed out, or if
 * the doc doesn't exist remotely yet (a session that hasn't been uploaded at
 * all goes through pushNewSessions with its current topic already attached,
 * not this path).
 */
export async function pushSessionRetag(
  target: Pick<LoggedSession, 'startedAt' | 'plannedS' | 'actualS'>,
  topic: string | undefined,
  topicUpdatedAt: number,
): Promise<void> {
  const owner = pushTarget();
  if (!owner) return;
  const deviceId = await currentDeviceId();
  const id = sessionDocId(deviceId, target);
  await updateDoc(doc(getDb(), 'users', owner.uid, 'sessions', id), {
    topic: topic ?? deleteField(),
    topicUpdatedAt,
  });
}
