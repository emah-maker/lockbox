// SignedOutAccount.test.tsx -- pins the fix for two bugs in the signed-out
// Account page's sign-in error handling (useAuthStore.ts's signInError/
// signInErrorSource/reportSignInError, and this component's two SignInError
// call sites):
//
// 1. The Account sheet can be swiped away while a sign-in is still in
//    flight. signInError/signInErrorSource used to be this component's own
//    useState, so a failure that landed AFTER the unmount wrote into a fiber
//    nobody was reading any more: nothing appeared, and reopening Account
//    started clean, with no trace the attempt had failed at all. They now
//    live in useAuthStore instead, which outlives the component.
// 2. The provider buttons sit at the top of a scrolling sheet and the email
//    form at the bottom; a single error slot at the top left a user who had
//    scrolled down to the email form with no visible feedback at all. The
//    fix renders a SignInError next to each control instead of one shared
//    slot.
//
// Drives the REAL useAuthStore (not a mock of it), because the unmount-
// survival property in bug 1 is only meaningful against real store state --
// a mocked store would only ever prove that a mock returns what a test told
// it to return, never that a value actually outlives a component teardown.
// Only the platform edge is faked (the Firebase Auth SDK, the native Google/
// Apple modules, SecureStore), via loginSimulation.harness.ts's own mock
// factories -- the same ones loginSimulation.test.ts uses to drive this same
// store end to end. googleAuth.ts/appleAuth.ts/emailAuth.ts/accountLinking.ts/
// accountDisplay.ts are all real.
//
// Apple availability is pinned to false throughout, so the Apple button never
// renders. That is not just simplification: with Google as the only button in
// the provider row, "before/after the provider row" (bug 2) reduces to
// "before/after the Google button", which is what errorIndex()/
// indexOfAccessibilityLabel() below actually compare.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as AppleAuthentication from 'expo-apple-authentication';
import { signInWithCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { resolveTheme } from '../../theme/theme';
import { sdkError, installHealthyDefaults } from '../../auth/loginSimulation.harness';

jest.mock('firebase/auth', () => require('../../auth/loginSimulation.harness').firebaseAuthMock());
jest.mock('../../auth/firebase', () => require('../../auth/loginSimulation.harness').firebaseModuleMock());
jest.mock('../../auth/firebaseConfig', () =>
  require('../../auth/loginSimulation.harness').firebaseConfigMock(jest.requireActual('../../auth/firebaseConfig')));
jest.mock('expo-secure-store', () => require('../../auth/loginSimulation.harness').secureStoreMock());
jest.mock('expo-apple-authentication', () => require('../../auth/loginSimulation.harness').appleAuthenticationMock());
jest.mock('expo-crypto', () => require('../../auth/loginSimulation.harness').cryptoMock());
jest.mock('@react-native-google-signin/google-signin', () =>
  require('../../auth/loginSimulation.harness').googleSigninMock());
jest.mock('../../sync/firestoreSync', () => require('../../auth/loginSimulation.harness').firestoreSyncMock());
jest.mock('../../sync/localDataOwner', () => ({ clearLocalAccountData: jest.fn() }));
jest.mock('../../push/pushRegistration', () => ({ unregisterPushToken: jest.fn() }));
jest.mock('../../store/useStore', () => ({ useStore: { getState: () => ({ setSessions: jest.fn() }) } }));
jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ autoSyncEnabled: false }) },
}));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
// Not a double -- the real React, pinned into the mock registry so
// jest.isolateModules (freshHandles below) cannot hand the component a
// SECOND copy of React whose hook dispatcher is null. Same fix
// loginSimulation.audit.test.ts uses for the same reason.
jest.mock('react', () => jest.requireActual('react'));

const theme = resolveTheme('dark', 'mint');

/**
 * A fresh useAuthStore + the SignedOutAccount that reads it, loaded in ONE
 * isolateModules block -- same technique loginSimulation.audit.test.ts's
 * signedInDangerZone uses, and for the same reason: SignedOutAccount's own
 * `import { useAuthStore } from '../../auth/useAuthStore'` has to resolve to
 * the SAME instance this test drives, or every assertion below reads a store
 * the rendered component never actually sees. Fresh per test, so
 * module-scope state (authListenerAttached, googleAuth's `configured`) never
 * leaks between cases -- but the SAME captured pair is reused for every
 * mount within one test, which is what lets the unmount test prove the store
 * survives a remount rather than just prove two unrelated stores exist.
 */
