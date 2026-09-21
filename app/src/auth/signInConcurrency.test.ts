// signInConcurrency.test.ts -- what happens when a second sign-in tap lands
// before the first one has finished, and what happens when Sign out (or
// deleteAccount) is tapped while one is still running.
//
// SignedOutAccount's `busy` disables the Google/Apple buttons and the email
// form, but it is screen-local React state set AFTER the handler has already
// started: it cannot stop a second tap that lands before the button visually
// greys out, and it is gone entirely once the sheet is dismissed. Before
// useAuthStore.ts's exclusiveSignIn/inFlightSignIn/sessionGeneration existed,
// that meant:
//   - two taps on Google opened two independent native pickers;
//   - a Google tap followed by an Apple tap let whichever finished LAST
//     silently overwrite the identity already on screen, with no error;
//   - a sign-in whose native picker was still open when the user tapped Sign
//     out could finish AFTER sign-out and silently sign them back in -- on
//     the shared-or-resold-device case clearSignedInState exists to protect,
//     exactly the leak reopening on its own.
//
// Mock surface follows involuntarySignOut.test.ts (same reasoning: the store
// logic under test -- exclusiveSignIn, sessionGeneration, undoStaleSignIn --
// lives entirely in useAuthStore.ts, so googleAuth/appleAuth/emailAuth can
// stay simple jest.fn() stand-ins and onAuthStateChanged is driven directly,
// exactly the way Firebase really delivers a sign-in's result). Every mock
// this file needs is imported at the TOP of the file, never require()'d from
// inside a test body -- freshStore()'s jest.isolateModules gives useAuthStore
// a clean module instance per test, and a lazy require() from outside that
// sandbox is not guaranteed to hand back the same mock instance useAuthStore
// actually calls, which silently breaks `mockResolvedValue` wiring.
import { initFirebaseAuth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  signInWithGoogle,
  signOutFully as signOutGoogleFully,
  reauthenticateForDeletion as reauthenticateGoogleForDeletion,
  deleteUserAccount as deleteGoogleUserAccount,
} from './googleAuth';
import { signInWithApple } from './appleAuth';
import { signInWithEmail } from './emailAuth';
import { deleteAllUserData } from '../sync/firestoreSync';

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
  signOutFully: jest.fn(async () => {}),
  reauthenticateForDeletion: jest.fn(),
  deleteUserAccount: jest.fn(),
  linkGoogleToCurrentUser: jest.fn(),
}));
jest.mock('./appleAuth', () => ({
  signInWithApple: jest.fn(),
  signOutFully: jest.fn(async () => {}),
  reauthenticateForDeletion: jest.fn(),
  deleteUserAccount: jest.fn(),
  linkAppleToCurrentUser: jest.fn(),
}));
jest.mock('./emailAuth', () => ({
  signInWithEmail: jest.fn(),
  createAccountWithEmail: jest.fn(),
  sendPasswordReset: jest.fn(),
  linkEmailToCurrentUser: jest.fn(),
  signOutFully: jest.fn(async () => {}),
  reauthenticateForDeletion: jest.fn(),
  deleteUserAccount: jest.fn(),
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

const mockInitFirebaseAuth = initFirebaseAuth as jest.Mock;
const mockOnAuthStateChanged = onAuthStateChanged as jest.Mock;

/** Fresh module instance per test: useAuthStore caches authListenerAttached,
 * inFlightSignIn and sessionGeneration at module scope, which would otherwise
 * leak between tests -- same rationale as involuntarySignOut.test.ts's
 * freshStore(). */
function freshStore() {
  let store: any;
  jest.isolateModules(() => {
    store = require('./useAuthStore').useAuthStore;
  });
  return store;
}

/** The minimum of Firebase's User that toAccountUser reads. */
const firebaseUser = (uid: string, providerId: string) => ({
  uid,
  email: `${uid}@example.com`,
  displayName: null,
  photoURL: null,
  emailVerified: true,
  metadata: {},
  providerData: [{ providerId }],
});

/** Attaches the real listener and hands back the callback Firebase would
 * invoke, so a test can drive auth transitions directly -- same helper as
 * involuntarySignOut.test.ts's attachListener(). */
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

/** Microtask drain. exclusiveSignIn/handleProviderSignIn chain several awaits
 * (requireFirebaseAuth, then doSignIn, then the pendingLink/re-read steps)
 * before a mocked provider function is actually invoked -- checking a mock's
 * call count, or reaching into a resolver a mock implementation assigns,
 * immediately after firing the call (with no await at all) runs before any
 * of that has happened. Named and reused rather than inlined so every call
 * site says PRECISELY what it is waiting on, matching
 * loginSimulation.audit.test.ts's identical helper. */
async function flush(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('a second sign-in tap while one is already running', () => {
  it('joins the Google picker already open instead of starting a second one on a double-tap', async () => {
    const { store, emit } = await attachListener();
    let resolveGoogle!: (u: unknown) => void;
    (signInWithGoogle as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveGoogle = (u) => { emit(u); resolve(u); }; }),
    );

    const firstTap = store.getState().signInWithGoogle();
    const secondTap = store.getState().signInWithGoogle(); // the double-tap, before the first sheet returns
    await flush(); // let both taps reach as far as they can before Google ever answers

    // One credential exchange for two taps -- not two competing native
    // pickers, which is what used to happen here.
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);

    resolveGoogle(firebaseUser('uid-1', 'google.com'));
    await Promise.all([firstTap, secondTap]);
    expect(store.getState().user).toMatchObject({ uid: 'uid-1' });
  });

  it('joins an in-flight Google attempt on an Apple tap instead of letting whichever finishes last overwrite the screen', async () => {
    const { store, emit } = await attachListener();
    let resolveGoogle!: (u: unknown) => void;
    (signInWithGoogle as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveGoogle = (u) => { emit(u); resolve(u); }; }),
    );

    const google = store.getState().signInWithGoogle();
    const apple = store.getState().signInWithApple(); // tapped before Google's sheet returned
    await flush();

    resolveGoogle(firebaseUser('uid-google', 'google.com'));
    await Promise.all([google, apple]);

    // Apple's own native sheet never ran: the second tap joined Google's
    // attempt rather than racing it. Before this fix, Apple would have run
    // independently and -- had it resolved after Google -- silently replaced
    // the account the screen had already settled on.
    expect(signInWithApple).not.toHaveBeenCalled();
    expect(store.getState().user).toMatchObject({ uid: 'uid-google' });
  });

  it('joins an in-flight Google attempt on an email-form submission too, so a Google-side outcome can surface under the email form', async () => {
    // This is the trade-off worth naming out loud, not a second copy of the
    // test above: exclusiveSignIn's lock is scoped to "any sign-in", not "the
    // same control", so a tap on the email form while Google is still open
    // joins Google's attempt rather than checking the typed password at all.
    // Cancelling Google here then surfaces "Google Sign-In was cancelled." as
    // the EMAIL form's own error (SignedOutAccount passes source: 'email' for
    // this control) -- not a crash and not a silent hang, but the typed
    // email/password are never sent to Firebase, and the message on screen
    // names the wrong control. Pinned here so a future change to
    // exclusiveSignIn's scope has to look at this case on purpose.
    const { store } = await attachListener();
    let rejectGoogle!: (e: unknown) => void;
    (signInWithGoogle as jest.Mock).mockReturnValue(new Promise((_resolve, reject) => { rejectGoogle = reject; }));

    const google = store.getState().signInWithGoogle();
    const email = store.getState().signInWithEmail('me@example.com', 'hunter22');
    await flush();

    rejectGoogle(new Error('Google Sign-In was cancelled.'));
    await expect(google).rejects.toThrow('Google Sign-In was cancelled.');
    await expect(email).rejects.toThrow('Google Sign-In was cancelled.');
    expect(signInWithEmail).not.toHaveBeenCalled(); // the typed credentials were never sent anywhere
  });
});

