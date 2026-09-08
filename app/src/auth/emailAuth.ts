// emailAuth.ts -- email/password sign-in, account creation, and the full
// secure sign-out, mirroring googleAuth.ts's and appleAuth.ts's structure and
// security-comment discipline as this app's third sign-in provider (see
// accountLinking.ts's AuthProviderKind).
//
// Security note (matches googleAuth.ts's and appleAuth.ts's own notes): a
// password passed into any function below is used exactly once -- handed
// straight to a Firebase SDK call (signInWithEmailAndPassword,
// createUserWithEmailAndPassword) or used to build an
// EmailAuthProvider.credential() for linkWithCredential/
// reauthenticateWithCredential -- and then goes out of scope. It is never
// passed to SecureStore, AsyncStorage, a log call, or a Firestore write.
// Firebase issues and manages its own session from that call onward,
// persisted only through secureStorePersistence (see firebase.ts), exactly as
// googleAuth.ts documents.
import {
  EmailAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  linkWithCredential,
  deleteUser,
  reauthenticateWithCredential,
  type User,
} from 'firebase/auth';
import * as SecureStore from 'expo-secure-store';
import { getFirebaseAuth } from './firebase';
import { SECURE_STORE_OPTS, FIREBASE_AUTH_SECURE_STORE_KEYS } from './secureStoreKeys';

/**
 * Signs in with an existing email/password account.
 *
 * Deliberately NOT routed through accountLinking.ts's
 * signInDetectingLinkConflict, unlike signInWithGoogle/signInWithApple.
 * auth/account-exists-with-different-credential is specifically what
 * signInWithCredential throws when the CREDENTIAL it was handed belongs to a
 * provider that doesn't match the one already on file for that email --
 * signInWithEmailAndPassword takes no such credential (email+password IS the
 * credential, verified directly against the account it names), so that code
 * is not a path this call can take. Under this project's Email Enumeration
 * Protection, a wrong password and a nonexistent account both surface here as
 * the single auth/invalid-credential code instead -- accountDisplay.ts's
 * SIGN_IN_ERROR_MESSAGES already maps that to copy that doesn't claim to
 * tell the two apart. Skipping the conflict wrapper here is intentional, not
 * a missed case: it would never fire.
 *
 * A pending link from an EARLIER Google/Apple conflict can still be
 * completed by a successful call here, though -- see useAuthStore.ts's
 * handleProviderSignIn, which checks the pending link's candidateProviders
 * against whichever provider just signed in successfully, independent of
 * how that sign-in got there.
 */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  // `password` falls out of scope here -- used once, never persisted.
  return result.user;
}

/**
 * Creates a new email/password account and signs it in -- Firebase does both
 * in one call. Fires a best-effort verification email: logged on failure,
 * never thrown, because the account already exists by the time
 * sendEmailVerification runs, so surfacing a failure here would incorrectly
 * tell the caller account creation itself failed. Verification is NOT
 * enforced anywhere in this app -- no screen gates on user.emailVerified, the
 * user goes straight in -- matching what already shipped on the website (see
 * website/js/emailAuthForm.js's identical best-effort send and comment).
 */
export async function createAccountWithEmail(email: string, password: string): Promise<User> {
  const result = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
  await sendEmailVerification(result.user).catch((e: any) =>
    console.warn('[emailAuth] createAccountWithEmail: sendEmailVerification failed', e?.message),
  );
  // `password` falls out of scope here -- used once, never persisted.
  return result.user;
}

/**
 * Sends a password-reset email. Resolves the same way whether or not `email`
 * has an account -- this project's Email Enumeration Protection means
 * Firebase itself never reveals that either way, so callers must show one
 * non-committal confirmation regardless of the outcome, never a
 * confirm/deny of the account's existence (matches website/js/
 * emailAuthForm.js's identical handling and comment).
 */
export async function sendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email);
}

