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
  //
  // Must never reject, for a different reason than _get's below. Firebase
  // awaits this inside directlySetCurrentUser(), which is on the path of
  // every signInWithCredential/signInWithEmailAndPassword call (verified
  // against the installed firebase@10.14.1's PersistenceUserManager.
  // setCurrentUser -> persistence._set). A rejection there therefore comes
  // back out of the sign-in call itself -- so a user who authenticated
  // perfectly, and whom Firebase has already accepted, is told the sign-in
  // FAILED. Worse, the thrown error is a SecureStore one with no `.code`, so
  // accountDisplay.ts's signInErrorMessage falls through to its "this is our
  // own static string, safe to show" branch and renders the raw Keychain
  // message verbatim (design doc §5 checklist item 3).
  //
  // Reachable without anything being corrupt: SECURE_STORE_OPTS pins
  // keychainAccessible to AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, so any write
  // before the first unlock since boot fails -- and this app runs locked, in
  // the background, off its BLE connection, where Firebase's proactive token
  // refresh writes through here on its own schedule. (It was WHEN_UNLOCKED,
  // which failed on EVERY locked-screen write rather than only that window;
  // secureStoreKeys.ts records why it changed, and firebaseConfig.test.ts now
  // asserts the value against the real module.)
  //
  // Degrading costs the persisted session (the user signs in again next cold
  // start) against costing them the sign-in they just completed. Logged, so
  // "signed in, signed out again after a restart" is diagnosable rather than
  // silent -- key names only, never `value`, which is the session itself.
  async _set(key: string, value: unknown): Promise<void> {
    const storeKey = secureStoreKey(key);
    try {
      await SecureStore.setItemAsync(storeKey, JSON.stringify(value), SECURE_STORE_OPTS);
    } catch (e: any) {
      console.warn('[secureStorePersistence] write failed for', storeKey, e?.message);
    }
  }

  // Must never reject. Firebase calls _get from initializeCurrentUser(), and a
  // rejection there rejects Auth's own initialization promise: onAuthStateChanged
  // never fires, useAuthStore's `ready` never flips, and its 10s watchdog
  // surfaces "Couldn't start sign-in. Check your connection and try again." --
  // see secureStoreKeys.ts's own account of that exact failure. The part that
  // made it unrecoverable was that nothing removed the value responsible, so
  // every subsequent launch took the same branch. Two ways this used to throw:
  // getItemAsync itself erroring (a Keychain read failure, e.g. an entry
  // written under different keychainAccessible terms), and JSON.parse on a
  // truncated or legacy-format value. Both now degrade to "no persisted
  // session" -- which costs the user one sign-in, against costing them sign-in
  // altogether -- matching the corrupt-value-falls-back-to-default discipline
  // storage.ts's getJSON already applies on the AsyncStorage side.
  async _get(key: string): Promise<unknown> {
    const storeKey = secureStoreKey(key);
    let json: string | null;
    try {
      json = await SecureStore.getItemAsync(storeKey, SECURE_STORE_OPTS);
    } catch (e: any) {
      // Key names only, never the value -- see secureStoreKeys.ts.
      console.warn('[secureStorePersistence] read failed for', storeKey, e?.message);
      return null;
    }
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch (e: any) {
      // Self-healing: drop the unparseable entry rather than leaving it to be
      // re-read (and re-rejected) on every launch from here on.
      console.warn('[secureStorePersistence] discarding unparseable value at', storeKey, e?.message);
      await SecureStore.deleteItemAsync(storeKey, SECURE_STORE_OPTS).catch(() => {});
      return null;
    }
  }

  // Same no-reject rule as _set above, same call path: Firebase awaits this
  // through removeCurrentUser() whenever the current user becomes null. This
  // one does NOT weaken the sign-out wipe -- every sign-out path also calls
  // secureStoreKeys.ts's wipeFirebaseAuthSecureStore() explicitly on the same
  // keys, which is the wipe §2.4 actually relies on; this is the SDK's own
  // bookkeeping copy of it.
  async _remove(key: string): Promise<void> {
    const storeKey = secureStoreKey(key);
    try {
      await SecureStore.deleteItemAsync(storeKey, SECURE_STORE_OPTS);
    } catch (e: any) {
      console.warn('[secureStorePersistence] delete failed for', storeKey, e?.message);
    }
  }

  _addListener(): void {} // single-tab RN app: no cross-tab sync needed
  _removeListener(): void {}
}

// The class itself is the value initializeAuth() wants -- it instantiates it.
export const secureStorePersistence = SecureStorePersistence as unknown as Persistence;

/**
 * The same probe `_isAvailable()` runs, exposed so firebase.ts can ask the
 * question BEFORE handing this class to initializeAuth().
 *
 * It has to be asked there because initializeAuth() only asks it once, ever.
 * @firebase/auth's PersistenceUserManager.create() filters out every
 * persistence whose _isAvailable() says no and keeps what is left for the
 * LIFE OF THE PROCESS -- so a single unlucky moment picks inMemoryPersistence
 * and nothing re-examines it. There is no API to reconsider afterwards:
 * initializeAuth() throws auth/already-initialized on a second call, and the
 * instance it hands back is the degraded one.
 *
 * That unlucky moment is reachable here. SECURE_STORE_OPTS pins
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, and this app declares
 * UIBackgroundModes ["bluetooth-central"] with a restoreStateIdentifier, so
 * iOS cold-launches it in the background for a box event -- including in the
 * window between a reboot and the owner's first unlock, where the Keychain
 * answers nothing. The user then unlocks, foregrounds that same process, and
 * finds themselves signed out; signing in again writes the session to memory
 * only, so the next launch signs them out once more. Nothing throws and
 * nothing is logged: it reads purely as "the app keeps signing me out".
 */
export async function isSecureStoreAvailable(): Promise<boolean> {
  return new SecureStorePersistence()._isAvailable();
}
