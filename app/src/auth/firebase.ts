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
import { initializeAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';
import { secureStorePersistence } from './secureStorePersistence';
import { wipeStaleSessionOnFreshInstall } from './wipeStaleSessionOnFreshInstall';

const app: FirebaseApp = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);

let auth: Auth | null = null;
let db: Firestore | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Wipes any stale pre-install Keychain session (§2.5), then initializes
 * Firebase Auth with the SecureStore-backed persistence adapter (§2.2).
 * Idempotent -- safe to call multiple times; only the first call does work,
 * later calls await the same in-flight/completed promise.
 */
export function initFirebaseAuth(): Promise<void> {
  if (!initPromise) {
    initPromise = wipeStaleSessionOnFreshInstall().then(() => {
      auth = initializeAuth(app, { persistence: secureStorePersistence });
      db = getFirestore(app);
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
