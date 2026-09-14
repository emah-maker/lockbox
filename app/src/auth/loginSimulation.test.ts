// loginSimulation.test.ts -- the whole sign-in flow, driven end to end, from
// the button press a user makes to the string that ends up on their screen.
//
// This project is developed on Windows and ships to iOS: there is no
// simulator, `expo prebuild -p ios` does not run, and a device build costs one
// of a hard monthly budget. So "did we break sign-in" cannot be answered by
// launching the app. It is answered here, by driving the REAL useAuthStore/
// googleAuth/appleAuth/emailAuth/accountLinking/authSession/accountDisplay/
// secureStorePersistence with only the platform edge faked -- every mock and
// fixture lives in loginSimulation.harness.ts so this file is scenarios and
// assertions only.
//
// The other suites here each pin one module's own contract. This one is
// deliberately the opposite: it asserts only on what a person could observe --
// is the gate open, is `user` set, which sentence is rendered and how many
// times -- so a fix that is individually correct but wired up wrong still
// fails here.
//
// This file covers getting IN: startup and the gate, a misconfigured build,
// and each provider's own failures. Its other half,
// loginSimulation.linking.test.ts, covers what happens after or around that
// tap -- cross-provider linking, Keychain failures, races, and error
// presentation. They are one suite, split only for CLAUDE.md's 500-line limit.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as SecureStore from 'expo-secure-store';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  onAuthStateChanged, signInWithCredential, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail,
} from 'firebase/auth';
import { initFirebaseAuth, FirebaseConfigError } from './firebase';
import { findInvalidGoogleSignInKeys } from './firebaseConfig';
import { runMigrationAndSync } from '../sync/firestoreSync';
import { providerActionErrorMessage, SIGN_IN_NOT_CONFIGURED_MESSAGE } from './accountDisplay';
import {
  keychain, makeUser, sdkError, freshAuth, coldStart, stalledInit,
  tapSignIn, signInErrorLine, installHealthyDefaults,
} from './loginSimulation.harness';

// Each factory defers to the harness so it is evaluated at require time,
// after this file's own imports -- jest.mock() calls are hoisted above them.
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

const mockInit = initFirebaseAuth as jest.Mock;
const mockOnAuthStateChanged = onAuthStateChanged as jest.Mock;
const mockGoogleKeys = findInvalidGoogleSignInKeys as jest.Mock;
const mockSync = runMigrationAndSync as jest.Mock;
const google = () => makeUser('uid-1', 'me@example.com', ['google.com']);

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // init() arms a 10s watchdog per call and withAuthInitTimeout one per tap;
  // real ones would outlive the run.
  jest.useFakeTimers();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  installHealthyDefaults();
});

