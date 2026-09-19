// firestoreSync.ts -- migration (first sign-in) + ongoing merge sync between
// local storage and Firestore. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §4.
//
// SCOPE. This file owns the sign-in orchestration (runMigrationAndSync), the
// sign-out race guard every inbound write goes through (makeSyncGuard), the
// two last-write-wins merges -- settings and goals -- and account deletion.
// Session history lives in sessionsSync.ts, and the handful of things both
// need in syncCommon.ts.
//
// That split is along a seam these two halves already had, not a line count:
// session history reconciles by DETERMINISTIC DOCUMENT ID and is purely
// additive, so it has no document clock to compare and can never lose a
// write, whereas settings and goals are last-write-wins on a store clock and
// are entirely about which side wins. Nothing here reads a session; nothing
// there reads a settings or goals clock.
//
// Every Firestore path here is built from the *signed-in* user's own uid
// (syncCommon's requireUid asserts this) -- never a client-supplied uid
// parameter (design doc §5 checklist item 15).
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  writeBatch,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '../auth/firebase';
import { useSettingsStore, type SyncableSettings } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useScheduleStore } from '../store/useScheduleStore';
import { planSettingsSync } from './settingsSyncPlan';
import { queueSettingsWrite } from './settingsWriteQueue';
import { syncSessions } from './sessionsSync';
import { BATCH_LIMIT, isBeingDeleted, pushTarget, requireUid } from './syncCommon';
import { ensureLocalDataScopedTo, localDataGeneration } from './localDataOwner';
import type { Goal } from '../goals/goals';
import { planGoalsSync } from './goalsSyncPlan';
import { syncScheduledSessions } from './scheduledSessionsSync';

// Re-exported so useAuthStore still has one import for the whole sync
// surface. They live in syncCommon rather than here because sessionsSync's
// own pushes read the same flag, and neither module may import the other.
export { beginAccountDeletion, endAccountDeletion } from './syncCommon';

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
      isBeingDeleted(uid)
    ) {
      throw new LocalDataSuperseded(`local data is no longer ${uid}'s`);
    }
  };
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
    // Re-checked, not asserted non-null. requireUid(uid) above did check it,
    // but FOUR awaits ago -- three hydrate()s and ensureLocalDataScopedTo --
    // and this function is started fire-and-forget from onAuthStateChanged
    // and from the Sync-now button, so a sign-out, an account switch or an
    // account deletion can land in that window. `auth.currentUser!` then
    // read null and the profile write below threw a TypeError on
    // `user.email`, which propagated as a generic "sync failed" on the
    // Account page for a sign-out the user performed on purpose. It is the
    // same expected, benign outcome the LocalDataSuperseded path at the
    // bottom of this function already exists to swallow -- and the profile
    // write is above the first guard() call, so nothing else was going to
    // catch it. A DIFFERENT uid is the same window with worse stakes: these
    // writes are all built from `uid`, so they would be aimed at an account
    // nobody is signed in as (and denied by firestore.rules' isOwner).
    const user = getFirebaseAuth().currentUser;
    if (!user || user.uid !== uid) {
      throw new LocalDataSuperseded(`${uid} is no longer the signed-in user`);
    }
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
      // Diagnostic only, and __DEV__-gated accordingly: as the comment above
      // says this is the expected outcome, not a fault, so a release build
      // should not log it.
      if (__DEV__) console.log('[sync] abandoned mid-run --', e.message);
      return;
    }
    throw e;
  }
}

/** Two-way last-write-wins merge for the five account-level settings fields (§4.2). */
async function syncSettingsTwoWay(uid: string, guard: () => void): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'settings', 'app');
  const snap = await getDoc(ref);
  // Read AFTER the getDoc above, deliberately: a snapshot taken before it
  // would compare a clock that could already have moved on while the read was
  // in flight, and lose the change that moved it. Everything from here to the
  // applyRemoteSettings below is synchronous, so nothing can slip in between
  // deciding and acting.
  const local = useSettingsStore.getState();

  if (!snap.exists()) {
    await pushLocalSettings(uid);
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
    // NOT `localSettingsPayload(local)`. `local` is the snapshot this run
    // made its decision from, and the write below may sit behind another one
    // for a while; by the time it goes out the user may have changed a
    // setting, and sending the snapshot would put the superseded values back
    // into the account. pushLocalSettings re-reads at send time instead --
    // see settingsWriteQueue.ts for the race this closes.
    await pushLocalSettings(uid);
  }
  // 'none': equal clocks, so both sides already hold the same write.
}

