// syncCommon.ts -- the few things both halves of the Firestore sync need,
// extracted so neither has to import the other.
//
// firestoreSync.ts (settings, goals, the sign-in orchestration and account
// deletion) and sessionsSync.ts (session history) were one 600-line file. The
// split is along the seam they already had -- session history reconciles by
// deterministic doc id and never touches a store clock, while settings and
// goals are last-write-wins on one -- but both ends still need the same
// batch limit, the same "is this uid really the signed-in one" assertion, and
// the same view of whether an account deletion is in flight.
import { getFirebaseAuth } from '../auth/firebase';

/** Firestore's per-batch write limit. */
export const BATCH_LIMIT = 500;

export function requireUid(uid: string): string {
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

/** Whether `uid` is the account currently being deleted. Read by every
 * incremental push, and by firestoreSync's own sync guard. */
export function isBeingDeleted(uid: string): boolean {
  return uid === deletingUid;
}

/** The signed-in user, unless an account deletion is in flight for them --
 * the precondition every incremental push shares. Null means "do not write".
 */
export function pushTarget(): { uid: string } | null {
  const user = getFirebaseAuth().currentUser;
  if (!user || isBeingDeleted(user.uid)) return null;
  return { uid: user.uid };
}

/**
 * Whether anyone is signed in, tolerating Firebase Auth not being
 * initialized yet. Unlike pushTarget() above -- which every push function
 * calls, and which is allowed to throw because by then init has certainly
 * happened -- this is the cheap early-out the SUBSCRIPTION bridges want: a
 * store can emit before initFirebaseAuth() resolves, and "not initialized"
 * means the same thing as "signed out" for a best-effort push.
 */
export function isSignedIn(): boolean {
  try {
    return !!getFirebaseAuth().currentUser;
  } catch {
    return false; // Firebase Auth not initialized yet -- nothing to push to
  }
}

/** The subset of a zustand store this module needs; declared structurally so
 * syncCommon stays free of any store import (and of the BLE manager useStore
 * builds at module scope). */
interface ReadableStore<S> {
  getState(): S;
  subscribe(listener: (state: S) => void): () => void;
}

/**
 * Builds the "watch a store, push the change" bridge that settingsSyncBridge
 * and goalsSyncBridge were each spelling out in full: an idempotent start
 * flag, a snapshot cached across emissions, a change compare that ignores
 * unrelated fields, the signed-out early-out, and a best-effort push whose
 * failure the next full sync catches up on.
 *
 * What stays with each caller is the only part that genuinely differs --
 * WHICH slice of its store counts as a change (`snapshot`/`equal`) and what
 * to push. Returns the start function rather than starting anything, so the
 * caller still exports a plainly-named `startXSyncBridge()` for App.tsx.
 *
 * Not used by sessionsSyncBridge (it diffs individual sessions into two
 * different pushes rather than comparing one snapshot) or by
 * scheduledSessionsSyncBridge (it also subscribes to auth state, and its
 * push carries per-plan detail) -- forcing either through this shape would
 * cost more than the repetition it removed.
 */
export function createSnapshotPushBridge<S extends { localWrites: number }, T>(
  store: ReadableStore<S>,
  snapshot: (state: S) => T,
  equal: (a: T, b: T) => boolean,
  push: () => Promise<unknown>,
): () => void {
  let started = false;
  return function start(): void {
    if (started) return;
    started = true;
    let prev = snapshot(store.getState());
    let prevWrites = store.getState().localWrites;
    store.subscribe((state) => {
      const next = snapshot(state);
      // Read and advance the counter BEFORE the snapshot early-out, not
      // after: a local edit that happens to leave the synced fields equal
      // (setting the theme to the value it already had) would otherwise
      // leave prevWrites stale, and the next non-local change -- a remote
      // document landing -- would look like that edit and get pushed back.
      const writes = state.localWrites;
      const editedHere = writes !== prevWrites;
      prevWrites = writes;
      if (equal(prev, next)) return; // an unrelated field on the same store changed
      prev = next;
      // Only a real user edit is mirrored. Hydration, a remote merge landing
      // and the sign-in wipe all replace these fields without anyone having
      // changed anything here, and the push is a whole-document setDoc: the
      // wipe (sync/localDataOwner.ts, which runs while ALREADY authenticated
      // as the new uid) used to arrive here as an ordinary change and
      // overwrite months of real cloud settings with defaults and
      // `updatedAt: 0`, before the two-way merge had read a byte of the
      // server's copy.
      if (!editedHere) return;
      if (!isSignedIn()) return; // signed out: local-only, nothing to push
      push().catch(() => {}); // best-effort; next successful sync catches up
    });
  };
}
