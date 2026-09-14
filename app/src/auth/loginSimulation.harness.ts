// loginSimulation.harness.ts -- the platform edge for loginSimulation.test.ts,
// and nothing else.
//
// That suite drives the REAL useAuthStore/googleAuth/appleAuth/emailAuth/
// accountLinking/authSession/accountDisplay, because a simulation that mocked
// those and then asserted the mock was called would prove nothing. What has
// to be faked is only the boundary the app cannot cross in Jest: the Firebase
// SDK, the three native sign-in modules, the Keychain, and the sync/push/store
// modules the auth store calls out to. All of that lives here so the test file
// itself is only scenarios and assertions.
//
// Named `.harness.ts`, NOT `.test.ts`/`.spec.ts` and not under `__tests__/`,
// so jest-expo's default testMatch does not pick it up and fail it as a suite
// with no tests in it.
//
// Every mock factory below is exported as a FUNCTION rather than an object.
// jest.mock() factories are hoisted above the imports of the file they appear
// in, so the test file cannot hand them a value from this module directly --
// it calls `jest.mock('x', () => require('./loginSimulation.harness').xMock())`
// instead, which defers the require to factory-invocation time. For the same
// reason nothing here imports 'firebase/auth' at module scope: this module is
// first loaded from inside that module's own factory.
import { signInErrorMessage } from './accountDisplay';

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------
// Parked on globalThis because several independent mock factories need to see
// the same objects, and a factory may be re-evaluated under
// jest.isolateModules -- `||` keeps the instance stable if it ever is.

export type FakeAuth = {
  currentUser: any;
  listener: ((u: any) => void) | null;
  signOut: jest.Mock;
};

export type FakeKeychain = {
  entries: Map<string, string>;
  failWrites: boolean;
  failDeletes: boolean;
};

/** The Auth instance getFirebaseAuth() hands back. `signOut` lives on it
 * because authSession.signOutFirebaseSession calls `auth.signOut()` directly,
 * and because the listener firing with null is the ONLY way the store learns
 * that nobody is signed in any more. */
export function newFakeAuth(): FakeAuth {
  const a: FakeAuth = {
    currentUser: null,
    listener: null,
    signOut: jest.fn(async () => {
      a.currentUser = null;
      a.listener?.(null);
    }),
  };
  return a;
}

export const fakeAuth = (): FakeAuth => (globalThis as any).__fakeAuth;
export const keychain = (): FakeKeychain => (globalThis as any).__keychain;

/** What the Firebase SDK does on a successful sign-in: the session becomes
 * current, and every onAuthStateChanged listener hears about it. The store
 * learns about a signed-in user ONLY through that callback, so a simulation
 * that skipped this would miss the whole class of "authenticated, but the app
 * never found out" bugs. */