function freshHandles(): { store: any; SignedOutAccount: any } {
  let store: any;
  let SignedOutAccount: any;
  jest.isolateModules(() => {
    store = require('../../auth/useAuthStore').useAuthStore;
    SignedOutAccount = require('./SignedOutAccount').SignedOutAccount;
  });
  return { store, SignedOutAccount };
}

const mounted: TestRenderer.ReactTestRenderer[] = [];

/** Mounts SignedOutAccount and flushes the one microtask
 * useAppleAuthAvailable's isAvailableAsync().then(...) needs. Apple is
 * pinned unavailable in beforeEach, so this only ever settles `available` to
 * false, but the effect still has to be allowed to run once or its state
 * update lands outside act(). */
async function mountAccount(SignedOutAccountComp: any, ready = true): Promise<TestRenderer.ReactTestRenderer> {
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(React.createElement(SignedOutAccountComp, { color: theme, ready }));
  });
  await act(async () => {});
  mounted.push(tree!);
  return tree!;
}

/** The sheet being swiped away mid-attempt -- an unmount the user causes on
 * purpose, unrelated to whatever sign-in is still in flight. */
function closeSheet(tree: TestRenderer.ReactTestRenderer): void {
  act(() => tree.unmount());
  const i = mounted.indexOf(tree);
  if (i >= 0) mounted.splice(i, 1);
}

/** Microtask drain. A sign-in walks a chain of real awaits (requireFirebaseAuth,
 * googleAuth's own picker/exchange steps), and a fixed small number of
 * `await Promise.resolve()`s would silently under-run it -- same helper,
 * same reasoning, as loginSimulation.audit.test.ts's own flush(). */
async function flush(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function pressable(tree: TestRenderer.ReactTestRenderer, accessibilityLabel: string) {
  return tree.root.findAll((n: any) => n.props?.accessibilityLabel === accessibilityLabel)[0];
}

function textField(tree: TestRenderer.ReactTestRenderer, placeholder: string) {
  return tree.root.findAll((n: any) => typeof n.type === 'string' && n.props?.placeholder === placeholder)[0];
}

/** The rendered host tree in document order -- same technique
 * CalendarScreen.layout.test.tsx uses to reason about layout, applied here to
 * reason about ORDER instead: collapsing composite wrappers (Button,
 * AnimatedPressable, EmailPasswordFields...) away leaves only the leaves a
 * user actually sees, in the order they appear on screen. */
function hostNodes(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((n: any) => typeof n.type === 'string');
}

function indexOfAccessibilityLabel(tree: TestRenderer.ReactTestRenderer, label: string): number {
  return hostNodes(tree).findIndex((n: any) => n.props.accessibilityLabel === label);
}

/** SignInError's accessibilityRole="alert" is unique in this tree -- nothing
 * else in SignedOutAccount sets that role -- so its position among the host
 * nodes IS the position of whichever error is currently showing. */
function errorIndex(tree: TestRenderer.ReactTestRenderer): number {
  return hostNodes(tree).findIndex((n: any) => n.props.accessibilityRole === 'alert');
}

function errorText(tree: TestRenderer.ReactTestRenderer): string | null {
  const nodes = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'alert');
  if (nodes.length === 0) return null;
  const children = nodes[0].props.children;
  return Array.isArray(children) ? children.join('') : (children ?? null);
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  installHealthyDefaults();
  (AppleAuthentication.isAvailableAsync as jest.Mock).mockResolvedValue(false);
});

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
  warn.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('a sign-in that fails after the sheet is already gone', () => {
  it('still shows the failure once Account is reopened, even though the sheet was swiped away mid-attempt', async () => {
    let rejectSignIn: (e: unknown) => void;
    (signInWithCredential as jest.Mock).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSignIn = reject;
      }),
    );

    const { store, SignedOutAccount } = freshHandles();
    const first = await mountAccount(SignedOutAccount);

    act(() => {
      pressable(first, 'Sign in with Google').props.onPress();
    });
    // The sheet closes -- e.g. the user backs out of Settings -- while
    // Google's own exchange with Firebase is still pending.
    closeSheet(first);

    // The attempt now fails, after nobody was listening any more.
    await act(async () => {
      rejectSignIn(sdkError('auth/network-request-failed'));
      await flush();
    });

    // Reopening Account is a brand-new component instance, exactly like
    // AccountSection swapping SignedOutAccount back in once `user` is still
    // null. Before this fix, signInError lived in this component's own
    // useState, so a fresh instance always started at null regardless of
    // what the abandoned attempt had done -- the failure left no trace to
    // reopen to.
    const second = await mountAccount(SignedOutAccount);
    expect(errorText(second)).toBe('No connection. Check your network and try again.');
    expect(store.getState().signInErrorSource).toBe('provider');
  });
});