afterEach(() => {
  warn.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

// --- Startup: is the screen usable at all? ---------------------------------
describe('cold start', () => {
  it('opens the sign-in screen with no error when there is no stored session', async () => {
    const { store } = await coldStart(null);
    expect(store.getState().ready).toBe(true); // every button live
    expect(store.getState().initError).toBeNull();
    expect(store.getState().user).toBeNull();
  });

  it('signs the user straight back in from a stored session, without a tap', async () => {
    const { store } = await coldStart(google());
    expect(store.getState().user).toMatchObject({ uid: 'uid-1', linkedProviders: ['google'] });
    expect(store.getState().initError).toBeNull();
    expect(GoogleSignin.signIn).not.toHaveBeenCalled(); // no picker was shown
  });

  it('syncs a restored session automatically only when the user asked for it', async () => {
    await coldStart(google());
    expect(mockSync).not.toHaveBeenCalled();

    (globalThis as any).__autoSync = true;
    await coldStart(google());
    expect(mockSync).toHaveBeenCalledWith('uid-1');
  });

  it('never reaches around initFirebaseAuth to read a session itself', async () => {
    // §2.5's ordering (wipe a previous install's Keychain entry BEFORE
    // initializeAuth) lives inside initFirebaseAuth. This asserts the half a
    // simulation can see: the store never resurrects a session the wipe was
    // supposed to have removed.
    keychain().entries.set('firebase_authUser_stale__DEFAULT_', '{"uid":"ghost"}');
    const { store } = await coldStart(null);
    expect(store.getState().user).toBeNull();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });
});

describe('when Firebase Auth will not start', () => {
  it('a sign-in tap gives up and reports, instead of spinning forever', async () => {
    // The failure a try/catch cannot see: initFirebaseAuth() neither resolves
    // nor rejects. The watchdog releases the gate, so the buttons look live --
    // and before withAuthInitTimeout the tap they accepted awaited that same
    // never-settling promise forever. SignedOutAccount clears `busy` only in a
    // `finally`, so the page stayed disabled and spinning until a force-quit.
    const { store } = await stalledInit();
    expect(store.getState().ready).toBe(true);

    const settled = tapSignIn(() => store.getState().signInWithGoogle());
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);
    const { threw, line } = await settled;

    expect(threw).toBeInstanceOf(Error); // it SETTLED -- that is the whole point
    expect(store.getState().initError).toMatch(/Couldn't start sign-in/);
    // Named AuthInitReportedError, so the page shows the sentence once (as
    // initError) instead of stacking an identical second red line.
    expect(line).toBeNull();
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
  });

  it('names the stall stage on screen, since the console is unreachable on a TestFlight build', async () => {
    const { store } = await stalledInit();
    expect(store.getState().initError).toContain('stage: initialize-auth');
  });

  it('says the build is misconfigured, not "check your connection", for a placeholder Firebase config', async () => {
    mockInit.mockRejectedValue(new FirebaseConfigError(['EXPO_PUBLIC_FIREBASE_API_KEY']));
    const { store } = freshAuth();
    await store.getState().init();
    expect(store.getState().initError).toBe(SIGN_IN_NOT_CONFIGURED_MESSAGE);

    const { threw, line } = await tapSignIn(() => store.getState().signInWithGoogle());

    expect(threw).toBeInstanceOf(Error);
    expect(store.getState().initError).toBe(SIGN_IN_NOT_CONFIGURED_MESSAGE);
    expect(line).toBeNull(); // one sentence, one line
    // The raw error's own message is a paragraph of env-var names and
    // 'expo start -c' instructions -- never fit for a user.
    expect(store.getState().initError).not.toMatch(/expo start|EXPO_PUBLIC_/);
  });

  it('stays a failure, and stays retryable, when the listener itself cannot be attached', async () => {
    // authListenerAttached is set only AFTER onAuthStateChanged returns.
    // Claiming it first meant a throw here left the flag true with no
    // listener: the next attempt took the early `return`, reported SUCCESS,
    // really did authenticate the user -- and nothing was left to tell the
    // store about it. `user` stayed null with no error anywhere.
    const boom = () => { throw new Error('FIREBASE INTERNAL ASSERTION FAILED'); };
    mockOnAuthStateChanged.mockImplementationOnce(boom);
    const { store } = freshAuth();
    await store.getState().init();
    expect(store.getState().initError).toBeTruthy();

    mockOnAuthStateChanged.mockImplementationOnce(boom);
    const second = await tapSignIn(() => store.getState().signInWithGoogle());

    expect(second.threw).toBeInstanceOf(Error); // still a failure, NOT a silent success
    expect(second.line).toBeNull(); // initError already says it
    expect(store.getState().initError).toMatch(/Couldn't start sign-in/);
    expect(store.getState().initError).not.toMatch(/ASSERTION/); // raw SDK text, never rendered
    expect(store.getState().user).toBeNull();

    // Third attempt, now healthy: the listener attaches and the user lands in.
    const third = await tapSignIn(() => store.getState().signInWithGoogle());
    expect(third.line).toBeUndefined();
    expect(store.getState().user).toMatchObject({ uid: 'uid-1' });
  });

  it('leaves no stray watchdog timer behind a sign-in that worked', async () => {
    // withAuthInitTimeout clears its timer in a `finally`, success included.
    // One orphaned 10s timer per tap would keep the RN timer queue alive past
    // the work it belongs to.
    const { store } = await coldStart();
    const before = jest.getTimerCount();
    await store.getState().signInWithGoogle();
    expect(jest.getTimerCount()).toBe(before);
  });

  it('attaches exactly one listener when a tap and a slow init finish together', async () => {
    // Both init() and the tap await the SAME memoized initFirebaseAuth()
    // promise, so both resume in one microtask drain. The unsubscribe
    // onAuthStateChanged returns is never called, so a second registration is
    // permanent -- every auth change would fire syncNow() twice forever.
    let release: () => void;
    mockInit.mockReturnValue(new Promise<void>((r) => { release = () => r(); }));
    const { store } = freshAuth();

    store.getState().init();
    await Promise.resolve();
    jest.advanceTimersByTime(10_000); // watchdog opens the gate
    const tap = store.getState().signInWithGoogle().catch(() => {});
    await Promise.resolve();
    release!();
    await tap;

    expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(1);
  });
});

// --- A build that configured Firebase but not Google -----------------------
describe('placeholder Google client ids, with Firebase config fine', () => {
  // EAS only uploads app/.env for the development profile, so every
  // preview/production build shipped with EXPO_PUBLIC_* still at REPLACE_ME.
  // The six Firebase vars were caught by initFirebaseAuth()'s gate; these two
  // were checked nowhere, so a placeholder audience reached
  // GoogleSignin.configure() intact and surfaced only as DEVELOPER_ERROR.
  beforeEach(() => {
    mockGoogleKeys.mockReturnValue(['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID']);
  });

  it('tells the truth about the build instead of opening a picker that would fail', async () => {
    const { store } = await coldStart();
    const line = await signInErrorLine(() => store.getState().signInWithGoogle());

    expect(line).toBe(SIGN_IN_NOT_CONFIGURED_MESSAGE);
    expect(GoogleSignin.configure).not.toHaveBeenCalled();
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    expect(line).not.toMatch(/expo start|EXPO_PUBLIC_|DEVELOPER_ERROR/);
  });

  it("leaves Apple and email sign-in working -- one provider's missing var must not take down the others", async () => {
    const { store } = await coldStart();

    expect(await signInErrorLine(() => store.getState().signInWithApple())).toBeUndefined();
    expect(store.getState().user).toMatchObject({ uid: 'uid-1' });

    await store.getState().signOut();
    expect(await signInErrorLine(() => store.getState().signInWithEmail('me@example.com', 'hunter22'))).toBeUndefined();
    expect(store.getState().user).toMatchObject({ uid: 'uid-1' });
  });

  it('says the same thing when the already-signed-in user taps "Link Google"', async () => {
    const { store } = await coldStart(makeUser('uid-1', 'me@example.com', ['apple.com']));
    let shown: string | null = null;
    try {
      await store.getState().linkProvider('google');
    } catch (e) {
      shown = providerActionErrorMessage(e as any, 'Could not link account. Please try again.');
    }
    expect(shown).toBe(SIGN_IN_NOT_CONFIGURED_MESSAGE);
  });

  it('still lets the user sign out, which needs no client id at all', async () => {
    const { store } = await coldStart(google());
    await expect(store.getState().signOut()).resolves.toBeUndefined();
    expect(store.getState().user).toBeNull();
  });
});

// --- Each provider's own failures ------------------------------------------
describe('Google sign-in', () => {
  it('shows nothing at all when the user backs out of the picker', async () => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'cancelled' });
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().signInWithGoogle())).toBeNull();
    expect(store.getState().user).toBeNull();
  });

  it('does not leave a half-finished sign-in when no ID token comes back', async () => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'success', data: { idToken: null } });
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().signInWithGoogle())).toBeTruthy();
    expect(signInWithCredential).not.toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });

  it('turns a bare native DEVELOPER_ERROR into something renderable', async () => {
    (GoogleSignin.signIn as jest.Mock).mockRejectedValue(
      Object.assign(new Error('DEVELOPER_ERROR'), { code: 'DEVELOPER_ERROR' }));
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().signInWithGoogle())).toBe('Could not sign in. Please try again.');
  });

  it("does not blame the user's password when Play Services is the problem", async () => {
    (GoogleSignin.hasPlayServices as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Play services not available'), { code: 'PLAY_SERVICES_NOT_AVAILABLE' }));
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().signInWithGoogle())).toBe('Could not sign in. Please try again.');
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
  });

  it('says "no connection" for a dropped network, not something generic', async () => {
    (signInWithCredential as jest.Mock).mockRejectedValue(sdkError('auth/network-request-failed'));
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().signInWithGoogle()))
      .toBe('No connection. Check your network and try again.');
  });
});

