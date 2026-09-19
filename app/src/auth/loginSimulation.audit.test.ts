// loginSimulation.audit.test.ts -- the third file of the sign-in simulation
// (read loginSimulation.test.ts's header first for the technique, and
// loginSimulation.harness.ts for the platform edge it fakes).
//
// The other two cover getting IN: the gate, each provider's failures, the
// cross-provider link. This one covers the paths a user reaches AFTER that
// first tap, which the Account page owns just as much: the password-reset
// mode, the link/unlink actions on the signed-in page, the way back out
// (sign out), and the deletion flow's own re-auth prompt.
//
// Same rule as the other two: the real useAuthStore/googleAuth/appleAuth/
// emailAuth/authSession/accountDisplay are driven, and the assertions are on
// what a person would read on the screen -- never on a mock having been
// called. Where the string a user sees is composed by a COMPONENT rather than
// by the store (DangerZoneSection maps deleteAccount's throws to its own
// copy), the component itself is rendered, for the same reason: mapping
// asserted against a re-typed copy of the mapping proves nothing.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  linkWithCredential, unlink, reauthenticateWithCredential,
  deleteUser, sendPasswordResetEmail,
} from 'firebase/auth';
import { runMigrationAndSync, deleteAllUserData } from '../sync/firestoreSync';
import { providerActionErrorMessage } from './accountDisplay';
import {
  fakeAuth, makeUser, sdkError, coldStart, signInErrorLine, installHealthyDefaults,
} from './loginSimulation.harness';

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
// Callable, unlike the other two files' object-only double: DangerZoneSection
// (rendered below) pulls in SettingsPrimitives, which calls useTheme(), which
// SUBSCRIBES to this store as a hook.
jest.mock('../store/useSettingsStore', () => {
  const state = { autoSyncEnabled: false, themeMode: 'dark', accent: 'blue' };
  const useSettingsStore: any = (selector: any) => (selector ? selector(state) : state);
  useSettingsStore.getState = () => ({ ...state, autoSyncEnabled: (globalThis as any).__autoSync ?? false });
  return { useSettingsStore };
});
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
// Not a double -- the real React, pinned into the mock registry so
// jest.isolateModules (below, for the component+store pair) cannot hand the
// component a SECOND copy of React whose hook dispatcher is null.
jest.mock('react', () => jest.requireActual('react'));

const googleUser = () => makeUser('uid-1', 'me@example.com', ['google.com']);
const appleUser = () => makeUser('uid-1', 'me@example.com', ['apple.com']);
const passwordUser = () => makeUser('uid-1', 'me@example.com', ['password']);

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

/** A cold start that is already signed in as `user` -- where every scenario
 * about the SIGNED-IN half of the Account page has to begin. */
async function signedIn(user: any = googleUser()) {
  const handles = await coldStart(user);
  expect(handles.store.getState().user).not.toBeNull();
  return handles;
}

/** Microtask drain. A sign-out walks a chain of awaits (push cleanup, each
 * provider's Firebase call, the Keychain wipe, the local-data clear), and a
 * fixed number of `await Promise.resolve()`s would silently under-run it and
 * report "not signed out yet" as a bug. */
