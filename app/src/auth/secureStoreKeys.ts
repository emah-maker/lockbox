// secureStoreKeys.ts -- shared SecureStore options + the set of key names
// Firebase Auth's persistence layer writes under. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §2.2/§2.4/§2.5.
//
// One shared module so secureStorePersistence.ts (the Persistence adapter
// itself), wipeStaleSessionOnFreshInstall.ts (§2.5's reinstall wipe), and
// googleAuth.ts's signOutFully() (§2.4's defense-in-depth wipe) all read and
// wipe the exact same keys -- expo-secure-store has no "list keys" API, so a
// full wipe must know every key Firebase Auth's persistence layer might have
// written, rather than clearing "everything under some prefix".
import * as SecureStore from 'expo-secure-store';
import { firebaseConfig } from './firebaseConfig';

export const SECURE_STORE_OPTS: SecureStore.SecureStoreOptions = {
  // Never exported to iCloud Keychain backups; unavailable if the device is
  // locked, and tied to this specific device install.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
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
