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
import { firebaseConfig, findInvalidFirebaseConfigKeys } from './firebaseConfig';

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
