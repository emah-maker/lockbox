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
// Also covers, with the same full-mock useAuthStore harness: deleteAccount's
// google > apple > password provider preference and its PasswordRequiredError
// guard (email/password is this app's third sign-in provider -- see
// accountLinking.ts's AuthProviderKind), and handleProviderSignIn's
// candidateProviders-based pending-link completion on signInWithGoogle/
// signInWithApple/signInWithEmail/createAccountWithEmail -- the other place
// the three-provider generalization could silently regress. There is no
// separate file for these: exercising the real matching logic means driving
// useAuthStore.ts itself, which needs this exact mock set, and Jest's
// file-scoped jest.mock() can't mix a mocked './emailAuth'/'./accountLinking'
// here with the real ones emailAuth.test.ts/accountLinking.test.ts test
// directly.
//
// These tests drive useAuthStore directly (a plain zustand store, no
// renderer needed), matching authInitGate.test.ts's style and mocking
// approach.
import { initFirebaseAuth, getFirebaseAuth } from './firebase';
import { deleteAllUserData, beginAccountDeletion, endAccountDeletion } from '../sync/firestoreSync';
import { clearLocalAccountData } from '../sync/localDataOwner';
import {
  signInWithGoogle as signInWithGoogleAuth,
  reauthenticateForDeletion as reauthenticateGoogleForDeletion,
  deleteUserAccount as deleteGoogleUserAccount,
} from './googleAuth';
import {
  signInWithApple as signInWithAppleAuth,
  reauthenticateForDeletion as reauthenticateAppleForDeletion,
  deleteUserAccount as deleteAppleUserAccount,
} from './appleAuth';
import {
  signInWithEmail as signInWithEmailAuth,
  createAccountWithEmail as createAccountWithEmailAuth,
  reauthenticateForDeletion as reauthenticateEmailForDeletion,
  deleteUserAccount as deleteEmailUserAccount,
} from './emailAuth';
import { getPendingLink, completePendingLink, clearPendingLink, AccountExistsError } from './accountLinking';
import { unregisterPushToken } from '../push/pushRegistration';

