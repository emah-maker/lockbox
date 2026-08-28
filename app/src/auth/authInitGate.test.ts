// authInitGate.test.ts -- regression tests for the "both sign-in buttons are
// greyed out and nothing is logged" bug.
//
// SignedOutAccount gates both buttons on `disabled={busy || !ready}`, and
// `ready` was only ever set inside the onAuthStateChanged callback that
// init() attaches *after* awaiting initFirebaseAuth(). So any failure before
// that point -- a rejection, or a promise that simply never settled -- left
// `ready` false for the lifetime of the process, with App.tsx's empty
// `.catch(() => {})` swallowing the only evidence.
//
// These tests drive useAuthStore directly (it's a plain zustand store, no
// renderer needed) and assert the gate is always released, by whichever of
// the three paths applies: normal startup, a caught rejection, or the
// watchdog. Every one of them fails against the pre-fix store.
import { initFirebaseAuth, getFirebaseAuth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { signInWithGoogle as signInWithGoogleAuth } from './googleAuth';

jest.mock('./firebase', () => ({
  initFirebaseAuth: jest.fn(),
  getFirebaseAuth: jest.fn(() => ({})),
  getDb: jest.fn(() => ({})),
}));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
  unlink: jest.fn(),
}));
jest.mock('./googleAuth', () => ({
  signInWithGoogle: jest.fn(),
  signOutFully: jest.fn(),
  deleteAccountFully: jest.fn(),
  linkGoogleToCurrentUser: jest.fn(),
}));
jest.mock('./appleAuth', () => ({
  signInWithApple: jest.fn(),
  signOutFully: jest.fn(),
  deleteAccountFully: jest.fn(),
  linkAppleToCurrentUser: jest.fn(),
}));
jest.mock('../sync/firestoreSync', () => ({
  runMigrationAndSync: jest.fn(),
  deleteAllUserData: jest.fn(),
  beginAccountDeletion: jest.fn(),
  endAccountDeletion: jest.fn(),
}));
jest.mock('../sync/localDataOwner', () => ({ clearLocalAccountData: jest.fn() }));
jest.mock('../store/useStore', () => ({ useStore: { getState: () => ({}) } }));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ autoSyncEnabled: false }) },
}));

const mockInitFirebaseAuth = initFirebaseAuth as jest.Mock;
const mockOnAuthStateChanged = onAuthStateChanged as jest.Mock;
const mockSignInWithGoogle = signInWithGoogleAuth as jest.Mock;

/** Fresh module instance per test: the store caches `authListenerAttached` at
 * module scope, so tests would otherwise leak listener state into each other. */
