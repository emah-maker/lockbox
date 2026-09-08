// firebase.ts -- Firebase app/Auth/Firestore initialization. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §1-2.
//
// initFirebaseAuth() enforces the §2.5 ordering requirement itself:
// wipeStaleSessionOnFreshInstall() always runs, and completes, before
// initializeAuth() is called -- so a stale Keychain session from a prior
// install can never be read by Firebase Auth's own startup. Call it once, as
// early as possible (App.tsx's init() effect, via useAuthStore.init()),
// before anything else touches auth or Firestore.
import 'react-native-get-random-values'; // polyfills crypto.getRandomValues for the firebase JS SDK on RN; must load before firebase/app
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { firebaseConfig, findInvalidFirebaseConfigKeys } from './firebaseConfig';
import { secureStorePersistence } from './secureStorePersistence';
import { wipeStaleSessionOnFreshInstall } from './wipeStaleSessionOnFreshInstall';

const app: FirebaseApp = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);

let auth: Auth | null = null;
let db: Firestore | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Thrown by initFirebaseAuth() before it ever touches the Firebase SDK, when
 * firebaseConfig.ts's required fields are missing/blank/still the
 * REPLACE_ME_* placeholder (see findInvalidFirebaseConfigKeys()). Without
 * this check, initializeApp()/initializeAuth() above accept a garbage
 * config silently -- Firebase doesn't validate the API key until the first
 * real network call, so the *first* sign the config is broken was a user
 * completing the native Google/Apple sheet and then seeing a raw
 * "Firebase: Error (auth/api-key-not-valid...)" on the Account page.
 * `missingEnvVars` names exactly which EXPO_PUBLIC_FIREBASE_* vars to set --
 * safe to log (env var names, not secrets) but this error's `.message`
 * must never be shown to the user as-is (see useAuthStore.ts/
 * accountDisplay.ts's signInErrorMessage, which map it to a generic,
 * user-facing string instead).
 */
export class FirebaseConfigError extends Error {
  constructor(public readonly missingEnvVars: string[]) {
    super(
      `Firebase config is missing/invalid for: ${missingEnvVars.join(', ')}. Set these in ` +
        `app/.env (see firebaseConfig.ts) and restart with 'expo start -c' -- EXPO_PUBLIC_* ` +
        `vars are inlined at build/transform time, so a stale build keeps the old value.`,
    );
    this.name = 'FirebaseConfigError';
  }
}

function assertFirebaseConfigValid(): void {
  const missingEnvVars = findInvalidFirebaseConfigKeys();
  if (missingEnvVars.length > 0) {
    throw new FirebaseConfigError(missingEnvVars);
  }
}

/**
 * Which step of initFirebaseAuth() is currently outstanding. Exists purely so
 * useAuthStore's watchdog can name the stalled step instead of reporting the
 * same generic "didn't start" for every cause. The distinction that actually
 * matters is 'done' vs anything else: reaching 'done' and STILL never getting
 * an onAuthStateChanged callback means the SDK's own initializeCurrentUser()
 * rejected internally (historically, the persistence adapter throwing -- see
 * secureStorePersistence.ts's _get), which is invisible from out here
 * otherwise because initializeAuth() itself resolves fine in that case.
 */
export type AuthInitStage = 'not-started' | 'config-check' | 'stale-session-wipe' | 'initialize-auth' | 'done';
let initStage: AuthInitStage = 'not-started';
export function getAuthInitStage(): AuthInitStage {
  return initStage;
}

/**
 * Wipes any stale pre-install Keychain session (§2.5), then initializes
 * Firebase Auth with the SecureStore-backed persistence adapter (§2.2).
 * Idempotent -- safe to call multiple times; only the first call does work,
 * later calls await the same in-flight/completed promise.
 */
export function initFirebaseAuth(): Promise<void> {
  if (!initPromise) {
    initPromise = Promise.resolve()
      .then(() => {
        initStage = 'config-check';
        assertFirebaseConfigValid(); // fail loudly here, not three steps later during sign-in
      })
      .then(() => {
        initStage = 'stale-session-wipe';
        return wipeStaleSessionOnFreshInstall();
      })
      .then(() => {
        initStage = 'initialize-auth';
        try {
          auth = initializeAuth(app, { persistence: secureStorePersistence });
        } catch (e: any) {
          // Fast Refresh re-evaluates this module, resetting `initPromise` and
          // `auth` to their initial values -- but the underlying FirebaseApp
          // survives, so the second initializeAuth() for it throws
          // auth/already-initialized. That instance is the one this very
          // module configured with secureStorePersistence, so adopting it via
          // getAuth() is exact, not a fallback to different behavior. Without
          // this, one edit in a dev client permanently killed sign-in for the
          // rest of the session (useAuthStore.init() never reached
          // onAuthStateChanged, so `ready` never flipped and both sign-in
          // buttons stayed disabled).
          if (e?.code !== 'auth/already-initialized') throw e;
          auth = getAuth(app);
        }
        db = getFirestore(app);
        initStage = 'done';
      })
      .catch((e) => {
        // Never leave a rejected promise cached: `initPromise` is the only
        // memo here, so holding a rejected one made a single transient
        // failure (a SecureStore/AsyncStorage hiccup in the wipe step above)
        // permanent for the whole app session, with no retry path. Clearing
        // it lets the next caller genuinely try again.
        initPromise = null;
        throw e;
      });
  }
  return initPromise;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    throw new Error('Firebase Auth accessed before initFirebaseAuth() completed.');
  }
  return auth;
}

export function getDb(): Firestore {
  if (!db) {
    throw new Error('Firestore accessed before initFirebaseAuth() completed.');
  }
  return db;
}
