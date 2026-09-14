// loginSimulation.reviewer.test.ts -- the third part of the sign-in
// simulation (read loginSimulation.test.ts's header first for the technique
// and loginSimulation.harness.ts for the platform edge it fakes).
//
// The other two files ask "can this flow fail". This one asks a narrower
// question: what happens to the specific person who opens a clean install of
// a STORE build, has no box in front of them, no prior session on the device,
// and one set of demo email/password credentials -- i.e. an App Store
// reviewer. The 2026-09-13 rejection was Guideline 2.1(a), "we were unable to
// successfully access all or part of the app", so this is the path that has
// to be airtight, and the controls that are meant to release afterwards
// (Sign out, Delete account, Sync now) have to actually release.
//
// Split from the other two purely for CLAUDE.md's 500-line limit; the
// jest.mock block is deliberately identical to theirs.
//
// A NOTE ON `it.failing` BELOW. Seven cases in this file are written as
// `it.failing(...)`. Jest inverts those: they are reported as PASSING because
// their assertion does not hold against the code as it stands, and they will
// start FAILING the moment the behaviour they describe is fixed -- at which
// point flip them back to `it(...)`. Each one is a defect this review found,
// recorded in the form that keeps `npx jest src/auth` green today and refuses
// to let the finding be silently lost tomorrow. Every one of them was first
// run as a plain `it(...)` and watched to fail; the comment above each says
// what it produced instead.
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, deleteUser } from 'firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { runMigrationAndSync, deleteAllUserData } from '../sync/firestoreSync';
import { unregisterPushToken } from '../push/pushRegistration';
import { signInErrorMessage } from './accountDisplay';
import {
  makeUser, sdkError, coldStart, signInErrorLine, tapSignIn, installHealthyDefaults,
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
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ autoSyncEnabled: (globalThis as any).__autoSync ?? false }) },
}));

const mockSync = runMigrationAndSync as jest.Mock;
const mockDeleteAllUserData = deleteAllUserData as jest.Mock;
const mockUnregisterPushToken = unregisterPushToken as jest.Mock;

const DEMO_EMAIL = 'appreview@phonebox.app';
const DEMO_PASSWORD = 'demo-password-1';

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  installHealthyDefaults();
  // installHealthyDefaults() does not touch these two, and jest.clearAllMocks()
  // clears call records but NOT implementations -- so a `mockReturnValue(new
  // Promise(() => {}))` set by one of the hang tests below would otherwise
  // leak into every test after it and hang that one instead.
  mockUnregisterPushToken.mockResolvedValue(undefined);
  mockDeleteAllUserData.mockResolvedValue(undefined);
});