jest.mock('../push/pushRegistration', () => ({ unregisterPushToken: jest.fn() }));
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
jest.mock('./emailAuth', () => ({
  signInWithEmail: jest.fn(),
  createAccountWithEmail: jest.fn(),
  sendPasswordReset: jest.fn(),
  linkEmailToCurrentUser: jest.fn(),
  signOutFully: jest.fn(),
  reauthenticateForDeletion: jest.fn(),
  deleteUserAccount: jest.fn(),
}));
// getPendingLink/completePendingLink are mocked so handleProviderSignIn's
// candidateProviders-matching logic can be driven directly; AccountExistsError
// is a trivial, dependency-free class (no Firebase import of its own reaches
// here), hand-rolled rather than pulled from the real module so its identity
// can never disagree with the mocked module `useAuthStore.ts` itself imports.
jest.mock('./accountLinking', () => ({
  getPendingLink: jest.fn(),
  completePendingLink: jest.fn(),
  clearPendingLink: jest.fn(),
  AccountExistsError: class AccountExistsError extends Error {
    pending: any;
    constructor(pending: any) {
      super('An account already exists for this email with a different sign-in method.');
      this.name = 'AccountExistsError';
      this.pending = pending;
    }
  },
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
const mockEmailReauth = reauthenticateEmailForDeletion as jest.Mock;
const mockEmailDeleteUser = deleteEmailUserAccount as jest.Mock;
const mockSignInWithGoogle = signInWithGoogleAuth as jest.Mock;
const mockSignInWithApple = signInWithAppleAuth as jest.Mock;
const mockSignInWithEmail = signInWithEmailAuth as jest.Mock;
const mockCreateAccountWithEmail = createAccountWithEmailAuth as jest.Mock;
const mockGetPendingLink = getPendingLink as jest.Mock;
const mockCompletePendingLink = completePendingLink as jest.Mock;
const mockClearPendingLink = clearPendingLink as jest.Mock;
const mockInitFirebaseAuth = initFirebaseAuth as jest.Mock;
const mockUnregisterPushToken = unregisterPushToken as jest.Mock;

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
  mockEmailReauth.mockResolvedValue(undefined);
  mockEmailDeleteUser.mockResolvedValue(undefined);
  mockDeleteAllUserData.mockResolvedValue(undefined);
  mockClearLocalAccountData.mockResolvedValue(undefined);
  mockInitFirebaseAuth.mockResolvedValue(undefined);
  mockGetPendingLink.mockReturnValue(null);
  mockCompletePendingLink.mockResolvedValue(undefined);
  mockUnregisterPushToken.mockResolvedValue(undefined);
});

/** A minimal PendingAccountLink-shaped fixture for asserting a stashed
 * conflict is torn down (clearPendingLink + the store's own field), as
 * opposed to the candidateProviders-matching tests below which care about
 * its actual shape. */
function fakePendingLink(): any {
  return { attemptedProvider: 'apple', candidateProviders: ['google', 'password'], email: 'a@b.com', credential: {} };
}

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

  // Regression test for a second leak in the same area as the ordering bug
  // above: nobody is signed in once this succeeds, so a credential stashed by
  // an earlier, unrelated conflict is both moot and unsafe to keep -- before
  // dismissPendingLink existed, deleteAccount's success path never touched
  // pendingLink at all (module singleton OR store field), so it survived
  // account deletion and could later attach itself to whoever signs in next
  // on this device.
  it('clears any stashed pending-link credential on the success path', async () => {
    const { useAuthStore } = storeSignedIn();
    useAuthStore.setState({ pendingLink: fakePendingLink() });

    await useAuthStore.getState().deleteAccount();

    expect(mockClearPendingLink).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().pendingLink).toBeNull();
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

  // email/password is this app's third sign-in provider (accountLinking.ts's
  // AuthProviderKind), preferred LAST -- deleteUser() only needs to run once
  // and removes every linked provider in a single call, so an account with
  // more than one provider picks exactly one to reauthenticate with. The
  // guarantee that matters here: existing OAuth users must be completely
  // unaffected by password now existing as an option.
  it('does not require a password and never prompts for one when Google and password are both linked', async () => {
    authWithProviders(['google.com', 'password']);
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().deleteAccount(); // no password passed -- must not throw or need one

    expect(mockGoogleReauth).toHaveBeenCalledTimes(1);
    expect(mockGoogleDeleteUser).toHaveBeenCalledTimes(1);
    expect(mockEmailReauth).not.toHaveBeenCalled();
    expect(mockEmailDeleteUser).not.toHaveBeenCalled();
  });

  it('picks Apple (not password) when Apple and password are both linked but Google is not', async () => {
    authWithProviders(['apple.com', 'password']);
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().deleteAccount();

    expect(mockAppleReauth).toHaveBeenCalledTimes(1);
    expect(mockAppleDeleteUser).toHaveBeenCalledTimes(1);
    expect(mockEmailReauth).not.toHaveBeenCalled();
    expect(mockEmailDeleteUser).not.toHaveBeenCalled();
  });
});