/**
 * Links a fresh email/password credential to `user` -- the additive "I'm
 * already signed in and want to also add a password" case (Account page §2
 * ask), mirroring googleAuth.ts's linkGoogleToCurrentUser/appleAuth.ts's
 * linkAppleToCurrentUser: goes straight to linkWithCredential on the CURRENT
 * user rather than a sign-in call, so it can never authenticate as a
 * different (or brand-new) Firebase user tied to this email instead of
 * attaching the credential to the one already signed in. Callers must pass
 * the CURRENT signed-in user (useAuthStore.linkEmailPassword does).
 *
 * Unlike the OAuth providers there is no native picker/sheet to run first --
 * the credential is built directly from the caller's typed email/password,
 * which is why linkEmailPassword is a separate store action from
 * linkProvider rather than sharing its shape.
 */
export async function linkEmailToCurrentUser(user: User, email: string, password: string): Promise<User> {
  const credential = EmailAuthProvider.credential(email, password);
  const result = await linkWithCredential(user, credential);
  // `password` falls out of scope here -- used once, never persisted.
  return result.user;
}

/**
 * Full secure sign-out, mirroring appleAuth.ts's signOutFully() (not
 * googleAuth.ts's): the Firebase session, then a defense-in-depth explicit
 * SecureStore wipe. Like Sign in with Apple, there is no OAuth grant to
 * revoke here -- email/password is a Firebase-only credential with no
 * separate provider-side session -- so there is no equivalent of
 * GoogleSignin.revokeAccess()/signOut() to call.
 */
export async function signOutFully(): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.signOut().catch(() => {});
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    // Key names only, never token contents -- see secureStoreKeys.ts.
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch((e) =>
      console.warn('[emailAuth] signOutFully: failed to delete', key, e?.message),
    );
  }
}

/**
 * Step 1 of account deletion, matching googleAuth.ts's/appleAuth.ts's
 * reauthenticateForDeletion(): proves the user is currently present, BEFORE
 * useAuthStore.deleteAccount touches anything destructive. Same hard-failure
 * contract as the other two providers document: a failure here (wrong
 * password, or any other rejection) aborts the whole deletion flow, since
 * nothing irreversible has run yet.
 *
 * Unlike the OAuth providers, there is no native picker/sheet this module can
 * re-run on its own to prove presence -- the caller (useAuthStore.deleteAccount)
 * is responsible for having already collected `password` from the user
 * (throwing PasswordRequiredError first if it hasn't).
 *
 * Firebase requires a *recent* sign-in to delete a user
 * (`auth/requires-recent-login` otherwise); this is what proves that
 * recency. useAuthStore.deleteAccount retries this once on that error code
 * (deleteWithReauthRetry) before giving up.
 */
export async function reauthenticateForDeletion(password: string): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  if (!user.email) {
    // Should be unreachable: every email/password-linked Firebase user has
    // `email` set from account creation. Thrown rather than silently
    // returned -- returning here would let deleteAccount's caller believe
    // reauth succeeded and proceed straight to the destructive Firestore
    // wipe without anything having actually proven the user's presence.
    throw new Error('The current user has no email; cannot reauthenticate with a password.');
  }
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
  // `password` falls out of scope here -- used once, never persisted.
}

/**
 * Step 3 of account deletion, matching googleAuth.ts's/appleAuth.ts's
 * deleteUserAccount(): deletes the Firebase Auth user itself, then wipes the
 * same way signOutFully() does. Caller (useAuthStore.deleteAccount) MUST call
 * reauthenticateForDeletion() above AND firestoreSync.deleteAllUserData()
 * BEFORE calling this -- see googleAuth.ts's identical note. No native prompt
 * runs here -- reauthenticateForDeletion already proved recent presence, so
 * this is the one place deleteUser() itself is invoked.
 */
export async function deleteUserAccount(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  await deleteUser(user);
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch((e) =>
      console.warn('[emailAuth] deleteUserAccount: failed to delete', key, e?.message),
    );
  }
}
