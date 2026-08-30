// firestoreSync.ts -- migration (first sign-in) + ongoing merge sync between
// local storage and Firestore. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §4.
//
// Every Firestore path here is built from the *signed-in* user's own uid
// (requireUid below asserts this) -- never a client-supplied uid parameter
// (design doc §5 checklist item 15).
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  deleteDoc,
  collection,
  getDocs,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '../auth/firebase';
import { loadSessions, replaceSessions, clearSessions, MIN_LOGGED_SESSION_S, type LoggedSession } from '../stats/sessionHistory';
import { useSettingsStore, type SyncableSettings } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useScheduleStore } from '../store/useScheduleStore';
import { useStore } from '../store/useStore';
import { getJSON } from '../storage/storage';
import { planSettingsSync } from './settingsSyncPlan';
import { sessionDocId, mergeSessionsPreferLocalTopic, type SessionRetag } from './sessionMerge';
import { ensureLocalDataScopedTo, localDataGeneration } from './localDataOwner';
import { markSessionsSeen } from './sessionsSyncBridge';
import type { Goal } from '../goals/goals';
import { planGoalsSync } from './goalsSyncPlan';
import { syncScheduledSessions } from './scheduledSessionsSync';

const LAST_DEVICE_KEY = 'lastDeviceId'; // mirrors useStore.ts's own AsyncStorage key
const BATCH_LIMIT = 500; // Firestore's per-batch write limit

interface RemoteSession {
  startedAt: number;
  plannedS: number;
  actualS: number;
  outcome: 'completed' | 'overridden';
  topic?: string;
  topicUpdatedAt?: number;
}

interface RemoteSettings extends SyncableSettings {
  updatedAt: number;
}

// `goals` is typed `unknown` here, not `Goal[]` -- sanitizeRemoteGoals is
// the boundary-validation choke point (goals.ts's own header comment) that
// turns this untrusted shape into a real Goal[]; trusting the Firestore SDK's
// cast at this interface would defeat that entirely.
interface RemoteGoalsDoc {
  goals: unknown;
  updatedAt: number;
}

function requireUid(uid: string): string {
  const auth = getFirebaseAuth();
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('Sync uid does not match the current signed-in Firebase user.');
  }
  return uid;
}

// Guards the best-effort incremental push bridges (sessionsSyncBridge.ts,
// settingsSyncBridge.ts) against re-creating a doc that deleteAllUserData just
// wiped. deleteAccountFully()'s own re-authentication step (a fresh native
// Google sign-in) can take a while, and a settings/session change landing in
// that window -- still authenticated as the same uid, since the Auth user
// isn't removed until deleteAccountFully finishes -- would otherwise repush
// straight back into the account being deleted (production readiness review,
// Medium: "deleteAccount race with concurrent settings/session push
// bridges"). Module-local, in-memory only: this only ever needs to span one
// in-flight deleteAccount call within the current app session.
let deletingUid: string | null = null;

/** Call at the start of useAuthStore.deleteAccount, before deleteAllUserData. */
export function beginAccountDeletion(uid: string): void {
  deletingUid = uid;
}

/** Call once deleteAccountFully() has settled (success or failure). */
export function endAccountDeletion(): void {
  deletingUid = null;
}

/** Thrown by a sync guard when the local side this run was merging into is
 * no longer this uid's -- the user signed out, deleted the account, or
 * another account signed in while this run was awaiting Firestore. Caught in
 * runMigrationAndSync; never surfaced as a sync error, because nothing went
 * wrong. */
class LocalDataSuperseded extends Error {}

/**
 * Returns a check to call immediately before ANY write to local storage or a
 * local store, for as long as one sync run lasts.
 *
 * Why every inbound write needs one: runMigrationAndSync is started
 * fire-and-forget from onAuthStateChanged and from the manual Sync-now
 * button, and it spends most of its life awaiting Firestore round trips. Its
 * merge helpers then write straight into AsyncStorage and into
 * useStore/useSettingsStore/useGoalsStore. Only the outer syncNow() wrapper
 * re-checked the signed-in uid, and only around its own lastSyncedAt
 * bookkeeping -- the merges themselves checked nothing.
 *
 * So: user A's sync is awaiting a getDocs. The user taps Sign Out, which
 * wipes local account data and clears the live store. A's read then resolves
 * and calls replaceSessions/setSessions/applyRemoteSettings/applyRemoteGoals
 * with the merge it computed a moment ago -- writing A's history, theme,
 * labels and goals back onto a device that is now signed out. That is
 * precisely the leak clearLocalAccountData exists to prevent, arriving a few
 * hundred milliseconds after it ran. deleteAccount is the same race with
 * worse stakes: the data is supposed to be gone for good.
 *
 * Three conditions, because they fail independently: the generation catches a
 * wipe (sign-out, account switch, deletion), currentUser catches a sign-out
 * that somehow didn't wipe, and deletingUid catches the window inside
 * deleteAccount where the Auth user still exists but its data is being
 * removed.
 */
