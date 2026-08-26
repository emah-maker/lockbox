/* =========================================================================
   firebaseConfig.js -- Firebase Web config for the focus dashboard
   (dashboard.html). Mirrors app/src/auth/firebaseConfig.ts's placeholders:
   these identify the Firebase project and aren't secrets in the usual sense
   (access control lives in app/firestore.rules, not here) -- but every
   REPLACE_ME below is a placeholder. A human must paste in the same
   project's values from the Firebase console (Project settings -> Your apps
   -> Web app) before sign-in works. Use the *same* Firebase project the app
   is configured against so a signed-in user sees the sessions their app
   already synced.
   ========================================================================= */

export const firebaseConfig = {
  apiKey: 'REDACTED_FIREBASE_WEB_API_KEY',
  authDomain: 'phonebox-d14b7.firebaseapp.com',
  projectId: 'phonebox-d14b7',
  storageBucket: 'phonebox-d14b7.firebasestorage.app',
  messagingSenderId: '1003347406984',
  appId: '1:1003347406984:web:0ebbe4dae8fc61dd65ef3d',
};

export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every((v) => !v.startsWith('REPLACE_ME'));
}