describe('ending the session while an earlier sign-in is still in flight', () => {
  it('signs a forgotten Google picker back out if it finally succeeds after the user already tapped Sign out', async () => {
    // Note what exclusiveSignIn (above) already rules out: a SECOND,
    // independently-running provider attempt cannot exist any more -- a tap
    // on Apple while Google is open now joins Google instead of racing it.
    // So the reachable version of this scenario is simpler than it used to
    // be: ONE attempt (Google) is still open when Sign out is tapped, full
    // stop. signOut() itself has no guard requiring `user` to be set first
    // (it is meant to be safe to call from anywhere, like every other action
    // here), so this is reachable even though SignedOutAccount would not
    // normally show a Sign out button while `user` is still null.
    const { store, emit } = await attachListener();
    let resolveGoogle!: (u: unknown) => void;
    (signInWithGoogle as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveGoogle = (u) => { emit(u); resolve(u); }; }),
    );

    const staleSignIn = store.getState().signInWithGoogle(); // sheet opens, then forgotten
    await flush();
    await store.getState().signOut();
    expect(store.getState().user).toBeNull();

    // The forgotten Google sheet finally returns -- a real, successful
    // result, not a cancel.
    resolveGoogle(firebaseUser('uid-1', 'google.com'));
    await staleSignIn;

    // Still signed out: the stale session is torn down (not just ignored),
    // so it cannot leave a live Google grant or Keychain entry behind either.
    expect(store.getState().user).toBeNull();
    expect(signOutGoogleFully).toHaveBeenCalled();
  });

  it('signs a forgotten sign-in back out after deleteAccount too, not just after signOut', async () => {
    // deleteAccount() bumps sessionGeneration for a stronger reason than
    // signOut does (see its own comment): once the Auth user is gone, a
    // stale credential for the SAME email would not restore the deleted
    // account, it would silently CREATE A NEW ONE seconds after the user
    // asked for it to be erased.
    const { store, emit } = await attachListener();
    emit(firebaseUser('uid-1', 'google.com')); // already signed in
    (reauthenticateGoogleForDeletion as jest.Mock).mockResolvedValue(undefined);
    (deleteAllUserData as jest.Mock).mockResolvedValue(undefined);
    (deleteGoogleUserAccount as jest.Mock).mockResolvedValue(undefined);

    let resolveGoogle!: (u: unknown) => void;
    (signInWithGoogle as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveGoogle = (u) => { emit(u); resolve(u); }; }),
    );
    const staleSignIn = store.getState().signInWithGoogle(); // a second Google tap, sheet still open
    await flush();

    await store.getState().deleteAccount();
    expect(store.getState().user).toBeNull();

    resolveGoogle(firebaseUser('uid-1', 'google.com'));
    await staleSignIn;

    expect(store.getState().user).toBeNull();
  });

  // Was written red, against a real gap: SIGN_IN_CLAIM_TTL_MS let a claim
  // expire without invalidating the attempt that held it, so an abandoned
  // sheet resolving minutes later still looked current. exclusiveSignIn now
  // bumps sessionGeneration when it evicts an expired claim, which is the
  // same "this result no longer counts" signal a sign-out raises, so
  // handleProviderSignIn undoes it like any other stale sign-in.
  it('does not let a sign-in abandoned for over two minutes silently replace the session someone actually chose afterward', async () => {
    // SIGN_IN_CLAIM_TTL_MS exists so a sheet that goes away without ever
    // resolving does not lock every later tap onto a dead promise forever --
    // its own comment says so, and also says "if it ever does settle,
    // sessionGeneration decides whether its result still counts". It does
    // not: sessionGeneration (grep the file) is bumped ONLY by signOut and
    // deleteAccount, never by a claim expiring. So once the TTL has passed, a
    // second, independent sign-in is free to start and succeed -- and if the
    // FIRST, abandoned attempt then resolves anyway (not a cancel; the user
    // just never got back to that sheet), nothing recognises it as stale:
    // onAuthStateChanged applies it exactly as it would a fresh sign-in,
    // silently pulling the account back to whichever one was forgotten over
    // two minutes ago.
    const { store, emit } = await attachListener();
    let resolveGoogle!: (u: unknown) => void;
    (signInWithGoogle as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveGoogle = (u) => { emit(u); resolve(u); }; }),
    );
    (signInWithEmail as jest.Mock).mockImplementation(async () => {
      const u = firebaseUser('uid-email', 'password');
      emit(u);
      return u;
    });

    const abandoned = store.getState().signInWithGoogle(); // sheet opens, then genuinely forgotten
    await flush();

    jest.advanceTimersByTime(120_001); // the exclusivity claim's TTL expires

    await store.getState().signInWithEmail('me@example.com', 'hunter22'); // a fresh, independent, successful sign-in
    expect(store.getState().user).toMatchObject({ uid: 'uid-email' });

    // The forgotten Google sheet is finally dismissed, minutes later, with a
    // real result -- not a cancel.
    resolveGoogle(firebaseUser('uid-google', 'google.com'));
    await abandoned;

    // What is actually guaranteed, and why it is not "uid-email survives":
    // by the time this runs, the abandoned attempt has ALREADY completed a
    // real signInWithCredential, so Firebase's own currentUser is the Google
    // account -- the email session is gone at the SDK level and this app
    // holds no credential it could restore it with. Nothing in the client can
    // undo that.
    //
    // So the guarantee is the one that actually protects the user: they are
    // never left silently signed in as the account they walked away from.
    // exclusiveSignIn's TTL eviction bumps sessionGeneration, handleProviderSignIn
    // sees the change, and undoStaleSignIn tears the stale session down --
    // ending on the signed-out page, which is honest and recoverable with one
    // tap.
    expect(store.getState().user).toBeNull();
    // The part that would be a real defect -- silently swapped to the
    // forgotten account -- asserted on its own so a regression names itself.
    expect(store.getState().user?.uid).not.toBe('uid-google');
  });
});
