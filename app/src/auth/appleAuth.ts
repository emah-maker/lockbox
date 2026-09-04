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
import {
  OAuthProvider,
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
 * Runs the native Sign in with Apple sheet and exchanges the resulting
 * identity token for a Firebase credential. Shared by signInWithApple
 * (below) and linkAppleToCurrentUser -- both need the same "run the native
 * sheet, get a fresh credential" step, they just do different things with
 * the result. Throws if the user cancels or the flow otherwise fails --
 * callers should treat that as "stay signed out"/"link not completed", not a
 * fatal error.
 */
async function getAppleCredential(): Promise<AuthCredential> {
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
  return provider.credential({ idToken: identityToken, rawNonce: nonce });
  // `identityToken` and `nonce` fall out of scope here -- used once, never persisted.
}

/**
 * Runs the native Sign in with Apple sheet, exchanges the resulting identity
 * token for a Firebase session, and returns the signed-in Firebase user.
 * Throws if the user cancels or the flow otherwise fails -- callers should
 * treat that as "stay signed out", not a fatal error.
 */
export async function signInWithApple(): Promise<User> {
  const credential = await getAppleCredential();
  const userCredential = await signInDetectingLinkConflict('apple', credential, () =>
    signInWithCredential(getFirebaseAuth(), credential),
  );
  // `credential` falls out of scope here -- used once, never persisted.
  return userCredential.user;
}

/**
 * Links a fresh Apple credential to `user` -- the additive "I'm already
 * signed in and want to also add Apple" case, mirroring
 * googleAuth.ts's linkGoogleToCurrentUser exactly (see its comment for why
 * this must never route through signInWithCredential). Callers must pass
 * the CURRENT signed-in user (useAuthStore.linkProvider does).
 */
export async function linkAppleToCurrentUser(user: User): Promise<User> {
  const credential = await getAppleCredential();
  const result = await linkWithCredential(user, credential);
  return result.user;
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
 * Step 1 of account deletion, matching googleAuth.ts's
 * reauthenticateForDeletion(): proves the user is currently present via a
 * fresh native Sign in with Apple sheet + reauthenticateWithCredential,
 * BEFORE useAuthStore.deleteAccount touches anything destructive.
 *
 * Unlike this file's OLD deleteAccountFully (which caught
 * ERR_REQUEST_CANCELED and fell through to deleteUser(), letting it fail
 * later with auth/requires-recent-login instead of aborting up front), a
 * cancelled sheet here is a hard failure: getAppleCredential() already turns
 * ERR_REQUEST_CANCELED into a plain throw, and that throw is left to
 * propagate rather than swallowed. The invariant deleteAccount relies on is
 * that nothing irreversible runs until this function has succeeded.
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
  const credential = await getAppleCredential(); // throws on cancel -- see comment above
  await reauthenticateWithCredential(user, credential);
}

/**
 * Step 3 of account deletion, matching googleAuth.ts's deleteUserAccount():
 * deletes the Firebase Auth user itself, then wipes the same way
 * signOutFully() does. Caller (useAuthStore.deleteAccount) MUST call
 * reauthenticateForDeletion() above AND firestoreSync.deleteAllUserData()
 * BEFORE calling this -- see googleAuth.ts's identical note. No native
 * prompt runs here -- reauthenticateForDeletion already proved recent
 * presence, so this is the one place deleteUser() itself is invoked.
 */
export async function deleteUserAccount(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  await deleteUser(user);
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch((e) =>
      console.warn('[appleAuth] deleteUserAccount: failed to delete', key, e?.message),
    );
  }
}