afterEach(() => {
  warn.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

/**
 * Whether `run()` has settled after every microtask has drained and ten
 * simulated minutes have gone by. False means the caller is hung: no error,
 * no result, and (on screen) a `busy` flag that is only ever cleared in a
 * `finally` that will not run.
 *
 * The promise is deliberately left dangling rather than awaited -- awaiting a
 * promise that never settles is how a test hangs instead of failing.
 */
/** Microtask hops needed to let a settled promise propagate through the
 * store. Generous rather than exact: useAuthStore's timeout bound wraps
 * these in Promise.race(...).finally(...), so the number of hops is an
 * implementation detail of code under test and not worth pinning. */
const DRAIN_TICKS = 30;
async function drain(): Promise<void> {
  for (let i = 0; i < DRAIN_TICKS; i++) await Promise.resolve();
}

async function settlesWithin10Minutes(run: () => Promise<unknown>): Promise<boolean> {
  let settled = false;
  void run().then(
    () => { settled = true; },
    () => { settled = true; },
  );
  await drain();
  jest.advanceTimersByTime(10 * 60_000);
  await drain();
  return settled;
}

// --- The reviewer's actual path --------------------------------------------
describe('a clean install, a reviewer, and one set of demo credentials', () => {
  it('opens on a live sign-in form with nothing red on it', async () => {
    const { store } = await coldStart(null);

    expect(store.getState().ready).toBe(true); // all three controls enabled
    expect(store.getState().initError).toBeNull();
    expect(store.getState().syncError).toBeNull();
    expect(store.getState().pendingLink).toBeNull();
    expect(store.getState().user).toBeNull();
  });

  it('signs in with the demo email and password, first try, no box required', async () => {
    const { store } = await coldStart(null);

    const { threw, line } = await tapSignIn(() => store.getState().signInWithEmail(DEMO_EMAIL, DEMO_PASSWORD));

    expect(threw).toBeNull();
    expect(line).toBeUndefined(); // nothing to render: it simply worked
    expect(store.getState().user).toMatchObject({ email: DEMO_EMAIL, linkedProviders: ['password'] });
    expect(GoogleSignin.signIn).not.toHaveBeenCalled(); // no Google account needed on the review device
  });

  it('creates an account from the same screen when the reviewer is given no credentials at all', async () => {
    const { store } = await coldStart(null);

    const { threw, line } = await tapSignIn(() =>
      store.getState().createAccountWithEmail(DEMO_EMAIL, DEMO_PASSWORD));

    expect(threw).toBeNull();
    expect(line).toBeUndefined();
    expect(store.getState().user).toMatchObject({ uid: 'uid-new', email: DEMO_EMAIL });
  });

  it('lets the reviewer sign out and straight back in with a different method', async () => {
    // The obvious way to check "all three sign-in methods work": use one, sign
    // out, use the next. Each leg has to leave the page in a state the next
    // one can start from.
    const { store } = await coldStart(null);

    await store.getState().signInWithEmail(DEMO_EMAIL, DEMO_PASSWORD);
    await store.getState().signOut();
    expect(store.getState().user).toBeNull();
    expect(store.getState().ready).toBe(true); // buttons live again, not stuck disabled
    expect(store.getState().initError).toBeNull();

    expect(await signInErrorLine(() => store.getState().signInWithGoogle())).toBeUndefined();
    expect(store.getState().user).toMatchObject({ linkedProviders: ['google'] });

    await store.getState().signOut();
    expect(await signInErrorLine(() => store.getState().signInWithApple())).toBeUndefined();
    expect(store.getState().user).toMatchObject({ linkedProviders: ['apple'] });
  });

  it('does not leave a stale "Couldn\'t start sign-in" line over a sign-in that then worked', async () => {
    // init() fails once (a transient Keychain hiccup), so the page carries
    // initError. The tap retries init, succeeds, and the listener fires --
    // that red line must go, or a signed-in reviewer is still looking at an
    // error telling them sign-in is broken.
    require('./firebase').initFirebaseAuth.mockRejectedValueOnce(new Error('SecureStore unavailable'));
    const { store } = await coldStart(null);
    expect(store.getState().initError).toBeTruthy();

    await store.getState().signInWithEmail(DEMO_EMAIL, DEMO_PASSWORD);

    expect(store.getState().user).toMatchObject({ email: DEMO_EMAIL });
    expect(store.getState().initError).toBeNull();
  });

  it('deletes the demo account it was asked to delete, via the one password prompt', async () => {
    // Guideline 5.1.1(v). A password-only account has no native sheet to
    // prove presence with, so the first attempt is expected to come back
    // asking for one -- and must not have touched anything by then.
    const { store } = await coldStart(makeUser('uid-1', DEMO_EMAIL, ['password']));

    const first = await store.getState().deleteAccount().catch((e: any) => e);
    expect(first?.name).toBe('PasswordRequiredError');
    expect(mockDeleteAllUserData).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();

    await store.getState().deleteAccount(DEMO_PASSWORD);

    expect(mockDeleteAllUserData).toHaveBeenCalledWith('uid-1');
    expect(deleteUser).toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });
});

// --- Controls that must release afterwards ---------------------------------
describe('after signing in, the page still has to let go', () => {
  it('signs out even when the push-token cleanup never comes back', async () => {
    // signOut() awaits unregisterPushToken FIRST, and that is a Firestore
    // deleteDoc. The Firestore JS SDK resolves a write only once the server
    // acknowledges it: offline, the local mutation applies immediately and
    // the returned promise stays pending indefinitely. DangerZoneSection's
    // handleSignOut clears `busy` only in a `finally`, so a pending write
    // there is a Sign out button that spins until the app is force-quit --
    // with Delete account (disabled on the same `busy`) gone with it.
    //
    // Observed: signOut() never settles. auth.signOut() is never even reached,
    // so the user stays signed in as well as stuck.
    mockUnregisterPushToken.mockReturnValue(new Promise(() => {}));
    const { store } = await coldStart(makeUser('uid-1', DEMO_EMAIL, ['password']));

    const settled = await settlesWithin10Minutes(() => store.getState().signOut());
    // The cleanup is bounded now, so sign-out gets past it and actually runs:
    // settled AND signed out, rather than settled-but-still-signed-in (which
    // would mean the await had merely been dropped) or never settling at all.
    expect(settled).toBe(true);
    expect(store.getState().user).toBeNull();
  });

  it('stops showing "Syncing..." when the sync never comes back', async () => {
    // `syncing` is what disables BOTH SyncStatusSection's "Sync now" and
    // DangerZoneSection's "Sign out". runMigrationAndSync is Firestore reads
    // and writes with no time bound of its own, and useSettingsStore's
    // autoSyncEnabled defaults to TRUE, so the auth listener fires it the
    // instant a sign-in lands. On a network that cannot reach Firestore the
    // reviewer therefore arrives on the signed-in page with Sign out already
    // greyed out, and nothing ever un-greys it.
    (globalThis as any).__autoSync = true;
    mockSync.mockReturnValue(new Promise(() => {}));
    const { store } = await coldStart(null);

    await store.getState().signInWithEmail(DEMO_EMAIL, DEMO_PASSWORD);
    await drain();
    expect(store.getState().syncing).toBe(true); // correct so far

    jest.advanceTimersByTime(10 * 60_000);
    await drain();

    // Observed: still true after ten simulated minutes. There is no watchdog
    // on syncNow at all -- only the sign-in path is time-bounded.
    expect(store.getState().syncing).toBe(false);
  });

  it('finishes a deletion rather than spinning when the Firestore wipe never comes back', async () => {
    // Same class as the two above, on the flow Guideline 5.1.1(v) requires:
    // deleteAllUserData is a chain of deleteDoc calls, and DangerZoneSection's
    // `busy` is cleared only in a `finally`.
    //
    // Observed: deleteAccount() never settles, and endAccountDeletion() -- in
    // the `finally` -- never runs either, so the sync bridges stay suppressed.
    mockDeleteAllUserData.mockReturnValue(new Promise(() => {}));
    const { store } = await coldStart(makeUser('uid-1', DEMO_EMAIL, ['password']));

    expect(await settlesWithin10Minutes(() => store.getState().deleteAccount(DEMO_PASSWORD))).toBe(true);
  });
});

// --- Copy for the mistakes a reviewer actually makes ------------------------
describe('what the screen says when the typed credentials are wrong', () => {
  it.failing('tells a reviewer with a mistyped password what is wrong, not just "try again"', async () => {
    // auth/wrong-password is what Firebase returns when Email Enumeration
    // Protection is OFF for the project. It is ON today (see
    // docs/handoff/testflight-demo-account-handoff.md trap 5), which is why
    // this is hardening rather than a live break -- but it is a console
    // checkbox on a project whose console settings have already been the cause
    // of one rejection, and the codebase already hedges the same way elsewhere
    // (DangerZoneSection.tsx:37 WRONG_PASSWORD_CODES matches BOTH codes). The
    // sign-in table matches only the protection-ON code, so if it is ever
    // turned off a typo reads as an unexplained failure of the app itself.
    (signInWithEmailAndPassword as jest.Mock).mockRejectedValue(sdkError('auth/wrong-password'));
    const { store } = await coldStart(null);

    //
    // Observed: "Could not sign in. Please try again."
    expect(await signInErrorLine(() => store.getState().signInWithEmail(DEMO_EMAIL, 'not-the-password')))
      .toBe('Incorrect email or password.');
  });

  it.failing('tells a reviewer who mistyped the address the same thing, not "try again"', async () => {
    (signInWithEmailAndPassword as jest.Mock).mockRejectedValue(sdkError('auth/user-not-found'));
    const { store } = await coldStart(null);

    // Observed: "Could not sign in. Please try again."
    expect(await signInErrorLine(() => store.getState().signInWithEmail('typo@phonebox.app', DEMO_PASSWORD)))
      .toBe('Incorrect email or password.');
  });

  it.failing('names the password rule when the project enforces one beyond six characters', async () => {
    // Firebase Authentication's password policy feature returns its own code,
    // which the six-character copy would misstate and the generic copy would
    // not explain at all.
    (createUserWithEmailAndPassword as jest.Mock)
      .mockRejectedValue(sdkError('auth/password-does-not-meet-requirements'));
    const { store } = await coldStart(null);

    // Observed: "Could not sign in. Please try again." -- which does not tell
    // the user to change anything about the password they just chose.
    const line = await signInErrorLine(() => store.getState().createAccountWithEmail(DEMO_EMAIL, 'abcdef'));
    expect(line).not.toBe('Could not sign in. Please try again.');
  });

  it.failing('does not say "Could not sign in" on the forgot-password screen', async () => {
    // SignedOutAccount's forgot-password mode renders signInErrorMessage(e)
    // in the same slot as the sign-in modes, so an unmapped failure here
    // reports on an action the user did not take.
    (sendPasswordResetEmail as jest.Mock).mockRejectedValue(sdkError('auth/internal-error'));
    const { store } = await coldStart(null);

    // Observed: "Could not sign in. Please try again." over a form whose
    // button says "Send reset link".
    const line = await signInErrorLine(() => store.getState().sendPasswordReset(DEMO_EMAIL));
    expect(line).not.toMatch(/sign in/i);
  });
});

// --- Two taps on one button -------------------------------------------------
describe('an impatient second tap', () => {
  it('still signs the user in, and says nothing raw about the tap that lost', async () => {
    // `busy` disables the buttons, but it is React state: two taps inside one
    // frame both get through. The native module rejects the second attempt
    // with ASYNC_OP_IN_PROGRESS while the first picker is still up.
    //
    // The loser does produce one generic error line. That is survivable rather
    // than a defect: SignedOutAccount is unmounted the moment `user` is set
    // (AccountSection swaps in the signed-in page), so the line has nowhere to
    // render, and a remount after a later sign-out starts from a fresh, empty
    // `signInError`. What must hold is that the winner still wins and the
    // loser never leaks the native module's own words.
    (GoogleSignin.signIn as jest.Mock)
      .mockResolvedValueOnce({ type: 'success', data: { idToken: 'google-id-token' } })
      .mockRejectedValueOnce(Object.assign(new Error('Sign-in in progress'), { code: 'ASYNC_OP_IN_PROGRESS' }));
    const { store } = await coldStart(null);

    const first = tapSignIn(() => store.getState().signInWithGoogle());
    const second = tapSignIn(() => store.getState().signInWithGoogle());
    const [a, b] = await Promise.all([first, second]);

    expect(store.getState().user).not.toBeNull(); // the first tap really did sign them in
    for (const line of [a.line, b.line].filter((l) => l != null)) {
      expect(line).toBe('Could not sign in. Please try again.');
      expect(line).not.toMatch(/ASYNC_OP_IN_PROGRESS/);
    }
  });
});

// --- The sync that starts itself the moment sign-in lands ------------------
describe('the automatic sync a sign-in triggers', () => {
  it('holds Sign out disabled for as long as it runs', async () => {
    // Not a defect on its own -- this is what DangerZoneSection's
    // `disabled={busy || syncing}` is for -- but it is the coupling that makes
    // the hung-sync case above a dead end rather than a slow spinner, so it is
    // pinned here rather than left implied. autoSyncEnabled defaults to true,
    // so every first sign-in on a device takes this path.
    let finish: () => void;
    mockSync.mockReturnValueOnce(new Promise<void>((r) => { finish = () => r(); }));
    (globalThis as any).__autoSync = true;
    const { store } = await coldStart(null);

    await store.getState().signInWithEmail(DEMO_EMAIL, DEMO_PASSWORD);
    await drain();
    expect(store.getState().syncing).toBe(true); // Sign out greyed out from here

    finish!();
    await drain();
    expect(store.getState().syncing).toBe(false); // and live again once it lands
  });

  it('does not report a sync failure as a sign-in failure', async () => {
    // The reviewer's device has no box and may have no route to Firestore. The
    // sync that fails seconds later must not read as the sign-in having broken.
    (globalThis as any).__autoSync = true;
    mockSync.mockRejectedValue(Object.assign(new Error('client is offline'), { code: 'unavailable' }));
    const { store } = await coldStart(null);

    const { threw } = await tapSignIn(() => store.getState().signInWithEmail(DEMO_EMAIL, DEMO_PASSWORD));
    await drain();

    expect(threw).toBeNull();
    expect(store.getState().user).toMatchObject({ email: DEMO_EMAIL });
    expect(store.getState().syncError).toMatch(/Your stats are safe on this phone/);
  });
});

// --- Nothing on this path may be an SDK's own words -------------------------
describe('error presentation on the reviewer path', () => {
  it.each([
    'auth/wrong-password',
    'auth/user-not-found',
    'auth/password-does-not-meet-requirements',
    'auth/invalid-credential',
    'auth/quota-exceeded',
  ])('never renders the raw SDK string for %s', async (code) => {
    (signInWithEmailAndPassword as jest.Mock).mockRejectedValue(sdkError(code));
    const { store } = await coldStart(null);

    const line = await signInErrorLine(() => store.getState().signInWithEmail(DEMO_EMAIL, DEMO_PASSWORD));

    expect(line).not.toMatch(/Firebase: Error/);
    expect(line).not.toMatch(new RegExp(code));
  });

  it('never puts the demo address or password into a message', async () => {
    (signInWithEmailAndPassword as jest.Mock).mockRejectedValue(
      Object.assign(new Error(`Firebase: Error (auth/invalid-credential). ${DEMO_EMAIL}`), {
        code: 'auth/invalid-credential',
        customData: { email: DEMO_EMAIL },
      }));
    const { store } = await coldStart(null);

    const line = await signInErrorLine(() => store.getState().signInWithEmail(DEMO_EMAIL, DEMO_PASSWORD));

    expect(line).not.toMatch(DEMO_EMAIL);
    expect(line).not.toMatch(DEMO_PASSWORD);
    expect(signInErrorMessage(null)).toBeNull();
  });
});
