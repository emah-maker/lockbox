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
 * How long one Firebase Auth REST call may hang before the caller stops
 * waiting.
 *
 * useAuthStore bounds Firebase Auth starting up, the Firestore sync, the
 * deletion wipe and the push cleanup, for a reason its own comment states
 * plainly: an await that never settles is "not a slow operation; it is a
 * permanently disabled control with no error and no way back short of
 * force-quitting". The auth calls themselves were the gap. A stalled TCP
 * connection -- not a refused one, which rejects promptly as
 * auth/network-request-failed -- left signInWithCredential pending forever,
 * and with it SignedOutAccount's `busy`, which disables every sign-in control
 * on the page while it is true. One tap on a bad connection, and the only way
 * out was force-quitting the app.
 *
 * Generous, because the failure being prevented is infinite rather than slow.
 */
const AUTH_NETWORK_TIMEOUT_MS = 30_000;

/**
 * Bounds a Firebase Auth network call.
 *
 * Wraps ONLY the REST calls, never the native picker or sheet that precedes
 * them: choosing a Google account, or typing an Apple ID password, is paced by
 * a person and is allowed to take as long as it takes. Bounding the whole
 * sign-in would have turned a slow human into a failed sign-in -- so each call
 * site below wraps the SDK call alone, after the credential already exists.
 *
 * The message is one of accountDisplay.ts's authored sign-in strings, chosen
 * deliberately: a timeout here IS the no-connection case from the user's side,
 * and signInErrorMessage renders a `.code`-less error's message verbatim, so
 * anything else written here would reach the screen as novel copy. `name` is
 * for the logs, which are the only place the difference matters.
 */
export function withAuthNetworkTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      console.warn(`[authSession] ${what} did not finish within ${AUTH_NETWORK_TIMEOUT_MS}ms.`);
      const e = new Error('No connection. Check your network and try again.');
      e.name = 'AuthNetworkTimeoutError';
      reject(e);
    }, AUTH_NETWORK_TIMEOUT_MS);
  });
  // Cleared on the success path too, or every call would leave a live timer
  // behind in the RN timer queue (and keep a Jest run alive past its test).
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

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
    withAuthNetworkTimeout(signInWithCredential(getFirebaseAuth(), credential), 'signInWithCredential'),
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
  const result = await withAuthNetworkTimeout(linkWithCredential(user, credential), 'linkWithCredential');
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
  // Same reasoning as deleteFirebaseUser below: this function's whole job is
  // to prove the person at the phone is still present, and returning quietly
  // when there is no user reports that proof as obtained without anyone
  // having been asked for anything. Its one caller is the deletion retry, so
  // a false success here is what lets the destructive step proceed.
  if (!user) throw new Error('No signed-in user to re-authenticate.');
  // getCredential runs the native picker/sheet and is deliberately NOT
  // bounded -- see withAuthNetworkTimeout. Only the call after it is.
  const credential = await getCredential(user);
  await withAuthNetworkTimeout(reauthenticateWithCredential(user, credential), 'reauthenticateWithCredential');
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
  expectedUid?: string,
): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  // Delete the account the flow STARTED on, or nothing.
  //
  // `auth.currentUser` is read here, at the end of a sequence whose first
  // step opens a native picker -- so the identity it returns is whoever is
  // signed in NOW, not necessarily whoever the user asked to delete. A
  // sign-in that was still waiting on its own forgotten picker can land in
  // that window and swap it (useAuthStore's sessionGeneration exists because
  // that really is reachable), and deleteUser() would then erase an account
  // the user never chose -- irreversibly, after their own account's data had
  // already been wiped under the uid captured up front.
  //
  // Throwing rather than deleting is the only safe branch: deleteAccount's
  // catch turns it into AccountDataWipedError, which tells the user exactly
  // what happened -- their data is gone but the account remains -- and that
  // is recoverable. Deleting a stranger's account is not.
  if (expectedUid !== undefined && user && user.uid !== expectedUid) {
    throw new Error('The signed-in account changed before it could be deleted.');
  }
  // Throw, never return. This runs as step 3 of deleteAccount, AFTER the
  // cloud data has already been wiped, so a silent return here is the one
  // outcome the flow must never produce: deleteAccount does not throw,
  // clearSignedInState runs, the page swaps to signed-out, and the user is
  // told their account is gone while the Firebase Auth user still exists and
  // can be signed straight back into. Reachable when the session drops
  // between the re-authentication and this call.
  //
  // AccountDataWipedError exists precisely to describe "your cloud data was
  // deleted but removing the account itself failed", and deleteAccount's
  // catch already turns anything thrown here into it. Returning quietly was
  // the one way to route around that message.
  if (!user) throw new Error('No signed-in user to delete.');
  await withAuthNetworkTimeout(deleteUser(user), 'deleteUser');
  await providerCleanup?.();
  await wipeFirebaseAuthSecureStore(context);
}
