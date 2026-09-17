// involuntarySignOut.test.ts -- what happens on this device when the session
// ends without anyone tapping Sign out.
//
// signOut() is not the only way a user stops being signed in. Firebase drops
// the session on its own whenever the refresh token stops being valid: the
// password was changed on another device, the account was disabled or
// deleted from the console, the credential was revoked. There is no tap, no
// action, no `await` anywhere in this app -- just onAuthStateChanged firing
// with null.
//
// The invariant: however the session ends, nothing of that account may be
// left on the device. That is clearSignedInState's whole purpose (see its
// own comment, and clearLocalAccountData's in sync/localDataOwner.ts: "so no
// account's data lingers on a shared, resold, or reset device"), and the
// auth listener never called it. It only set `user: null`, so
// localDataOwnerUid still named the old account and its sessions, goals,
// settings and armed scheduled-session reminders all stayed: the Account
// page flipped to signed-out while Stats and Calendar kept rendering the
// previous account's history and its reminders kept firing.
//
// Mock surface and the freshStore() helper follow authInitGate.test.ts,
// which drives this same listener for the sign-in gate.
import { initFirebaseAuth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { clearLocalAccountData } from '../sync/localDataOwner';

jest.mock('./firebase', () => ({
  initFirebaseAuth: jest.fn(),
  getFirebaseAuth: jest.fn(() => ({})),
  getDb: jest.fn(() => ({})),
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
jest.mock('../sync/localDataOwner', () => ({ clearLocalAccountData: jest.fn(async () => {}) }));
// setSessions is the live-store half of the teardown -- clearLocalAccountData
// only wipes AsyncStorage, and Stats/Calendar render useStore.sessions.
const mockSetSessions = jest.fn();
jest.mock('../store/useStore', () => ({ useStore: { getState: () => ({ setSessions: mockSetSessions }) } }));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ autoSyncEnabled: false }) },
}));

const mockInitFirebaseAuth = initFirebaseAuth as jest.Mock;
const mockOnAuthStateChanged = onAuthStateChanged as jest.Mock;
const mockClearLocalAccountData = clearLocalAccountData as jest.Mock;

/** Fresh module instance per test: the store caches `authListenerAttached` at
 * module scope, so tests would otherwise leak listener state into each other. */
function freshStore() {
  let store: any;
  jest.isolateModules(() => {
    store = require('./useAuthStore').useAuthStore;
  });
  return store;
}

/** The minimum of Firebase's User that toAccountUser reads. */
const firebaseUser = (uid: string) => ({
  uid,
  email: null,
  displayName: null,
  photoURL: null,
  emailVerified: true,
  metadata: {},
  providerData: [{ providerId: 'google.com' }],
});

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // init() arms a 10s watchdog on every call; a real timer would keep the
  // Jest process alive past the run.
  jest.useFakeTimers();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

/** Attaches the real listener and hands back the callback Firebase would
 * invoke, so a test can drive auth transitions directly. */
async function attachListener(): Promise<{ store: any; emit: (u: unknown) => void }> {
  let cb: ((u: unknown) => void) | null = null;
  mockInitFirebaseAuth.mockResolvedValue(undefined);
  mockOnAuthStateChanged.mockImplementation((_auth: unknown, fn: (u: unknown) => void) => {
    cb = fn;
    return () => {};
  });
  const store = freshStore();
  await store.getState().init();
  return { store, emit: (u: unknown) => cb!(u) };
}

describe('an involuntary sign-out', () => {
  it('tears down the previous account exactly as signOut does', async () => {
    const { store, emit } = await attachListener();
    emit(firebaseUser('uid-a'));
    store.setState({ lastSyncedAt: 1_700_000_000_000, syncError: 'stale', linkError: 'stale' });
    jest.clearAllMocks();

    // Firebase rejected the refresh token -- no tap, no action, just this.
    emit(null);
    // The teardown is async and the listener is not; let it settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().user).toBeNull();
    // The leak: without this, localDataOwnerUid still names uid-a and every
    // session, goal, plan and reminder of that account is still on the phone.
    expect(mockClearLocalAccountData).toHaveBeenCalled();
    expect(mockSetSessions).toHaveBeenCalledWith([]);
    expect(store.getState().lastSyncedAt).toBeNull();
    expect(store.getState().syncError).toBeNull();
    expect(store.getState().linkError).toBeNull();
  });

  it('leaves a signed-out cold start alone', async () => {
    // Firebase always fires once on startup, with null when there is no
    // session. Treating that as a sign-out would wipe local data -- and
    // reset the five syncable settings to their defaults -- on every single
    // launch of a signed-out app.
    const { store, emit } = await attachListener();

    emit(null);
    await Promise.resolve();

    expect(store.getState().ready).toBe(true);
    expect(mockClearLocalAccountData).not.toHaveBeenCalled();
    expect(mockSetSessions).not.toHaveBeenCalled();
  });

  it('leaves a token refresh alone', async () => {
    // onAuthStateChanged also fires for an ordinary token refresh of the SAME
    // user. Nothing ended, so nothing may be torn down.
    const { emit } = await attachListener();
    emit(firebaseUser('uid-a'));
    jest.clearAllMocks();

    emit(firebaseUser('uid-a'));
    await Promise.resolve();

    expect(mockClearLocalAccountData).not.toHaveBeenCalled();
  });

  it('does not let a failed teardown escape the listener', async () => {
    // The listener is a synchronous Firebase callback with no caller to
    // catch anything: an unhandled rejection out of here is an unhandled
    // rejection in the SDK's own call stack.
    mockClearLocalAccountData.mockRejectedValueOnce(new Error('storage unavailable'));
    const { store, emit } = await attachListener();
    emit(firebaseUser('uid-a'));

    expect(() => emit(null)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    // Signed out on screen regardless -- the account state is what the user
    // is being told about, and it is correct even when the wipe failed.
    expect(store.getState().user).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
