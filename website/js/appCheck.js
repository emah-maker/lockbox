/* =========================================================================
   appCheck.js -- Firebase App Check (reCAPTCHA v3 provider), wired in right
   after initializeApp on every entry point that talks to Firestore/Auth
   (login.js, dashboard.js).

   Why this exists: app/firestore.rules' `waitlist/{docId}` rule (see its own
   header comment) is this site's only unauthenticated write path. The
   create-only rule plus deriving the doc ID from a hash of the email caps
   DUPLICATE signups -- a repeat write
   becomes an `update`, which the rule denies -- but nothing in Firestore
   rules alone caps DISTINCT addresses. A script calling the Firestore REST
   API directly with random doc IDs and made-up emails can still write as
   many waitlist docs as it wants; it never has to go through any
   client-side validation at all. App Check is the primary
   defence against exactly that: it makes Firestore reject any write that
   doesn't carry a token proving the request came from this site running in
   a real, unautomated browser, which a script-against-the-REST-API
   attacker can't forge without also passing a live reCAPTCHA challenge. The
   waitlist rule's `update`-denial stays in place as the backstop for the
   *duplicate* case specifically (see that rule's own comment) -- App Check
   is what closes the *distinct-address* gap that denial was never meant to
   cover.

   -------------------------------------------------------------------------
   ACTIVATION IS NOT DONE YET. This ships disabled by default because the
   reCAPTCHA v3 site key below does not exist yet -- creating it is console
   work (Firebase console -> Build -> App Check -> register this web app ->
   reCAPTCHA v3 provider -> copy the site key here) that only the project
   owner can do, and it isn't something this repo can do for itself. Turning
   App Check on in code before that console registration exists would start
   attaching invalid/absent tokens to every request and could break sign-in
   for every visitor, with no way to fix it from this repo alone. So:
     - RECAPTCHA_SITE_KEY defaults to '' below. The ONLY code change needed
       once the owner has registered the site and has a real site key in
       hand is filling in that one constant -- nothing else in this file.
     - Site keys (unlike the matching SECRET key, which must never appear in
       this repo) are meant to be public -- they ship in page HTML/JS on
       every site that uses reCAPTCHA, the same way the Firebase apiKey in
       firebaseConfig.js is public rather than a credential.
     - While the key is empty, initAppCheck is a no-op (one console.warn,
       then return) -- every caller keeps working exactly as it does today,
       with no App Check protection, same as before this file existed.
   ========================================================================= */

// Fill in once the owner has created a reCAPTCHA v3 provider for this site
// under Firebase console -> Build -> App Check -> Apps -> (this web app) --
// see the header comment above for why this starts empty and why that's
// the only line that should change.
const RECAPTCHA_SITE_KEY = '';

/**
 * Initializes App Check for an already-initialized Firebase `app`, using a
 * reCAPTCHA v3 provider. Callers must call this right after initializeApp()
 * and before any Firestore/Auth call on that app -- App Check hooks its
 * token-fetching into the SDK's request pipeline at init time, so a
 * Firestore/Auth call issued before this resolves would go out unprotected
 * (and once real enforcement is on in the Firebase console, could simply
 * fail).
 *
 * Never throws. When the site key isn't set yet (see header) or the CDN
 * import/initializeAppCheck call fails for any other reason -- offline, the
 * reCAPTCHA script blocked by an ad/tracker blocker -- this logs a warning
 * and returns instead, so a problem here degrades to "no App Check" rather
 * than surfacing through login.js's/dashboard.js's own
 * `init().catch(showError)` as the page's generic error state.
 */
export async function initAppCheck(app) {
  if (!RECAPTCHA_SITE_KEY) {
    // Expected today -- see the header comment. Not an error: every caller
    // is written to keep working with App Check absent.
    console.warn('[appCheck] RECAPTCHA_SITE_KEY not set -- App Check disabled, see appCheck.js header');
    return;
  }
  try {
    const mod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js');
    mod.initializeAppCheck(app, {
      provider: new mod.ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      // Refreshes the token behind the scenes before it expires, so a
      // long-lived tab (the dashboard, left open for a while) doesn't start
      // failing writes/reads mid-session just because its first token aged
      // out.
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // Same philosophy as firebaseConfig.js's loadFirebaseConfigOrNull: a
    // missing protection layer degrades to today's behavior (no App Check)
    // rather than breaking the page.
    console.warn('[appCheck] initialization failed, continuing without App Check:', err && err.message ? err.message : err);
  }
}
