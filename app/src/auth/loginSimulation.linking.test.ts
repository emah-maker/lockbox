// loginSimulation.linking.test.ts -- the second half of the sign-in
// simulation: what happens AFTER, or AROUND, the tap that authenticates.
// Cross-provider linking, Keychain failures, races between two users, and the
// rule that nothing a user reads may come from an SDK.
//
// Same technique and the same harness as loginSimulation.test.ts (read its
// header first) -- the real modules driven with only the platform edge faked.
// Split off purely for CLAUDE.md's 500-line limit: the two files together are
// one suite, and the jest.mock block below is deliberately identical to that
// file's, because both must stand up the same platform edge.
import * as AppleAuthentication from 'expo-apple-authentication';
import { signInWithCredential, linkWithCredential } from 'firebase/auth';
import { runMigrationAndSync } from '../sync/firestoreSync';
import { signInErrorMessage } from './accountDisplay';
import {
  fakeAuth, keychain, makeUser, sdkError, conflictError, coldStart, afterGoogleConflict,
  newPersistence, signInErrorLine, installHealthyDefaults,
  AUTHORED_SIGN_IN_MESSAGES, SIGN_IN_SDK_CODES,
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
const google = () => makeUser('uid-1', 'me@example.com', ['google.com']);

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers(); // init() arms a 10s watchdog per call
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  installHealthyDefaults();
});

afterEach(() => {
  warn.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

// --- The cross-provider conflict prompt ------------------------------------
describe('an account that already exists under another provider', () => {
  it('prompts with the other providers by name, and shows no second error next to the prompt', async () => {
    (signInWithCredential as jest.Mock).mockRejectedValueOnce(conflictError());
    const { store } = await coldStart();

    const line = await signInErrorLine(() => store.getState().signInWithGoogle());

    expect(line).toBeNull(); // pendingLink carries the prompt; a second line would duplicate it
    expect(store.getState().pendingLink).toMatchObject({
      attemptedProvider: 'google', candidateProviders: ['apple', 'password'], email: 'me@example.com',
    });
  });

  it('completes the link once the user signs in to that same account with one of them', async () => {
    const { store } = await afterGoogleConflict('me@example.com');

    await store.getState().signInWithApple(); // same address

    expect(linkWithCredential).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'uid-1' }), expect.objectContaining({ providerId: 'google.com' }));
    expect(store.getState().pendingLink).toBeNull();
    expect(store.getState().user).toMatchObject({ uid: 'uid-1' });
  });

  it('completes it from an email/password sign-in too, which never throws the conflict itself', async () => {
    const { store } = await afterGoogleConflict();
    await store.getState().signInWithEmail('me@example.com', 'hunter22');
    expect(linkWithCredential).toHaveBeenCalled();
  });

  it('matches the address case-insensitively, since Firebase stores it as registered', async () => {
    const { store } = await afterGoogleConflict('Me@Example.com');
    await store.getState().signInWithEmail('me@example.com', 'hunter22');
    expect(linkWithCredential).toHaveBeenCalled();
  });

  it('does NOT link the credential onto a different account, whatever method that account used', async () => {
    // The security property. candidateProviders answers "is this one of the
    // METHODS we asked for" -- and a method is not an identity. On a shared
    // phone: A taps Google, hits the conflict, and leaves the prompt up naming
    // me@example.com. B signs in with their own email/password. 'password' is a
    // candidate, so A's stashed Google credential used to be linked onto B's
    // account, and A could afterwards sign in with one tap AS B.
    const { store, getPendingLink } = await afterGoogleConflict('me@example.com');
    expect(store.getState().pendingLink).toMatchObject({ email: 'me@example.com' });

    await store.getState().signInWithEmail('someone-else@example.com', 'hunter22');

    expect(store.getState().user).toMatchObject({ email: 'someone-else@example.com' });
    expect(linkWithCredential).not.toHaveBeenCalled();
    expect(getPendingLink()).toBeNull(); // and not left behind for the next one either
  });

  it('fails closed when the conflict carried no address to match against', async () => {
    const { store, getPendingLink } = await afterGoogleConflict(null);

    await store.getState().signInWithEmail('me@example.com', 'hunter22');

    // The sign-in itself still works -- this is about the link, not the tap.
    expect(store.getState().user).toMatchObject({ email: 'me@example.com' });
    // Nothing proves this is the right account, so nothing is linked. The
    // Account page's own "Link Google" does it deliberately instead, on an
    // account the user is demonstrably already inside.
    expect(linkWithCredential).not.toHaveBeenCalled();
    expect(getPendingLink()).toBeNull();
  });

  it('fails closed for an account with no email of its own', async () => {
    const { store } = await afterGoogleConflict('me@example.com');
    (signInWithCredential as jest.Mock).mockImplementationOnce(async () => {
      const u = makeUser('uid-1', null, ['apple.com']); // Apple, private relay, no email surfaced
      fakeAuth().currentUser = u;
      fakeAuth().listener?.(u);
      return { user: u };
    });

    await store.getState().signInWithApple();

    expect(store.getState().user).toMatchObject({ uid: 'uid-1', email: null }); // signed in, just not linked
    expect(linkWithCredential).not.toHaveBeenCalled();
  });

  it('throws the stashed credential away on sign-out, so it cannot attach to whoever signs in next', async () => {
    const { store, getPendingLink } = await afterGoogleConflict();
    expect(getPendingLink()).not.toBeNull();

    await store.getState().signInWithApple(); // links, consuming it
    await store.getState().signOut();
    (linkWithCredential as jest.Mock).mockClear();

    await store.getState().signInWithEmail('someone-else@example.com', 'hunter22');

    expect(getPendingLink()).toBeNull();
    expect(linkWithCredential).not.toHaveBeenCalled();
  });

  it('drops the prompt when the conflicted provider later succeeds on its own', async () => {
    const { store, getPendingLink } = await afterGoogleConflict();

    await store.getState().signInWithGoogle(); // retried, different Google account

    expect(store.getState().pendingLink).toBeNull();
    expect(getPendingLink()).toBeNull();
    expect(linkWithCredential).not.toHaveBeenCalled();
  });

  it("drops it on a brand-new account too, rather than linking a stranger's credential onto it", async () => {
    const { store, getPendingLink } = await afterGoogleConflict();

    await store.getState().createAccountWithEmail('brand-new@example.com', 'hunter22');

    expect(getPendingLink()).toBeNull();
    expect(linkWithCredential).not.toHaveBeenCalled();
  });

  it('does not retry a failed link with a stale credential', async () => {
    (linkWithCredential as jest.Mock).mockRejectedValue(sdkError('auth/credential-already-in-use'));
    const { store, getPendingLink } = await afterGoogleConflict();

    await store.getState().signInWithApple().catch(() => {});

    // The user IS signed in -- doSignIn succeeded, only the link did not --
    // and the credential is gone rather than left for a later sign-in.
    expect(store.getState().user).toMatchObject({ uid: 'uid-1' });
    expect(getPendingLink()).toBeNull();
    expect(store.getState().pendingLink).toBeNull();
  });
});

