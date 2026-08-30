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