export function firebaseSignsIn(user: any) {
  fakeAuth().currentUser = user;
  fakeAuth().listener?.(user);
  return { user };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

export function firebaseAuthMock() {
  const g = globalThis as any;
  g.__fakeAuth = g.__fakeAuth || newFakeAuth();
  return {
    // The real constant's real value -- accountLinking.ts branches on it.
    AuthErrorCodes: { NEED_CONFIRMATION: 'auth/account-exists-with-different-credential' },
    GoogleAuthProvider: { credential: jest.fn((idToken: string) => ({ providerId: 'google.com', idToken })) },
    // Written the long way round (no TypeScript parameter properties): babel's
    // out-of-scope guard for jest.mock factories rejects the shorthand.
    OAuthProvider: class {
      providerId: string;
      constructor(providerId: string) {
        this.providerId = providerId;
      }
      credential(o: any) {
        return { providerId: this.providerId, ...o };
      }
    },
    EmailAuthProvider: {
      credential: jest.fn((email: string, password: string) => ({ providerId: 'password', email, password })),
    },
    onAuthStateChanged: jest.fn(),
    signInWithCredential: jest.fn(),
    signInWithEmailAndPassword: jest.fn(),
    createUserWithEmailAndPassword: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    sendEmailVerification: jest.fn(),
    linkWithCredential: jest.fn(),
    reauthenticateWithCredential: jest.fn(),
    deleteUser: jest.fn(),
    unlink: jest.fn(),
  };
}

/**
 * firebase.ts owns FirebaseApp/SDK construction, which cannot run here. Its
 * FirebaseConfigError is reproduced exactly, message and all, because three
 * real modules depend on it BY NAME (googleAuth throws it; accountDisplay and
 * useAuthStore both branch on `e.name === 'FirebaseConfigError'`) -- and
 * because that message is the one string in this codebase documented as
 * never-show, so several assertions check it never reaches the screen.
 */
export function firebaseModuleMock() {
  class FirebaseConfigError extends Error {
    missingEnvVars: string[];
    constructor(missingEnvVars: string[]) {
      super(
        `Firebase config is missing/invalid for: ${missingEnvVars.join(', ')}. Set these in ` +
          `app/.env (see firebaseConfig.ts) and restart with 'expo start -c' -- EXPO_PUBLIC_* ` +
          `vars are inlined at build/transform time, so a stale build keeps the old value.`,
      );
      this.name = 'FirebaseConfigError';
      this.missingEnvVars = missingEnvVars;
    }
  }
  return {
    FirebaseConfigError,
    initFirebaseAuth: jest.fn(),
    getFirebaseAuth: jest.fn(() => (globalThis as any).__fakeAuth),
    getDb: jest.fn(() => ({})),
    getAuthInitStage: jest.fn(() => 'initialize-auth'),
  };
}

/** Only findInvalidGoogleSignInKeys is stubbed, and only because it reads
 * EXPO_PUBLIC_* values that babel-preset-expo inlines at transform time --
 * there is no way to vary them from inside a test (see its own docblock). Its
 * logic is covered by firebaseConfig.test.ts; what the simulation tests is the
 * wiring: what a user sees when it reports a placeholder. */
export function firebaseConfigMock(actual: any) {
  return { ...actual, findInvalidGoogleSignInKeys: jest.fn(() => []) };
}

export function secureStoreMock() {
  const g = globalThis as any;
  g.__keychain = g.__keychain || { entries: new Map<string, string>(), failWrites: false, failDeletes: false };
  // The real iOS failure this reproduces: SECURE_STORE_OPTS pins
  // keychainAccessible to WHEN_UNLOCKED_THIS_DEVICE_ONLY, so a read or write
  // while the device is locked comes back as errSecInteractionNotAllowed.
  const locked = () => new Error('User interaction is not allowed. (-25308)');
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (key: string, value: string) => {
      if (keychain().failWrites) throw locked();
      keychain().entries.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => keychain().entries.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      if (keychain().failDeletes) throw locked();
      keychain().entries.delete(key);
    }),
  };
}

export function appleAuthenticationMock() {
  return {
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    isAvailableAsync: jest.fn(),
    signInAsync: jest.fn(),
  };
}

export function cryptoMock() {
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomBytesAsync: jest.fn(async () => new Uint8Array(32)),
    digestStringAsync: jest.fn(async () => 'hashed-nonce'),
  };
}

export function googleSigninMock() {
  return {
    GoogleSignin: {
      configure: jest.fn(),
      hasPlayServices: jest.fn(),
      signIn: jest.fn(),
      revokeAccess: jest.fn(),
      signOut: jest.fn(),
    },
  };
}

