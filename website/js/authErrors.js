/* =========================================================================
   authErrors.js -- plain-language copy for the Firebase Auth/Firestore
   error codes login.html and dashboard.html can hit, shared so a visitor
   never sees raw SDK text like "Firebase: Error (auth/popup-closed-by-user)."
   on either page.

   Every message still carries the raw code in parentheses. This is a
   single-operator dashboard, not a consumer funnel: the codes below are
   the difference between "the network hiccuped, retry" and "a provider
   isn't enabled in the Firebase console", and a bare "Something went
   wrong" makes a report from the browser unactionable. logAuthError()
   also dumps the whole error object to the console for the same reason.
   ========================================================================= */

const MESSAGES = {
  // --- Firebase Auth (login.html) ---
  'auth/network-request-failed': 'Couldn’t reach the sign-in provider -- check your connection, and whether an ad/tracker blocker or VPN is blocking identitytoolkit.googleapis.com.',
  'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups for this site and try again.',
  'auth/unauthorized-domain': 'This page’s domain isn’t on the Firebase project’s authorized-domains list (Firebase console → Authentication → Settings → Authorized domains). Sign-in only works from localhost or the project’s own hosting domains -- opening the file directly with a file:// URL will always fail.',
  'auth/operation-not-allowed': 'That sign-in provider isn’t enabled for this Firebase project (Firebase console → Authentication → Sign-in method).',
  'auth/web-storage-unsupported': 'Your browser is blocking the storage this sign-in needs. Turn off strict tracking protection for this site, or leave private browsing, and try again.',
  'auth/too-many-requests': 'Too many attempts from this device. Wait a few minutes and try again.',
  'auth/internal-error': 'The sign-in provider returned an internal error. Try again -- if it repeats, check that the Google provider has a support email set in the Firebase console.',

  // --- Firestore (dashboard.html) ---
  'permission-denied': 'Your account doesn’t have access to this data. If this is your own account, the Firestore rules in app/firestore.rules may not be deployed yet -- run `firebase deploy --only firestore:rules`.',
  unauthenticated: 'Your sign-in expired before the data loaded. Reload the page to sign in again.',
  unavailable: 'Couldn’t reach the server -- check your connection, and whether an ad/tracker blocker, VPN, or network firewall is blocking firestore.googleapis.com.',
  'failed-precondition': 'Firestore needs an index this query doesn’t have yet. Open the console link in this browser’s developer console to create it, or run `firebase deploy --only firestore:indexes`.',
  timeout: 'This is taking too long. Make sure Firestore Database is created for this project (Firebase console → Build → Firestore Database) and that nothing is blocking requests to firestore.googleapis.com.',
};

// User-initiated popup dismissals aren't failures worth an error screen.
const IGNORED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

export function isIgnorableAuthError(err) {
  return !!(err && IGNORED_CODES.has(err.code));
}

export function friendlyErrorMessage(err) {
  const code = err && err.code;
  const base = MESSAGES[code] || 'Something went wrong. Please try again.';
  // The code is what makes a screenshot of this screen diagnosable -- without
  // it every unmapped failure looks identical to every other one.
  return code ? `${base} (${code})` : base;
}

/* Companion to friendlyErrorMessage: the on-screen copy is deliberately
   short, so put the untruncated error somewhere a developer can actually
   read it. Called on the same paths that render an error state. */
export function logAuthError(context, err) {
  const code = (err && err.code) || 'no-code';
  console.error(`[phonebox] ${context} failed: ${code}`, err);
}
