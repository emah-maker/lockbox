// deleteAccount.test.ts -- regression tests for a data-loss bug in
// useAuthStore.deleteAccount: it used to wipe Firestore data (deleteAllUserData)
// BEFORE re-authenticating, so a cancelled or failed native Google/Apple
// picker left cloud settings/goals/devices permanently destroyed while the
// user stayed fully signed in, with DangerZoneSection showing only a generic
// "please try again" message -- no indication anything had been destroyed.
//
// The fix reorders deleteAccount to: (1) re-authenticate first -- a
// cancelled/failed picker aborts the WHOLE flow before anything is touched --
// then (2) wipe Firestore, then (3) delete the Auth user, then (4) clear
// local state. See useAuthStore.ts's deleteAccount for the full comment.
//
// These tests drive useAuthStore directly (a plain zustand store, no
// renderer needed), matching authInitGate.test.ts's style and mocking
// approach.
import { getFirebaseAuth } from './firebase';
import { deleteAllUserData, beginAccountDeletion, endAccountDeletion } from '../sync/firestoreSync';
import { clearLocalAccountData } from '../sync/localDataOwner';
import {
  reauthenticateForDeletion as reauthenticateGoogleForDeletion,
  deleteUserAccount as deleteGoogleUserAccount,
} from './googleAuth';
import {
  reauthenticateForDeletion as reauthenticateAppleForDeletion,
  deleteUserAccount as deleteAppleUserAccount,
} from './appleAuth';

jest.mock('./firebase', () => ({
  initFirebaseAuth: jest.fn(),
  getFirebaseAuth: jest.fn(),
  getDb: jest.fn(() => ({})),
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

const mockSetSessions = jest.fn();
jest.mock('../store/useStore', () => ({
  useStore: { getState: () => ({ setSessions: mockSetSessions }) },
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ autoSyncEnabled: false }) },
}));

const mockGetFirebaseAuth = getFirebaseAuth as jest.Mock;
const mockDeleteAllUserData = deleteAllUserData as jest.Mock;
const mockBeginAccountDeletion = beginAccountDeletion as jest.Mock;
const mockEndAccountDeletion = endAccountDeletion as jest.Mock;
const mockClearLocalAccountData = clearLocalAccountData as jest.Mock;
const mockGoogleReauth = reauthenticateGoogleForDeletion as jest.Mock;
const mockGoogleDeleteUser = deleteGoogleUserAccount as jest.Mock;
const mockAppleReauth = reauthenticateAppleForDeletion as jest.Mock;
const mockAppleDeleteUser = deleteAppleUserAccount as jest.Mock;

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

/** Fresh module instance per test -- same rationale as authInitGate.test.ts's
 * freshStore: avoids cross-test state bleed through this module's
 * module-scope singletons. Returns the whole module (not just the store) so
 * AccountDataWipedError comes from the SAME module instance the store
 * throws it from -- requiring useAuthStore a second time outside
 * isolateModules would get a different module registry entry, and
 * `instanceof` would fail even for the "same" class. */
function freshAuthModule() {
  let mod: any;
  jest.isolateModules(() => {
    mod = require('./useAuthStore');
  });
  return mod;
}

function authWithProviders(providerIds: string[]) {
  mockGetFirebaseAuth.mockReturnValue({
    currentUser: { uid: 'u1', providerData: providerIds.map((id) => ({ providerId: id })) },
  });
}

function storeSignedIn() {
  const mod = freshAuthModule();
  mod.useAuthStore.setState({ user: fakeUser });
  return mod;
}

beforeEach(() => {
  jest.clearAllMocks();
  authWithProviders(['google.com']);
  mockGoogleReauth.mockResolvedValue(undefined);
  mockGoogleDeleteUser.mockResolvedValue(undefined);
  mockAppleReauth.mockResolvedValue(undefined);
  mockAppleDeleteUser.mockResolvedValue(undefined);
  mockDeleteAllUserData.mockResolvedValue(undefined);
  mockClearLocalAccountData.mockResolvedValue(undefined);
});

