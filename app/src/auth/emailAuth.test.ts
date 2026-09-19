// emailAuth.test.ts -- unit tests for the email/password auth module, this
// app's third sign-in provider alongside googleAuth.ts/appleAuth.ts (see
// accountLinking.ts's AuthProviderKind). Mocks 'firebase/auth' and
// 'expo-secure-store' the way accountLinking.test.ts/secureStorePersistence.test.ts
// do; './secureStoreKeys' (and its own './firebaseConfig' dependency) is left
// real -- it's a pure, side-effect-free module with safe REPLACE_ME_*
// defaults (see firebaseConfig.ts), so nothing here needs it mocked.
//
// useAuthStore.ts's own signInWithEmail/createAccountWithEmail store actions
// (and their pendingLink/candidateProviders interaction) are NOT tested here
// -- that needs './emailAuth' itself mocked wholesale, which Jest's
// file-scoped jest.mock() can't do in the same file as these direct,
// real-module tests. See deleteAccount.test.ts instead.
import {
  EmailAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  linkWithCredential,
  deleteUser,
  reauthenticateWithCredential,
} from 'firebase/auth';
import * as SecureStore from 'expo-secure-store';
import {
  signInWithEmail,
  createAccountWithEmail,
  sendPasswordReset,
  linkEmailToCurrentUser,
  signOutFully,
  reauthenticateForDeletion,
  deleteUserAccount,
} from './emailAuth';
import { getFirebaseAuth } from './firebase';
import { FIREBASE_AUTH_SECURE_STORE_KEYS, SECURE_STORE_OPTS } from './secureStoreKeys';

jest.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: jest.fn() },
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendEmailVerification: jest.fn(),
  linkWithCredential: jest.fn(),
  deleteUser: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  deleteItemAsync: jest.fn(),
}));
jest.mock('./firebase', () => ({ getFirebaseAuth: jest.fn() }));

const mockSignIn = signInWithEmailAndPassword as jest.Mock;
const mockCreateUser = createUserWithEmailAndPassword as jest.Mock;
const mockSendPasswordResetEmail = sendPasswordResetEmail as jest.Mock;
const mockSendEmailVerification = sendEmailVerification as jest.Mock;
const mockLinkWithCredential = linkWithCredential as jest.Mock;
const mockDeleteUser = deleteUser as jest.Mock;
const mockReauthenticateWithCredential = reauthenticateWithCredential as jest.Mock;
const mockCredential = EmailAuthProvider.credential as jest.Mock;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;
const mockGetFirebaseAuth = getFirebaseAuth as jest.Mock;

const mockFirebaseSignOut = jest.fn();

/** `auth.currentUser`, as reauthenticateForDeletion/deleteUserAccount/signOutFully
 * read it straight off getFirebaseAuth(). */
function authWithCurrentUser(user: any) {
  mockGetFirebaseAuth.mockReturnValue({ currentUser: user, signOut: mockFirebaseSignOut });
}

beforeEach(() => {
  jest.clearAllMocks();
  authWithCurrentUser(null);
  // Defaults for the calls this module's source wraps in `.catch(...)` --
  // those need an actual Promise back, not a bare jest.fn()'s `undefined`,
  // or `.catch` itself would throw before a test ever gets to its own case.
  mockFirebaseSignOut.mockResolvedValue(undefined);
  mockSendEmailVerification.mockResolvedValue(undefined);
  mockDeleteItemAsync.mockResolvedValue(undefined);
});

describe('signInWithEmail', () => {
  it('signs in with the given email/password and returns the signed-in user', async () => {
    const user = { uid: 'u1' };
    const auth = { currentUser: null };
    mockGetFirebaseAuth.mockReturnValue(auth);
    mockSignIn.mockResolvedValue({ user });

    await expect(signInWithEmail('a@b.com', 'pw')).resolves.toBe(user);
    expect(mockSignIn).toHaveBeenCalledWith(auth, 'a@b.com', 'pw');
  });

  it('propagates a sign-in failure (e.g. auth/invalid-credential) unchanged', async () => {
    const err: any = new Error('bad creds');
    err.code = 'auth/invalid-credential';
    mockSignIn.mockRejectedValue(err);

    await expect(signInWithEmail('a@b.com', 'wrong')).rejects.toBe(err);
  });
});