async function flush(times = 30) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// The way back out
// ---------------------------------------------------------------------------
describe('signing out', () => {
  it('returns to a usable signed-out screen even when the Google grant revoke never comes back', async () => {
    // revokeAccess() is a network call to Google's revocation endpoint, and
    // it is awaited, unbounded, inside signOutFully. On a phone with no
    // connection it can simply never settle. The question is whether the user
    // still gets out: `user` is what swaps the page back to SignedOutAccount,
    // and clearSignedInState is what stops the previous account's sessions
    // from still being on screen.
    const { store } = await signedIn();
    (GoogleSignin.revokeAccess as jest.Mock).mockReturnValue(new Promise(() => {}));

    let settled = false;
    store.getState().signOut().then(() => { settled = true; });
    await flush();

    expect(store.getState().user).toBeNull(); // the page has swapped back
    expect(settled).toBe(false); // ...but the action itself never finishes
  });

  it('leaves no stale sync error on the signed-out screen', async () => {
    // syncError is rendered by SignedOutAccount as well as by SyncStatusSection,
    // so a failure from the previous session must not still be sitting there
    // over the sign-in buttons.
    const { store } = await signedIn();
    (runMigrationAndSync as jest.Mock).mockRejectedValue(sdkError('unavailable', 'client is offline'));
    await store.getState().syncNow();
    expect(store.getState().syncError).toBeTruthy();

    await store.getState().signOut();
    expect(store.getState().syncError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Adding and removing a sign-in method from the signed-in page
// ---------------------------------------------------------------------------
describe('linking another sign-in method', () => {
  it('shows nothing when the user backs out of the Link picker', async () => {
    const { store } = await signedIn();
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'cancelled' });
    let shown: string | null | undefined;
    try {
      await store.getState().linkProvider('google');
    } catch (e) {
      shown = providerActionErrorMessage(e as any, 'Could not link account. Please try again.');
    }
    expect(shown).toBeNull();
  });

  it('names the real problem when that Google account belongs to someone else', async () => {
    const { store } = await signedIn();
    (linkWithCredential as jest.Mock).mockRejectedValue(sdkError('auth/credential-already-in-use'));
    let shown: string | null | undefined;
    try {
      await store.getState().linkProvider('google');
    } catch (e) {
      shown = providerActionErrorMessage(e as any, 'Could not link account. Please try again.');
    }
    expect(shown).toBe('That account is already linked to a different sign-in.');
  });

  it('does not report a link as done when nobody is signed in any more', async () => {
    // linkProvider/linkEmailPassword/unlinkProvider used to start
    // `if (!current) return;`. A silent resolve reads to the caller
    // (SignInMethodsSection) exactly like success: the spinner stops, no
    // error appears, and the chip row is unchanged -- "I tapped Link Google
    // and nothing happened". They throw now, so the section has something to
    // render; the picker still never opens either way.
    const { store } = await signedIn();
    fakeAuth().currentUser = null;
    await expect(store.getState().linkProvider('google')).rejects.toThrow(/not signed in/i);
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
  });

  it('adds the password chip to the account page once an email link succeeds', async () => {
    const { store } = await signedIn();
    (linkWithCredential as jest.Mock).mockResolvedValue({
      user: makeUser('uid-1', 'me@example.com', ['google.com', 'password']),
    });
    await store.getState().linkEmailPassword('  me@example.com ', 'hunter22');
    expect(store.getState().user.linkedProviders).toEqual(['google', 'password']);
  });

  it('refuses to remove the only way into the account', async () => {
    const { store } = await signedIn(passwordUser());
    await expect(store.getState().unlinkProvider('password')).rejects.toThrow(
      'Cannot remove your only sign-in method.',
    );
    expect(unlink).not.toHaveBeenCalled();
  });

  it('updates the chip row when a provider really is removed', async () => {
    const { store } = await signedIn(makeUser('uid-1', 'me@example.com', ['google.com', 'password']));
    (unlink as jest.Mock).mockResolvedValue(passwordUser());
    await store.getState().unlinkProvider('google');
    expect(store.getState().user.linkedProviders).toEqual(['password']);
  });
});

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------
describe('the forgot-password mode', () => {
  it('says the build is misconfigured rather than silently doing nothing', async () => {
    const { FirebaseConfigError } = require('./firebase');
    require('./firebase').initFirebaseAuth.mockRejectedValue(
      new FirebaseConfigError(['EXPO_PUBLIC_FIREBASE_API_KEY']),
    );
    const { store } = await coldStart();
    const line = await signInErrorLine(() => store.getState().sendPasswordReset('lost@example.com'));
    // Nothing from the throw itself (it is already on screen as initError) --
    // but initError must actually carry the authored sentence.
    expect(line).toBeNull();
    expect(store.getState().initError).toBe("Sign-in isn't configured on this build.");
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('is not told an account exists, or does not, when the address is unknown', async () => {
    // Email Enumeration Protection: sendPasswordResetEmail resolves either
    // way, and the screen's confirmation must stay non-committal. The one
    // thing that would leak is a DIFFERENT outcome for an unknown address --
    // e.g. auth/user-not-found reaching the error slot.
    const { store } = await coldStart();
    (sendPasswordResetEmail as jest.Mock).mockRejectedValue(sdkError('auth/user-not-found'));
    const line = await signInErrorLine(() => store.getState().sendPasswordReset('nobody@example.com'));
    expect(line).not.toMatch(/not found|no account|does not exist/i);
  });
});

// ---------------------------------------------------------------------------
// Deleting the account -- what the Danger zone actually prints
// ---------------------------------------------------------------------------
/**
 * A signed-in store and the REAL DangerZoneSection that reads it, loaded in
 * ONE isolateModules block so the component's own
 * `import { useAuthStore } from '../../auth/useAuthStore'` resolves to the
 * same instance this test drives -- and so its `e instanceof
 * PasswordRequiredError` checks compare against the same class objects.
 * Loaded separately (the harness's freshAuth) they are two different modules,
 * the component sees `user: null`, deleteAccount no-ops, and every assertion
 * about what the page says passes for the wrong reason.
 */
async function signedInDangerZone(user: any) {
  let store: any;
  let DangerZoneSection: any;
  jest.isolateModules(() => {
    store = require('./useAuthStore').useAuthStore;
    DangerZoneSection = require('../screens/account/DangerZoneSection').DangerZoneSection;
  });
  fakeAuth().currentUser = user;
  await store.getState().init();
  expect(store.getState().user).not.toBeNull();
  return { store, DangerZoneSection };
}

/**
 * Renders DangerZoneSection and taps "Delete account" through its own Alert,
 * returning whatever red line it ends up showing.
 *
 * The mapping from deleteAccount's throw to a sentence lives in that
 * component and nowhere else, so this is the only honest way to ask what a
 * user reads: re-implementing the mapping in the test would assert the test
 * against itself.
 */
async function tapDeleteAccount(DangerZoneSection: any, password?: string): Promise<string | null> {
  const { resolveTheme } = require('../theme/theme');
  const { Alert } = require('react-native');

  let confirm: (() => void) | undefined;
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((...args: any[]) => {
    const buttons = args[2] as any[];
    confirm = () => buttons.find((b) => b.style === 'destructive')?.onPress?.();
  });

  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      React.createElement(DangerZoneSection, { color: resolveTheme('dark', 'blue') }),
    );
  });

  // The Alert's destructive action is the first attempt (no password); the
  // inline "Confirm delete" button is the retry once PasswordRequiredError
  // has revealed the field.
  await act(async () => {
    tree!.root.findAll((n: any) => n.props?.accessibilityLabel === 'Delete account')[0].props.onPress();
    confirm?.();
  });
  if (password !== undefined) {
    const passwordField = tree!.root.findAll(
      (n: any) => typeof n.type === 'string' && n.props?.placeholder === 'Password',
    )[0];
    await act(async () => { passwordField.props.onChangeText(password); });
    const confirmButton = tree!.root.findAll(
      (n: any) => n.props?.accessibilityLabel === 'Confirm delete',
    )[0];
    await act(async () => { confirmButton.props.onPress(); });
  }

  const red = tree!.root
    .findAll((n: any) => n.type === 'Text')
    .map((n: any) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
    .filter((s: any) => typeof s === 'string');

  alertSpy.mockRestore();
  act(() => tree!.unmount());
  return red.find((s: string) => /could not|incorrect|deleted/i.test(s)) ?? null;
}

describe('deleting the account', () => {
  // FAILING against the current code -- see the report. DangerZoneSection's
  // catch has no cancel branch, so both of these print "Could not delete
  // account. Please try again." over a deletion the user themselves called off.
  it('shows nothing when the user backs out of the re-authentication sheet', async () => {
    // A cancel is not a failure anywhere else in this app -- SignedOutAccount
    // shows nothing at all for one (signInErrorMessage returns null), and
    // SignInMethodsSection shows nothing for a cancelled Link picker
    // (providerActionErrorMessage returns null). The deletion flow re-runs the
    // SAME native sheet, so backing out of it is the same deliberate act:
    // the user changed their mind, and nothing failed.
    const { DangerZoneSection } = await signedInDangerZone(appleUser());
    (AppleAuthentication.signInAsync as jest.Mock).mockRejectedValue(
      Object.assign(new Error('The user canceled the authorization attempt'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    expect(await tapDeleteAccount(DangerZoneSection)).toBeNull();
    expect(deleteAllUserData).not.toHaveBeenCalled();
  });

  it('shows nothing when the Google picker for the same prompt is dismissed', async () => {
    const { DangerZoneSection } = await signedInDangerZone(googleUser());
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'cancelled' });
    expect(await tapDeleteAccount(DangerZoneSection)).toBeNull();
  });

  it('names a wrong password instead of inviting the same retry forever', async () => {
    const { DangerZoneSection } = await signedInDangerZone(passwordUser());
    (reauthenticateWithCredential as jest.Mock).mockRejectedValue(sdkError('auth/invalid-credential'));
    expect(await tapDeleteAccount(DangerZoneSection, 'nope123')).toBe('Incorrect password. Please try again.');
  });

  it('tells the truth when the data went but the account did not', async () => {
    const { DangerZoneSection } = await signedInDangerZone(appleUser());
    (reauthenticateWithCredential as jest.Mock).mockResolvedValue(undefined);
    (deleteAllUserData as jest.Mock).mockResolvedValue(undefined);
    (deleteUser as jest.Mock).mockRejectedValue(sdkError('auth/network-request-failed'));
    expect(await tapDeleteAccount(DangerZoneSection)).toMatch(/cloud data was deleted/i);
  });

  it('does not report success when there is no Auth user left to delete', async () => {
    // deleteFirebaseUser's `if (!user) return` used to make step 3 a silent
    // success when currentUser went null mid-flow, and the whole flow then
    // reported DONE: the page swapped to signed-out and the user was told
    // their account was gone, while the Firebase Auth user was still there to
    // sign back into. It throws now, which is what turns this into the one
    // message that describes what actually happened -- the cloud data really
    // was deleted, the sign-in really was not.
    const { store } = await signedIn(appleUser());
    (reauthenticateWithCredential as jest.Mock).mockImplementation(async () => {
      fakeAuth().currentUser = null; // e.g. the session dropped during the sheet
    });
    (deleteAllUserData as jest.Mock).mockResolvedValue(undefined);

    await expect(store.getState().deleteAccount()).rejects.toThrow(/removing the sign-in itself failed/i);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A launch that happens while the phone is locked
// ---------------------------------------------------------------------------
//
// app.json declares UIBackgroundModes: ["bluetooth-central"], so iOS can
// start this app's process for a box event with the screen off and the device
// locked. App.tsx's effect then runs useAuthStore.init() -> initFirebaseAuth()
// -> initializeAuth(app, { persistence: secureStorePersistence }) exactly as
// it does on a normal launch -- against a Keychain that, under
// WHEN_UNLOCKED_THIS_DEVICE_ONLY (secureStoreKeys.ts's SECURE_STORE_OPTS),
// answers nothing at all until the phone is unlocked.
describe('the Keychain when the phone is locked', () => {
  it('reports itself unavailable, which is what makes the SDK pick a different store', async () => {
    const { newPersistence, keychain } = require('./loginSimulation.harness');
    const p = newPersistence();
    keychain().failWrites = true;
    keychain().failReads = true;
    expect(await p._isAvailable()).toBe(false);
  });

  it('answers "no session" for a session that is really there', async () => {
    // Indistinguishable, from the SDK's side, from a signed-out device. The
    // user did not sign out and nothing failed loudly -- the Account page
    // simply comes up signed out, and (because the process persists into the
    // foreground) stays that way until the app is force-quit and relaunched.
    const { newPersistence, keychain } = require('./loginSimulation.harness');
    const p = newPersistence();
    await p._set('firebase:authUser:key:[DEFAULT]', { uid: 'uid-1' }); // written while unlocked
    keychain().failReads = true; // ...read back while locked
    expect(await p._get('firebase:authUser:key:[DEFAULT]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The fresh-install wipe (design doc section 2.5)
// ---------------------------------------------------------------------------
describe('wiping a previous install\'s Keychain session', () => {
  // FAILING against the current code -- see the report.
  it('does not record a wipe that did not happen', async () => {
    // iOS Keychain entries survive an uninstall; this is the one thing
    // standing between a new owner of the phone and the previous owner's
    // session. wipeFirebaseAuthSecureStore is best-effort by design (one
    // failed delete must not stop the rest), so it resolves even when nothing
    // was deleted -- and the marker is then written regardless, which is what
    // closes the window permanently: every later launch sees hasRunBefore and
    // skips the wipe.
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear(); // the fresh-install marker lives here, not in the Keychain
    const { keychain } = require('./loginSimulation.harness');
    const { FIREBASE_AUTH_SECURE_STORE_KEYS } = require('./secureStoreKeys');
    const { wipeStaleSessionOnFreshInstall } = require('./wipeStaleSessionOnFreshInstall');

    keychain().entries.set(FIREBASE_AUTH_SECURE_STORE_KEYS[0], '{"uid":"previous-owner"}');
    keychain().failDeletes = true; // e.g. launched before the first unlock
    await wipeStaleSessionOnFreshInstall();

    // The stale session is still there -- that part is unavoidable. What is
    // avoidable is never trying again:
    keychain().failDeletes = false;
    await wipeStaleSessionOnFreshInstall();
    expect(keychain().entries.has(FIREBASE_AUTH_SECURE_STORE_KEYS[0])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------
describe('the sign-in gate', () => {
  it('is never released by anything except init(), so a caller that skips it leaves the buttons dead', async () => {
    // `ready` gates both provider buttons AND the email submit
    // (SignedOutAccount: disabled={busy || !ready}). Everything that can
    // release it -- the onAuthStateChanged callback, the 10s watchdog, the
    // catch -- lives inside init(). There is no independent floor.
    const { freshAuth } = require('./loginSimulation.harness');
    const { store } = freshAuth();
    expect(store.getState().ready).toBe(false);
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(store.getState().ready).toBe(false);
    expect(store.getState().initError).toBeNull(); // ...and nothing on screen says why
  });
});
