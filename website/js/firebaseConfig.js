/* =========================================================================
   firebaseConfig.js -- Firebase Web config for the focus dashboard, fetched
   from Firebase Hosting rather than committed here.

   Hosting serves the deployed site's own project config at the reserved
   /__/firebase/init.json path automatically -- no setup, and it tracks
   whatever project the site was deployed to, including preview channels. So
   the config lives nowhere in this repo, and there is no second copy to
   drift out of sync with app/.env the way the hardcoded one did.

   To be clear about what this does and doesn't buy: these values are not
   secrets and this does not make them private. Anyone can read
   /__/firebase/init.json, or just open devtools on the deployed site -- that
   is true of every browser Firebase app, and it is why the API key is an
   identifier rather than a credential. Access control lives entirely in
   app/firestore.rules. This only keeps the values out of version control.

   Trade-off: the site must be served BY Firebase Hosting (`firebase deploy`,
   a preview channel, or `firebase serve`/`firebase emulators:start` locally).
   Opening the HTML straight off disk, or from an unrelated static server,
   has no /__/firebase/init.json to fetch, so sign-in reports "not connected"
   instead of silently half-working.
   ========================================================================= */

/** Hosting's reserved auto-config path. Relative on purpose: it resolves
 * against whatever origin is serving the page, so live, preview channels and
 * `firebase serve` each get their own project's config with no branching. */
const INIT_JSON_PATH = '/__/firebase/init.json';

// Cached across callers: dashboard.js and login.js are separate pages, but
// script.js's waitlist form can ask more than once in a single page session.
let configPromise = null;

/**
 * Fetches the config Hosting serves for this site. Rejects if the page isn't
 * being served by Firebase Hosting. Callers that render a "not connected"
 * state should prefer loadFirebaseConfigOrNull() below.
 */
export function loadFirebaseConfig() {
  if (!configPromise) {
    configPromise = fetch(INIT_JSON_PATH)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`${INIT_JSON_PATH} returned ${res.status}`);
        }
        return res.json();
      })
      .then((config) => {
        // A stray SPA rewrite or a 200-serving 404 page would hand back HTML
        // or an empty object here; initializeApp would then fail much later
        // with something far less obvious than this.
        if (!config || !config.apiKey || !config.projectId) {
          throw new Error(`${INIT_JSON_PATH} did not contain a Firebase config`);
        }
        return config;
      })
      .catch((err) => {
        // Never cache a rejection: a transient network failure on first load
        // would otherwise block every retry for the rest of the page session.
        configPromise = null;
        throw err;
      });
  }
  return configPromise;
}

/**
 * Same, but resolves to `null` instead of rejecting -- for the pages that
 * answer a missing config with their own "isn't connected yet" state rather
 * than an error surface.
 */
export async function loadFirebaseConfigOrNull() {
  try {
    return await loadFirebaseConfig();
  } catch (err) {
    console.warn('[firebaseConfig] no Firebase config available:', err?.message ?? err);
    return null;
  }
}
