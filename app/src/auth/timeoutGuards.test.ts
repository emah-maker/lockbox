// timeoutGuards.test.ts -- what the two 30s bounds in useAuthStore.ts are
// allowed to release when they fire.
//
// withTimeout bounds how long the CALLER waits. It cannot cancel what it
// raced -- the Firestore SDK offers nothing to cancel with, and offline a
// write's promise simply stays pending rather than rejecting (see
// SYNC_TIMEOUT_MS's own comment). So a timeout means "stop waiting", never
// "it stopped".
//
// Both of these bounds were releasing a GUARD from the race's own `finally`,
// which is the one thing that must not be released early, because the work
// the guard protects against is still running:
//
//   - deleteAccount's endAccountDeletion. isBeingDeleted(uid) going false
//     while deletes are still in flight makes syncCommon's pushTarget()
//     return the uid again, and the next settings/session/goal bridge
//     emission re-creates a document inside the account being deleted --
//     exactly the race that flag was added for (see syncCommon.ts's
//     deletingUid comment).
//   - syncNow's syncingUid. That field is the re-entrancy guard, so clearing
//     it re-enables the Sync-now button for a run that is still going: two
//     runMigrationAndSync calls for one uid then interleave replaceSessions,
//     applyRemoteSettings and their upload batches.
//
// Mock surface follows deleteAccount.test.ts, which drives this same store.
import { initFirebaseAuth, getFirebaseAuth } from './firebase';
import {
  runMigrationAndSync,
  deleteAllUserData,
  beginAccountDeletion,
  endAccountDeletion,
} from '../sync/firestoreSync';
import { clearLocalAccountData } from '../sync/localDataOwner';
import { reauthenticateForDeletion as reauthenticateGoogleForDeletion } from './googleAuth';

jest.mock('../push/pushRegistration', () => ({ unregisterPushToken: jest.fn(async () => {}) }));
jest.mock('./firebase', () => ({
  initFirebaseAuth: jest.fn(),
  getFirebaseAuth: jest.fn(),
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
  deleteUserAccount: jest.fn(async () => {}),
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
jest.mock('../store/useStore', () => ({ useStore: { getState: () => ({ setSessions: jest.fn() }) } }));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ autoSyncEnabled: false }) },
}));

const mockGetFirebaseAuth = getFirebaseAuth as jest.Mock;
const mockInitFirebaseAuth = initFirebaseAuth as jest.Mock;
const mockRunMigrationAndSync = runMigrationAndSync as jest.Mock;
const mockDeleteAllUserData = deleteAllUserData as jest.Mock;
const mockBeginAccountDeletion = beginAccountDeletion as jest.Mock;
const mockEndAccountDeletion = endAccountDeletion as jest.Mock;
const mockClearLocalAccountData = clearLocalAccountData as jest.Mock;
const mockGoogleReauth = reauthenticateGoogleForDeletion as jest.Mock;

/** Matches the two constants in useAuthStore.ts; both bounds are 30s. */
const TIMEOUT_MS = 30_000;

const fakeUser = {
  uid: 'u1',
  email: 'a@b.com',
  displayName: null,
  photoURL: null,
  emailVerified: true,
  creationTime: null,
  lastSignInTime: null,
  providerIds: ['google.com'],
  linkedProviders: ['google'] as const,
};

/** Fresh module instance per test -- same rationale as deleteAccount.test.ts's
 * freshAuthModule: this module has module-scope singletons. */
function storeSignedIn() {
  let mod: any;
  jest.isolateModules(() => {
    mod = require('./useAuthStore');
  });
  mod.useAuthStore.setState({ user: fakeUser });
  return mod.useAuthStore;
}

/** A promise the test decides when to settle, standing in for a Firestore
 * call that is simply taking longer than its bound. */
function pending(): { promise: Promise<void>; finish: () => void } {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

/** Settled-or-not, without ever leaving a rejection unhandled: fake timers
 * make it easy for a rejection to land several ticks before the assertion
 * that consumes it. */
function capture(p: Promise<unknown>): Promise<Error | null> {
  return p.then(
    () => null,
    (e: Error) => e,
  );
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockGetFirebaseAuth.mockReturnValue({
    currentUser: { uid: 'u1', providerData: [{ providerId: 'google.com' }] },
  });
  mockInitFirebaseAuth.mockResolvedValue(undefined);
  mockGoogleReauth.mockResolvedValue(undefined);
  mockDeleteAllUserData.mockResolvedValue(undefined);
  mockRunMigrationAndSync.mockResolvedValue(undefined);
  mockClearLocalAccountData.mockResolvedValue(undefined);
});

