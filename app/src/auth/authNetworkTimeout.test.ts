// authNetworkTimeout.test.ts -- authSession.ts's withAuthNetworkTimeout,
// which bounds every Firebase Auth REST call a sign-in attempt can make.
//
// useAuthStore.ts already bounded Firebase Auth starting up, the Firestore
// sync, the account-deletion wipe and sign-out's push cleanup -- its own
// comments say why: an await that never settles "is not a slow operation; it
// is a permanently disabled control with no error and no way back short of
// force-quitting." The sign-in network calls themselves were the gap.
// signInWithEmailAndPassword/createUserWithEmailAndPassword/
// sendPasswordResetEmail (emailAuth.ts) and signInWithCredential/
// linkWithCredential/reauthenticateWithCredential/deleteUser
// (authSession.ts) all ran unbounded: a stalled TCP connection -- not a
// refused one, which rejects promptly as auth/network-request-failed -- left
// them pending forever, and with them SignedOutAccount's `busy`, which
// disables every sign-in control on the page while it is true. One tap on a
// bad connection, and the only way out was force-quitting the app.
//
// This file drives the REAL useAuthStore/emailAuth/authSession the same way
// loginSimulation.test.ts does (see its header for the technique); only the
// platform edge -- Firebase, the native sign-in modules, the Keychain, and
// the sync/push/store modules -- is faked, via loginSimulation.harness.ts.
// Each test below stalls exactly one REST call and shows the store action
// fails, promptly and with an already-authored message, instead of hanging.
import { signInWithCredential, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { signInErrorMessage } from './accountDisplay';
import { coldStart, installHealthyDefaults } from './loginSimulation.harness';

jest.mock('firebase/auth', () => require('./loginSimulation.harness').firebaseAuthMock());
jest.mock('./firebase', () => require('./loginSimulation.harness').firebaseModuleMock());
jest.mock('./firebaseConfig', () =>
  require('./loginSimulation.harness').firebaseConfigMock(jest.requireActual('./firebaseConfig')));
jest.mock('expo-secure-store', () => require('./loginSimulation.harness').secureStoreMock());
jest.mock('expo-apple-authentication', () => require('./loginSimulation.harness').appleAuthenticationMock());
jest.mock('expo-crypto', () => require('./loginSimulation.harness').cryptoMock());
jest.mock('@react-native-google-signin/google-signin', () => require('./loginSimulation.harness').googleSigninMock());
jest.mock('../sync/firestoreSync', () => require('./loginSimulation.harness').firestoreSyncMock());
jest.mock('../sync/localDataOwner', () => ({ clearLocalAccountData: jest.fn() }));
jest.mock('../push/pushRegistration', () => ({ unregisterPushToken: jest.fn() }));
jest.mock('../store/useStore', () => ({ useStore: { getState: () => ({ setSessions: jest.fn() }) } }));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ autoSyncEnabled: (globalThis as any).__autoSync ?? false }) },
}));

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  installHealthyDefaults();
});

afterEach(() => {
  warn.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

// AUTH_NETWORK_TIMEOUT_MS in authSession.ts. Advancing exactly this far
// (rather than an arbitrarily longer bound) is what proves the fix is a real
// deadline and not just "eventually resolves by coincidence".
const AUTH_NETWORK_TIMEOUT_MS = 30_000;

describe('a stalled sign-in network call fails instead of hanging the page forever', () => {
  it('Sign in (email/password) tells the user to check their connection instead of leaving the button spinning forever', async () => {
    // signInWithEmailAndPassword has no native picker/sheet in front of it --
    // the whole call is network, so this is the plainest version of the bug:
    // one tap, on a stalled connection, used to hang SignedOutAccount's
    // `busy` (and therefore every sign-in control on the page) forever.
    (signInWithEmailAndPassword as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { store } = await coldStart();

    const attempt = store.getState().signInWithEmail('me@example.com', 'hunter22');
    // Attached before advancing the clock, not after: the timeout rejects
    // DURING advanceTimersByTimeAsync, and a promise with no handler yet at
    // the instant it rejects is what Jest's unhandled-rejection guard (not
    // this fix) would flag -- an artifact of test order, not of the code
    // under test, which is exactly why it is attached here first.
    const caught = attempt.catch((err: any) => err);
    await jest.advanceTimersByTimeAsync(AUTH_NETWORK_TIMEOUT_MS);

    const e: any = await caught;
    expect(e?.name).toBe('AuthNetworkTimeoutError');
    // Not a new sentence: this is already one of accountDisplay.ts's authored
    // sign-in strings (auth/network-request-failed's own wording), so a
    // network timeout and a refused connection read identically to the user.
    expect(signInErrorMessage(e)).toBe('No connection. Check your network and try again.');
  });

  it('Sign in with Google tells the user to check their connection if the Firebase exchange stalls after a completed picker', async () => {
    // The native picker already succeeded -- GoogleSignin.signIn() resolved
    // normally (installHealthyDefaults' default). This is not a cancellation;
    // the user did everything asked of them, and only the REST call after
    // that (signInWithCredential, authSession.ts) is what stalls here.
    (signInWithCredential as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { store } = await coldStart();

    const attempt = store.getState().signInWithGoogle();
    const caught = attempt.catch((err: any) => err); // see the email test's note on why this comes first
    await jest.advanceTimersByTimeAsync(AUTH_NETWORK_TIMEOUT_MS);

    const e: any = await caught;
    expect(e?.name).toBe('AuthNetworkTimeoutError');
    expect(signInErrorMessage(e)).toBe('No connection. Check your network and try again.');
  });

  it('Send reset link fails instead of leaving the forgot-password form stuck forever', async () => {
    (sendPasswordResetEmail as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { store } = await coldStart();

    const attempt = store.getState().sendPasswordReset('lost@example.com');
    const caught = attempt.catch((err: any) => err); // see the email test's note on why this comes first
    await jest.advanceTimersByTimeAsync(AUTH_NETWORK_TIMEOUT_MS);

    const e: any = await caught;
    expect(e?.name).toBe('AuthNetworkTimeoutError');
    expect(signInErrorMessage(e)).toBe('No connection. Check your network and try again.');
  });

  it('does not bound the native picker itself -- a person taking their time is not a timeout', async () => {
    // withAuthNetworkTimeout wraps ONLY the REST call, never the native
    // picker/sheet before it (authSession.ts's own comment). A Google account
    // picker that is still open -- nobody has answered it yet -- must not be
    // torn down out from under the user just because 30s have passed.
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    (GoogleSignin.signIn as jest.Mock).mockReturnValue(new Promise(() => {})); // the picker itself never returns
    const { store } = await coldStart();

    const attempt = store.getState().signInWithGoogle();
    await jest.advanceTimersByTimeAsync(AUTH_NETWORK_TIMEOUT_MS);

    let settled = false;
    attempt.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false); // still waiting on the person, not failed
  });
});
