// secureStorePersistence.test.ts -- regression tests for "Couldn't start
// sign-in. Check your connection and try again." on every launch.
//
// expo-secure-store throws on any key outside /^[\w.-]+$/, and Firebase
// Auth's persistence layer asks for `firebase:authUser:<apiKey>:[DEFAULT]`.
// So every read and write through this adapter rejected, Auth's
// initialization promise rejected with it, onAuthStateChanged never fired,
// and useAuthStore's watchdog reported the generic connection error -- for a
// fault that had nothing to do with the network.
//
// The mock below reproduces expo-secure-store's validation (not its storage),
// so these tests fail against the pre-fix adapter exactly as the device did.
import * as SecureStore from 'expo-secure-store';
import { secureStorePersistence } from './secureStorePersistence';
import { FIREBASE_AUTH_SECURE_STORE_KEYS, secureStoreKey } from './secureStoreKeys';

const VALID_KEY = /^[\w.-]+$/; // SecureStore.js's isValidKey, verified against expo-secure-store@14.0.1

jest.mock('expo-secure-store', () => {
  const ensureValidKey = (key: string) => {
    if (!/^[\w.-]+$/.test(key)) {
      throw new Error(
        'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
      );
    }
  };
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (key: string) => ensureValidKey(key)),
    getItemAsync: jest.fn(async (key: string) => {
      ensureValidKey(key);
      return null;
    }),
    deleteItemAsync: jest.fn(async (key: string) => ensureValidKey(key)),
  };
});

// The adapter's storage contract is internal to @firebase/auth and not part
// of the public `Persistence` type; cast once here rather than at each call.
const persistence = secureStorePersistence as any;

/** The exact key @firebase/auth's PersistenceUserManager asks for. */
const FIREBASE_USER_KEY = 'firebase:authUser:AIzaSyTestApiKey:[DEFAULT]';

beforeEach(() => jest.clearAllMocks());

describe('secureStorePersistence', () => {
  it('reads the Firebase user key without rejecting', async () => {
    await expect(persistence._get(FIREBASE_USER_KEY)).resolves.toBeNull();
    expect((SecureStore.getItemAsync as jest.Mock).mock.calls[0][0]).toMatch(VALID_KEY);
  });

  it('writes and removes the Firebase user key without rejecting', async () => {
    await expect(persistence._set(FIREBASE_USER_KEY, '{"uid":"u1"}')).resolves.toBeUndefined();
    await expect(persistence._remove(FIREBASE_USER_KEY)).resolves.toBeUndefined();
    expect((SecureStore.setItemAsync as jest.Mock).mock.calls[0][0]).toMatch(VALID_KEY);
    expect((SecureStore.deleteItemAsync as jest.Mock).mock.calls[0][0]).toMatch(VALID_KEY);
  });

  it('maps every key it is handed to the same name consistently', async () => {
    await persistence._set(FIREBASE_USER_KEY, 'v');
    await persistence._get(FIREBASE_USER_KEY);
    await persistence._remove(FIREBASE_USER_KEY);
    const written = (SecureStore.setItemAsync as jest.Mock).mock.calls[0][0];
    expect((SecureStore.getItemAsync as jest.Mock).mock.calls[0][0]).toBe(written);
    expect((SecureStore.deleteItemAsync as jest.Mock).mock.calls[0][0]).toBe(written);
  });

  it('probes availability with a key SecureStore accepts', async () => {
    await expect(persistence._isAvailable()).resolves.toBe(true);
  });
});

describe('FIREBASE_AUTH_SECURE_STORE_KEYS', () => {
  // The sign-out and fresh-install wipes delete these names directly. If they
  // drifted from what the adapter writes, a "wiped" session would survive.
  it('are valid SecureStore keys', () => {
    for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
      expect(key).toMatch(VALID_KEY);
    }
  });

  it('name the same values the adapter writes', async () => {
    await persistence._set(`firebase:authUser:${'test'}:[DEFAULT]`, 'v');
    const written = (SecureStore.setItemAsync as jest.Mock).mock.calls[0][0];
    expect(written).toBe(secureStoreKey(`firebase:authUser:${'test'}:[DEFAULT]`));
  });
});