/**
 * The ONE way this app writes users/{uid}/settings/app -- both the two-way
 * merge above and pushSettingsPatch below go through here.
 *
 * Two properties, and settingsWriteQueue.ts's header explains why neither is
 * sufficient alone:
 *
 *   - the payload is built from LIVE store state at send time, never from a
 *     snapshot the caller took before its own awaits, so a write can only
 *     ever carry the newest local values;
 *   - writes are serialized, so two of them are never in flight at once and
 *     the server cannot apply them out of order.
 *
 * The pushTarget() re-check is here rather than at the call sites for the
 * same reason: it has to be evaluated when the write actually goes out. A
 * write queued behind another one can find, by the time its turn comes, that
 * the user signed out, switched accounts, or started deleting this one.
 */
function pushLocalSettings(uid: string): Promise<void> {
  return queueSettingsWrite(uid, async () => {
    const target = pushTarget();
    if (!target || target.uid !== uid) return;
    await setDoc(
      doc(getDb(), 'users', uid, 'settings', 'app'),
      localSettingsPayload(useSettingsStore.getState()),
    );
  });
}

function localSettingsPayload(local: ReturnType<typeof useSettingsStore.getState>) {
  return {
    themeMode: local.themeMode,
    accent: local.accent,
    callAlertsEnabled: local.callAlertsEnabled,
    customLabels: local.customLabels,
    excludedTopicKeys: local.excludedTopicKeys,
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
 * Incremental push for a local settings change (called from
 * sync/settingsSyncBridge.ts, which subscribes to useSettingsStore -- §4.3).
 * No-op if signed out. Mirrors useStore.ts's existing "optimistic local
 * write, best-effort remote sync" pattern for box settings (pushBoxSettings).
 *
 * Shares pushLocalSettings with the two-way merge rather than issuing its own
 * setDoc: these are the two writers that used to race each other for this one
 * document.
 */
export async function pushSettingsPatch(): Promise<void> {
  const target = pushTarget();
  if (!target) return;
  await pushLocalSettings(target.uid);
}

/**
 * Incremental push for a local goals change (called from
 * sync/goalsSyncBridge.ts, which subscribes to useGoalsStore -- same §4.3
 * pattern as pushSettingsPatch above). No-op if signed out.
 *
 * Unlike pushSettingsPatch this is NOT a blind whole-document write, and the
 * difference is the whole reason goals has planGoalsSync at all: settings/app
 * is whole-document last-write-wins, so pushing this device's copy over it is
 * the protocol. goals/config is a per-item UNION (syncGoalsTwoWay's comment,
 * and goalMerge.ts's) precisely so a goal added on the dashboard and a goal
 * edited on the phone both survive -- and a blind setDoc from here bypassed
 * that union entirely. Add a goal on the dashboard, then edit any goal on the
 * phone before its next full sync, and the phone's array -- which never
 * contained the new goal -- replaced the document. The next syncGoalsTwoWay
 * then union-merged against a document the goal was already absent from, so
 * neither side had a copy left to restore it from.
 *
 * Hence read-modify-write, and in a transaction rather than a getDoc/setDoc
 * pair: two devices pushing at once would otherwise each merge against the
 * pre-write document and the later write would still drop the earlier one's
 * goal, which is the same bug one round trip narrower. The SDK re-runs this
 * callback on contention, which is why the local state is read INSIDE it.
 *
 * The merge result is deliberately not applied locally. This runs from a
 * best-effort bridge with no sync guard, and writing remote goals into a
 * store that may have been wiped by a sign-out mid-flight is exactly the leak
 * makeSyncGuard exists to stop. Leaving it is safe: the document now holds
 * the union, and the next syncGoalsTwoWay pulls the missing goal down under
 * a guard.
 */
export async function pushGoalsPatch(): Promise<void> {
  const target = pushTarget();
  if (!target) return;
  const db = getDb();
  const ref = doc(db, 'users', target.uid, 'goals', 'config');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    // Same untrusted shape syncGoalsTwoWay reads, so it goes through the same
    // sanitize-and-merge decision rather than a second, thinner copy of it.
    const remote = snap.exists() ? (snap.data() as RemoteGoalsDoc) : undefined;
    const local = useGoalsStore.getState();
    const plan = planGoalsSync(local.goals, local.goalsUpdatedAt, remote?.goals, remote?.updatedAt ?? 0);
    // Nothing new for the remote side: the bridge fired for something this
    // document doesn't carry, or another device already pushed this exact
    // state. Writing anyway would bump the doc clock every other device
    // re-merges against, for no content change.
    if (!plan.shouldPushBack) return;
    tx.set(ref, goalsPayload(plan.merged, plan.docUpdatedAt));
  });
}

