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
import { OAuthProvider, updateProfile, type AuthCredential, type User } from 'firebase/auth';
import {
  signInWithProviderCredential,
  linkCredentialToUser,
  reauthenticateCurrentUser,
  signOutFirebaseSession,
  deleteFirebaseUser,
} from './authSession';

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
async function getAppleCredential(): Promise<AppleCredential> {
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
  return { credential: provider.credential({ idToken: identityToken, rawNonce: nonce }), displayName: fullNameOf(result) };
  // `identityToken` and `nonce` fall out of scope here -- used once, never persisted.
}

/** What getAppleCredential() hands back: the Firebase credential, plus the
 * one piece of profile data Apple will never send again (see fullNameOf). */
type AppleCredential = { credential: AuthCredential; displayName: string | null };

/**
 * Apple's `fullName`, flattened to the single string Firebase stores.
 *
 * Apple returns `fullName` ONLY on the very first authorization for this
 * Apple ID + app pair, and never again on any later sign-in -- unlike `email`,
 * it is not carried in the identity token either, so once this first response
 * is discarded the name is unrecoverable by any means, on any device, forever.
 * This function existed nowhere: getAppleCredential destructured
 * `identityToken` and dropped the rest, so every Apple-only account in this
 * app had `displayName === null` permanently.
 *
 * What the user saw: IdentityHeader.tsx and SettingsScreen.tsx both render
 * `displayName ?? email ?? 'Signed in'`, and an Apple user who chose "Hide My
 * Email" has an `email` like `a1b2c3@privaterelay.appleid.com` -- so the
 * Account page greeted them with a random relay address, and firestoreSync.ts
 * wrote `displayName: null` into their cloud profile to match.
 *
 * Only given/family are used. Apple populates namePrefix/middleName/suffix/
 * nickname from the Apple ID record and they are usually null; "Dr." and a
 * middle name are not what belongs in a one-line "Signed in as" header.
 */
function fullNameOf(result: AppleAuthentication.AppleAuthenticationCredential): string | null {
  const parts = [result.fullName?.givenName, result.fullName?.familyName].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' ').trim() : null;
}

/**
 * Writes the captured name onto the Firebase user, once, and never fails the
 * sign-in over it.
 *
 * Two guards, both load-bearing:
 *
 * `user.displayName` must be empty first. On a link (linkAppleToCurrentUser)
 * or a second sign-in to an account that already has a name from Google, the
 * Apple name -- if Apple even sent one -- must not overwrite it.
 *
 * And nothing here may throw. By the time this runs the user is ALREADY
 * signed in: Firebase has accepted them and onAuthStateChanged has fired. An
 * updateProfile() rejection (an offline phone, a token refresh failure) that
 * propagated would come back out of signInWithApple() and be rendered by
 * SignedOutAccount as a failed sign-in, for a sign-in that completely
 * succeeded -- the same "told the sign-in FAILED after it worked" trap
 * secureStorePersistence.ts's _set documents and avoids the same way. A
 * missing display name is a cosmetic loss; a false failure is not.
 */
async function applyAppleDisplayName(user: User, displayName: string | null): Promise<void> {
  if (!displayName || user.displayName) return;
  try {
    await updateProfile(user, { displayName });
  } catch (e: any) {
    // Name only -- never the email or the uid (design doc §5 checklist item 2).
    console.warn('[appleAuth] could not save the name Apple provided:', e?.message ?? e);
  }
}

/**
 * Runs the native Sign in with Apple sheet, exchanges the resulting identity
 * token for a Firebase session, and returns the signed-in Firebase user.
 * Throws if the user cancels or the flow otherwise fails -- callers should
 * treat that as "stay signed out", not a fatal error.
 */
export async function signInWithApple(): Promise<User> {
  const { credential, displayName } = await getAppleCredential();
  const user = await signInWithProviderCredential('apple', credential);
  // After the session exists, never before: updateProfile needs a signed-in
  // user, and this is the only moment `displayName` will ever be available.
  await applyAppleDisplayName(user, displayName);
  return user;
}

/**
 * Links a fresh Apple credential to `user` -- the additive "I'm already
 * signed in and want to also add Apple" case, mirroring
 * googleAuth.ts's linkGoogleToCurrentUser exactly (see its comment for why
 * this must never route through signInWithCredential). Callers must pass
 * the CURRENT signed-in user (useAuthStore.linkProvider does).
 */
export async function linkAppleToCurrentUser(user: User): Promise<User> {
  const { credential, displayName } = await getAppleCredential();
  const linked = await linkCredentialToUser(user, credential);
  // Only fills a name the account does not already have -- see
  // applyAppleDisplayName. An account being linked FROM Google usually has
  // one, in which case this is a no-op; an email/password account signed up
  // without a name usually does not.
  await applyAppleDisplayName(linked, displayName);
  return linked;
}

/**
 * Full secure sign-out (authSession.ts): the Firebase session, then a
 * defense-in-depth explicit SecureStore wipe. No provider cleanup is passed
 * because, unlike Google, Sign in with Apple has no client-revocable local
 * grant to release -- Apple's revocation model is server-side (an
 * authorization-code exchange this app doesn't implement) -- so there is no
 * equivalent of GoogleSignin.revokeAccess()/signOut() to call here.
 */
export async function signOutFully(): Promise<void> {
  await signOutFirebaseSession('[appleAuth] signOutFully');
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
  // getAppleCredential() throws on cancel and that throw is left to
  // propagate -- see the comment above and authSession.ts's own.
  //
  // The `.credential` unwrap is all this needs from the pair: Apple sends no
  // name on a re-authorization (it is first-authorization-only), and this
  // path is about to delete the account regardless.
  await reauthenticateCurrentUser(async () => (await getAppleCredential()).credential);
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
export async function deleteUserAccount(expectedUid?: string): Promise<void> {
  await deleteFirebaseUser('[appleAuth] deleteUserAccount', undefined, expectedUid);
}
