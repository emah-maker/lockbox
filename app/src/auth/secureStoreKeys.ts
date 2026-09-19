// secureStoreKeys.ts -- shared SecureStore options + the set of key names
// Firebase Auth's persistence layer writes under. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §2.2/§2.4/§2.5.
//
// One shared module so secureStorePersistence.ts (the Persistence adapter
// itself), wipeStaleSessionOnFreshInstall.ts (§2.5's reinstall wipe), and
// every provider's sign-out/delete path (§2.4's defense-in-depth wipe, via
// authSession.ts) all read and wipe the exact same keys -- expo-secure-store
// has no "list keys" API, so a full wipe must know every key Firebase Auth's
// persistence layer might have written, rather than clearing "everything
// under some prefix".
//
// The wipe itself lives here too (wipeFirebaseAuthSecureStore, below) rather
// than being re-typed next to each list of keys: it was the same loop in four
// places, and a wipe that misses one key in one of them is exactly the bug
// this module exists to prevent. Note this file deliberately imports nothing
// from ./firebase -- wipeStaleSessionOnFreshInstall must run BEFORE Firebase
// Auth initializes, so its wipe cannot sit behind getFirebaseAuth().
import * as SecureStore from 'expo-secure-store';
import { firebaseConfig } from './firebaseConfig';

export const SECURE_STORE_OPTS: SecureStore.SecureStoreOptions = {
  // Never exported to iCloud Keychain backups, and tied to this specific
  // device install -- the two properties §2.2 actually requires.
  //
  // AFTER_FIRST_UNLOCK rather than WHEN_UNLOCKED because this app runs while
  // the phone is locked and can be COLD-LAUNCHED there: app.json declares
  // UIBackgroundModes ["bluetooth-central"] and PhoneBoxClient.ts sets
  // restoreStateIdentifier, so iOS relaunches the process in the background,
  // screen off, to hand back the restored central. App.tsx's init() then runs
  // the normal auth startup against a Keychain that answers nothing.
  //
  // The damage is not a failed read -- it is a silent, whole-process
  // downgrade. secureStorePersistence._isAvailable() probes with a WRITE, so
  // it returns false; @firebase/auth's PersistenceUserManager.create() filters
  // out every unavailable persistence and falls back to inMemoryPersistence
  // for the life of that process. The user unlocks, foregrounds the SAME
  // process, and finds themselves signed out with auto-sync stopped -- and if
  // they sign in again, that session is written to memory only, so they are
  // signed out once more on the next launch. Nothing throws and nothing is
  // logged, so it reads as "the app keeps signing me out".
  //
  // WHEN_UNLOCKED bought nothing against that: the session is readable
  // whenever the app is usable either way. AFTER_FIRST_UNLOCK only widens the
  // window to "at some point since boot, the owner unlocked this device once",
  // which is the standard choice for an app with a background mode.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// The modular Firebase JS SDK's persistence layer names its keys
// `firebase:<key>:<apiKey>:<appName>` (see @firebase/auth's
// PersistenceUserManager) when a custom Persistence is supplied: `authUser`
// holds the persisted user record itself, `persistence` records which
// Persistence implementation was last selected. This format is internal to
// the SDK, not part of its public API -- derived here (from the same
// apiKey/app-name this build actually uses) rather than hardcoded, so it
// can't drift out of sync with firebaseConfig.
const FIREBASE_APP_NAME = '[DEFAULT]';

/**
 * Maps a Firebase Auth persistence key name onto one expo-secure-store will
 * actually accept.
 *
 * expo-secure-store validates every key against `/^[\w.-]+$/` and *throws*
 * otherwise (SecureStore.js's `ensureValidKey`). The SDK's own key format --
 * `firebase:authUser:<apiKey>:[DEFAULT]` -- contains `:`, `[` and `]`, so
 * every raw read/write through the adapter rejected. That broke sign-in
 * outright: PersistenceUserManager.create() swallows the first `_get`, but
 * initializeCurrentUser()'s getCurrentUser() does not, so Auth's
 * initialization promise rejected, onAuthStateChanged never fired, `ready`
 * never flipped, and the 10s watchdog in useAuthStore surfaced "Couldn't
 * start sign-in. Check your connection and try again." on every launch.
 *
 * The substitution is applied in exactly one place so the persistence adapter
 * (which writes) and the wipe paths (which delete) can never disagree about
 * the name a value actually lives under.
 */
export function secureStoreKey(name: string): string {
  return name.replace(/[^\w.-]/g, '_');
}

export const FIREBASE_AUTH_SECURE_STORE_KEYS: string[] = [
  secureStoreKey(`firebase:authUser:${firebaseConfig.apiKey}:${FIREBASE_APP_NAME}`),
  secureStoreKey(`firebase:persistence:${firebaseConfig.apiKey}:${FIREBASE_APP_NAME}`),
];

/**
 * Deletes every key above, best-effort: one failure must not stop the rest,
 * and no caller has anything better to do than report it.
 *
 * `context` names the caller (e.g. `'[googleAuth] signOutFully'`) so the
 * warning says which wipe path failed. Logging the key NAMES is safe and
 * deliberate -- they are derived from firebaseConfig.apiKey, not secret (see
 * above) -- and it is the only diagnostic there is if an SDK version drift
 * ever changes the internal key format this module still assumes. A bare
 * `.catch(() => {})` here previously gave none at all (production readiness
 * review, Medium).
 *
 * Returns whether every delete actually succeeded. Best-effort is right for
 * the sign-out paths, which have a real wipe behind them and nothing better to
 * do on failure -- but wipeStaleSessionOnFreshInstall gets ONE attempt ever,
 * and it used to record success unconditionally. A Keychain that refused the
 * deletes (a locked device, which §2.5's wipe can meet: this app is
 * cold-launched in the background by the bluetooth-central restore) left the
 * previous owner's session in place AND set the marker that stops any later
 * launch retrying -- so the §2.5 window closed permanently on a wipe that
 * never happened, on exactly the resold or restored phone it exists for.
 */
export async function wipeFirebaseAuthSecureStore(context: string): Promise<boolean> {
  let wipedEverything = true;
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS).catch((e) => {
      wipedEverything = false;
      console.warn(`${context}: failed to delete`, key, e?.message);
    });
  }
  return wipedEverything;
}
