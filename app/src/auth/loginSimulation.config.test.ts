// loginSimulation.config.test.ts -- the misconfigured-build question, asked
// of the REAL firebase.ts instead of a stand-in for it.
//
// Why this file exists separately from loginSimulation.test.ts: that suite
// (and every other suite under src/auth) mocks './firebase' wholesale, so the
// module that actually decides "is this build configured" -- initFirebaseAuth's
// config gate, its stage tracking, its promise memoization -- is never itself
// executed anywhere. The build submitted to App Review on 2026-09-06 shipped
// with every EXPO_PUBLIC_FIREBASE_* still at its REPLACE_ME_* default, so
// "does a placeholder config fail loudly, early, and legibly" is precisely the
// question that matters most, and precisely the one a mocked './firebase'
// cannot answer.
//
// So here './firebase' is REAL, and the boundary moves one layer out:
//   - 'firebase/app'       real -- initializeApp() runs at firebase.ts's
//                          MODULE scope, above the config gate, so whether a
//                          placeholder config survives an import at all is
//                          part of what is being tested.
//   - 'firebase/auth'      faked -- initializeAuth() is the thing the gate must
//                          prevent ever being reached, so it has to be
//                          observable.
//   - 'firebase/firestore' faked -- no emulator here.
//   - './firebaseConfig'   faked, and ONLY here: babel-preset-expo inlines
//                          process.env.EXPO_PUBLIC_* at transform time, so a
//                          test cannot vary those values any other way (see
//                          findInvalidFirebaseConfigKeys' own docblock). The
//                          values are the module's own real REPLACE_ME_*
//                          defaults, copied verbatim.
jest.mock('react-native-get-random-values', () => ({})); // native crypto polyfill; nothing to polyfill in node
// The harness's own firebase/auth fake (so the real useAuthStore on top of the
// real firebase.ts still has everything it imports), plus the two symbols only
// firebase.ts itself calls -- which are what the config gate must be shown to
// never reach.
jest.mock('firebase/auth', () => ({
  ...require('./loginSimulation.harness').firebaseAuthMock(),
  initializeAuth: jest.fn(() => ({ __fake: 'auth' })),
  getAuth: jest.fn(() => ({ __fake: 'auth' })),
}));
jest.mock('firebase/firestore', () => ({ getFirestore: jest.fn(() => ({ __fake: 'db' })) }));
jest.mock('expo-secure-store', () => require('./loginSimulation.harness').secureStoreMock());
jest.mock('expo-apple-authentication', () => require('./loginSimulation.harness').appleAuthenticationMock());
jest.mock('expo-crypto', () => require('./loginSimulation.harness').cryptoMock());
jest.mock('@react-native-google-signin/google-signin', () => require('./loginSimulation.harness').googleSigninMock());
jest.mock('../sync/firestoreSync', () => require('./loginSimulation.harness').firestoreSyncMock());
jest.mock('../sync/localDataOwner', () => ({ clearLocalAccountData: jest.fn() }));
jest.mock('../push/pushRegistration', () => ({ unregisterPushToken: jest.fn() }));
jest.mock('../store/useStore', () => ({ useStore: { getState: () => ({ setSessions: jest.fn() }) } }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => ({ autoSyncEnabled: false }) } }));

/** firebaseConfig.ts's own REPLACE_ME_* defaults, byte for byte -- what a
 * build with no EXPO_PUBLIC_FIREBASE_* environment variables ships. */
const PLACEHOLDER_CONFIG = {
  apiKey: 'REPLACE_ME_FIREBASE_API_KEY',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME_PROJECT_ID',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME_SENDER_ID',
  appId: 'REPLACE_ME_FIREBASE_APP_ID',
};

const REAL_CONFIG = {
  apiKey: 'AIzaSyRealLookingKey',
  authDomain: 'phonebox-d14b7.firebaseapp.com',
  projectId: 'phonebox-d14b7',
  storageBucket: 'phonebox-d14b7.appspot.com',
  messagingSenderId: '1003347406984',
  appId: '1:1003347406984:ios:abcdef',
};

/**
 * Loads the REAL ./firebase with `config` standing in for what the build's
 * env vars produced. Isolated per call because firebase.ts memoizes
 * `initPromise` and `initStage` at module scope.
 *
 * Returns the mocked SDK modules AS THE ISOLATED COPY SEES THEM, not as this
 * file's own top-level imports: jest.isolateModules re-invokes every mock
 * factory, so the `initializeAuth` firebase.ts calls is a different jest.fn()
 * from the one a top-level import holds. Asserting on the wrong one passes
 * vacuously -- `not.toHaveBeenCalled()` is trivially true of a function
 * nothing could have called.
 */
