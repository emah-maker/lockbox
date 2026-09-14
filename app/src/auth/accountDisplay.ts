// accountDisplay.ts -- pure, UI-agnostic helpers for the Account page (spec
// §1 sign-in method status, §2 sync caption): provider-id -> display label
// mapping, relative/short-date formatting, and unlink eligibility. Kept
// dependency-free (no Firebase/React imports) so these are trivially
// unit-testable and shareable between useAuthStore.ts (which needs
// toProviderKinds for AccountUser.linkedProviders and the
// signOut/deleteAccount provider-branching that already existed) and the
// screens/account/*.tsx components that render them.
import type { AuthProviderKind } from './accountLinking';

/** Maps a raw Firebase providerId to the chip label spec §1 asks for. Never
 * throws on an unrecognized id -- Firebase's providerData could in
 * principle include a provider this app doesn't otherwise support, and
 * silently mislabeling it as "Other" is far safer than crashing the Account
 * page over it. */
export function providerLabel(providerId: string): string {
  if (providerId === 'google.com') return 'Google';
  if (providerId === 'apple.com') return 'Apple';
  // Firebase's raw id for email/password is the literal string 'password'
  // (EmailAuthProvider.PROVIDER_ID) -- NOT 'password.com'. Unlike the two
  // OAuth providers above, it was never assigned a dotted reverse-domain id.
  if (providerId === 'password') return 'Email';
  return 'Other';
}

/** Narrows raw providerData ids to the three providers this app's link/unlink
 * actions actually understand, in the same shape useAuthStore.ts's
 * AccountUser.linkedProviders and internal linkedProviders(user) both need.
 * Promoted out of useAuthStore.ts (which used to inline this exact filter
 * +map) so both call sites -- and this module's own unlinkedProviders/
 * canUnlink below -- share one definition instead of drifting apart. */
export function toProviderKinds(providerIds: string[]): AuthProviderKind[] {
  return providerIds
    .filter((id): id is 'google.com' | 'apple.com' | 'password' => id === 'google.com' || id === 'apple.com' || id === 'password')
    .map((id) => (id === 'google.com' ? 'google' : id === 'apple.com' ? 'apple' : 'password'));
}

/** §1's "never leave an account with zero sign-in methods" rule: unlinking a
 * provider is only permitted when at least one other provider would remain
 * linked afterward.
 *
 * Takes RAW provider ids, deliberately not the toProviderKinds()-narrowed
 * list: the question "would this account still have a way to sign in?" is
 * about everything Firebase actually has linked, not just the three providers
 * this app's own Link buttons understand. Counting the narrowed list would
 * wrongly refuse a legitimate unlink for an account that also has some other
 * method attached (it would see 2 where Firebase has 3) -- unreachable while
 * Google, Apple, and email/password are the only providers enabled, but wrong
 * the moment a fourth is, and it would put this out of step with the
 * website's own account panel, which counts user.providerData directly. */
export function canUnlink(providerIds: string[]): boolean {
  return providerIds.length >= 2;
}

/** Providers NOT currently linked, in a fixed (Google, Apple, Email) order --
 * what §1's "Not linked yet" affordance offers a Link action for. Callers
 * still need to separately gate Apple on
 * AppleAuthentication.isAvailableAsync() (§1) -- that's a platform/runtime
 * check, not a pure function of `linked`, so it deliberately doesn't live
 * here. Email/password has no equivalent runtime gate -- it's always offered. */
export function unlinkedProviders(linked: AuthProviderKind[]): AuthProviderKind[] {
  const all: AuthProviderKind[] = ['google', 'apple', 'password'];
  return all.filter((p) => !linked.includes(p));
}

/** "5m ago" / "3h ago" / "2d ago" -- the small non-blocking sync caption §2
 * asks for. Moved here from the old AccountSection.tsx (byte-for-byte)
 * so it's covered by this module's own tests instead of living untested
 * inline in a UI file. */
