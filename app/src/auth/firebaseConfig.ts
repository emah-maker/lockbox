// firebaseConfig.ts -- placeholder Firebase/Google project identifiers. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §7.2.
//
// These values identify the Firebase project and OAuth clients; they are not
// secrets in the way an API key for most other services would be -- access
// control lives entirely in firestore.rules (§3.2), not here (design doc §5
// checklist item 9). Still, none of the REPLACE_ME_* placeholders below are
// real: a human must fill these in from the actual Firebase/Google Cloud
// console (§7.2 steps 1-5) before this app can sign in against a real
// backend. Prefer setting the EXPO_PUBLIC_* env vars (Expo inlines
// EXPO_PUBLIC_-prefixed vars at build time) over editing this file directly,
// so real project identifiers don't need to be hand-edited into source.
export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'REPLACE_ME_FIREBASE_API_KEY',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'REPLACE_ME.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'REPLACE_ME_PROJECT_ID',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'REPLACE_ME.appspot.com',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? 'REPLACE_ME_SENDER_ID',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? 'REPLACE_ME_FIREBASE_APP_ID',
};

// The "Web client ID" Firebase auto-provisions when the Google provider is
// enabled (Authentication -> Sign-in method -> Google) -- GoogleSignin.configure()
// needs this on *both* platforms as the idToken audience Firebase expects.
// See design doc §7.2 step 2.
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? 'REPLACE_ME_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com';

// The iOS OAuth client ID from the Firebase iOS app registration. See design
// doc §7.2 step 3 (also note the *reversed* client ID needed for the config
// plugin's URL scheme -- a separate, human, manual step).
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? 'REPLACE_ME_GOOGLE_IOS_CLIENT_ID.apps.googleusercontent.com';