function makeSyncGuard(uid: string): () => void {
  const generation = localDataGeneration();
  return () => {
    if (
      localDataGeneration() !== generation ||
      getFirebaseAuth().currentUser?.uid !== uid ||
      uid === deletingUid
    ) {
      throw new LocalDataSuperseded(`local data is no longer ${uid}'s`);
    }
  };
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

/**
 * Runs on every successful sign-in (first device ever, or an Nth device --
 * §4.1/§4.2 collapse into the same merge logic here). Creates the account
 * profile doc if this is genuinely the first device, then reconciles
 * sessions (additive union) and settings (last-write-wins).
 */
export async function runMigrationAndSync(uid: string): Promise<void> {
  requireUid(uid);
  // Every two-way merge below reads this device's LOCAL side out of a zustand
  // store, and those stores load from AsyncStorage asynchronously -- kicked
  // off independently in App.tsx, awaited by nobody. For an already signed-in
  // user, Firebase's persisted session resolves onAuthStateChanged almost
  // immediately, so this whole function could and did run to completion
  // before those reads landed. Two things went wrong, in ascending order of
  // severity:
  //
  //   - hydrate()'s own `set` landed after a merge had already applied remote
  //     data, silently reverting the freshly-merged goals/plans (and the
  //     reminders derived from them) to the pre-sync local snapshot, even
  //     though storage itself was correct. Each store now also re-checks
  //     `hydrated` after its reads, which closes that half.
  //   - worse, and not fixable inside the stores: a merge run against a store
  //     that hasn't hydrated sees an EMPTY local side. Settings this device
  //     owns compare with a settingsUpdatedAt of 0 and lose last-write-wins
  //     to whatever the account already had; goals and plans this device
  //     created but never pushed simply aren't in the union.
  //
  // Awaiting hydration first is what actually fixes that: it is cheap (each
  // hydrate() no-ops once it has run) and it guarantees every merge below is
  // comparing two real sides.
  await Promise.all([
    useSettingsStore.getState().hydrate(),
    useGoalsStore.getState().hydrate(),
    useScheduleStore.getState().hydrate(),
  ]);
  // Must run before any read/write below: a device whose local storage still
  // belongs to a different (or no) account can't be allowed to blend into
  // uid's data -- see localDataOwner.ts.
  await ensureLocalDataScopedTo(uid);
  const db = getDb();
  const auth = getFirebaseAuth();
  const user = auth.currentUser!;
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // Every inbound (remote -> local) write below is gated on this. See
  // makeSyncGuard for the sign-out race it exists to stop.
  //
  // Created HERE, after ensureLocalDataScopedTo, and that placement is
  // load-bearing: on a first sign-in (or an account switch)
  // ensureLocalDataScopedTo wipes local storage itself, which bumps the very
  // generation counter this guard snapshots. Built any earlier, the guard
  // would see that legitimate, expected wipe as "someone signed out under me"
  // and abandon the sync -- so the one case that most needs to merge, a brand
  // new device pulling the account down for the first time, would abort every
  // single time and quietly do nothing.
  const guard = makeSyncGuard(uid);
  try {
    await syncSessions(uid, guard);
    await syncSettingsTwoWay(uid, guard);
    await syncGoalsTwoWay(uid, guard);
    // Planned focus sessions. Last of the four, and the only one whose
    // failure is swallowed rather than propagated: a plan that doesn't
    // reconcile on this sign-in still exists locally and still fires its own
    // local reminder, whereas every merge above feeds what the app actually
    // renders.
    //
    // Caught, not just ordered last. This collection is the newest, and it is
    // the one whose rules may not be deployed yet on a given project (the
    // scheduled-session feature can be shipped in the app before the
    // Firestore rules and its backend are) -- an un-deployed rule denies the
    // read, and an uncaught rejection here would surface as a whole-account
    // "sync failed" for a feature the user may not even be using. A
    // superseded local side is re-thrown rather than swallowed: it is not
    // this collection's own failure, it means the whole run should stop.
    await syncScheduledSessions(uid, guard).catch((e) => {
      if (e instanceof LocalDataSuperseded) throw e;
      console.warn('[sync] scheduled sessions did not reconcile:', e?.message ?? e);
    });
  } catch (e) {
    // Not a failure, so it must not surface as one: syncNow would otherwise
    // put a "sync failed" error in the account UI of a device that simply
    // signed out mid-sync, which is the expected outcome, not a fault. The
    // remote side is untouched and correct; there is just no longer a local
    // side belonging to this uid to merge into.
    if (e instanceof LocalDataSuperseded) {
      console.log('[sync] abandoned mid-run --', e.message);
      return;
    }
    throw e;
  }
}

/** Additive-union merge of session history, deduped by deterministic doc ID (§4.2). */
async function syncSessions(uid: string, guard: () => void): Promise<void> {
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

/** Two-way last-write-wins merge for the four account-level settings fields (§4.2). */
async function syncSettingsTwoWay(uid: string, guard: () => void): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'settings', 'app');
  const snap = await getDoc(ref);
  const local = useSettingsStore.getState();

  if (!snap.exists()) {
    await setDoc(ref, localSettingsPayload(local));
    return;
  }

  // The decision -- which side wins, and what the remote values become once
  // they are made safe to render -- is settingsSyncPlan.ts, where a test can
  // reach it. This function stays the I/O shell around it, the same shape
  // syncGoalsTwoWay has with goalsSyncPlan.
  const plan = planSettingsSync(local.settingsUpdatedAt, snap.data() as RemoteSettings);
  if (plan.action === 'apply') {
    guard();
    useSettingsStore.getState().applyRemoteSettings(plan.settings, plan.updatedAt);
  } else if (plan.action === 'push') {
    await setDoc(ref, localSettingsPayload(local));
  }
  // 'none': equal clocks, so both sides already hold the same write.
}

