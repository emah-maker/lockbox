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
  // Only ever read to annotate a diagnostic log line (useAuthStore's
  // describeInitError / watchdog), so a fixed value is enough -- these tests
  // assert on the store's state and the gate's timing, not on log text.
  getAuthInitStage: jest.fn(() => 'initialize-auth'),
}));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
  unlink: jest.fn(),
}));
jest.mock('./googleAuth', () => ({
  signInWithGoogle: jest.fn(),
  signOutFully: jest.fn(),
  reauthenticateForDeletion: jest.fn(),
  deleteUserAccount: jest.fn(),
  linkGoogleToCurrentUser: jest.fn(),
}));
jest.mock('./appleAuth', () => ({
  signInWithApple: jest.fn(),
  signOutFully: jest.fn(),
  reauthenticateForDeletion: jest.fn(),
  deleteUserAccount: jest.fn(),
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

  it('reports the not-configured message (not the generic connection one) when init fails on a FirebaseConfigError', async () => {
    // firebase.ts's initFirebaseAuth() throws this (by name, no `.code`)
    // before it ever touches the Firebase SDK, when firebaseConfig.ts's
    // required fields are missing/blank/placeholder -- see
    // firebaseConfig.test.ts. AUTH_INIT_ERROR's "check your connection"
    // wording would be actively misleading for this, since no network is
    // involved and no retry can fix it.
    const configError = new Error('Firebase config is missing/invalid for: EXPO_PUBLIC_FIREBASE_API_KEY.');
    configError.name = 'FirebaseConfigError';
    mockInitFirebaseAuth.mockRejectedValue(configError);
    const store = freshStore();

    await store.getState().init();

    expect(store.getState().ready).toBe(true);
    expect(store.getState().initError).toBe("Sign-in isn't configured on this build.");
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

// The watchdog in init() releases the sign-in GATE when auth never starts. It
// cannot un-hang the sign-in itself -- and before these two cases it actually
// made that failure worse, by turning visibly-dead buttons into live-looking
// ones that accept a tap and then never come back.
describe('a sign-in tap is time-bounded too', () => {
  it('fails with a shown error instead of hanging forever when init never settles', async () => {
    // initFirebaseAuth() memoizes its promise, so a call that neither
    // resolves nor rejects is handed to every later caller as well. The
    // sign-in path awaited it with no bound, and SignedOutAccount only clears
    // `busy` in its `finally` -- so the spinner ran and every button on the
    // page stayed disabled until the app was force-quit, with nothing shown
    // and nothing logged.
    mockInitFirebaseAuth.mockReturnValue(new Promise(() => {}));
    const store = freshStore();

    store.getState().init();
    await Promise.resolve();
    jest.advanceTimersByTime(10_000); // the init watchdog releases the gate
    expect(store.getState().ready).toBe(true);

    const signIn = store.getState().signInWithGoogle();
    const rejects = expect(signIn).rejects.toThrow(/Couldn't start sign-in/);
    await Promise.resolve();
    jest.advanceTimersByTime(10_000); // and now the sign-in's own bound
    await rejects;

    // The provider's native picker must never have opened: there was no
    // Firebase session for its credential to land in.
    expect(mockSignInWithGoogle).not.toHaveBeenCalled();
    expect(store.getState().initError).toMatch(/Couldn't start sign-in/);
  });

  it('leaves no stray timer behind when auth starts normally', async () => {
    // The bound arms a timer on every sign-in attempt. Left uncleared on the
    // success path it would keep the RN timer queue (and a Jest run) alive
    // past the work it belongs to.
    mockInitFirebaseAuth.mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(null);
      return () => {};
    });
    mockSignInWithGoogle.mockResolvedValue({ uid: 'u1', providerData: [] });
    const store = freshStore();

    await store.getState().init();
    jest.advanceTimersByTime(10_000); // drain init()'s own watchdog first
    const before = jest.getTimerCount();

    await store.getState().signInWithGoogle();

    expect(jest.getTimerCount()).toBe(before);
  });
});

describe('the auth-state listener is only claimed once it actually attached', () => {
  it('still attaches on a retry after the first registration threw', async () => {
    // `authListenerAttached` used to be set BEFORE onAuthStateChanged was
    // called. If that registration threw, the flag stayed true with no
    // listener anywhere: the first failure surfaced (init()'s catch), but
    // every retry afterwards took the early `return` and reported SUCCESS.
    // The sign-in then ran for real -- Firebase genuinely authenticated the
    // user -- and nothing was left to tell this store about it. `user` stayed
    // null, the Account page stayed signed-out, and no error was shown
    // anywhere: tapping "Sign in with Google" simply did nothing, forever.
    mockInitFirebaseAuth.mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockImplementationOnce(() => {
      throw new Error('INTERNAL ASSERTION FAILED');
    });
    const store = freshStore();

    await store.getState().init();
    expect(store.getState().initError).toBeTruthy(); // the failure is reported, once

    const user = {
      uid: 'u1',
      email: null,
      displayName: null,
      photoURL: null,
      emailVerified: false,
      metadata: {},
      providerData: [{ providerId: 'google.com' }],
    };
    mockOnAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(user);
      return () => {};
    });
    mockSignInWithGoogle.mockResolvedValue({ uid: 'u1', providerData: [] });

    await store.getState().signInWithGoogle();

    // The whole point: the retry re-registered, so the signed-in user
    // actually reached the store.
    expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(2);
    expect(store.getState().user?.uid).toBe('u1');
    expect(store.getState().initError).toBeNull();
  });
});
