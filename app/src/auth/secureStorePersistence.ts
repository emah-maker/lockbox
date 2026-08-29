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
//
// The shape below is dictated by three undocumented requirements of the
// SDK's internal persistence contract, each of which broke sign-in outright
// when this file got it wrong. All three are mirrored from the SDK's own RN
// adapter (getReactNativePersistence in @firebase/auth's index.rn.js,
// verified against the installed firebase@10.14.1):
//
//   1. It must be a CLASS, not an instance. initializeAuth() passes whatever
//      it is given to _getInstance(), which asserts `cls instanceof Function`
//      and then calls `new cls()`. Handing it an object literal threw
//      "INTERNAL ASSERTION FAILED: Expected a class definition" synchronously
//      out of initializeAuth() on every single launch -- which surfaced, via
//      useAuthStore's catch, as "Couldn't start sign-in. Check your
//      connection and try again." on a perfectly good network.
//   2. _set receives an OBJECT (PersistenceUserManager calls
//      `_set(key, user.toJSON())`), and _get must return that object back.
//      SecureStore only stores strings, so the JSON round-trip happens here.
//   3. Keys must survive expo-secure-store's key validation -- see
//      secureStoreKeys.ts.
import * as SecureStore from 'expo-secure-store';
import type { Persistence } from 'firebase/auth';
import { SECURE_STORE_OPTS, secureStoreKey } from './secureStoreKeys';

// Firebase's public `Persistence` type (firebase/auth) only declares `type`;
// the actual storage contract every custom persistence must implement
// (`_isAvailable`/`_get`/`_set`/`_remove`/listener no-ops) is internal to the
// SDK (@firebase/auth's `PersistenceInternal`) and isn't exported from the
// package's public entry point. We declare that shape locally -- rather than
// reaching into a private subpath export -- and widen to `Persistence` only
// where `initializeAuth` expects it (see firebase.ts).
interface AuthPersistenceImpl {
  readonly type: 'LOCAL';
  _isAvailable(): Promise<boolean>;
  _set(key: string, value: unknown): Promise<void>;
  _get(key: string): Promise<unknown>;
  _remove(key: string): Promise<void>;
  _addListener(key: string, listener: (value: unknown) => void): void;
  _removeListener(key: string, listener: (value: unknown) => void): void;
}

/** Keyed on nothing the SDK cares about -- just a name unlikely to collide
 * with a real entry, used once to prove SecureStore answers at all. */
const AVAILABILITY_PROBE_KEY = 'phonebox.securestore.probe';

/** Must have an empty constructor: _getInstance() calls `new cls()` with no
 * arguments and caches the single instance it gets back. */
export class SecureStorePersistence implements AuthPersistenceImpl {
  // Both are required: the SDK reads `type` off the instance, and off the
  // class itself when comparing persistence hierarchies.
  static readonly type = 'LOCAL' as const;
  readonly type = 'LOCAL' as const;

  async _isAvailable(): Promise<boolean> {
    try {
      await SecureStore.setItemAsync(AVAILABILITY_PROBE_KEY, '1', SECURE_STORE_OPTS);
      await SecureStore.deleteItemAsync(AVAILABILITY_PROBE_KEY, SECURE_STORE_OPTS);
      return true;
    } catch {
      return false;
    }
  }

  // JSON.stringify on the way in, JSON.parse on the way out: `value` is the
  // user record object, and SecureStore stores strings only.
  async _set(key: string, value: unknown): Promise<void> {
    await SecureStore.setItemAsync(secureStoreKey(key), JSON.stringify(value), SECURE_STORE_OPTS);
  }

  async _get(key: string): Promise<unknown> {
    const json = await SecureStore.getItemAsync(secureStoreKey(key), SECURE_STORE_OPTS);
    return json ? JSON.parse(json) : null;
  }

  async _remove(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(secureStoreKey(key), SECURE_STORE_OPTS);
  }

  _addListener(): void {} // single-tab RN app: no cross-tab sync needed
  _removeListener(): void {}
}

// The class itself is the value initializeAuth() wants -- it instantiates it.
export const secureStorePersistence = SecureStorePersistence as unknown as Persistence;
