// firebaseInit.test.ts -- the first suite to exercise initFirebaseAuth()'s own
// sequencing, rather than mocking it away.
//
// Every other suite under src/auth mocks './firebase' wholesale (see
// loginSimulation.harness.ts's firebaseModuleMock), which is right for testing
// everything ABOVE this module but leaves initFirebaseAuth() itself -- the
// order its stages run in, whether a failed attempt is retryable, whether two
// callers really share one attempt -- untested anywhere.
// loginSimulation.config.test.ts also loads the real './firebase', but for a
// different question (does a misconfigured BUILD fail loudly); it never mocks
// './secureStorePersistence', so it never exercises the Keychain probe
// failing, which is this file's main subject:
//
//   @firebase/auth's PersistenceUserManager.create() calls a persistence's
//   _isAvailable() exactly once and keeps whichever persistence answered for
//   the life of the process (see secureStorePersistence.ts's
//   isSecureStoreAvailable doc). initFirebaseAuth() asks that question itself
//   BEFORE handing the persistence to initializeAuth(), so a Keychain that is
//   not answering fails initFirebaseAuth() outright instead of letting the SDK
//   quietly and permanently fall back to in-memory persistence for the rest of
//   the process.
//
// './firebase' is the one real module here. Every SDK entry point it calls
// (firebase/app, firebase/auth, firebase/firestore) and every local module it
// calls out to (./secureStorePersistence, ./wipeStaleSessionOnFreshInstall,
// ./firebaseConfig) is faked, so the sequencing can be asserted directly
// instead of inferred from real SDK behavior.
import { getApps, initializeApp } from 'firebase/app';
import { initializeAuth, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { isSecureStoreAvailable } from './secureStorePersistence';
import { wipeStaleSessionOnFreshInstall } from './wipeStaleSessionOnFreshInstall';
import { findInvalidFirebaseConfigKeys } from './firebaseConfig';

// Nothing to polyfill in node -- see loginSimulation.config.test.ts's own copy
// of this mock for why the real module (which reaches into react-native's
// NativeModules) is not something this file needs at all.
jest.mock('react-native-get-random-values', () => ({}));
jest.mock('firebase/app', () => ({
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));
jest.mock('firebase/auth', () => ({
  initializeAuth: jest.fn(),
  getAuth: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(),
}));
jest.mock('./secureStorePersistence', () => ({
  secureStorePersistence: { __fake: 'persistence-class' },
  isSecureStoreAvailable: jest.fn(),
}));
jest.mock('./wipeStaleSessionOnFreshInstall', () => ({
  wipeStaleSessionOnFreshInstall: jest.fn(),
}));
jest.mock('./firebaseConfig', () => ({
  firebaseConfig: { apiKey: 'test-api-key' },
  findInvalidFirebaseConfigKeys: jest.fn(),
}));

// Imported at this file's top level (not required from inside an
// isolateModules callback), so each of these keeps ONE identity for the whole
// file -- see freshFirebase() below for why that is what lets a test
// configure a mock and then have the fresh copy of './firebase' actually call
// the very function it configured.
const mockGetApps = getApps as jest.Mock;
const mockInitializeApp = initializeApp as jest.Mock;
const mockInitializeAuth = initializeAuth as jest.Mock;
const mockGetAuth = getAuth as jest.Mock;
const mockGetFirestore = getFirestore as jest.Mock;
const mockIsSecureStoreAvailable = isSecureStoreAvailable as jest.Mock;
const mockWipe = wipeStaleSessionOnFreshInstall as jest.Mock;
const mockFindInvalidConfigKeys = findInvalidFirebaseConfigKeys as jest.Mock;

const FAKE_APP = { __fake: 'app' };
const FAKE_AUTH = { __fake: 'auth' };
const FAKE_DB = { __fake: 'db' };

beforeEach(() => {
  jest.clearAllMocks();
  // The healthy default for every dependency: a config that passes, a wipe
  // and Keychain probe that both succeed, an SDK that initializes cleanly.
  // Set explicitly here (not left to whatever a bare jest.fn() returns)
  // because clearAllMocks() only clears call history, not an implementation a
  // previous test installed with mockImplementation/mockReturnValue -- see
  // loginSimulation.harness.ts's installHealthyDefaults for the same
  // reasoning applied to the rest of this directory's suites.
  mockGetApps.mockReturnValue([]);
  mockInitializeApp.mockReturnValue(FAKE_APP);
  mockFindInvalidConfigKeys.mockReturnValue([]);
  mockWipe.mockResolvedValue(undefined);
  mockIsSecureStoreAvailable.mockResolvedValue(true);
  mockInitializeAuth.mockReturnValue(FAKE_AUTH);
  mockGetAuth.mockReturnValue(FAKE_AUTH);
  mockGetFirestore.mockReturnValue(FAKE_DB);
});

/**
 * A fresh copy of firebase.ts. `auth`, `db`, `initPromise` and `initStage` are
 * all module-scope state, so re-requiring the same cached instance would leak
 * one test's init into the next -- same technique as
 * loginSimulation.harness.ts's freshAuth(). './firebase' is deliberately never
 * imported at this file's top level, for the mirror-image reason the mocks
 * above ARE imported up there: a top-level import would hand every test the
 * one shared instance this helper exists to avoid.
 */
function freshFirebase(): any {
  let mod: any;
  jest.isolateModules(() => {
    mod = require('./firebase');
  });
  return mod;
}

/** Microtask drain, generous on purpose -- see loginSimulation.audit.test.ts's
 * own flush() for why guessing the exact number of `.then()` links in a chain
 * is the wrong thing to rely on. */
async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('stage ordering', () => {
  it('runs config-check, stale-session-wipe, keychain-probe and initialize-auth in that order, reporting each stage while its own step runs', async () => {
    const firebase = freshFirebase();
    const order: string[] = [];
    const stageWhenCalled: string[] = [];
    mockFindInvalidConfigKeys.mockImplementation(() => {
      order.push('config');
      stageWhenCalled.push(firebase.getAuthInitStage());
      return [];
    });
    mockWipe.mockImplementation(async () => {
      order.push('wipe');
      stageWhenCalled.push(firebase.getAuthInitStage());
    });
    mockIsSecureStoreAvailable.mockImplementation(async () => {
      order.push('probe');
      stageWhenCalled.push(firebase.getAuthInitStage());
      return true;
    });
    mockInitializeAuth.mockImplementation(() => {
      order.push('initializeAuth');
      stageWhenCalled.push(firebase.getAuthInitStage());
      return FAKE_AUTH;
    });

    expect(firebase.getAuthInitStage()).toBe('not-started');
    await firebase.initFirebaseAuth();

    expect(order).toEqual(['config', 'wipe', 'probe', 'initializeAuth']);
    expect(stageWhenCalled).toEqual(['config-check', 'stale-session-wipe', 'keychain-probe', 'initialize-auth']);
    expect(firebase.getAuthInitStage()).toBe('done');
  });

  it('does not call initializeAuth until the stale-session wipe has actually resolved, not merely been called', async () => {
    // The §2.5 guarantee is that a stale Keychain session can never be read by
    // Firebase Auth's own startup. That requires the wipe's promise to be
    // AWAITED, not just started: a `.then(() => { wipeStaleSessionOnFreshInstall();
    // })` with no `return` would still call it at the right point in the
    // sequence and still let a slow wipe's Keychain deletes still be in
    // flight when initializeAuth() reads the very same entries.
    const firebase = freshFirebase();
    let resolveWipe!: () => void;
    mockWipe.mockImplementation(() => new Promise<void>((resolve) => { resolveWipe = resolve; }));

    const pendingInit = firebase.initFirebaseAuth();
    await flush();

    expect(mockWipe).toHaveBeenCalledTimes(1);
    expect(mockIsSecureStoreAvailable).not.toHaveBeenCalled();
    expect(mockInitializeAuth).not.toHaveBeenCalled();

    resolveWipe();
    await pendingInit;

    expect(mockInitializeAuth).toHaveBeenCalledTimes(1);
  });
});

describe('the config gate', () => {
  it('throws FirebaseConfigError and never reaches the wipe, the Keychain probe or initializeAuth when the config is invalid', async () => {
    const firebase = freshFirebase();
    mockFindInvalidConfigKeys.mockReturnValue(['EXPO_PUBLIC_FIREBASE_API_KEY']);

    const e = await firebase.initFirebaseAuth().catch((err: any) => err);

    expect(e).toBeInstanceOf(firebase.FirebaseConfigError);
    expect(e.missingEnvVars).toEqual(['EXPO_PUBLIC_FIREBASE_API_KEY']);
    expect(mockWipe).not.toHaveBeenCalled();
    expect(mockIsSecureStoreAvailable).not.toHaveBeenCalled();
    expect(mockInitializeAuth).not.toHaveBeenCalled();
    expect(mockGetFirestore).not.toHaveBeenCalled();
    expect(firebase.getAuthInitStage()).toBe('config-check');
    expect(() => firebase.getFirebaseAuth()).toThrow(/before initFirebaseAuth/);
  });
});

describe('the Keychain probe', () => {
  it('throws KeychainUnavailableError and never calls initializeAuth when the Keychain is not answering', async () => {
    // The point of asking first: @firebase/auth's PersistenceUserManager only
    // asks a persistence's _isAvailable() once and keeps that answer for the
    // life of the process (see secureStorePersistence.ts's
    // isSecureStoreAvailable doc), so letting a locked Keychain reach
    // initializeAuth() would make the SDK silently and permanently fall back
    // to in-memory persistence instead of failing visibly and recoverably.
    const firebase = freshFirebase();
    mockIsSecureStoreAvailable.mockResolvedValue(false);

    const e = await firebase.initFirebaseAuth().catch((err: any) => err);

    expect(e).toBeInstanceOf(firebase.KeychainUnavailableError);
    expect(mockWipe).toHaveBeenCalled(); // the wipe still ran -- only initializeAuth is gated
    expect(mockInitializeAuth).not.toHaveBeenCalled();
    expect(firebase.getAuthInitStage()).toBe('keychain-probe'); // stalled here, not 'done'
  });

  it('proceeds to initializeAuth and reaches done when the Keychain answers', async () => {
    const firebase = freshFirebase();

    await firebase.initFirebaseAuth();

    expect(mockInitializeAuth).toHaveBeenCalledTimes(1);
    expect(firebase.getFirebaseAuth()).toBe(FAKE_AUTH);
    expect(firebase.getDb()).toBe(FAKE_DB);
    expect(firebase.getAuthInitStage()).toBe('done');
  });
});

describe('retrying after a failed init', () => {
  it('genuinely retries on the next call after the Keychain probe fails, instead of replaying the cached rejection', async () => {
    const firebase = freshFirebase();
    mockIsSecureStoreAvailable.mockResolvedValueOnce(false);

    await expect(firebase.initFirebaseAuth()).rejects.toBeInstanceOf(firebase.KeychainUnavailableError);
    expect(mockInitializeAuth).not.toHaveBeenCalled();

    // The phone has since been unlocked -- the probe now succeeds.
    mockIsSecureStoreAvailable.mockResolvedValueOnce(true);
    await expect(firebase.initFirebaseAuth()).resolves.toBeUndefined();

    expect(mockInitializeAuth).toHaveBeenCalledTimes(1);
    // A real second attempt re-runs the whole sequence, not just the tail
    // end: if the `.catch` cached the rejection instead of clearing
    // `initPromise`, this second call would just return the same rejected
    // promise, and the wipe below would show only the one call from before.
    expect(mockWipe).toHaveBeenCalledTimes(2);
    expect(firebase.getAuthInitStage()).toBe('done');
  });
});

describe('auth/already-initialized', () => {
  it('adopts the existing Auth instance via getAuth() and still reaches done', async () => {
    // Fast Refresh re-evaluates firebase.ts, resetting `initPromise` and
    // `auth` to their initial values -- but the underlying FirebaseApp
    // survives, so a second initializeAuth() for it throws this code.
    // Rethrowing it (instead of adopting the existing instance) used to kill
    // sign-in for the rest of a dev session.
    const firebase = freshFirebase();
    const EXISTING_AUTH = { __fake: 'existing-auth' };
    mockInitializeAuth.mockImplementation(() => {
      throw Object.assign(new Error('already initialized'), { code: 'auth/already-initialized' });
    });
    mockGetAuth.mockReturnValue(EXISTING_AUTH);

    await expect(firebase.initFirebaseAuth()).resolves.toBeUndefined();

    expect(mockGetAuth).toHaveBeenCalled();
    expect(firebase.getFirebaseAuth()).toBe(EXISTING_AUTH);
    expect(firebase.getDb()).toBe(FAKE_DB);
    expect(firebase.getAuthInitStage()).toBe('done');
  });

  it('rethrows any other initializeAuth error instead of silently adopting getAuth()', async () => {
    const firebase = freshFirebase();
    mockInitializeAuth.mockImplementation(() => {
      throw Object.assign(new Error('network hiccup'), { code: 'auth/network-request-failed' });
    });

    await expect(firebase.initFirebaseAuth()).rejects.toMatchObject({ code: 'auth/network-request-failed' });

    expect(mockGetAuth).not.toHaveBeenCalled();
    expect(mockGetFirestore).not.toHaveBeenCalled();
    expect(firebase.getAuthInitStage()).toBe('initialize-auth'); // never reached done
  });
});

describe('idempotence', () => {
  it('does the work once and hands the exact same promise to two concurrent callers', async () => {
    const firebase = freshFirebase();

    const p1 = firebase.initFirebaseAuth();
    const p2 = firebase.initFirebaseAuth();

    expect(p1).toBe(p2); // the same memoized promise, not just two calls that both happen to resolve
    await Promise.all([p1, p2]);

    expect(mockFindInvalidConfigKeys).toHaveBeenCalledTimes(1);
    expect(mockWipe).toHaveBeenCalledTimes(1);
    expect(mockIsSecureStoreAvailable).toHaveBeenCalledTimes(1);
    expect(mockInitializeAuth).toHaveBeenCalledTimes(1);
  });

  it('does not restart the sequence on a later call once init has already completed', async () => {
    const firebase = freshFirebase();

    await firebase.initFirebaseAuth();
    await firebase.initFirebaseAuth();

    expect(mockInitializeAuth).toHaveBeenCalledTimes(1);
  });
});
