// firebaseConfig.test.ts -- regression coverage for the "signed in with
// Apple/Google natively, then Firebase: Error (auth/api-key-not-valid...)"
// bug: an EXPO_PUBLIC_FIREBASE_* var left unset (or blank) in .env silently
// bakes in a REPLACE_ME_* placeholder (or "") at transform time, which
// Firebase doesn't reject until a real sign-in's REST call. See firebase.ts's
// FirebaseConfigError, which calls findInvalidFirebaseConfigKeys() before any
// of that can happen.
//
// findInvalidFirebaseConfigKeys() takes `config` as a parameter (defaulting
// to firebaseConfig.ts's own env-derived object) specifically so these tests
// can exercise every combination with a plain object, rather than mutating
// process.env and re-requiring the module: babel-preset-expo inlines
// process.env.EXPO_PUBLIC_* at transform time, and Jest's transform cache
// means a re-require under a different process.env does not actually observe
// the new value the way a real rebuild would.
//
// This file deliberately does NOT jest.mock('expo-secure-store'). Every other
// auth suite does (via loginSimulation.harness), which is exactly why the two
// build-shaped guards at the bottom -- the Keychain accessibility class, and
// the iOS URL scheme -- have to live here: both compare a value in the source
// against a value that only the REAL module (or app.json) knows, and a mock
// stands in for precisely the thing being checked.
import * as SecureStore from 'expo-secure-store';
import { firebaseConfig, findInvalidFirebaseConfigKeys, findInvalidGoogleSignInKeys, GOOGLE_IOS_CLIENT_ID } from './firebaseConfig';
import { SECURE_STORE_OPTS } from './secureStoreKeys';

type Config = typeof firebaseConfig;

const REAL_CONFIG: Config = {
  apiKey: 'AIzaSyReal-Key-1234567890',
  authDomain: 'phonebox-d14b7.firebaseapp.com',
  projectId: 'phonebox-d14b7',
  storageBucket: 'phonebox-d14b7.appspot.com',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:ios:abcdef0123456789',
};

const ALL_EXPECTED_ENV_VARS = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
];

describe('findInvalidFirebaseConfigKeys', () => {
  it('flags every var when the config is all REPLACE_ME_* placeholders (fresh checkout, no .env)', () => {
    const placeholders: Config = {
      apiKey: 'REPLACE_ME_FIREBASE_API_KEY',
      authDomain: 'REPLACE_ME.firebaseapp.com',
      projectId: 'REPLACE_ME_PROJECT_ID',
      storageBucket: 'REPLACE_ME.appspot.com',
      messagingSenderId: 'REPLACE_ME_SENDER_ID',
      appId: 'REPLACE_ME_FIREBASE_APP_ID',
    };
    expect(findInvalidFirebaseConfigKeys(placeholders).sort()).toEqual([...ALL_EXPECTED_ENV_VARS].sort());
  });

  it('returns nothing once every field is a real-looking value', () => {
    expect(findInvalidFirebaseConfigKeys(REAL_CONFIG)).toEqual([]);
  });

  it('flags only the one field left as a placeholder', () => {
    expect(findInvalidFirebaseConfigKeys({ ...REAL_CONFIG, apiKey: 'REPLACE_ME_FIREBASE_API_KEY' })).toEqual([
      'EXPO_PUBLIC_FIREBASE_API_KEY',
    ]);
  });

  it('flags a field set to an empty string exactly like a placeholder one', () => {
    // Expo inlines EXPO_PUBLIC_* vars at transform time -- a blank .env line
    // (e.g. "EXPO_PUBLIC_FIREBASE_API_KEY=") bakes in "" verbatim, which the
    // `?? 'REPLACE_ME_...'` fallback in firebaseConfig.ts never catches
    // (`??` only falls back on null/undefined, not "").
    expect(findInvalidFirebaseConfigKeys({ ...REAL_CONFIG, apiKey: '' })).toEqual(['EXPO_PUBLIC_FIREBASE_API_KEY']);
  });

  it('defaults to this file\'s own env-derived firebaseConfig when called with no argument', () => {
    // Whatever this test run's actual env produces -- just proving the
    // default parameter wires up to the real export, not a hardcoded value.
    expect(findInvalidFirebaseConfigKeys()).toEqual(findInvalidFirebaseConfigKeys(firebaseConfig));
  });
});

