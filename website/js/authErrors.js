/* =========================================================================
   authErrors.js -- plain-language copy for the Firebase Auth/Firestore
   error codes login.html and dashboard.html can hit, shared so a visitor
   never sees raw SDK text like "Firebase: Error (auth/popup-closed-by-user)."
   on either page.
   ========================================================================= */

const MESSAGES = {
  'auth/network-request-failed': 'Couldn’t reach Google to sign you in -- check your connection and try again.',
  'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups for this site and try again.',
  'permission-denied': 'Your account doesn’t have access to this data.',
  unavailable: 'Couldn’t reach the server -- check your connection and try again.',
};

// User-initiated popup dismissals aren't failures worth an error screen.
const IGNORED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

export function isIgnorableAuthError(err) {
  return !!(err && IGNORED_CODES.has(err.code));
}

export function friendlyErrorMessage(err) {
  const code = err && err.code;
  return MESSAGES[code] || 'Something went wrong. Please try again.';
}
