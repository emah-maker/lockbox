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

// Which EXPO_PUBLIC_* env var backs each firebaseConfig field -- the only
// thing findInvalidFirebaseConfigKeys() (below) needs beyond the REPLACE_ME_*
// defaults above to name exactly what's missing.
const FIREBASE_CONFIG_ENV_VARS: Record<keyof typeof firebaseConfig, string> = {
  apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
};

/** A blank string (an EXPO_PUBLIC_* var set to "" in .env, which Expo still
 * inlines as-is rather than treating as unset) or one of the REPLACE_ME_*
 * literals above -- either way, not a real value Firebase could ever accept. */
function isPlaceholderValue(value: string): boolean {
  return !value || value.startsWith('REPLACE_ME');
}

/**
 * Returns the EXPO_PUBLIC_FIREBASE_* env var names that are missing, blank,
 * or still this file's REPLACE_ME_* placeholder -- i.e. Firebase Auth cannot
 * possibly succeed with the current config. Pure and side-effect-free so
 * firebase.ts's init boundary (see initFirebaseAuth's config check) can call
 * it directly, instead of only finding out when a sign-in attempt's REST
 * call comes back with an opaque auth/api-key-not-valid.
 *
 * Takes `config` as a parameter (defaulting to this file's own
 * `firebaseConfig`, read from `process.env.EXPO_PUBLIC_FIREBASE_*` above)
 * rather than reading `firebaseConfig` directly, so this file's tests can
 * exercise every combination of set/missing/blank values with a plain
 * object -- babel-preset-expo inlines `process.env.EXPO_PUBLIC_*` at
 * transform time (cached per source file), so re-requiring this module
 * under a mutated `process.env` inside a test does not actually pick up the
 * new value the way it would in a real per-build .env change.
 */
export function findInvalidFirebaseConfigKeys(config: typeof firebaseConfig = firebaseConfig): string[] {
  return (Object.keys(FIREBASE_CONFIG_ENV_VARS) as (keyof typeof firebaseConfig)[])
    .filter((key) => isPlaceholderValue(config[key]))
    .map((key) => FIREBASE_CONFIG_ENV_VARS[key]);
}

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

/**
 * findInvalidFirebaseConfigKeys' counterpart for the two Google Sign-In
 * client IDs above -- deliberately a SEPARATE function rather than more keys
 * in that one.
 *
 * initFirebaseAuth()'s config gate calls findInvalidFirebaseConfigKeys and
 * fails ALL of auth when it returns anything, which is right for the six
 * firebaseConfig fields (nothing signs in without them) and wrong for these
 * two: Apple and email/password sign-in work perfectly on a build that never
 * configured Google, so folding these in would take down two working
 * providers over a third one's missing var. googleAuth.ts's ensureConfigured
 * calls this instead, at the point of use, so only the Google button fails.
 *
 * That gap is not hypothetical: preview and production builds shipped with
 * every EXPO_PUBLIC_* still at its REPLACE_ME_* default until 2026-09-13.
 * Note the cause, because the obvious guess is wrong -- app/.env DOES reach
 * the builder (the repo-root .easignore re-includes /app for exactly this
 * reason, and `eas build:inspect --stage archive` shows the file in the
 * upload). What decides the value is the EAS *environment* a build profile
 * maps to, and `production`/`preview` had no variables in them at all while
 * `development` did. app/eas.json now names an environment on every profile
 * so that mapping cannot regress silently. The six Firebase ones were
 * caught by the gate and reported as "Sign-in isn't configured on this
 * build."; these two were not checked anywhere, so once the Firebase vars
 * were fixed a placeholder audience here reached GoogleSignin.configure()
 * intact and surfaced only as the native module's opaque DEVELOPER_ERROR.
 *
 * Takes `ids` as a parameter for the same reason findInvalidFirebaseConfigKeys
 * does -- see its docblock on babel-preset-expo's transform-time inlining.
 */
export function findInvalidGoogleSignInKeys(
  ids: { webClientId: string; iosClientId: string } = {
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
  },
): string[] {
  const missing: string[] = [];
  if (isPlaceholderValue(ids.webClientId)) missing.push('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  if (isPlaceholderValue(ids.iosClientId)) missing.push('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
  return missing;
}