// --- Storage failures must cost a session, never a sign-in -----------------
describe('when the Keychain will not cooperate', () => {
  it('does not fail a sign-in the user already completed, when the session write fails', async () => {
    // SECURE_STORE_OPTS pins AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, so a write
    // before the first unlock since boot fails -- and Firebase writes here on
    // its own token-refresh schedule, from the background, off the BLE
    // connection. Firebase awaits _set inside directlySetCurrentUser, on the
    // path of every sign-in call: a rejection comes back out of the sign-in
    // and tells a user who authenticated perfectly that it failed.
    keychain().failWrites = true;
    await expect(newPersistence()._set('firebase:authUser:k:[DEFAULT]', { uid: 'u1' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled(); // degraded, but diagnosable
  });

  it('does not fail a sign-out when the delete fails', async () => {
    keychain().failDeletes = true;
    await expect(newPersistence()._remove('firebase:authUser:k:[DEFAULT]')).resolves.toBeUndefined();
  });

  it('treats an unreadable stored session as "no session", not as a failed launch', async () => {
    keychain().entries.set('firebase_authUser_k__DEFAULT_', '{"uid": tru');
    await expect(newPersistence()._get('firebase:authUser:k:[DEFAULT]')).resolves.toBeNull();
    // Self-healing: the bad value is dropped so the next launch starts clean.
    expect(keychain().entries.has('firebase_authUser_k__DEFAULT_')).toBe(false);
  });

  it('still signs the user out when every Keychain delete throws', async () => {
    keychain().failDeletes = true;
    const { store } = await coldStart(google());
    await expect(store.getState().signOut()).resolves.toBeUndefined();
    expect(store.getState().user).toBeNull();
  });
});

// --- Races -----------------------------------------------------------------
describe('races', () => {
  it("does not hand a second user the first user's sync result", async () => {
    let finishA: () => void;
    mockSync.mockImplementationOnce(() => new Promise<void>((r) => { finishA = () => r(); }));
    const { store } = await coldStart(makeUser('a', 'a@example.com', ['google.com']));

    const syncA = store.getState().syncNow();
    await store.getState().signOut();
    await store.getState().signInWithEmail('b@example.com', 'hunter22');
    finishA!();
    await syncA;

    expect(store.getState().user).toMatchObject({ email: 'b@example.com' });
    expect(store.getState().lastSyncedAt).toBeNull();
  });

  it("does not report an error from the previous user's failed sync", async () => {
    let failA: (e: any) => void;
    mockSync.mockImplementationOnce(() => new Promise((_r, rej) => { failA = rej; }));
    const { store } = await coldStart(makeUser('a', 'a@example.com', ['google.com']));

    const syncA = store.getState().syncNow();
    await store.getState().signOut();
    await store.getState().signInWithEmail('b@example.com', 'hunter22');
    failA!(new Error('boom'));
    await syncA;

    expect(store.getState().syncError).toBeNull();
  });

  it('does not re-populate the account page after a sign-out that landed while a picker was open', async () => {
    let finishPicker: (v: any) => void;
    (AppleAuthentication.signInAsync as jest.Mock).mockReturnValue(new Promise((r) => { finishPicker = r; }));
    const { store } = await coldStart(google());

    const linking = store.getState().linkProvider('apple');
    await store.getState().signOut();
    finishPicker!({ identityToken: 'apple-identity-token' });
    await linking;

    expect(store.getState().user).toBeNull();
  });
});

// --- Nothing the user reads may come from an SDK ---------------------------
describe('error presentation', () => {
  it.each(SIGN_IN_SDK_CODES)('never renders the raw SDK string for %s', async (code) => {
    (signInWithCredential as jest.Mock).mockRejectedValue(sdkError(code));
    const { store } = await coldStart();

    const line = await signInErrorLine(() => store.getState().signInWithGoogle());

    expect(line).not.toBeNull();
    expect(line).not.toMatch(/Firebase: Error/);
    expect(AUTHORED_SIGN_IN_MESSAGES).toContain(line);
  });

  it('never renders the email, uid or token that a conflict error carries', async () => {
    (signInWithCredential as jest.Mock).mockRejectedValue(conflictError());
    const { store } = await coldStart();

    expect(await signInErrorLine(() => store.getState().signInWithGoogle())).toBeNull();
    expect(JSON.stringify(store.getState().pendingLink?.credential ?? null)).not.toMatch(/ya29/);
  });

  it('keeps a raw Keychain message off the screen if a sign-in ever rejects with one', async () => {
    // A SecureStore failure carries no `.code`, so signInErrorMessage falls
    // through to its "this is our own static string, safe to show" branch and
    // would render the raw message. secureStorePersistence no longer rejects
    // on write, which is what keeps that unreachable -- this pins the reason.
    keychain().failWrites = true;
    await expect(newPersistence()._set('firebase:authUser:k:[DEFAULT]', { uid: 'u1' })).resolves.toBeUndefined();
    expect(signInErrorMessage(new Error('User interaction is not allowed. (-25308)')))
      .toBe('User interaction is not allowed. (-25308)');
  });

  it("never renders Firestore's own words when the sync that follows a sign-in fails", async () => {
    // autoSyncEnabled defaults to true and the auth listener fires syncNow(),
    // so a rules change not yet deployed used to put "Missing or insufficient
    // permissions." on the Account page seconds after signing in -- where it
    // reads as the sign-in itself having half-worked.
    (globalThis as any).__autoSync = true;
    mockSync.mockRejectedValue(Object.assign(
      new Error('Missing or insufficient permissions.'), { code: 'permission-denied', name: 'FirebaseError' }));
    const { store } = await coldStart();

    await store.getState().signInWithGoogle();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().syncError).not.toMatch(/insufficient permissions/);
    expect(store.getState().syncError)
      .toBe("This account doesn't have access to its cloud data yet. Your stats are safe on this phone.");
  });

  it('says something true about an offline sync rather than quoting the SDK', async () => {
    mockSync.mockRejectedValue(Object.assign(
      new Error('Failed to get document because the client is offline.'),
      { code: 'unavailable', name: 'FirebaseError' }));
    const { store } = await coldStart(google());

    await store.getState().syncNow();

    expect(store.getState().syncError).not.toMatch(/Failed to get document/);
    expect(store.getState().syncError).toMatch(/Your stats are safe on this phone/);
  });

  it('does not quote a JS runtime error either, which is what an uncoded sync failure is', async () => {
    // Unlike the sign-in path, nothing on the sync path throws authored
    // Errors, so an uncoded rejection here is a crash, not a message.
    mockSync.mockRejectedValue(new TypeError("undefined is not an object (evaluating 'd.settings')"));
    const { store } = await coldStart(google());

    await store.getState().syncNow();

    expect(store.getState().syncError).not.toMatch(/undefined is not an object/);
    expect(store.getState().syncError).toBe('Could not sync. Your stats are safe on this phone.');
  });
});