describe('deleteAccount on a password-only account', () => {
  it('throws PasswordRequiredError before beginAccountDeletion/deleteAllUserData when no password is passed', async () => {
    authWithProviders(['password']);
    const mod = storeSignedIn();

    await expect(mod.useAuthStore.getState().deleteAccount()).rejects.toBeInstanceOf(mod.PasswordRequiredError);

    // The critical assertion, matching this file's other "aborts before
    // touching any data" tests above: unlike a cancelled OAuth picker, there
    // is no native prompt this store can run on its own for a password, so
    // the flow must not even begin -- not beginAccountDeletion, and
    // certainly not the destructive Firestore wipe.
    expect(mockBeginAccountDeletion).not.toHaveBeenCalled();
    expect(mockDeleteAllUserData).not.toHaveBeenCalled();
    expect(mockEmailReauth).not.toHaveBeenCalled();
    expect(mockEmailDeleteUser).not.toHaveBeenCalled();
    expect(mod.useAuthStore.getState().user).toEqual(fakeUser);
  });

  it('reauth, then wipe, then deleteUser, then local state cleared, in that order, once a password is passed', async () => {
    authWithProviders(['password']);
    const order: string[] = [];
    mockEmailReauth.mockImplementation(async () => {
      order.push('reauth');
    });
    mockDeleteAllUserData.mockImplementation(async () => {
      order.push('wipe');
    });
    mockEmailDeleteUser.mockImplementation(async () => {
      order.push('deleteUser');
    });
    mockClearLocalAccountData.mockImplementation(async () => {
      order.push('clearLocal');
    });
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().deleteAccount('hunter2');

    expect(order).toEqual(['reauth', 'wipe', 'deleteUser', 'clearLocal']);
    // The password reaches reauthentication specifically -- not dropped, and
    // not the wrong closure variable captured.
    expect(mockEmailReauth).toHaveBeenCalledWith('hunter2');
    expect(useAuthStore.getState().user).toBeNull();
  });
});