describe('Apple sign-in', () => {
  it('shows nothing at all when the sheet is dismissed', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockRejectedValue(
      Object.assign(new Error('The user canceled the authorization attempt'), { code: 'ERR_REQUEST_CANCELED' }));
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().signInWithApple())).toBeNull();
    expect(store.getState().user).toBeNull();
  });

  it('does not proceed without an identity token', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({ identityToken: null });
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().signInWithApple())).toBeTruthy();
    expect(signInWithCredential).not.toHaveBeenCalled();
  });

  it('hides the Apple button rather than crashing when the native module is not in the build', async () => {
    // isAvailableAsync REJECTS (it does not resolve false) in Expo Go, or in a
    // dev client built before expo-apple-authentication was added. Without the
    // .catch that is an unhandled-rejection warning over the Account page, for
    // a condition whose correct answer is just "no Apple button".
    (AppleAuthentication.isAvailableAsync as jest.Mock).mockRejectedValue(new Error('Native module not found'));
    const { useAppleAuthAvailable } = require('../screens/account/useAppleAuthAvailable');

    let seen: boolean | undefined;
    const Probe = () => { seen = useAppleAuthAvailable(); return null; };
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(React.createElement(Probe)); });
    await act(async () => {});

    expect(seen).toBe(false);
    act(() => tree!.unmount());
  });
});