function localSettingsPayload(local: ReturnType<typeof useSettingsStore.getState>) {
  return {
    themeMode: local.themeMode,
    accent: local.accent,
    callAlertsEnabled: local.callAlertsEnabled,
    customLabels: local.customLabels,
    updatedAt: local.settingsUpdatedAt,
  };
}

/**
 * Two-way per-goal merge for the focus-goals doc (users/{uid}/goals/config --
 * this feature's own contract, §2), following syncSettingsTwoWay's overall
 * shape above but delegating the actual merge-and-push decision to
 * goalsSyncPlan.ts's planGoalsSync (itself built on goalMerge.ts's mergeGoals
 * -- union-by-id, per-goal last-write-wins -- and goals.ts's
 * sanitizeRemoteGoals) rather than a single doc-level LWW compare -- a goal
 * edited on one device and a different goal archived on another must both
 * survive, which a whole-doc "newer side wins" compare (like settings/app's)
 * would silently lose one of.
 */
async function syncGoalsTwoWay(uid: string, guard: () => void): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'goals', 'config');
  const snap = await getDoc(ref);
  const local = useGoalsStore.getState();

  if (!snap.exists()) {
    // Skip the write entirely when this device has never created a goal --
    // otherwise every fresh sign-in (including one that will never touch
    // this feature) writes an empty { goals: [], updatedAt: 0 } doc for no
    // reason. Once the user creates their first goal, useGoalsStore's own
    // mutation-triggered push (goalsSyncBridge.ts's pushGoalsPatch) or the
    // next full sync creates the doc for real.
    if (local.goals.length > 0) {
      await setDoc(ref, goalsPayload(local.goals, local.goalsUpdatedAt));
    }
    return;
  }

  // The actual merge-vs-push decision is a pure function (goalsSyncPlan.ts,
  // unit-tested there) -- this function is just the I/O shell around it:
  // read the doc, hand it the two sides, apply the result, maybe write it
  // back.
  const remote = snap.data() as RemoteGoalsDoc;
  const plan = planGoalsSync(local.goals, local.goalsUpdatedAt, remote.goals, remote.updatedAt ?? 0);

  // Apply locally unconditionally -- even when nothing needs to be written
  // back to Firestore, the merge may still have pulled in a goal (or an
  // edit/archive) that only existed on the remote side.
  guard();
  useGoalsStore.getState().applyRemoteGoals(plan.merged, plan.docUpdatedAt);

  if (plan.shouldPushBack) {
    // Re-read from the store rather than reusing `plan.merged` directly:
    // applyRemoteGoals just pruned aged-out archived tombstones (goals.ts's
    // pruneArchivedGoals, called from useGoalsStore's persist() -- see that
    // file's comment) before committing to local storage, and the payload
    // pushed to Firestore should match what this device now actually holds,
    // not the pre-prune merge result.
    await setDoc(ref, goalsPayload(useGoalsStore.getState().goals, plan.docUpdatedAt));
  }
}

function goalsPayload(goals: Goal[], updatedAt: number) {
  return { goals, updatedAt };
}

/**
 * Incremental push for newly-logged sessions (called from useStore.ts's
 * handleHistory right after a local appendSessions -- §4.3). No-op if
 * signed out. Best-effort: a failure here just means the next full sync
 * (syncSessions, run on the next sign-in/syncNow) catches up.
 */