describe('deleteAccount ordering', () => {
  it('is a no-op when nobody is signed in', async () => {
    const mod = freshAuthModule(); // user starts null
    await mod.useAuthStore.getState().deleteAccount();
    expect(mockBeginAccountDeletion).not.toHaveBeenCalled();
    expect(mockDeleteAllUserData).not.toHaveBeenCalled();
  });

  it('aborts before touching any data when re-authentication fails -- deleteAllUserData is never called', async () => {
    mockGoogleReauth.mockRejectedValue(new Error('Google Sign-In was cancelled.'));
    const { useAuthStore } = storeSignedIn();

    await expect(useAuthStore.getState().deleteAccount()).rejects.toThrow('Google Sign-In was cancelled.');

    // The critical assertion: a cancelled/failed re-auth must never reach
    // the destructive Firestore wipe.
    expect(mockDeleteAllUserData).not.toHaveBeenCalled();
    expect(mockGoogleDeleteUser).not.toHaveBeenCalled();
    expect(mockClearLocalAccountData).not.toHaveBeenCalled();
    // The user must still be signed in -- nothing was cleared or destroyed.
    expect(useAuthStore.getState().user).toEqual(fakeUser);
    // begin/end still bracket the (aborted) attempt.
    expect(mockBeginAccountDeletion).toHaveBeenCalledWith('u1');
    expect(mockEndAccountDeletion).toHaveBeenCalled();
  });

  it('happy path: reauth, then wipe, then deleteUser, then local state cleared, in that order', async () => {
    const order: string[] = [];
    mockGoogleReauth.mockImplementation(async () => {
      order.push('reauth');
    });
    mockDeleteAllUserData.mockImplementation(async () => {
      order.push('wipe');
    });
    mockGoogleDeleteUser.mockImplementation(async () => {
      order.push('deleteUser');
    });
    mockClearLocalAccountData.mockImplementation(async () => {
      order.push('clearLocal');
    });
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().deleteAccount();

    expect(order).toEqual(['reauth', 'wipe', 'deleteUser', 'clearLocal']);
    expect(useAuthStore.getState().user).toBeNull();
    expect(mockSetSessions).toHaveBeenCalledWith([]);
  });

  it('retries re-authentication exactly once on auth/requires-recent-login, then proceeds normally', async () => {
    const staleError: any = new Error('stale session');
    staleError.code = 'auth/requires-recent-login';
    mockGoogleReauth.mockRejectedValueOnce(staleError).mockResolvedValueOnce(undefined);
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().deleteAccount();

    expect(mockGoogleReauth).toHaveBeenCalledTimes(2);
    expect(mockDeleteAllUserData).toHaveBeenCalledTimes(1);
    expect(mockGoogleDeleteUser).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second time -- a second requires-recent-login failure propagates and still aborts before the wipe', async () => {
    const staleError: any = new Error('stale session');
    staleError.code = 'auth/requires-recent-login';
    mockGoogleReauth.mockRejectedValue(staleError);
    const { useAuthStore } = storeSignedIn();

    await expect(useAuthStore.getState().deleteAccount()).rejects.toBe(staleError);

    expect(mockGoogleReauth).toHaveBeenCalledTimes(2);
    expect(mockDeleteAllUserData).not.toHaveBeenCalled();
  });

  it('surfaces AccountDataWipedError, and never clears local state, when deleteUser fails after the wipe already succeeded', async () => {
    const underlying = new Error('network dropped');
    mockGoogleDeleteUser.mockRejectedValue(underlying);
    const mod = storeSignedIn();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(mod.useAuthStore.getState().deleteAccount()).rejects.toBeInstanceOf(mod.AccountDataWipedError);

    expect(mockDeleteAllUserData).toHaveBeenCalledTimes(1); // the wipe DID happen
    expect(mockClearLocalAccountData).not.toHaveBeenCalled();
    // Still signed in in the store -- the account itself was never actually removed.
    expect(mod.useAuthStore.getState().user).toEqual(fakeUser);
    expect(mockEndAccountDeletion).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('picks Apple re-auth/delete when only Apple is linked, and never touches Google', async () => {
    authWithProviders(['apple.com']);
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().deleteAccount();

    expect(mockAppleReauth).toHaveBeenCalledTimes(1);
    expect(mockAppleDeleteUser).toHaveBeenCalledTimes(1);
    expect(mockGoogleReauth).not.toHaveBeenCalled();
    expect(mockGoogleDeleteUser).not.toHaveBeenCalled();
  });

  it('picks Google (not Apple) when both providers are linked, so only one native prompt runs', async () => {
    authWithProviders(['google.com', 'apple.com']);
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().deleteAccount();

    expect(mockGoogleReauth).toHaveBeenCalledTimes(1);
    expect(mockGoogleDeleteUser).toHaveBeenCalledTimes(1);
    expect(mockAppleReauth).not.toHaveBeenCalled();
    expect(mockAppleDeleteUser).not.toHaveBeenCalled();
  });
});
