// secureStorePersistence.ts -- custom Firebase Auth `Persistence` adapter
// backed by expo-secure-store. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §2.2.
//
// Every byte of Firebase Auth session state (refresh token, uid, claims) that
// touches disk flows through this one adapter -- iOS Keychain / Android
// Keystore-backed encrypted storage -- and nowhere else. There is
// deliberately no AsyncStorage fallback and no @react-native-firebase native
// storage; see §2.1 for why both of those fail the "never AsyncStorage"
// requirement.
import * as SecureStore from 'expo-secure-store';
import type { Persistence } from 'firebase/auth';
import { SECURE_STORE_OPTS } from './secureStoreKeys';

// Firebase's public `Persistence` type (firebase/auth) only declares `type`;
// the actual storage contract every custom persistence must implement
// (`_isAvailable`/`_get`/`_set`/`_remove`/listener no-ops) is internal to the
// SDK (@firebase/auth's `PersistenceInternal`, verified against the
// installed firebase@10.14.1 package's auth-public.d.ts) and isn't exported
// from the package's public entry point. We declare that shape locally --
// exactly as specified in the design doc -- rather than reaching into a
// private subpath export, and widen to `Persistence` only where
// `initializeAuth` expects it (see firebase.ts).
interface AuthPersistenceImpl extends Persistence {
  _isAvailable(): Promise<boolean>;
  _set(key: string, value: string): Promise<void>;
  _get(key: string): Promise<string | null>;
  _remove(key: string): Promise<void>;
  _addListener(key: string, listener: (value: string | null) => void): void;
  _removeListener(key: string, listener: (value: string | null) => void): void;
}

const impl: AuthPersistenceImpl = {
  type: 'LOCAL',
  async _isAvailable() {
    try {
      await SecureStore.setItemAsync('__probe', '1', SECURE_STORE_OPTS);
      await SecureStore.deleteItemAsync('__probe', SECURE_STORE_OPTS);
      return true;
    } catch {
      return false;
    }
  },
  _set: (key, value) => SecureStore.setItemAsync(key, value, SECURE_STORE_OPTS),
  _get: (key) => SecureStore.getItemAsync(key, SECURE_STORE_OPTS),
  _remove: (key) => SecureStore.deleteItemAsync(key, SECURE_STORE_OPTS),
  _addListener: () => {}, // single-tab RN app: no cross-tab sync needed
  _removeListener: () => {},
};

export const secureStorePersistence: Persistence = impl;