describe('where the message renders in the scrolling sheet', () => {
  it('puts a failed Google sign-in above the sign-in buttons', async () => {
    (signInWithCredential as jest.Mock).mockRejectedValue(sdkError('auth/network-request-failed'));
    const { store, SignedOutAccount } = freshHandles();
    const tree = await mountAccount(SignedOutAccount);

    await act(async () => {
      pressable(tree, 'Sign in with Google').props.onPress();
      await flush();
    });

    expect(errorText(tree)).toBe('No connection. Check your network and try again.');
    expect(store.getState().signInErrorSource).toBe('provider');
    expect(errorIndex(tree)).toBeGreaterThanOrEqual(0); // it actually rendered
    expect(errorIndex(tree)).toBeLessThan(indexOfAccessibilityLabel(tree, 'Sign in with Google'));
  });

  it('puts an invalid email address below the sign-in buttons, by the field it belongs to', async () => {
    const { store, SignedOutAccount } = freshHandles();
    const tree = await mountAccount(SignedOutAccount);

    // Submitted blank -- validateEmailPassword rejects the email before it
    // even looks at the password, so this alone is enough to trigger it.
    act(() => {
      pressable(tree, 'Sign in').props.onPress();
    });

    expect(errorText(tree)).toBe('Enter a valid email address.');
    expect(store.getState().signInErrorSource).toBe('email');
    // This is the exact failure the fix exists for: a user scrolled down to
    // the email form used to have their error written into a slot back at
    // the top of the page -- off-screen, and indistinguishable from the
    // button having done nothing at all.
    expect(errorIndex(tree)).toBeGreaterThan(indexOfAccessibilityLabel(tree, 'Sign in with Google'));
  });
});

describe('retrying and switching modes clear the old message', () => {
  it('clears the stale email message the instant a fixed address is submitted, before that attempt even resolves', async () => {
    // Never settles in this test -- what matters is what the screen shows
    // the moment the user retries, not what eventually happens to the retry.
    (signInWithEmailAndPassword as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { SignedOutAccount } = freshHandles();
    const tree = await mountAccount(SignedOutAccount);

    act(() => {
      pressable(tree, 'Sign in').props.onPress();
    });
    expect(errorText(tree)).toBe('Enter a valid email address.');

    act(() => {
      textField(tree, 'Email').props.onChangeText('me@example.com');
      textField(tree, 'Password').props.onChangeText('hunter22');
    });
    act(() => {
      pressable(tree, 'Sign in').props.onPress();
    });

    // Gone immediately: the clear happens at the START of handleSignIn, not
    // only once the retry itself succeeds or fails.
    expect(errorText(tree)).toBeNull();
  });

  it('clears the stale email message when the user switches to Create an account instead of retrying', async () => {
    const { SignedOutAccount } = freshHandles();
    const tree = await mountAccount(SignedOutAccount);

    act(() => {
      pressable(tree, 'Sign in').props.onPress();
    });
    expect(errorText(tree)).toBe('Enter a valid email address.');

    act(() => {
      pressable(tree, 'Create an account').props.onPress();
    });
    expect(errorText(tree)).toBeNull();
  });
});
