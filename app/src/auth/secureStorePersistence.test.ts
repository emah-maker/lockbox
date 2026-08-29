// secureStorePersistence.test.ts -- regression tests for "Couldn't start
// sign-in. Check your connection and try again." on every launch, on a
// perfectly good network.
//
// Three separate faults in this adapter all surfaced as that one message,
// because useAuthStore turns any initFirebaseAuth() rejection into it:
//
//   1. The adapter was an object literal. initializeAuth() hands persistence
//      to the SDK's _getInstance(), which asserts `cls instanceof Function`
//      and calls `new cls()` -- so initializeAuth() threw "INTERNAL ASSERTION
//      FAILED: Expected a class definition" synchronously, before any of the
//      storage methods below ever ran.
//   2. _set/_get skipped the JSON round-trip, but the SDK stores an object
//      (`_set(key, user.toJSON())`) and SecureStore stores only strings.
//   3. The keys the SDK asks for (`firebase:authUser:<apiKey>:[DEFAULT]`)
//      are rejected outright by expo-secure-store's key validation.
//
// Fault 1 is only catchable by running the real SDK, so the first test does
// exactly that -- initializeAuth() against a throwaway FirebaseApp. It needs
// no network: Auth initializes off local persistence and fires
// onAuthStateChanged without contacting the backend.
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, onAuthStateChanged } from 'firebase/auth';
import * as SecureStore from 'expo-secure-store';
import { secureStorePersistence, SecureStorePersistence } from './secureStorePersistence';
import { FIREBASE_AUTH_SECURE_STORE_KEYS, secureStoreKey } from './secureStoreKeys';

const VALID_KEY = /^[\w.-]+$/; // SecureStore.js's isValidKey, expo-secure-store@14.0.1

// Reproduces expo-secure-store's real validation on top of an in-memory
// store, so a key or value the device would reject fails here too.
const backing = new Map<string, string>();
jest.mock('expo-secure-store', () => {
  const check = (key: string) => {
    if (!/^[\w.-]+$/.test(key)) {
      throw new Error(`Invalid key provided to SecureStore: ${key}`);
    }
  };
  // Resolved lazily: jest hoists this factory above the assignment below.
  const store = (): Map<string, string> => (globalThis as any).__secureStoreBacking;
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (key: string, value: string) => {
      check(key);
      if (typeof value !== 'string') {
        throw new Error('Invalid value provided to SecureStore. Values must be strings');
      }
      store().set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => {
      check(key);
      return store().get(key) ?? null;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      check(key);
      store().delete(key);
    }),
  };
});
(globalThis as any).__secureStoreBacking = backing;

// The storage contract is internal to @firebase/auth and absent from the
// public `Persistence` type; cast once here rather than at each call.
const persistence = new SecureStorePersistence() as any;

/** The exact key shape @firebase/auth's PersistenceUserManager asks for. */
const FIREBASE_USER_KEY = 'firebase:authUser:AIzaSyTestApiKey:[DEFAULT]';

beforeEach(() => {
  backing.clear();
  jest.clearAllMocks();
});

describe('initializeAuth with this persistence', () => {
  it('does not throw, and reaches onAuthStateChanged', async () => {
    const app = initializeApp(
      { apiKey: 'test-api-key', projectId: 'test-project', appId: '1:1:web:1' },
      `persistence-test-${Date.now()}`,
    );
    try {
      // Threw "Expected a class definition" before the fix -- the failure
      // that took sign-in down on every launch.
      const auth = initializeAuth(app, { persistence: secureStorePersistence });

      // `ready` in useAuthStore is set only from inside this callback, so a
      // persistence that never lets Auth finish initializing leaves both
      // sign-in buttons permanently disabled.
      const fired = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 10000);
        onAuthStateChanged(auth, () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      expect(fired).toBe(true);
    } finally {
      await deleteApp(app);
    }
  }, 15000);
});

describe('SecureStorePersistence', () => {
  it('is a class the SDK can instantiate', () => {
    // Mirrors the SDK's _getInstance(): assert, then `new cls()`.
    expect(secureStorePersistence).toBeInstanceOf(Function);
    expect(new (secureStorePersistence as any)()).toBeInstanceOf(SecureStorePersistence);
  });

  it('reports LOCAL persistence on both the class and its instances', () => {
    expect((SecureStorePersistence as any).type).toBe('LOCAL');
    expect(new SecureStorePersistence().type).toBe('LOCAL');
  });

  it('round-trips the object the SDK actually stores', async () => {
    // Shaped like UserImpl.toJSON() -- an object, not a string.
    const userRecord = {
      uid: 'abc123',
      email: 'someone@example.com',
      providerData: [{ providerId: 'google.com', uid: 'g1' }],
      stsTokenManager: { refreshToken: 'r', accessToken: 'a', expirationTime: 1 },
    };
    await persistence._set(FIREBASE_USER_KEY, userRecord);
    await expect(persistence._get(FIREBASE_USER_KEY)).resolves.toEqual(userRecord);
  });

  it('returns null for a key that was never written', async () => {
    await expect(persistence._get(FIREBASE_USER_KEY)).resolves.toBeNull();
  });

  it('removes what it wrote', async () => {
    await persistence._set(FIREBASE_USER_KEY, { uid: 'abc123' });
    await persistence._remove(FIREBASE_USER_KEY);
    await expect(persistence._get(FIREBASE_USER_KEY)).resolves.toBeNull();
  });

  it('only ever hands SecureStore keys it accepts', async () => {
    await persistence._set(FIREBASE_USER_KEY, { uid: 'u' });
    await persistence._get(FIREBASE_USER_KEY);
    await persistence._remove(FIREBASE_USER_KEY);
    await persistence._isAvailable();
    const allKeys = [
      ...(SecureStore.setItemAsync as jest.Mock).mock.calls,
      ...(SecureStore.getItemAsync as jest.Mock).mock.calls,
      ...(SecureStore.deleteItemAsync as jest.Mock).mock.calls,
    ].map((call) => call[0]);
    expect(allKeys.length).toBeGreaterThan(0);
    for (const key of allKeys) expect(key).toMatch(VALID_KEY);
  });

  it('reports availability when SecureStore answers', async () => {
    await expect(persistence._isAvailable()).resolves.toBe(true);
  });

  it('reports unavailability instead of throwing when SecureStore fails', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));
    await expect(persistence._isAvailable()).resolves.toBe(false);
  });
});

describe('FIREBASE_AUTH_SECURE_STORE_KEYS', () => {
  // The sign-out and fresh-install wipes delete these names directly. If they
  // drifted from what the adapter writes, a "wiped" session would survive.
  it('are valid SecureStore keys', () => {
    expect(FIREBASE_AUTH_SECURE_STORE_KEYS.length).toBeGreaterThan(0);
    for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) expect(key).toMatch(VALID_KEY);
  });

  it('name the same entries the adapter writes', async () => {
    await persistence._set(FIREBASE_USER_KEY, { uid: 'u' });
    const written = (SecureStore.setItemAsync as jest.Mock).mock.calls[0][0];
    expect(written).toBe(secureStoreKey(FIREBASE_USER_KEY));
  });
});