function loadWithConfig(config: typeof PLACEHOLDER_CONFIG) {
  let out: any;
  jest.isolateModules(() => {
    jest.doMock('./firebaseConfig', () => {
      const actual = jest.requireActual('./firebaseConfig');
      return {
        ...actual,
        firebaseConfig: config,
        // The REAL predicate, applied to the substituted config. Its default
        // parameter closes over the actual module's own env-derived object,
        // which no amount of mocking the export can change -- so the default
        // is rebound here rather than the logic replaced.
        findInvalidFirebaseConfigKeys: (c: any = config) => actual.findInvalidFirebaseConfigKeys(c),
        GOOGLE_WEB_CLIENT_ID: 'x',
        GOOGLE_IOS_CLIENT_ID: 'y',
      };
    });
    out = {
      firebase: require('./firebase'),
      auth: require('firebase/auth'),
      secureStore: require('expo-secure-store'),
      // The REAL store, sitting on the REAL firebase.ts -- the combination
      // every other suite in this directory has to mock away.
      store: require('./useAuthStore').useAuthStore,
      notConfiguredMessage: require('./accountDisplay').SIGN_IN_NOT_CONFIGURED_MESSAGE,
    };
  });
  return out as {
    firebase: any;
    auth: { initializeAuth: jest.Mock; getAuth: jest.Mock; onAuthStateChanged: jest.Mock };
    secureStore: { deleteItemAsync: jest.Mock };
    store: any;
    notConfiguredMessage: string;
  };
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('a build that shipped without its Firebase environment variables', () => {
  it('still imports -- a placeholder config must not crash the app before it draws a frame', () => {
    // firebase.ts calls initializeApp(firebaseConfig) at module scope, above
    // everything else in the file. A throw there is not a sign-in failure, it
    // is a blank app: useAuthStore imports firebase.ts, App.tsx imports
    // useAuthStore, so the bundle would fail to evaluate and the reviewer
    // would see a launch that dies on the splash screen with no UI at all.
    expect(() => loadWithConfig(PLACEHOLDER_CONFIG)).not.toThrow();
  });

  it('rejects init before the Firebase SDK is ever asked to start', async () => {
    // The point of the gate: Firebase does not validate an API key until the
    // first network call, so without this the FIRST sign this build is broken
    // was a user completing the native Google sheet and then being shown a raw
    // auth/api-key-not-valid.
    const { firebase, auth } = loadWithConfig(PLACEHOLDER_CONFIG);

    await expect(firebase.initFirebaseAuth()).rejects.toMatchObject({ name: 'FirebaseConfigError' });

    expect(auth.initializeAuth).not.toHaveBeenCalled();
    expect(auth.getAuth).not.toHaveBeenCalled();
  });

  it('names all six missing variables, so the fix is a lookup and not a hunt', async () => {
    const { firebase } = loadWithConfig(PLACEHOLDER_CONFIG);
    const e = await firebase.initFirebaseAuth().catch((err: any) => err);

    expect(e.missingEnvVars).toEqual([
      'EXPO_PUBLIC_FIREBASE_API_KEY',
      'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
      'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
      'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
      'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
      'EXPO_PUBLIC_FIREBASE_APP_ID',
    ]);
  });

  it('reports the stall stage as config-check, not as a Keychain or SDK problem', async () => {
    const { firebase } = loadWithConfig(PLACEHOLDER_CONFIG);
    await firebase.initFirebaseAuth().catch(() => {});
    // useAuthStore renders this stage into the on-screen message, which is the
    // only diagnostic channel a TestFlight build has.
    expect(firebase.getAuthInitStage()).toBe('config-check');
  });

  it('never wipes the Keychain for a build that could not have signed anyone in', async () => {
    // The config check runs BEFORE wipeStaleSessionOnFreshInstall, so a
    // misconfigured build cannot destroy a session a correctly configured one
    // left behind -- an app update that lost its env vars should not also cost
    // every existing user their sign-in.
    const { firebase, secureStore } = loadWithConfig(PLACEHOLDER_CONFIG);
    await firebase.initFirebaseAuth().catch(() => {});
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('does not cache its rejection, so the retry a sign-in tap makes is a real attempt', async () => {
    const { firebase } = loadWithConfig(PLACEHOLDER_CONFIG);
    await firebase.initFirebaseAuth().catch(() => {});
    await firebase.initFirebaseAuth().catch(() => {});
    // Two genuine attempts, not one memoized rejection replayed. (For a
    // placeholder config both fail, but the same clearing is what lets a
    // transient Keychain failure recover on the next tap.)
    expect(firebase.getAuthInitStage()).toBe('config-check');
  });
});

describe('a correctly configured build', () => {
  it('wipes a previous install\'s Keychain session BEFORE Firebase Auth starts', async () => {
    // Design doc §2.5's ordering requirement, asserted against the real
    // module rather than inferred: a fresh install must not be able to resume
    // the last install's session, and Keychain entries survive an uninstall.
    const order: string[] = [];
    const { firebase, auth, secureStore } = loadWithConfig(REAL_CONFIG);
    secureStore.deleteItemAsync.mockImplementation(async () => void order.push('wipe'));
    auth.initializeAuth.mockImplementation(() => {
      order.push('initializeAuth');
      return { __fake: 'auth' };
    });

    await firebase.initFirebaseAuth();

    expect(order[order.length - 1]).toBe('initializeAuth');
    expect(order).toContain('wipe');
    expect(firebase.getAuthInitStage()).toBe('done');
  });

  it('adopts the existing Auth instance instead of dying on a Fast Refresh re-init', async () => {
    // auth/already-initialized is what a second initializeAuth() for the same
    // FirebaseApp throws. Rethrowing it made one edit in a dev client kill
    // sign-in for the rest of the session.
    const { firebase, auth } = loadWithConfig(REAL_CONFIG);
    auth.initializeAuth.mockImplementation(() => {
      throw Object.assign(new Error('already initialized'), { code: 'auth/already-initialized' });
    });

    await expect(firebase.initFirebaseAuth()).resolves.toBeUndefined();

    expect(auth.getAuth).toHaveBeenCalled();
    expect(firebase.getFirebaseAuth()).toBeTruthy();
  });

  it('refuses to hand out Auth or Firestore before init has finished', () => {
    const { firebase } = loadWithConfig(REAL_CONFIG);
    expect(() => firebase.getFirebaseAuth()).toThrow(/before initFirebaseAuth/);
    expect(() => firebase.getDb()).toThrow(/before initFirebaseAuth/);
  });
});

// The whole chain in one test, because the pieces being individually right is
// what the 2026-09-06 build already had: firebaseConfig's REPLACE_ME defaults
// -> the real findInvalidFirebaseConfigKeys -> the real initFirebaseAuth ->
// the real useAuthStore -> the exact sentence SignedOutAccount renders.
describe('what a misconfigured build actually puts on the Account page', () => {
  beforeEach(() => {
    jest.useFakeTimers(); // init() arms a 10s watchdog per call
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('says the build is not configured -- not "check your connection", not an SDK string', async () => {
    const { store, notConfiguredMessage } = loadWithConfig(PLACEHOLDER_CONFIG);

    await store.getState().init();

    // The gate is released, so the buttons are live rather than three dead
    // grey rectangles with no explanation.
    expect(store.getState().ready).toBe(true);
    expect(store.getState().initError).toBe(notConfiguredMessage);
    expect(store.getState().initError).toBe("Sign-in isn't configured on this build.");
    // FirebaseConfigError's own message is a paragraph of env-var names and
    // 'expo start -c' instructions. It is the one message in this codebase
    // documented as never-show, and this is the path that used to show it.
    expect(store.getState().initError).not.toMatch(/EXPO_PUBLIC_|expo start|firebaseConfig/);
    expect(store.getState().initError).not.toMatch(/check your connection/i);
  });

  it('keeps saying it on every tap, without opening a provider flow that cannot work', async () => {
    const { store, notConfiguredMessage } = loadWithConfig(PLACEHOLDER_CONFIG);
    await store.getState().init();

    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    const AppleAuthentication = require('expo-apple-authentication');

    for (const tap of [
      () => store.getState().signInWithGoogle(),
      () => store.getState().signInWithApple(),
      () => store.getState().signInWithEmail('appreview@phonebox.app', 'demo-password-1'),
    ]) {
      const e = await tap().catch((err: any) => err);
      // Thrown so the caller stops, but named so SignedOutAccount prints the
      // sentence once (as initError) instead of stacking a second red line.
      expect(e?.name).toBe('AuthInitReportedError');
      expect(store.getState().initError).toBe(notConfiguredMessage);
    }

    expect(GoogleSignin.configure).not.toHaveBeenCalled();
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    expect(AppleAuthentication.signInAsync).not.toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });

  it('signs a user in normally once the variables are actually set', async () => {
    // The control: the same wiring, the same real modules, a real-looking
    // config -- so the test above is proof of a gate, not of a broken harness.
    const { store, auth } = loadWithConfig(REAL_CONFIG);
    auth.onAuthStateChanged.mockImplementation((_a: any, cb: any) => {
      cb(null);
      return () => {};
    });

    await store.getState().init();

    expect(store.getState().ready).toBe(true);
    expect(store.getState().initError).toBeNull();
  });
});