export function firestoreSyncMock() {
  return {
    runMigrationAndSync: jest.fn(),
    deleteAllUserData: jest.fn(),
    beginAccountDeletion: jest.fn(),
    endAccountDeletion: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures and drivers
// ---------------------------------------------------------------------------

export function makeUser(uid: string, email: string | null, providerIds: string[]) {
  return {
    uid,
    email,
    displayName: null,
    photoURL: null,
    emailVerified: true,
    metadata: { creationTime: 'Mon, 12 Aug 2026 00:00:00 GMT', lastSignInTime: 'Mon, 12 Aug 2026 00:00:00 GMT' },
    providerData: providerIds.map((providerId) => ({ providerId })),
  };
}

/** A Firebase SDK error: a `.code`, and the developer-facing `.message` the
 * SDK really produces -- which must never be rendered. */
export function sdkError(code: string, message = `Firebase: Error (${code}).`) {
  return Object.assign(new Error(message), { code, name: 'FirebaseError' });
}

/** Firebase's auth/account-exists-with-different-credential, carrying the
 * customData.email accountLinking reads and the _tokenResponse credential
 * payload design doc §5 item 3 forbids surfacing. */
export function conflictError(email: string | null = 'me@example.com') {
  return Object.assign(new Error('Firebase: Error (auth/account-exists-with-different-credential).'), {
    code: 'auth/account-exists-with-different-credential',
    customData: email ? { email } : {},
    _tokenResponse: { idToken: 'ya29.SECRET-OAUTH-TOKEN' },
  });
}

/**
 * A fresh copy of the store and every real module behind it.
 *
 * `authListenerAttached` (useAuthStore), `configured` (googleAuth) and the
 * stashed credential (accountLinking) are all module-scope state that would
 * otherwise leak between tests -- and the Google one would make the
 * placeholder-client-id tests order-dependent, since ensureConfigured()
 * short-circuits once it has succeeded even once.
 *
 * The test file deliberately imports nothing local to ./auth at its top level
 * for the same reason: jest reuses an already-loaded module inside
 * isolateModules, so a top-level import would defeat the isolation. Only the
 * MOCKS are imported up there, which is exactly what should be shared.
 */
export function freshAuth(): { store: any; getPendingLink: () => any } {
  let out: any;
  jest.isolateModules(() => {
    out = {
      store: require('./useAuthStore').useAuthStore,
      getPendingLink: require('./accountLinking').getPendingLink,
    };
  });
  return out;
}

/** Cold start with a working init, the way App.tsx does it. */
export async function coldStart(storedUser: any = null) {
  fakeAuth().currentUser = storedUser;
  const handles = freshAuth();
  await handles.store.getState().init();
  return handles;
}

/** init() against an initFirebaseAuth() that never settles, advanced far
 * enough for the 10s watchdog to release the sign-in gate. The state the
 * buttons look live in but auth is not actually up. */
export async function stalledInit() {
  require('./firebase').initFirebaseAuth.mockReturnValue(new Promise(() => {}));
  const handles = freshAuth();
  handles.store.getState().init();
  await Promise.resolve();
  jest.advanceTimersByTime(10_000);
  return handles;
}

/** Drives the cross-provider conflict prompt into existence: a Google tap
 * Firebase rejects with account-exists-with-different-credential for `email`.
 * Where most of the linking scenarios start. */
export async function afterGoogleConflict(email: string | null = 'me@example.com') {
  require('firebase/auth').signInWithCredential.mockRejectedValueOnce(conflictError(email));
  const handles = await coldStart();
  await handles.store.getState().signInWithGoogle().catch(() => {});
  return handles;
}

/** The real persistence adapter. Cast because its storage contract
 * (_get/_set/_remove) is internal to @firebase/auth and absent from the
 * public `Persistence` type -- see secureStorePersistence.ts's own note. */
export const newPersistence = (): any => new (require('./secureStorePersistence').SecureStorePersistence)();

/**
 * One tap, and the two things that can be observed about it.
 *
 * `threw` is what the store action rejected with -- null when it succeeded.
 * `line` is what SignedOutAccount's handleSignIn would then render:
 * signInErrorMessage(e), which is deliberately null for the cases the page
 * already communicates some other way (a user-initiated cancel shows nothing;
 * AccountExistsError's prompt is carried by pendingLink; AuthInitReportedError
 * is already on screen as initError). `undefined` means there was nothing to
 * render because nothing failed.
 *
 * Distinguishing null from undefined is the whole point: "the tap failed and
 * the page says so elsewhere" and "the tap succeeded" look identical if you
 * only look at the error line, and the difference between them is the
 * difference between a working sign-in and a silent no-op.
 */
export async function tapSignIn(
  run: () => Promise<void>,
): Promise<{ threw: any; line: string | null | undefined }> {
  try {
    await run();
    return { threw: null, line: undefined };
  } catch (e) {
    return { threw: e, line: signInErrorMessage(e as any) };
  }
}

/** tapSignIn when only the rendered line matters. */
export async function signInErrorLine(run: () => Promise<void>): Promise<string | null | undefined> {
  return (await tapSignIn(run)).line;
}

/** Every default a healthy device would produce. Each test changes exactly
 * the one thing it is about, so a failure names its own cause. */
export function installHealthyDefaults(): void {
  const fa = require('firebase/auth');
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  const AppleAuthentication = require('expo-apple-authentication');

  (globalThis as any).__fakeAuth = newFakeAuth();
  (globalThis as any).__keychain = { entries: new Map(), failWrites: false, failDeletes: false };
  (globalThis as any).__autoSync = false;

  require('./firebase').initFirebaseAuth.mockResolvedValue(undefined);
  require('./firebaseConfig').findInvalidGoogleSignInKeys.mockReturnValue([]);
  require('../sync/firestoreSync').runMigrationAndSync.mockResolvedValue(undefined);

  fa.onAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
    fakeAuth().listener = cb;
    cb(fakeAuth().currentUser); // Firebase always fires once with the initial state
    return () => {};
  });
  fa.signInWithCredential.mockImplementation(async (_auth: any, cred: any) =>
    firebaseSignsIn(makeUser('uid-1', 'me@example.com', [cred.providerId])),
  );
  fa.signInWithEmailAndPassword.mockImplementation(async (_auth: any, email: string) =>
    firebaseSignsIn(makeUser('uid-1', email, ['password'])),
  );
  fa.createUserWithEmailAndPassword.mockImplementation(async (_auth: any, email: string) =>
    firebaseSignsIn(makeUser('uid-new', email, ['password'])),
  );
  fa.sendPasswordResetEmail.mockResolvedValue(undefined);
  fa.sendEmailVerification.mockResolvedValue(undefined);
  fa.linkWithCredential.mockImplementation(async (user: any) => ({ user }));

  GoogleSignin.hasPlayServices.mockResolvedValue(true);
  GoogleSignin.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
  GoogleSignin.revokeAccess.mockResolvedValue(undefined);
  GoogleSignin.signOut.mockResolvedValue(undefined);
  AppleAuthentication.isAvailableAsync.mockResolvedValue(true);
  AppleAuthentication.signInAsync.mockResolvedValue({ identityToken: 'apple-identity-token' });
}