export async function pushNewSessions(sessions: LoggedSession[]): Promise<void> {
  if (!sessions.length) return;
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user || user.uid === deletingUid) return;
  const db = getDb();
  const deviceId = await currentDeviceId();
  const batch = writeBatch(db);
  for (const s of sessions) {
    batch.set(doc(db, 'users', user.uid, 'sessions', sessionDocId(deviceId, s)), sessionPayload(s));
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
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user || user.uid === deletingUid) return;
  const db = getDb();
  const deviceId = await currentDeviceId();
  const id = sessionDocId(deviceId, target);
  await updateDoc(doc(db, 'users', user.uid, 'sessions', id), {
    topic: topic ?? deleteField(),
    topicUpdatedAt,
  });
}

/**
 * Incremental push for a local settings change (called from
 * sync/settingsSyncBridge.ts, which subscribes to useSettingsStore -- §4.3).
 * No-op if signed out. Mirrors useStore.ts's existing "optimistic local
 * write, best-effort remote sync" pattern for box settings (pushBoxSettings).
 */
export async function pushSettingsPatch(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user || user.uid === deletingUid) return;
  const db = getDb();
  const local = useSettingsStore.getState();
  await setDoc(doc(db, 'users', user.uid, 'settings', 'app'), localSettingsPayload(local));
}

/**
 * Incremental push for a local goals change (called from
 * sync/goalsSyncBridge.ts, which subscribes to useGoalsStore -- same §4.3
 * pattern as pushSettingsPatch above). No-op if signed out. This is a whole-
 * array push, not a per-goal patch -- see syncGoalsTwoWay's own comment on
 * why there's no cheaper partial-update path for goals the way sessions has
 * one for retags.
 */
export async function pushGoalsPatch(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user || user.uid === deletingUid) return;
  const db = getDb();
  const local = useGoalsStore.getState();
  await setDoc(doc(db, 'users', user.uid, 'goals', 'config'), goalsPayload(local.goals, local.goalsUpdatedAt));
}

/**
 * Deletes what firestore.rules actually permits a client to delete under
 * users/{uid} -- the settings, devices, and goals subcollections, then the
 * parent user doc itself (design doc §4.3, §5 checklist item 12; goals added
 * for the focus-goals feature -- firestore.rules' goals/config block allows
 * `delete` the same as settings/app). Firestore has no automatic
 * cascade-delete for subcollections, so each is enumerated and deleted
 * explicitly -- enumerating the whole `goals` subcollection here (rather
 * than a one-off deleteDoc on goals/config) stays correct even if a second
 * goals doc is ever added later, matching this function's existing pattern
 * for settings/devices.
 *
 * Deliberately does NOT attempt to delete `sessions`: firestore.rules (§3.2)
 * makes session docs `allow update, delete: if false` for every client,
 * including the owner -- a deliberate integrity property (a compromised
 * client token can't retroactively erase real history) that this deletion
 * path must not weaken. Those documents are orphaned, not purged, by account
 * deletion. This still satisfies checklist item 12's actual bar ("no
 * orphaned data remains READABLE under that uid"): once the parent
 * users/{uid} doc and the Auth user are both gone, `isOwner(uid)` can never
 * be satisfied again by anyone -- Firebase Auth never re-issues a deleted
 * uid, so a re-registration with the same Google account gets a brand-new
 * uid and starts from an empty users/{uid}, exactly as the checklist
 * requires. Physically purging the orphaned session docs would need a
 * privileged Cloud Function (Admin SDK bypasses rules) -- out of scope for
 * this client-only, no-backend design; flagged as a known follow-up, not a
 * silent gap.
 *
 * MUST be called (and awaited) BEFORE googleAuth.deleteAccountFully() removes
 * the Firebase Auth user -- every delete below is authorized by
 * `isOwner(uid)`, which requires the caller to still be signed in as that
 * uid. Deleting the auth user first would make even these permitted deletes
 * impossible (denied by the rules, not just inconvenient).
 */
export async function deleteAllUserData(uid: string): Promise<void> {
  requireUid(uid);
  const db = getDb();
  // pushTokens and scheduledSessions join the original three: a token left
  // behind would keep pushing a deleted account's reminders to a phone that
  // no longer has an account, and a scheduled session left behind would be
  // the thing being pushed. Both are also the only user data an automated
  // backend job reads, which makes leaving them the worst kind of leftover.
  const subcollections = ['settings', 'devices', 'goals', 'pushTokens', 'scheduledSessions'] as const;
  for (const sub of subcollections) {
    const snap = await getDocs(collection(db, 'users', uid, sub));
    // Firestore batches cap at 500 writes; chunk defensively even though a
    // single user's data is expected to stay well under that.
    let batch = writeBatch(db);
    let count = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      count += 1;
      if (count === BATCH_LIMIT) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  }
  await deleteDoc(doc(db, 'users', uid));
}
