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
import { firebaseConfig, findInvalidFirebaseConfigKeys, findInvalidGoogleSignInKeys } from './firebaseConfig';

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