/** Every string this codebase authors for a failed sign-in. Anything a user
 * can see on that path must be one of these -- design doc §5 checklist
 * item 3. Kept here, next to the fixtures, so the sweep in the test file
 * reads as one assertion rather than a wall of literals. */
export const AUTHORED_SIGN_IN_MESSAGES = [
  'Could not sign in. Please try again.',
  'No connection. Check your network and try again.',
  'Too many attempts. Try again later.',
  'This account has been disabled.',
  'Incorrect email or password.',
  'An account with that email already exists.',
  'Password must be at least 6 characters.',
  'Enter a valid email address.',
  'Enter your password.',
  "That sign-in method isn't enabled for this app yet.",
  "Sign-in isn't configured on this build.",
  'Google Sign-In was cancelled.',
  'Google Sign-In did not return an ID token.',
  'Apple Sign-In was cancelled.',
  'Apple Sign-In did not return an identity token.',
];

/** A spread of Firebase Auth codes: mapped, unmapped, and one that does not
 * exist yet, since a future SDK will invent some. */
export const SIGN_IN_SDK_CODES = [
  'auth/invalid-credential',
  'auth/too-many-requests',
  'auth/user-disabled',
  'auth/operation-not-allowed',
  'auth/internal-error',
  'auth/requires-recent-login',
  'auth/invalid-api-key',
  'auth/unknown-code-from-a-future-sdk',
];
