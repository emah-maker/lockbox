// authSession.ts -- the provider-agnostic half of every sign-in provider.
//
// googleAuth.ts, appleAuth.ts and emailAuth.ts each own exactly one thing:
// how to obtain a credential from their own native picker/sheet/form. What
// they then DO with that credential -- exchange it for a Firebase session,
// link it onto the current user, prove recent presence before a deletion,
// tear the session down -- was identical prose repeated three times, down to
// the `if (!user) return` guard and the SecureStore wipe loop. It lives here
// once instead, so a change to any of those contracts cannot land in two
// providers and miss the third.
//
// What deliberately does NOT live here: anything provider-specific. Google
// additionally revokes its native OAuth grant on sign-out and deletion; Apple
// and email/password have no client-revocable grant to release. That
// asymmetry is expressed as the optional `providerCleanup` callback below,
// which runs at exactly the point in the sequence the provider's own code
// used to run it -- after the Firebase call, before the SecureStore wipe --
// rather than being flattened into a shared "if google" branch.
import {
  signInWithCredential,
  linkWithCredential,
  deleteUser,
  reauthenticateWithCredential,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from './firebase';
import { wipeFirebaseAuthSecureStore } from './secureStoreKeys';
import { signInDetectingLinkConflict, type AuthProviderKind } from './accountLinking';

/**
 * Exchanges a provider credential for a Firebase session, routed through
 * accountLinking.ts's conflict handler so a user who already has an account
 * under this email via a DIFFERENT provider gets the "sign in with X to link"
 * prompt instead of a fatal auth/account-exists-with-different-credential.
 *
 * Not used by emailAuth.ts: signInWithEmailAndPassword takes no credential,
 * so it cannot produce that error code at all -- see signInWithEmail's own
 * comment for why skipping the wrapper there is intentional.
 */
export async function signInWithProviderCredential(
  kind: AuthProviderKind,
  credential: AuthCredential,
): Promise<User> {
  const userCredential = await signInDetectingLinkConflict(kind, credential, () =>
    signInWithCredential(getFirebaseAuth(), credential),
  );
  // `credential` falls out of scope in the caller -- used once, never persisted.
  return userCredential.user;
}

/**
 * Attaches `credential` to `user` -- the additive "I'm already signed in and
 * want to also add this provider" case.
 *
 * The invariant every caller depends on, stated once here rather than three
 * times: this must never route through signInWithCredential, which would
 * authenticate as a DIFFERENT (or brand-new) Firebase user tied to that
 * provider identity instead of attaching the credential to the one already
 * signed in. Callers must pass the CURRENT signed-in user.
 */
export async function linkCredentialToUser(user: User, credential: AuthCredential): Promise<User> {
  const result = await linkWithCredential(user, credential);
  return result.user;
}

/**
 * Proves the current user is present, by reauthenticating with a credential
 * `getCredential` mints for them. Step 1 of account deletion for every
 * provider.
 *
 * Failures propagate deliberately and must not be swallowed: the invariant
 * useAuthStore.deleteAccount relies on is that nothing irreversible runs
 * until this has succeeded, so a cancelled picker/sheet or a wrong password
 * has to abort the whole flow. Firebase requires a *recent* sign-in to delete
 * a user (`auth/requires-recent-login` otherwise); this is what proves that
 * recency, and deleteWithReauthRetry retries it once on that code.
 *
 * `getCredential` receives the user so a provider that needs a field off it
 * (emailAuth needs `user.email`) doesn't have to re-read currentUser itself
 * and risk reading a different one.
 */
export async function reauthenticateCurrentUser(
  getCredential: (user: User) => Promise<AuthCredential> | AuthCredential,
): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  const credential = await getCredential(user);
  await reauthenticateWithCredential(user, credential);
}

/**
 * Full secure sign-out: the Firebase session, the provider's own cleanup if
 * it has any, then a defense-in-depth explicit SecureStore wipe -- rather
 * than trusting any one of those SDKs' own cleanup alone.
 *
 * `context` names the caller for the wipe's failure log (e.g.
 * `'[googleAuth] signOutFully'`), which is the only way to tell which of the
 * paths through here failed.
 */
export async function signOutFirebaseSession(
  context: string,
  providerCleanup?: () => Promise<void>,
): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.signOut().catch(() => {});
  await providerCleanup?.();
  await wipeFirebaseAuthSecureStore(context);
}

/**
 * Step 3 of account deletion: deletes the Firebase Auth user itself, then
 * runs the same provider cleanup + wipe a sign-out does.
 *
 * Callers MUST have run reauthenticateCurrentUser() AND
 * firestoreSync.deleteAllUserData() BEFORE this -- once the Auth user is
 * gone, firestore.rules' `isOwner(uid)` check can never authenticate as that
 * uid again, so a cascade delete after this point is impossible, not just
 * harder. No native prompt runs here: reauthentication already proved recent
 * presence, so this is the one place deleteUser() itself is invoked.
 *
 * The `if (!user) return` guard short-circuits before `providerCleanup` for
 * the same reason each provider's own version did: with nobody signed in
 * there is no grant to revoke and nothing to wipe.
 */
export async function deleteFirebaseUser(
  context: string,
  providerCleanup?: () => Promise<void>,
): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  await deleteUser(user);
  await providerCleanup?.();
  await wipeFirebaseAuthSecureStore(context);
}
