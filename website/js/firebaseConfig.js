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
  apiKey: 'REPLACE_ME_FIREBASE_API_KEY',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME_PROJECT_ID',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME_SENDER_ID',
  appId: 'REPLACE_ME_FIREBASE_APP_ID',
};

export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every((v) => !v.startsWith('REPLACE_ME'));
}