describe('createAccountWithEmail', () => {
  it('creates the account, sends a verification email, and returns the new user', async () => {
    const user = { uid: 'u2' };
    mockCreateUser.mockResolvedValue({ user });

    await expect(createAccountWithEmail('new@x.com', 'pw123456')).resolves.toBe(user);

    expect(mockCreateUser).toHaveBeenCalledWith(expect.anything(), 'new@x.com', 'pw123456');
    expect(mockSendEmailVerification).toHaveBeenCalledWith(user);
  });

  it('does not reject when sendEmailVerification fails -- the account already exists by then, so failing here would incorrectly report that account creation itself failed', async () => {
    const user = { uid: 'u3' };
    mockCreateUser.mockResolvedValue({ user });
    mockSendEmailVerification.mockRejectedValue(new Error('mailer down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(createAccountWithEmail('new@x.com', 'pw123456')).resolves.toBe(user);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('propagates a rejection from account creation itself, and never attempts to send a verification email', async () => {
    const err: any = new Error('in use');
    err.code = 'auth/email-already-in-use';
    mockCreateUser.mockRejectedValue(err);

    await expect(createAccountWithEmail('taken@x.com', 'pw123456')).rejects.toBe(err);
    expect(mockSendEmailVerification).not.toHaveBeenCalled();
  });
});

describe('sendPasswordReset', () => {
  it('sends a password-reset email for the given address', async () => {
    mockSendPasswordResetEmail.mockResolvedValue(undefined);

    await sendPasswordReset('a@b.com');

    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'a@b.com');
  });

  it('propagates a failure unchanged rather than swallowing it into a false confirmation', async () => {
    const err = new Error('network down');
    mockSendPasswordResetEmail.mockRejectedValue(err);

    await expect(sendPasswordReset('a@b.com')).rejects.toBe(err);
  });
});

describe('linkEmailToCurrentUser', () => {
  it('builds an email/password credential and links it to the given (already signed-in) user', async () => {
    const currentUser = { uid: 'u4' } as any;
    const credential = { providerId: 'password', signInMethod: 'password' };
    const linkedUser = { uid: 'u4', providerData: [{ providerId: 'password' }] };
    mockCredential.mockReturnValue(credential);
    mockLinkWithCredential.mockResolvedValue({ user: linkedUser });

    await expect(linkEmailToCurrentUser(currentUser, 'a@b.com', 'pw')).resolves.toBe(linkedUser);

    expect(mockCredential).toHaveBeenCalledWith('a@b.com', 'pw');
    // Links onto the CURRENT user via linkWithCredential, never a fresh
    // signInWithCredential -- that's what keeps this from ever authenticating
    // as a different (or brand-new) Firebase user instead of attaching to the
    // one already signed in.
    expect(mockLinkWithCredential).toHaveBeenCalledWith(currentUser, credential);
  });

  it('propagates a link failure (e.g. auth/credential-already-in-use) unchanged', async () => {
    const err: any = new Error('already linked');
    err.code = 'auth/credential-already-in-use';
    mockLinkWithCredential.mockRejectedValue(err);

    await expect(linkEmailToCurrentUser({} as any, 'a@b.com', 'pw')).rejects.toBe(err);
  });
});

describe('signOutFully', () => {
  it('signs out of Firebase and deletes every FIREBASE_AUTH_SECURE_STORE_KEYS entry', async () => {
    authWithCurrentUser(null);

    await signOutFully();

    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(FIREBASE_AUTH_SECURE_STORE_KEYS.length);
    for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
      expect(mockDeleteItemAsync).toHaveBeenCalledWith(key, SECURE_STORE_OPTS);
    }
  });

  it('does not throw when auth.signOut() itself rejects -- there is no OAuth grant to revoke, only best-effort cleanup', async () => {
    mockFirebaseSignOut.mockRejectedValue(new Error('network down'));

    await expect(signOutFully()).resolves.toBeUndefined();
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(FIREBASE_AUTH_SECURE_STORE_KEYS.length);
  });

  it('still attempts every key even when an earlier SecureStore delete fails', async () => {
    mockDeleteItemAsync.mockRejectedValueOnce(new Error('keychain locked')).mockResolvedValueOnce(undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(signOutFully()).resolves.toBeUndefined();
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(FIREBASE_AUTH_SECURE_STORE_KEYS.length);

    warn.mockRestore();
  });
});

describe('reauthenticateForDeletion', () => {
  // Same reasoning as the no-email case below: this function's whole job is
  // to prove the person holding the phone is still there, so resolving when
  // there is nobody to ask reports that proof as obtained without anyone
  // having been prompted -- and its one caller then proceeds to the
  // destructive wipe on the strength of it.
  it('throws rather than silently returning when nobody is signed in', async () => {
    await expect(reauthenticateForDeletion('pw')).rejects.toThrow(); // authWithCurrentUser(null) from beforeEach
    expect(mockReauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('throws rather than silently returning when the current user has no email', async () => {
    // Should be unreachable in practice (every email/password-linked user has
    // `email` set from account creation) -- but returning silently here would
    // let the caller (useAuthStore.deleteAccount) believe reauth succeeded and
    // proceed straight to the destructive Firestore wipe without anything
    // having actually proven the user's presence.
    authWithCurrentUser({ email: null });

    await expect(reauthenticateForDeletion('pw')).rejects.toThrow();
    expect(mockReauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it("reauthenticates with a credential built from the current user's email and the given password", async () => {
    const user = { email: 'a@b.com' };
    authWithCurrentUser(user);
    const credential = { providerId: 'password' };
    mockCredential.mockReturnValue(credential);
    mockReauthenticateWithCredential.mockResolvedValue(undefined);

    await reauthenticateForDeletion('pw');

    expect(mockCredential).toHaveBeenCalledWith('a@b.com', 'pw');
    expect(mockReauthenticateWithCredential).toHaveBeenCalledWith(user, credential);
  });

  it('propagates a reauthentication failure unchanged, so deleteWithReauthRetry (useAuthStore.ts) can inspect its code', async () => {
    authWithCurrentUser({ email: 'a@b.com' });
    const err: any = new Error('stale session');
    err.code = 'auth/requires-recent-login';
    mockReauthenticateWithCredential.mockRejectedValue(err);

    await expect(reauthenticateForDeletion('pw')).rejects.toBe(err);
  });
});

describe('deleteUserAccount', () => {
  // Throws rather than returning silently, for the same reason the no-email
  // case above does -- and with more at stake. This runs as step 3 of
  // deleteAccount, AFTER the Firestore wipe, so a silent resolve makes
  // deleteAccount report a complete success: the page swaps to signed-out and
  // the user is told their account is gone, while the Firebase Auth user
  // still exists and can be signed straight back into. Reachable if the
  // session drops between the re-authentication and this call.
  // AccountDataWipedError is the message that outcome is supposed to get, and
  // deleteAccount's catch produces it from anything thrown here.
  it('throws rather than reporting success when there is no user left to delete', async () => {
    await expect(deleteUserAccount()).rejects.toThrow(); // authWithCurrentUser(null) from beforeEach
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('deletes the current user, then wipes every SecureStore key', async () => {
    const user = { uid: 'u5' };
    authWithCurrentUser(user);
    mockDeleteUser.mockResolvedValue(undefined);

    await deleteUserAccount();

    expect(mockDeleteUser).toHaveBeenCalledWith(user);
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(FIREBASE_AUTH_SECURE_STORE_KEYS.length);
  });

  it('does not throw when a SecureStore delete fails after deleteUser has already succeeded', async () => {
    authWithCurrentUser({ uid: 'u6' });
    mockDeleteUser.mockResolvedValue(undefined);
    mockDeleteItemAsync.mockRejectedValue(new Error('keychain locked'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(deleteUserAccount()).resolves.toBeUndefined();

    warn.mockRestore();
  });
});

// The address that reaches Firebase is trimmed, on every path that takes one.
//
// EmailPasswordFields.ts's isValidEmail() tests `email.trim()` but every
// caller submitted the raw field value, so a leading/trailing space -- an iOS
// autofill, a paste, or the space bar sitting next to return on the email
// keyboard -- passed this app's own validation and came back from Firebase as
// auth/invalid-email, which accountDisplay.ts renders as "Enter a valid email
// address." about an address that looks perfectly valid on screen. Retyping
// it produces the same space and the same dead end.
//
// Asserted per entry point rather than once on the helper (which isn't
// exported): the bug was four call sites, and normalizing three of them is
// the same bug on the fourth. Password arguments are deliberately passed
// through untouched -- a space is a legal password character, and trimming
// one would lock out an account that has it.
describe('email normalization', () => {
  const PADDED = '  user@example.com  ';
  const CLEAN = 'user@example.com';

  it('trims the address before signInWithEmailAndPassword', async () => {
    mockSignIn.mockResolvedValue({ user: { uid: 'u1' } });

    await signInWithEmail(PADDED, ' pw ');

    expect(mockSignIn).toHaveBeenCalledWith(expect.anything(), CLEAN, ' pw ');
  });

  it('trims the address before createUserWithEmailAndPassword', async () => {
    mockCreateUser.mockResolvedValue({ user: { uid: 'u2' } });

    await createAccountWithEmail(PADDED, 'pw123456');

    expect(mockCreateUser).toHaveBeenCalledWith(expect.anything(), CLEAN, 'pw123456');
  });

  it('trims the address before sendPasswordResetEmail', async () => {
    mockSendPasswordResetEmail.mockResolvedValue(undefined);

    await sendPasswordReset(PADDED);

    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), CLEAN);
  });

  it('trims the address before building the credential a link uses', async () => {
    mockCredential.mockReturnValue({ providerId: 'password' });
    mockLinkWithCredential.mockResolvedValue({ user: { uid: 'u3' } });

    await linkEmailToCurrentUser({ uid: 'u3' } as any, PADDED, 'pw123456');

    expect(mockCredential).toHaveBeenCalledWith(CLEAN, 'pw123456');
  });
});
