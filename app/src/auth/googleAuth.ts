// googleAuth.ts -- native Google Sign-In -> Firebase credential exchange
// (§1.2), and the full secure sign-out (§2.4).
//
// Security note (design doc §5 checklist item 1): the raw Google ID token
// returned by GoogleSignin.signIn() is held only in the local `idToken`
// variable below, used exactly once to build a Firebase credential via
// GoogleAuthProvider.credential(), and then goes out of scope -- it is never
// passed to SecureStore, AsyncStorage, a log call, or a Firestore write.
// Firebase issues and manages its own session from `signInWithCredential`
// onward, persisted only through secureStorePersistence (§2.2).
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential, deleteUser, reauthenticateWithCredential, type User } from 'firebase/auth';
import * as SecureStore from 'expo-secure-store';
import { getFirebaseAuth } from './firebase';
import { SECURE_STORE_OPTS, FIREBASE_AUTH_SECURE_STORE_KEYS } from './secureStoreKeys';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from './firebaseConfig';

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
 * Runs the native Google Sign-In account picker, exchanges the resulting ID
 * token for a Firebase session, and returns the signed-in Firebase user.
 * Throws if the user cancels or the flow otherwise fails -- callers should
 * treat that as "stay signed out", not a fatal error.
 */
export async function signInWithGoogle(): Promise<User> {
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
  const credential = GoogleAuthProvider.credential(idToken);
  const userCredential = await signInWithCredential(getFirebaseAuth(), credential);
  // `idToken` and `credential` fall out of scope here -- used once, never persisted.
  return userCredential.user;
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
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch(() => {});
  }
}

/**
 * Full account deletion (design doc §4.3, §5 checklist item 12): deletes the
 * Firebase Auth user itself, then revokes/wipes the same way signOutFully()
 * does. Caller (useAuthStore.deleteAccount) MUST delete the user's Firestore
 * documents (firestoreSync.deleteAllUserData) BEFORE calling this -- once the
 * Auth user is gone, firestore.rules' `isOwner(uid)` check can never
 * authenticate as that uid again, so a cascade delete after this point is
 * impossible, not just harder.
 *
 * Firebase requires a *recent* sign-in to delete a user
 * (`auth/requires-recent-login` otherwise); this re-runs the native Google
 * Sign-In flow to get a fresh credential and re-authenticates before
 * deleting, so the deletion doesn't fail on a long-lived session.
 */
export async function deleteAccountFully(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn(); // fresh account picker -- proves recent user presence
  if (response.type === 'success' && response.data.idToken) {
    const credential = GoogleAuthProvider.credential(response.data.idToken);
    await reauthenticateWithCredential(user, credential);
  }
  await deleteUser(user);
  await GoogleSignin.revokeAccess().catch(() => {});
  await GoogleSignin.signOut().catch(() => {});
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch(() => {});
  }
}