afterEach(() => {
  warn.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('the account-deletion guard outlives its timeout', () => {
  it('stays set while a timed-out wipe is still deleting', async () => {
    const wipe = pending();
    mockDeleteAllUserData.mockReturnValue(wipe.promise);
    const useAuthStore = storeSignedIn();

    const deletion = capture(useAuthStore.getState().deleteAccount());
    await jest.advanceTimersByTimeAsync(0); // reauth resolves, the wipe starts
    expect(mockBeginAccountDeletion).toHaveBeenCalledWith('u1');
    expect(mockDeleteAllUserData).toHaveBeenCalledWith('u1');

    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect((await deletion)?.name).toBe('DeleteWipeTimeoutError');

    // The wipe is STILL deleting documents. Releasing here is what let a
    // bridge emission re-create one of them inside the account.
    expect(mockEndAccountDeletion).not.toHaveBeenCalled();

    wipe.finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockEndAccountDeletion).toHaveBeenCalled();
  });

  it('releases as soon as a timed-out wipe fails, too', async () => {
    // Released because the work STOPPED, not because it succeeded -- a wipe
    // that rejects after its bound has nothing left in flight to guard.
    let failWipe!: (e: Error) => void;
    mockDeleteAllUserData.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        failWipe = reject;
      }),
    );
    const useAuthStore = storeSignedIn();

    const deletion = capture(useAuthStore.getState().deleteAccount());
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    await deletion;
    expect(mockEndAccountDeletion).not.toHaveBeenCalled();

    failWipe(new Error('permission denied'));
    await jest.advanceTimersByTimeAsync(0);
    expect(mockEndAccountDeletion).toHaveBeenCalled();
  });

  it('still releases when the wipe never started', async () => {
    // A cancelled picker aborts before deleteAllUserData is called at all.
    // Nothing is in flight, so the guard must not be left set -- that would
    // block every later push for a user who is still signed in.
    mockGoogleReauth.mockRejectedValue(new Error('Google Sign-In was cancelled.'));
    const useAuthStore = storeSignedIn();

    const deletion = capture(useAuthStore.getState().deleteAccount());
    await jest.advanceTimersByTimeAsync(0);

    expect((await deletion)?.message).toMatch(/cancelled/);
    expect(mockDeleteAllUserData).not.toHaveBeenCalled();
    expect(mockEndAccountDeletion).toHaveBeenCalled();
  });

  it('releases on the ordinary successful deletion', async () => {
    const useAuthStore = storeSignedIn();

    await useAuthStore.getState().deleteAccount();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockEndAccountDeletion).toHaveBeenCalled();
    expect(mockClearLocalAccountData).toHaveBeenCalled();
  });
});

describe('the sync re-entrancy guard outlives its timeout', () => {
  it('unblocks the UI but does not let a second run start', async () => {
    // The two halves of this are deliberately different fields doing
    // different jobs: `syncing` is what the screen renders (spinner, and
    // the disabled Sync-now and Sign-out buttons), so the bound must
    // release it or the first sign-in on a flaky connection greys out the
    // way back out of the app -- the exact bug SYNC_TIMEOUT_MS was added
    // for. `syncingUid` is the re-entrancy guard, and the run it guards
    // against is still going.
    const work = pending();
    mockRunMigrationAndSync.mockReturnValue(work.promise);
    const useAuthStore = storeSignedIn();

    const first = capture(useAuthStore.getState().syncNow());
    await jest.advanceTimersByTimeAsync(0);
    expect(useAuthStore.getState().syncing).toBe(true);

    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    await first;

    expect(useAuthStore.getState().syncing).toBe(false);
    expect(useAuthStore.getState().syncError).toBeTruthy();

    // runMigrationAndSync is still running: replaceSessions,
    // applyRemoteSettings and its upload batches are all still to come. A
    // second run for the same uid interleaves with every one of them.
    // Not awaited: with the guard broken this call really does start a
    // second run, and awaiting a run that never settles would turn the
    // failure into a Jest timeout instead of this assertion.
    mockRunMigrationAndSync.mockClear();
    capture(useAuthStore.getState().syncNow());
    await jest.advanceTimersByTimeAsync(0);
    expect(mockRunMigrationAndSync).not.toHaveBeenCalled();

    work.finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(useAuthStore.getState().syncingUid).toBeNull();

    // And once it really has stopped, Sync now works again.
    mockRunMigrationAndSync.mockResolvedValue(undefined);
    await useAuthStore.getState().syncNow();
    expect(mockRunMigrationAndSync).toHaveBeenCalledWith('u1');
  });

  it('clears both on an ordinary sync', async () => {
    const useAuthStore = storeSignedIn();

    await useAuthStore.getState().syncNow();

    expect(useAuthStore.getState().syncing).toBe(false);
    expect(useAuthStore.getState().syncingUid).toBeNull();
    expect(useAuthStore.getState().syncError).toBeNull();
  });

  it('clears both when the sync itself fails', async () => {
    mockRunMigrationAndSync.mockRejectedValue(new Error('Firestore unavailable'));
    const useAuthStore = storeSignedIn();

    await useAuthStore.getState().syncNow();
    await jest.advanceTimersByTimeAsync(0);

    expect(useAuthStore.getState().syncing).toBe(false);
    expect(useAuthStore.getState().syncingUid).toBeNull();
    expect(useAuthStore.getState().syncError).toBeTruthy();
  });

  it('never blocks -- or is clobbered by -- another account', async () => {
    // Only re-entrancy for the SAME uid is guarded (syncNow's own comment),
    // and holding the guard longer must not change that.
    const stale = pending();
    mockRunMigrationAndSync.mockReturnValue(stale.promise);
    const useAuthStore = storeSignedIn();

    const first = capture(useAuthStore.getState().syncNow());
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    await first;

    // B signs in on this phone while A's run is still in flight.
    const fresh = pending();
    mockRunMigrationAndSync.mockReturnValue(fresh.promise);
    useAuthStore.setState({ user: { ...fakeUser, uid: 'u2' } });
    const second = capture(useAuthStore.getState().syncNow());
    await jest.advanceTimersByTimeAsync(0);
    expect(useAuthStore.getState().syncingUid).toBe('u2');

    // A's run finally stops. It owns none of this state any more, so
    // releasing the guard must not take B's spinner down with it.
    stale.finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(useAuthStore.getState().syncingUid).toBe('u2');
    expect(useAuthStore.getState().syncing).toBe(true);

    fresh.finish();
    await second;
    expect(useAuthStore.getState().syncingUid).toBeNull();
    expect(useAuthStore.getState().syncing).toBe(false);
  });
});