function freshStore() {
  let store: any;
  jest.isolateModules(() => {
    store = require('./useAuthStore').useAuthStore;
  });
  return store;
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // Fake timers throughout: init() arms a 10s watchdog on every call, and a
  // real one would keep the Jest process alive past the run.
  jest.useFakeTimers();
  // The bug's signature was silence; these tests assert warnings are emitted,
  // so capture rather than print them.
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('init() releases the sign-in gate', () => {
  it('sets ready once Firebase Auth reports its initial state', async () => {
    mockInitFirebaseAuth.mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(null); // signed out -- Firebase always fires once with null or a user
      return () => {};
    });
    const store = freshStore();

    expect(store.getState().ready).toBe(false);
    await store.getState().init();

    expect(store.getState().ready).toBe(true);
    expect(store.getState().initError).toBeNull();
    expect(store.getState().user).toBeNull();
  });

  it('releases the gate and reports an error when init throws', async () => {
    // The pre-fix store propagated this rejection out of init() without ever
    // setting `ready`, so both buttons stayed disabled permanently.
    mockInitFirebaseAuth.mockRejectedValue(new Error('SecureStore unavailable'));
    const store = freshStore();

    await expect(store.getState().init()).resolves.toBeUndefined(); // handled, not rethrown

    expect(store.getState().ready).toBe(true);
    expect(store.getState().initError).toBeTruthy();
    expect(warn).toHaveBeenCalled(); // no longer silent
  });

  it('releases the gate via the watchdog when init never settles', async () => {
    mockInitFirebaseAuth.mockReturnValue(new Promise(() => {})); // never resolves, never rejects
    const store = freshStore();

    store.getState().init();
    await Promise.resolve(); // let init() reach its first await and arm the watchdog
    await Promise.resolve();
    expect(store.getState().ready).toBe(false); // still waiting, correctly

    jest.advanceTimersByTime(10_000);

    expect(store.getState().ready).toBe(true);
    expect(store.getState().initError).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });

  it('watchdog does not fire once auth has already come up', async () => {
    mockInitFirebaseAuth.mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(null);
      return () => {};
    });
    const store = freshStore();

    await store.getState().init();
    expect(store.getState().initError).toBeNull();

    jest.advanceTimersByTime(30_000);

    // A late watchdog must not stamp an error onto a perfectly healthy store.
    expect(store.getState().initError).toBeNull();
    expect(store.getState().ready).toBe(true);
  });

  it('does not let a lastSyncedAt read failure take auth down with it', async () => {
    const storage = require('../storage/storage');
    jest.spyOn(storage, 'getJSON').mockRejectedValue(new Error('AsyncStorage exploded'));
    mockInitFirebaseAuth.mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(null);
      return () => {};
    });
    const store = freshStore();

    await store.getState().init();

    // Cosmetic read, non-cosmetic consequence pre-fix: it rejected before
    // initFirebaseAuth() was even reached.
    expect(store.getState().ready).toBe(true);
    expect(store.getState().initError).toBeNull();
  });
});

describe('sign-in retries a failed init', () => {
  it('starts auth on the first tap when init() had failed', async () => {
    mockInitFirebaseAuth.mockRejectedValueOnce(new Error('transient'));
    const store = freshStore();
    await store.getState().init();
    expect(store.getState().initError).toBeTruthy();

    // Second attempt succeeds -- initFirebaseAuth() no longer caches its own
    // rejection, so a retry is actually able to get through.
    mockInitFirebaseAuth.mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb({
        uid: 'u1',
        email: null,
        displayName: null,
        photoURL: null,
        emailVerified: false,
        metadata: {},
        providerData: [{ providerId: 'google.com' }],
      });
      return () => {};
    });
    mockSignInWithGoogle.mockResolvedValue({ uid: 'u1', providerData: [] });

    await store.getState().signInWithGoogle();

    expect(mockInitFirebaseAuth).toHaveBeenCalledTimes(2);
    expect(mockSignInWithGoogle).toHaveBeenCalled();
    expect(store.getState().initError).toBeNull();
  });

  it('surfaces a generic message, not a raw SDK one, if the retry also fails', async () => {
    mockInitFirebaseAuth.mockRejectedValue(new Error('FIREBASE INTERNAL ASSERTION xyz'));
    const store = freshStore();
    await store.getState().init();

    // SignedOutAccount renders e.message verbatim, so a raw SDK string would
    // land in front of the user (design doc §5 checklist item 3).
    await expect(store.getState().signInWithGoogle()).rejects.toThrow(/Couldn't start sign-in/);
    expect(mockSignInWithGoogle).not.toHaveBeenCalled();
  });

  it('attaches the auth-state listener exactly once across init + retries', async () => {
    mockInitFirebaseAuth.mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(null);
      return () => {};
    });
    mockSignInWithGoogle.mockResolvedValue({ uid: 'u1', providerData: [] });
    const store = freshStore();

    await store.getState().init();
    await store.getState().signInWithGoogle();
    await store.getState().signInWithApple().catch(() => {});

    // A duplicate registration is permanent (the unsubscribe is never called),
    // and would fire syncNow() twice for every auth change.
    expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(getFirebaseAuth).toHaveBeenCalled();
  });
});
