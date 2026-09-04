// googleAuth.ts -- native Google Sign-In -> Firebase credential exchange
// (§1.2), and the full secure sign-out (§2.4). signInWithGoogle() routes
// through accountLinking.ts's signInDetectingLinkConflict() so a user who
// already has an Apple-linked account under this email gets a clear
// "sign in with Apple to link" prompt instead of a fatal
// auth/account-exists-with-different-credential throw -- see
// accountLinking.ts for the shared conflict-handling logic appleAuth.ts uses
// too.
//
// Security note (design doc §5 checklist item 1): the raw Google ID token
// returned by GoogleSignin.signIn() is held only in the local `idToken`
// variable below, used exactly once to build a Firebase credential via
// GoogleAuthProvider.credential(), and then goes out of scope -- it is never
// passed to SecureStore, AsyncStorage, a log call, or a Firestore write.
// Firebase issues and manages its own session from `signInWithCredential`
// onward, persisted only through secureStorePersistence (§2.2).
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  signInWithCredential,
  linkWithCredential,
  deleteUser,
  reauthenticateWithCredential,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import * as SecureStore from 'expo-secure-store';
import { getFirebaseAuth } from './firebase';
import { SECURE_STORE_OPTS, FIREBASE_AUTH_SECURE_STORE_KEYS } from './secureStoreKeys';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from './firebaseConfig';
import { signInDetectingLinkConflict } from './accountLinking';

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID, // required on both platforms: the idToken audience Firebase expects
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    offlineAccess: false, // identity only -- no Google API scopes/server refresh token needed (§1.2)
  });
  configured = true;
}

/**
 * Runs the native Google Sign-In account picker and exchanges the resulting
 * ID token for a Firebase credential. Shared by signInWithGoogle (below) and
 * linkGoogleToCurrentUser -- both need the same "run the native picker, get
 * a fresh credential" step, they just do different things with the result.
 * Throws if the user cancels or the flow otherwise fails -- callers should
 * treat that as "stay signed out"/"link not completed", not a fatal error.
 */
async function getGoogleCredential(): Promise<AuthCredential> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (response.type !== 'success') {
    throw new Error('Google Sign-In was cancelled.');
  }
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google Sign-In did not return an ID token.');
  }
  return GoogleAuthProvider.credential(idToken);
  // `idToken` falls out of scope here -- used once, never persisted.
}

/**
 * Runs the native Google Sign-In account picker, exchanges the resulting ID
 * token for a Firebase session, and returns the signed-in Firebase user.
 * Throws if the user cancels or the flow otherwise fails -- callers should
 * treat that as "stay signed out", not a fatal error.
 */
export async function signInWithGoogle(): Promise<User> {
  const credential = await getGoogleCredential();
  const userCredential = await signInDetectingLinkConflict('google', credential, () =>
    signInWithCredential(getFirebaseAuth(), credential),
  );
  // `credential` falls out of scope here -- used once, never persisted.
  return userCredential.user;
}

/**
 * Links a fresh Google credential to `user` -- the additive "I'm already
 * signed in and want to also add Google" case (Account page §2 ask),
 * distinct from signInWithGoogle's sign-in-time conflict path above: this
 * deliberately never calls signInWithCredential, which would authenticate as
 * a DIFFERENT (or brand-new) Firebase user tied to this Google account
 * instead of attaching the credential to the one already signed in. Callers
 * must pass the CURRENT signed-in user (useAuthStore.linkProvider does).
 */
export async function linkGoogleToCurrentUser(user: User): Promise<User> {
  const credential = await getGoogleCredential();
  const result = await linkWithCredential(user, credential);
  return result.user;
}

/**
 * Full secure sign-out (§2.4): Firebase session, then the Google OAuth grant
 * itself (not just the local session cache), then the native module's own
 * cached account, then a defense-in-depth explicit SecureStore wipe -- rather
 * than trusting any one of those SDKs' own cleanup alone.
 */
export async function signOutFully(): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.signOut().catch(() => {});
  await GoogleSignin.revokeAccess().catch(() => {}); // invalidates the grant at Google, not just the local session
  await GoogleSignin.signOut().catch(() => {});
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    // Key names only, never token contents -- see secureStoreKeys.ts (safe to
    // log). Previously a bare `.catch(() => {})` gave no diagnostic at all if
    // this wipe ever failed (production readiness review, Medium).
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch((e) =>
      console.warn('[googleAuth] signOutFully: failed to delete', key, e?.message),
    );
  }
}

/**
 * Step 1 of account deletion (design doc §4.3, §5 checklist item 12): proves
 * the user is currently present via a fresh native Google Sign-In +
 * reauthenticateWithCredential, BEFORE useAuthStore.deleteAccount touches
 * anything destructive. This is deliberately stricter than
 * signInWithGoogle/linkGoogleToCurrentUser's "cancel = stay in the previous
 * state" contract: getGoogleCredential() already throws on a cancelled or
 * failed picker, and that throw is left to propagate here rather than
 * swallowed -- a cancelled picker MUST abort the whole deletion flow, since
 * the invariant deleteAccount relies on is that nothing irreversible runs
 * until this function has succeeded.
 *
 * Firebase requires a *recent* sign-in to delete a user
 * (`auth/requires-recent-login` otherwise); this is what proves that
 * recency. useAuthStore.deleteAccount retries this once on that error code
 * (deleteWithReauthRetry) before giving up.
 */
export async function reauthenticateForDeletion(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  const credential = await getGoogleCredential(); // throws on cancel -- see comment above
  await reauthenticateWithCredential(user, credential);
}

/**
 * Step 3 of account deletion: deletes the Firebase Auth user itself, then
 * revokes/wipes the same way signOutFully() does. Caller
 * (useAuthStore.deleteAccount) MUST call reauthenticateForDeletion() above
 * AND firestoreSync.deleteAllUserData() BEFORE calling this -- once the Auth
 * user is gone, firestore.rules' `isOwner(uid)` check can never authenticate
 * as that uid again, so a cascade delete after this point is impossible, not
 * just harder. No native prompt runs here -- reauthenticateForDeletion
 * already proved recent presence, so this is the one place deleteUser()
 * itself is invoked.
 */
export async function deleteUserAccount(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  await deleteUser(user);
  await GoogleSignin.revokeAccess().catch(() => {});
  await GoogleSignin.signOut().catch(() => {});
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch((e) =>
      console.warn('[googleAuth] deleteUserAccount: failed to delete', key, e?.message),
    );
  }
}
