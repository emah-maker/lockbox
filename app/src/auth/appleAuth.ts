// appleAuth.ts -- native Sign in with Apple -> Firebase credential exchange,
// mirroring googleAuth.ts's structure and security-comment discipline, and
// the full secure sign-out.
//
// Security note (matches googleAuth.ts's own note): the raw Apple
// `identityToken` returned by AppleAuthentication.signInAsync() is held only
// in the local `identityToken` variable below, used exactly once to build a
// Firebase credential via OAuthProvider('apple.com').credential(), and then
// goes out of scope -- it is never passed to SecureStore, AsyncStorage, a log
// call, or a Firestore write. The nonce (below) is generated fresh per
// attempt and is equally never persisted or logged. Firebase issues and
// manages its own session from `signInWithCredential` onward, persisted only
// through secureStorePersistence (see firebase.ts), exactly as googleAuth.ts
// documents.
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { OAuthProvider, signInWithCredential, deleteUser, reauthenticateWithCredential, type User } from 'firebase/auth';
import * as SecureStore from 'expo-secure-store';
import { getFirebaseAuth } from './firebase';
import { SECURE_STORE_OPTS, FIREBASE_AUTH_SECURE_STORE_KEYS } from './secureStoreKeys';
import { signInDetectingLinkConflict } from './accountLinking';

const APPLE_SCOPES = [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL];

/**
 * Generates a random nonce and its SHA-256 hash. Apple requires the *hashed*
 * nonce in the sign-in request (so Apple's servers never see the raw value)
 * and Firebase requires the *raw* nonce alongside the identityToken, so it
 * can verify the token was minted for this exact attempt (replay
 * protection). Generated fresh per call -- never reused across attempts.
 */
async function generateNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

/**
 * Runs the native Sign in with Apple sheet, exchanges the resulting identity
 * token for a Firebase session, and returns the signed-in Firebase user.
 * Throws if the user cancels or the flow otherwise fails -- callers should
 * treat that as "stay signed out", not a fatal error.
 */
export async function signInWithApple(): Promise<User> {
  const { raw: nonce, hashed: hashedNonce } = await generateNonce();
  let result: AppleAuthentication.AppleAuthenticationCredential;
  try {
    result = await AppleAuthentication.signInAsync({ requestedScopes: APPLE_SCOPES, nonce: hashedNonce });
  } catch (e: any) {
    if (e?.code === 'ERR_REQUEST_CANCELED') {
      throw new Error('Apple Sign-In was cancelled.');
    }
    throw e;
  }
  const { identityToken } = result;
  if (!identityToken) {
    throw new Error('Apple Sign-In did not return an identity token.');
  }
  const provider = new OAuthProvider('apple.com');
  const credential = provider.credential({ idToken: identityToken, rawNonce: nonce });
  const userCredential = await signInDetectingLinkConflict('apple', credential, () =>
    signInWithCredential(getFirebaseAuth(), credential),
  );
  // `identityToken`, `nonce`, and `credential` fall out of scope here -- used
  // once, never persisted.
  return userCredential.user;
}

/**
 * Full secure sign-out, matching googleAuth.ts's signOutFully(): the
 * Firebase session, then a defense-in-depth explicit SecureStore wipe.
 * Unlike Google, Sign in with Apple has no client-revocable local grant to
 * release -- Apple's revocation model is server-side (an authorization-code
 * exchange this app doesn't implement) -- so there is no equivalent of
 * GoogleSignin.revokeAccess()/signOut() to call here.
 */
export async function signOutFully(): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.signOut().catch(() => {});
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    // Key names only, never token contents -- see secureStoreKeys.ts.
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch((e) =>
      console.warn('[appleAuth] signOutFully: failed to delete', key, e?.message),
    );
  }
}

/**
 * Full account deletion, matching googleAuth.ts's deleteAccountFully():
 * deletes the Firebase Auth user itself, then wipes the same way
 * signOutFully() does. Caller (useAuthStore.deleteAccount) MUST delete the
 * user's Firestore documents BEFORE calling this -- see googleAuth.ts's
 * identical note.
 *
 * Firebase requires a *recent* sign-in to delete a user
 * (`auth/requires-recent-login` otherwise); this re-runs the native Apple
 * Sign-In sheet to get a fresh credential and re-authenticates before
 * deleting, so the deletion doesn't fail on a long-lived session.
 */
export async function deleteAccountFully(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  const { raw: nonce, hashed: hashedNonce } = await generateNonce();
  // Unlike GoogleSignin.signIn() (which resolves with a "cancelled" result
  // type), AppleAuthentication.signInAsync() REJECTS with ERR_REQUEST_CANCELED
  // on cancel -- caught here so a cancelled reauth sheet skips
  // reauthenticateWithCredential and falls through to deleteUser() below
  // (which itself throws auth/requires-recent-login if the session actually
  // isn't recent), matching googleAuth.ts's graceful-skip-on-cancel behavior
  // instead of aborting the whole deletion on a cancelled picker.
  let result: AppleAuthentication.AppleAuthenticationCredential | null = null;
  try {
    result = await AppleAuthentication.signInAsync({ requestedScopes: APPLE_SCOPES, nonce: hashedNonce }); // fresh sheet -- proves recent user presence
  } catch (e: any) {
    if (e?.code !== 'ERR_REQUEST_CANCELED') throw e;
  }
  if (result?.identityToken) {
    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({ idToken: result.identityToken, rawNonce: nonce });
    await reauthenticateWithCredential(user, credential);
  }
  await deleteUser(user);
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch((e) =>
      console.warn('[appleAuth] deleteAccountFully: failed to delete', key, e?.message),
    );
  }
}
