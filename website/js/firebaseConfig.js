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

/**
 * How long to wait for that fetch before giving up and reporting "not
 * connected". Matches dashboardData.js's LOAD_TIMEOUT_MS deliberately -- the
 * Firestore reads downstream already got a 15s guard for the same class of
 * failure, and this fetch is the step BEFORE those, so a shorter or longer
 * budget here would just make the page's two stall behaviours inconsistent.
 *
 * Without any deadline, a request that is accepted and then never completes
 * (a hung proxy, a captive portal swallowing the connection) left both
 * pages permanently blank rather than merely slow. That is worse than it
 * sounds: every state div in dashboard.html and login.html starts `hidden`,
 * and init() awaits this call BEFORE its first showState(), so the page
 * never reached even the loading spinner. No spinner, no error, no retry
 * button -- an empty main region forever, with nothing on screen to
 * suggest the page was still trying.
 */
const CONFIG_TIMEOUT_MS = 15000;

// Cached across callers within a single page session -- dashboard.js and
// login.js are separate pages, so each starts with a fresh copy of this
// module and its own cache.
let configPromise = null;

/**
 * Fetches the config Hosting serves for this site. Rejects if the page isn't
 * being served by Firebase Hosting. Callers that render a "not connected"
 * state should prefer loadFirebaseConfigOrNull() below.
 */
export function loadFirebaseConfig() {
  if (!configPromise) {
    // An AbortController rather than a bare Promise.race against a timer:
    // racing settles the promise we return but leaves the request itself in
    // flight, still holding a connection and still due to be parsed into a
    // result nobody will read. Aborting actually cancels it. `timedOut`
    // distinguishes our own abort from any other fetch rejection so the
    // error below can say which happened.
    const controller = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CONFIG_TIMEOUT_MS);
    configPromise = fetch(INIT_JSON_PATH, { signal: controller.signal })
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
        // A timeout is exactly such a transient failure, so it is cached no
        // more than any other -- a retry issues a fresh request.
        configPromise = null;
        // Rewritten from the AbortError the abort above produces ("The
        // operation was aborted"), which names the mechanism rather than the
        // problem and would read as a bug in this page rather than a stalled
        // network. Tagged `code: 'timeout'` to match the convention
        // dashboardData.js's withTimeout already uses.
        if (timedOut) {
          throw Object.assign(
            new Error(`${INIT_JSON_PATH} did not respond within ${CONFIG_TIMEOUT_MS}ms`),
            { code: 'timeout' },
          );
        }
        throw err;
      })
      // Always, on both paths -- a success would otherwise leave a live 15s
      // timer holding an AbortController for a request that already
      // finished.
      .finally(() => clearTimeout(deadline));
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