describe('email and password', () => {
  it('will not tell a wrong password apart from an unknown account -- and says so honestly', async () => {
    (signInWithEmailAndPassword as jest.Mock).mockRejectedValue(sdkError('auth/invalid-credential'));
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().signInWithEmail('me@example.com', 'wrong')))
      .toBe('Incorrect email or password.');
  });

  it('accepts an address with the whitespace an iOS paste or autofill leaves on it', async () => {
    // The dead end this closes: EmailPasswordFields.isValidEmail() tests
    // email.trim(), so " me@x.com " passed the app's own validation and was
    // then rejected by Firebase as auth/invalid-email -- rendering "Enter a
    // valid email address." over a field showing that exact address.
    const { store } = await coldStart();
    await store.getState().signInWithEmail('  me@example.com \n', 'hunter22');
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'me@example.com', 'hunter22');
    expect(store.getState().user).toMatchObject({ uid: 'uid-1' });
  });

  it('trims it on every email path a user can reach, not just sign-in', async () => {
    const { store } = await coldStart();
    await store.getState().createAccountWithEmail(' new@example.com ', 'hunter22');
    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'new@example.com', 'hunter22');
    await store.getState().sendPasswordReset('  lost@example.com  ');
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'lost@example.com');
  });

  it('names the real problem when the password is too short', async () => {
    (createUserWithEmailAndPassword as jest.Mock).mockRejectedValue(sdkError('auth/weak-password'));
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().createAccountWithEmail('me@example.com', 'short')))
      .toBe('Password must be at least 6 characters.');
  });

  it('sends someone with an existing account to sign in instead of creating a second one', async () => {
    (createUserWithEmailAndPassword as jest.Mock).mockRejectedValue(sdkError('auth/email-already-in-use'));
    const { store } = await coldStart();
    expect(await signInErrorLine(() => store.getState().createAccountWithEmail('me@example.com', 'hunter22')))
      .toBe('An account with that email already exists.');
    expect(store.getState().user).toBeNull();
  });

  it('resolves a reset for an address with no account, so the screen can stay non-committal', async () => {
    // Email Enumeration Protection means Firebase never reveals whether the
    // address exists; a rejection here would leak what it deliberately hides.
    const { store } = await coldStart();
    await expect(store.getState().sendPasswordReset('nobody@example.com')).resolves.toBeUndefined();
  });
});