/**
 * Deletes everything stored under users/{uid} -- the parent doc first, then
 * every subcollection (design doc §4.3, §5 checklist item 12; goals added
 * for the focus-goals feature -- firestore.rules' goals/config block allows
 * `delete` the same as settings/app). Firestore has no automatic
 * cascade-delete for subcollections, so each is enumerated and deleted
 * explicitly -- enumerating the whole `goals` subcollection here (rather
 * than a one-off deleteDoc on goals/config) stays correct even if a second
 * goals doc is ever added later, matching this function's existing pattern
 * for settings/devices.
 *
 * `sessions` is included, and getting it there is why the parent user doc is
 * deleted FIRST rather than last. Session docs are append-only for every
 * client including the owner -- an integrity property this path must not
 * weaken -- so firestore.rules permits deleting one only while users/{uid}
 * is absent, which is a state nothing but this function ever produces.
 * Removing the parent first opens that window; the sweep below closes it.
 *
 * Sessions used to be left behind instead, on the reasoning that a deleted
 * uid is never reissued so orphaned docs stay unreadable forever. That still
 * holds, but unreadable is not deleted: App Store Review Guideline 5.1.1(v)
 * asks for the account AND its associated data, and session topics are
 * free text a user typed. The alternative was a privileged Cloud Function
 * (Admin SDK bypasses rules), which this client-only design has nowhere to
 * run.
 *
 * Interruption is safe. If this throws partway, users/{uid} is already gone,
 * so a retry re-enters the same window and finishes the sweep. If the user
 * instead keeps using the app, runMigrationAndSync recreates users/{uid} and
 * sessions go back to being append-only -- the correct resting state, and a
 * later deletion reopens the window from the top.
 *
 * A stale deployed ruleset is safe too: the session sweep is the one step
 * allowed to fail, because firestore.rules ships separately from the binary.
 * See the try/catch at the end of the body.
 *
 * MUST be called (and awaited) AFTER useAuthStore.deleteAccount's re-auth
 * step succeeds but BEFORE googleAuth/appleAuth's deleteUserAccount() removes
 * the Firebase Auth user -- every delete below is authorized by
 * `isOwner(uid)`, which requires the caller to still be signed in as that
 * uid. Deleting the auth user first would make even these permitted deletes
 * impossible (denied by the rules, not just inconvenient).
 */
/** Enumerate one subcollection under users/{uid} and delete every document
 * in it. Firestore has no cascade-delete, so each is swept explicitly. */
async function deleteSubcollection(db: ReturnType<typeof getDb>, uid: string, sub: string): Promise<void> {
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

export async function deleteAllUserData(uid: string): Promise<void> {
  requireUid(uid);
  const db = getDb();
  // FIRST, and load-bearing rather than tidy: firestore.rules only permits a
  // session delete while this doc is absent (see the docblock above). Deleting
  // it last -- as this did while sessions were merely orphaned -- would leave
  // every session permanently undeletable by anyone.
  await deleteDoc(doc(db, 'users', uid));
  // pushTokens and scheduledSessions join the original three: a token left
  // behind would keep pushing a deleted account's reminders to a phone that
  // no longer has an account, and a scheduled session left behind would be
  // the thing being pushed. Both are also the only user data an automated
  // backend job reads, which makes leaving them the worst kind of leftover.
  for (const sub of ['settings', 'devices', 'goals', 'pushTokens', 'scheduledSessions'] as const) {
    await deleteSubcollection(db, uid, sub);
  }
  // Sessions go last, and are the one sweep permitted to fail.
  //
  // firestore.rules is deployed separately from the app binary -- it is not
  // in the bundle -- so a build can reach a phone before the ruleset that
  // lets it purge sessions is live. Then these deletes come back
  // permission-denied, and letting that throw would abandon the flow with
  // users/{uid} already gone and the Auth user still alive: strictly worse
  // than the orphaning this replaced, and on the one path the user cannot
  // retry from a clean state. Swallowing it degrades to exactly the old
  // behaviour instead, and the warning is the signal that
  // `firebase deploy --only firestore:rules` is overdue.
  try {
    await deleteSubcollection(db, uid, 'sessions');
  } catch (e) {
    console.warn('[sync] session history not purged on account deletion:', e instanceof Error ? e.message : e);
  }
}