// The same check for the two Google Sign-In client IDs, which the gate above
// deliberately does NOT cover.
//
// findInvalidFirebaseConfigKeys is what initFirebaseAuth() calls, and a
// non-empty result there fails ALL of auth. Folding these two in would mean a
// build that simply never configured Google could not sign in with Apple or
// email either -- so googleAuth.ts's ensureConfigured() calls this separately,
// at the point of use, and only the Google button fails.
//
// The gap this closes shipped: EAS uploads app/.env for the development
// profile only, so preview/production builds carried REPLACE_ME_* for every
// EXPO_PUBLIC_* var. The six Firebase ones were caught and reported as
// "Sign-in isn't configured on this build."; these two were checked nowhere,
// so a placeholder audience reached GoogleSignin.configure() intact and the
// only symptom was the native module's opaque DEVELOPER_ERROR.
describe('findInvalidGoogleSignInKeys', () => {
  const REAL_IDS = {
    webClientId: '123456789012-abcdef.apps.googleusercontent.com',
    iosClientId: '123456789012-ghijkl.apps.googleusercontent.com',
  };

  it('flags both ids on a fresh checkout with no .env', () => {
    expect(
      findInvalidGoogleSignInKeys({
        webClientId: 'REPLACE_ME_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com',
        iosClientId: 'REPLACE_ME_GOOGLE_IOS_CLIENT_ID.apps.googleusercontent.com',
      }).sort(),
    ).toEqual(['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID']);
  });

  it('returns nothing once both are real-looking values', () => {
    expect(findInvalidGoogleSignInKeys(REAL_IDS)).toEqual([]);
  });

  it('flags only the one that is still a placeholder', () => {
    expect(
      findInvalidGoogleSignInKeys({ ...REAL_IDS, webClientId: 'REPLACE_ME_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com' }),
    ).toEqual(['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID']);
  });

  it('flags a blank id exactly like a placeholder one', () => {
    // Same transform-time inlining trap firebaseConfig's own blank-value test
    // covers: "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=" bakes in "", which `??`
    // never falls back on.
    expect(findInvalidGoogleSignInKeys({ ...REAL_IDS, iosClientId: '' })).toEqual([
      'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
    ]);
  });

  it('does not affect the Firebase config gate, which must stay Google-agnostic', () => {
    // The whole point of the split: a config with every Firebase field real
    // still passes the gate that initFirebaseAuth() consults, regardless of
    // what the Google ids are, so Apple and email sign-in stay available.
    expect(findInvalidFirebaseConfigKeys(REAL_CONFIG)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The Keychain accessibility class
// ---------------------------------------------------------------------------
//
// One field, in one object, that decides whether a signed-in user stays signed
// in -- and until this test existed, nothing asserted it. secureStoreKeys.ts
// is the only file in the app that names AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY.
//
// Why it matters more here than in most apps: app.json declares
// UIBackgroundModes ["bluetooth-central"] and PhoneBoxClient.ts sets
// restoreStateIdentifier, so iOS cold-launches this process in the background,
// screen off, to hand back a restored central. App.tsx runs the normal auth
// startup there. If the Keychain refuses that launch, the cost is not a failed
// read: secureStorePersistence._isAvailable() probes with a write, returns
// false, and @firebase/auth's PersistenceUserManager.create() drops to
// inMemoryPersistence for the life of the process. The user unlocks,
// foregrounds that SAME process, and is signed out -- and a fresh sign-in is
// then written to memory only, so they are signed out again next launch.
// WHEN_UNLOCKED makes that the outcome of every locked-screen launch;
// AFTER_FIRST_UNLOCK narrows it to the window between a reboot and the owner's
// first unlock.
describe('SECURE_STORE_OPTS.keychainAccessible', () => {
  it('is AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, the value a background launch can actually read', () => {
    expect(SECURE_STORE_OPTS.keychainAccessible).toBe(SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY);
  });

  it('is not WHEN_UNLOCKED_THIS_DEVICE_ONLY, which fails every locked-screen launch', () => {
    // Spelled out separately from the positive assertion because this is the
    // specific regression: the two constants differ by one word, and the wrong
    // one produces no error anywhere -- only "the app keeps signing me out".
    expect(SECURE_STORE_OPTS.keychainAccessible).not.toBe(SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY);
  });

  it('is set at all, so a mock that omits the constant cannot pass for the real one', () => {
    // `undefined` is what SecureStore treats as "use the platform default"
    // (WHEN_UNLOCKED), so an unset field is the same bug as the wrong field --
    // and it is what loginSimulation.harness's mock used to produce.
    expect(SECURE_STORE_OPTS.keychainAccessible).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The iOS URL scheme
// ---------------------------------------------------------------------------
//
// Google Sign-In returns to the app through a custom URL scheme that must be
// the iOS client id reversed. Two copies of that id exist and neither knows
// about the other: app.json hardcodes the scheme (it is consumed by the
// config plugin at prebuild, before any JS runs, so it cannot read an env
// var), while GOOGLE_IOS_CLIENT_ID comes from EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
// -- which on a real build is an EAS environment variable, editable from the
// dashboard by someone who will never see app.json.
//
// Rotate the client id there and the scheme silently stops matching. Nothing
// fails at build time: the native sheet opens, the user picks an account, and
// iOS has no registered handler for the callback, so the app is simply never
// returned to. There is no error to map and no message to show -- which is the
// one sign-in failure mode this codebase's error strings cannot describe.
//
// How much of that this suite can actually prove, honestly stated: Jest does
// not load app/.env (only the Expo CLI does), so GOOGLE_IOS_CLIENT_ID is the
// REPLACE_ME_* placeholder in every local run and a value-level comparison
// against it would pass vacuously. The shape check below therefore runs
// unconditionally and is the part that always has teeth; the equality check
// runs only where a real id is present in the environment -- a CI job with the
// EAS variables exported, or `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=... npx jest`.
// It is written to be skipped loudly (the shape check still covers the scheme)
// rather than to look like coverage that is not there.
describe('the Google iOS URL scheme in app.json', () => {
  const iosUrlScheme: unknown = require('../../app.json').expo.plugins.find(
    (p: unknown) => Array.isArray(p) && p[0] === '@react-native-google-signin/google-signin',
  )?.[1]?.iosUrlScheme;

  /** An id straight from the env, or null when only the placeholder is here. */
  const realIosClientId = (): string | null => {
    const fromEnv = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? GOOGLE_IOS_CLIENT_ID;
    const placeholder =
      findInvalidGoogleSignInKeys({ webClientId: 'x.apps.googleusercontent.com', iosClientId: fromEnv }).length > 0;
    return placeholder ? null : fromEnv;
  };

  it('is declared on the google-signin plugin, in reversed-domain form', () => {
    // The shape iOS needs: the client id's labels in reverse order. A
    // truncated, hand-edited or half-rotated scheme fails here even with no
    // real id to compare against.
    expect(iosUrlScheme).toEqual(expect.stringMatching(/^com\.googleusercontent\.apps\.\d+-[A-Za-z0-9]+$/));
  });

  it('carries no leftover placeholder', () => {
    expect(iosUrlScheme).not.toEqual(expect.stringContaining('REPLACE_ME'));
  });

  it('is the exact reverse of the iOS client id, wherever a real one is available', () => {
    const clientId = realIosClientId();
    if (clientId === null) {
      // Not silently passing: the scheme itself is still asserted above. This
      // branch only records that no real id was in scope to compare against.
      expect(GOOGLE_IOS_CLIENT_ID).toEqual(expect.stringContaining('REPLACE_ME'));
      return;
    }
    expect(iosUrlScheme).toBe(clientId.split('.').reverse().join('.'));
  });
});