// handleProviderSignIn (useAuthStore.ts) completes a pending cross-provider
// link once the user proves ownership by signing in with ANY of
// pendingLink.candidateProviders -- not one specific provider. Before the
// three-provider generalization this compared against a single
// `linkWithProvider` field; these tests drive the real matching logic
// (getPendingLink/completePendingLink are mocked so each case can set up its
// own pending state directly, rather than needing a real conflict first).
describe('sign-in completes a pending cross-provider link for ANY candidate provider', () => {
  const fakeCredential = { providerId: 'google.com', signInMethod: 'oauth' } as any;

  function pendingLinkFor(
    attemptedProvider: 'google' | 'apple' | 'password',
    candidateProviders: Array<'google' | 'apple' | 'password'>,
  ) {
    return { attemptedProvider, candidateProviders, email: 'a@b.com', credential: fakeCredential };
  }

  it('completes the link when Apple signs in and Apple is a candidate (the original conflict was a Google attempt)', async () => {
    mockGetPendingLink.mockReturnValue(pendingLinkFor('google', ['apple', 'password']));
    const signedInUser = { uid: 'apple-user' };
    mockSignInWithApple.mockResolvedValue(signedInUser);
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().signInWithApple();

    expect(mockCompletePendingLink).toHaveBeenCalledWith(signedInUser);
    expect(useAuthStore.getState().pendingLink).toBeNull();
    // completePendingLink consumes (and clears) the stashed credential itself
    // -- this path must not ALSO call clearPendingLink, or a future regression
    // where completePendingLink stops clearing it would go unnoticed.
    expect(mockClearPendingLink).not.toHaveBeenCalled();
  });

  it('completes the link when signing in with email/password and password is a candidate (the original conflict was a Google attempt)', async () => {
    mockGetPendingLink.mockReturnValue(pendingLinkFor('google', ['apple', 'password']));
    const signedInUser = { uid: 'password-user' };
    mockSignInWithEmail.mockResolvedValue(signedInUser);
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().signInWithEmail('a@b.com', 'pw');

    // The actual semantic change: the old code compared against one
    // hardcoded field, so it could only ever match ONE of the two candidates
    // above -- this and the previous test between them prove it checks
    // membership in the whole list instead.
    expect(mockCompletePendingLink).toHaveBeenCalledWith(signedInUser);
    expect(mockClearPendingLink).not.toHaveBeenCalled(); // see the Apple case's note above
  });

  it('does NOT complete the link when the provider signing in is the one that originally conflicted (not a candidate), and dismisses the stale credential instead', async () => {
    mockGetPendingLink.mockReturnValue(pendingLinkFor('google', ['apple', 'password']));
    const signedInUser = { uid: 'google-user-again' };
    mockSignInWithGoogle.mockResolvedValue(signedInUser);
    const { useAuthStore } = storeSignedIn();

    await useAuthStore.getState().signInWithGoogle();

    expect(mockCompletePendingLink).not.toHaveBeenCalled();
    // The critical assertion (this is the regression that shipped): a
    // non-candidate success used to clear only the store's own mirror --
    // set({pendingLink:null}) ran unconditionally -- while the module's
    // stashed credential (accountLinking.ts) lived on, ready for a LATER,
    // unrelated sign-in to have it silently linked on. clearPendingLink()
    // must actually run here, not just the store field.
    expect(mockClearPendingLink).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().pendingLink).toBeNull();
  });

  it('sets pendingLink in the store, and still rethrows, when a sign-in attempt hits a cross-provider conflict', async () => {
    const pending = pendingLinkFor('google', ['apple', 'password']);
    const conflictError = new AccountExistsError(pending as any);
    mockSignInWithGoogle.mockRejectedValue(conflictError);
    const { useAuthStore } = storeSignedIn();

    await expect(useAuthStore.getState().signInWithGoogle()).rejects.toBe(conflictError);

    expect(useAuthStore.getState().pendingLink).toEqual(pending);
    expect(mockCompletePendingLink).not.toHaveBeenCalled();
  });

  // createAccountWithEmail always creates a brand-new Firebase user under
  // whatever email was typed, which proves nothing about a pending conflict's
  // (possibly different) email -- so, unlike the sign-in actions above, it
  // must never complete one. It does still clear the store's own stale
  // prompt, since a newly-created and signed-in account makes that prompt
  // moot either way (see the action's own implementation comment).
  it('createAccountWithEmail does not complete a pending link, but does clear the stale prompt', async () => {
    // createAccountWithEmail doesn't consult getPendingLink() at all (it
    // isn't routed through handleProviderSignIn) -- setting the store's own
    // pendingLink field directly is what stands in for "a prompt is showing".
    const newUser = { uid: 'brand-new-user' };
    mockCreateAccountWithEmail.mockResolvedValue(newUser);
    const mod = freshAuthModule();
    mod.useAuthStore.setState({ pendingLink: pendingLinkFor('apple', ['google', 'password']) as any });

    await mod.useAuthStore.getState().createAccountWithEmail('new@x.com', 'pw123456');

    expect(mockCompletePendingLink).not.toHaveBeenCalled();
    // The original finding this whole section was added for: this used to be
    // a bare `set({ pendingLink: null })`, which only ever took the prompt off
    // the screen -- clearPendingLink() (accountLinking.ts's own module state)
    // was never called from here (or from ANY production path), so the
    // stashed credential survived and could later be linked onto an unrelated
    // account. Asserting the store field alone would pass against that old
    // behavior too; clearPendingLink is the assertion that actually tells the
    // two apart.
    expect(mockClearPendingLink).toHaveBeenCalledTimes(1);
    expect(mod.useAuthStore.getState().pendingLink).toBeNull();
  });
});

// signOut has no other test file -- it shares this file's full useAuthStore
// mock harness, same reasoning as the sign-in/createAccountWithEmail section
// above.
describe('signOut', () => {
  it('clears any stashed pending-link credential, not just the store field -- nobody is signed in afterward to have it linked onto', async () => {
    const { useAuthStore } = storeSignedIn();
    useAuthStore.setState({ pendingLink: fakePendingLink() });

    await useAuthStore.getState().signOut();

    // Before dismissPendingLink existed, signOut didn't touch pendingLink at
    // all -- neither the module singleton nor the store's own field -- so a
    // stashed credential survived sign-out entirely, ready for the next
    // person to sign in on this device to have it silently linked onto their
    // account.
    expect(mockClearPendingLink).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().pendingLink).toBeNull();
  });
});