export function formatRelative(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Short local date ("Aug 12, 2026") for the account-created/last-sign-in
 * fields §1 asks for. Returns null (never throws) for a missing or
 * unparsable timestamp -- Firebase's user.metadata.creationTime/
 * lastSignInTime are untyped date strings from the server, not guaranteed
 * to be present or well-formed on every provider/SDK version. */
export function formatShortDate(isoString: string | null): string | null {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Friendly, credential-free text for a failed link/unlink action -- the
 * already-signed-in counterpart to signInErrorMessage below, and it follows
 * that function's rules exactly rather than a looser set of its own.
 *
 * Takes the ERROR, not `(code, fallback)`. That earlier signature made the
 * caller decide when `e.message` was safe to pass as the fallback, and one
 * of the two call sites got it wrong: SignInMethodsSection's link handler
 * passed `e.message` itself, so every code outside the three below rendered
 * the raw SDK string ("Firebase: Error (auth/network-request-failed).")
 * straight into the Account screen -- the exact thing design doc §5
 * checklist item 3 forbids, arrived at by way of the helper that exists to
 * prevent it. Only this function can safely judge that, because the judgement
 * depends on whether `.code` is set, so only this function is asked to.
 *
 * Returns null for "show nothing": a user-initiated cancel, which
 * googleAuth/appleAuth throw as a plain Error whose message contains
 * "cancel" -- same convention, and same null return, as signInErrorMessage.
 */
export function providerActionErrorMessage(
  e: { code?: string; name?: string; message?: string } | null | undefined,
  fallback: string,
): string | null {
  const message = typeof e?.message === 'string' ? e.message : '';
  if (/cancel/i.test(message)) return null;
  // Before the no-`.code` fallthrough at the bottom, which would otherwise
  // render this error's `message` -- the one message in this codebase
  // explicitly documented as never-show (firebase.ts's FirebaseConfigError:
  // a paragraph of env-var names and 'expo start -c' instructions). It
  // reaches here via linkProvider('google') -> googleAuth.ts's
  // ensureConfigured, which throws it when the Google client IDs are still
  // placeholders. Same name-based branch signInErrorMessage below already has.
  if (e?.name === 'FirebaseConfigError') return SIGN_IN_NOT_CONFIGURED_MESSAGE;

  const code = e?.code;
  if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
    return 'That account is already linked to a different sign-in.';
  }
  if (code === 'auth/provider-already-linked') {
    return 'That sign-in method is already linked.';
  }
  if (code) {
    // A real Firebase SDK error. Its `.message` is developer-facing whatever
    // the code, so it is never rendered -- the shared table first (a link
    // dropping the network deserves the same "No connection" wording a
    // sign-in gets, rather than a vaguer one just because it came from a
    // different screen), then the caller's own generic line.
    return SIGN_IN_ERROR_MESSAGES[code] ?? fallback;
  }
  // No `.code`: one of this codebase's own thrown Errors, whose message is
  // already a static, credential-free string safe to show -- the same
  // reasoning signInErrorMessage's final branch gives.
  return message || fallback;
}

/** Shared by signInErrorMessage below and useAuthStore.ts's init()/
 * requireFirebaseAuth() -- both need the same user-facing text for a
 * FirebaseConfigError (firebase.ts), which is a build/deploy problem, not
 * something a user's connection or retry can fix, so it deliberately doesn't
 * share AUTH_INIT_ERROR's "check your connection" wording. */
export const SIGN_IN_NOT_CONFIGURED_MESSAGE = "Sign-in isn't configured on this build.";

/** Known Firebase Auth SDK error codes -> short, human-readable,
 * credential-free text, for signInErrorMessage below. Anything not listed
 * here falls back to one generic message rather than the raw SDK string
 * (design doc §5 checklist item 3). */
const SIGN_IN_ERROR_MESSAGES: Record<string, string> = {
  'auth/network-request-failed': 'No connection. Check your network and try again.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/user-disabled': 'This account has been disabled.',
  // The provider is switched off in Firebase console -> Authentication ->
  // Sign-in method. Named rather than left to the generic "Please try again",
  // which invites a user to retry something that cannot start working: this
  // is a console setting on a project only its operator can reach, and
  // website/js/authErrors.js already names it for the same reason.
  'auth/operation-not-allowed': "That sign-in method isn't enabled for this app yet.",
  // Email/password-specific codes (emailAuth.ts). This Firebase project has
  // Email Enumeration Protection enabled (see accountLinking.ts's header for
  // the same constraint on fetchSignInMethodsForEmail), which is why
  // invalid-credential's copy below is deliberately vague: it's what
  // signInWithEmailAndPassword returns for BOTH a wrong password and a
  // nonexistent account, on purpose, so this must never guess which --
  // matches website/js/authErrors.js's identical reasoning for the same code.
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with that email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-password': 'Enter your password.',
  // What Firebase's own REST call throws for a missing/invalid API key or a
  // project with Auth not configured -- exactly the bug this file's
  // FirebaseConfigError check (firebase.ts) exists to catch earlier, but a
  // key can also be invalid for a reason that check can't see (e.g. an API
  // key restricted in the Google Cloud console), so this stays as a second,
  // independent line of defense against ever rendering the raw SDK string.
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': SIGN_IN_NOT_CONFIGURED_MESSAGE,
  'auth/api-key-not-valid': SIGN_IN_NOT_CONFIGURED_MESSAGE,
  'auth/invalid-api-key': SIGN_IN_NOT_CONFIGURED_MESSAGE,
  'auth/configuration-not-found': SIGN_IN_NOT_CONFIGURED_MESSAGE,
};

/**
 * Maps a sign-in attempt's thrown error to short, human-readable,
 * credential-free text for SignedOutAccount's buttons -- the sign-in-time
 * counterpart to providerActionErrorMessage above (that one's for the
 * already-signed-in link/unlink actions). Callers must still log the
 * original error separately (e.name/e.code/e.message) for debugging; only
 * this function's return value is safe to render.
 *
 * Returns null for "don't show anything": a user-initiated cancel (appleAuth.ts/
 * googleAuth.ts throw a plain Error whose message contains "cancel", not a
 * Firebase SDK error with a `.code`), or AccountExistsError (accountLinking.ts) --
 * whose own generic prompt is already carried by `pendingLink`, so showing
 * this too would be a duplicate.
 */
export function signInErrorMessage(
  e: { code?: string; name?: string; message?: string } | null | undefined,
): string | null {
  if (!e) return null;
  if (e.name === 'AccountExistsError') return null;
  // useAuthStore.requireFirebaseAuth already wrote this exact sentence into
  // `initError`, which SignedOutAccount renders on its own line -- see that
  // function's comment. Returning the message here too printed it twice.
  if (e.name === 'AuthInitReportedError') return null;
  const message = typeof e.message === 'string' ? e.message : '';
  if (/cancel/i.test(message)) return null;
  if (e.name === 'FirebaseConfigError') return SIGN_IN_NOT_CONFIGURED_MESSAGE;
  if (e.code) {
    // A real Firebase Auth SDK error: e.message is a raw, developer-facing
    // string like "Firebase: Error (auth/xxx-yyy.)" -- never fit for the UI,
    // mapped or not.
    return SIGN_IN_ERROR_MESSAGES[e.code] ?? 'Could not sign in. Please try again.';
  }
  // No `.code` -- one of this codebase's own thrown Error messages
  // (appleAuth.ts/googleAuth.ts/accountLinking.ts), already a static,
  // credential-free string that's safe to show as-is.
  return message || 'Could not sign in. Please try again.';
}

/** Firestore (not Auth) error codes -> authored copy, for syncErrorMessage
 * below. Separate table from SIGN_IN_ERROR_MESSAGES because these are bare
 * codes off a FirestoreError ('permission-denied'), not Auth's 'auth/'-prefixed
 * ones, and they can't collide. Same three codes website/js/authErrors.js
 * carries -- worded for a phone rather than the operator's dashboard, which
 * can afford to print a `firebase deploy` command. */
const SYNC_ERROR_MESSAGES: Record<string, string> = {
  'permission-denied': "This account doesn't have access to its cloud data yet. Your stats are safe on this phone.",
  unauthenticated: 'Your sign-in expired before syncing. Sign out and back in to retry.',
  unavailable: "Couldn't reach the server. Your stats are safe on this phone and will sync later.",
};

/**
 * Authored, credential-free text for a failed syncNow() -- the sync-time
 * member of this file's error-mapping family (signInErrorMessage,
 * providerActionErrorMessage).
 *
 * useAuthStore.syncNow used to store `e.message` directly, and both
 * SyncStatusSection and SignedOutAccount render `syncError` verbatim, so the
 * Firestore SDK's own words went straight onto the Account page: "Missing or
 * insufficient permissions." for a rules change not yet deployed (this repo
 * has shipped that state before), "Failed to get document because the client
 * is offline." for no network. autoSyncEnabled defaults to true and the auth
 * listener fires syncNow() on sign-in, so that lands seconds after signing
 * in, where it reads as the sign-in itself having half-failed.
 *
 * Deliberately never returns null: unlike a cancelled sign-in there is no
 * "the user did this on purpose" case here -- a sync either worked or it
 * didn't, and the caller's slot is a status line, not a transient alert.
 */
export function syncErrorMessage(e: { code?: string; message?: string } | null | undefined): string {
  const code = e?.code;
  return (code && SYNC_ERROR_MESSAGES[code]) || SYNC_FAILED_MESSAGE;
}

/** The fallback, and -- unlike signInErrorMessage/providerActionErrorMessage,
 * which pass an uncoded error's `message` through as "one of our own static
 * strings" -- the answer for EVERY unrecognized error here, coded or not.
 * That passthrough is safe for those two because this codebase really does
 * throw authored Errors on the sign-in and link paths. It throws none on the
 * sync path: firestoreSync.ts's one own error (LocalDataSuperseded) is caught
 * and returns early, so anything uncoded arriving here is a JS runtime error,
 * and "undefined is not an object (evaluating 'd.settings')" is not a thing
 * to put in front of someone. */
const SYNC_FAILED_MESSAGE = 'Could not sync. Your stats are safe on this phone.';
