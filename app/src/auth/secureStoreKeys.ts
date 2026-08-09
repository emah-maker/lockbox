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

export const FIREBASE_AUTH_SECURE_STORE_KEYS: string[] = [
  `firebase:authUser:${firebaseConfig.apiKey}:${FIREBASE_APP_NAME}`,
  `firebase:persistence:${firebaseConfig.apiKey}:${FIREBASE_APP_NAME}`,
];
