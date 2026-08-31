// accountDisplay.test.ts -- unit tests for the Account page's pure display
// helpers. No mocks needed -- this module has no external dependencies,
// matching accountLinking.test.ts's "real logic, nothing to mock" shape for
// the pieces that don't touch 'firebase/auth' directly.
import {
  providerLabel,
  toProviderKinds,
  canUnlink,
  unlinkedProviders,
  formatRelative,
  formatShortDate,
  providerActionErrorMessage,
  signInErrorMessage,
  SIGN_IN_NOT_CONFIGURED_MESSAGE,
} from './accountDisplay';

describe('providerLabel', () => {
  it('maps known provider ids to their display labels', () => {
    expect(providerLabel('google.com')).toBe('Google');
    expect(providerLabel('apple.com')).toBe('Apple');
  });

  it('falls back to "Other" for an unrecognized id without throwing', () => {
    expect(providerLabel('facebook.com')).toBe('Other');
    expect(providerLabel('')).toBe('Other');
  });
});

describe('toProviderKinds', () => {
  it('narrows google.com/apple.com to their kinds', () => {
    expect(toProviderKinds(['google.com', 'apple.com'])).toEqual(['google', 'apple']);
  });

  it('drops unrecognized provider ids rather than throwing', () => {
    expect(toProviderKinds(['password', 'google.com', 'facebook.com'])).toEqual(['google']);
  });

  it('returns an empty array for no providers', () => {
    expect(toProviderKinds([])).toEqual([]);
  });
});

describe('canUnlink', () => {
  it('is false with zero or one linked provider', () => {
    expect(canUnlink([])).toBe(false);
    expect(canUnlink(['google.com'])).toBe(false);
  });

  it('is true with two or more linked providers', () => {
    expect(canUnlink(['google.com', 'apple.com'])).toBe(true);
    // Counts providers this app has no Link button for: an account with some
    // third method attached still has a way in after unlinking Google.
    expect(canUnlink(['google.com', 'password'])).toBe(true);
  });
});

describe('unlinkedProviders', () => {
  it('returns both providers when none are linked', () => {
    expect(unlinkedProviders([])).toEqual(['google', 'apple']);
  });

  it('returns only the missing provider when one is linked', () => {
    expect(unlinkedProviders(['google'])).toEqual(['apple']);
    expect(unlinkedProviders(['apple'])).toEqual(['google']);
  });

  it('returns an empty array when both are linked', () => {
    expect(unlinkedProviders(['google', 'apple'])).toEqual([]);
  });
});

describe('formatRelative', () => {
  it('formats sub-minute gaps as "just now"', () => {
    expect(formatRelative(Date.now())).toBe('just now');
  });

  it('formats minutes, hours, and days', () => {
    const now = Date.now();
    expect(formatRelative(now - 5 * 60_000)).toBe('5m ago');
    expect(formatRelative(now - 3 * 60 * 60_000)).toBe('3h ago');
    expect(formatRelative(now - 2 * 24 * 60 * 60_000)).toBe('2d ago');
  });
});

describe('formatShortDate', () => {
  it('formats a valid ISO string as a short local date', () => {
    // Noon UTC so this reads as Aug 12 across every realistic test-runner
    // timezone (only breaks for an offset beyond +/-12h, which doesn't exist).
    expect(formatShortDate('2026-08-12T12:00:00.000Z')).toBe('Aug 12, 2026');
  });

  it('returns null for null/empty/unparsable input instead of throwing', () => {
    expect(formatShortDate(null)).toBeNull();
    expect(formatShortDate('')).toBeNull();
    expect(formatShortDate('not a date')).toBeNull();
  });
});

describe('providerActionErrorMessage', () => {
  // What a real Firebase SDK rejection looks like: a `.code`, and a `.message`
  // that is developer-facing whatever the code is.
  const sdk = (code: string) => ({ code, message: `Firebase: Error (${code}).` });

  it('maps known link/unlink error codes to friendly, credential-free text', () => {
    expect(providerActionErrorMessage(sdk('auth/credential-already-in-use'), 'fallback')).toBe(
      'That account is already linked to a different sign-in.',
    );
    expect(providerActionErrorMessage(sdk('auth/email-already-in-use'), 'fallback')).toBe(
      'That account is already linked to a different sign-in.',
    );
    expect(providerActionErrorMessage(sdk('auth/provider-already-linked'), 'fallback')).toBe(
      'That sign-in method is already linked.',
    );
  });

  it('never renders a raw SDK message, whatever the code', () => {
    // The bug this signature exists to make impossible: SignInMethodsSection's
    // link handler passed `e.message` as the fallback, so any code outside the
    // three above put "Firebase: Error (...)" on the Account screen.
    for (const code of ['auth/network-request-failed', 'auth/internal-error', 'auth/weird-future-code']) {
      const shown = providerActionErrorMessage(sdk(code), 'Could not link account. Please try again.');
      expect(shown).not.toMatch(/Firebase:/);
      expect(shown).not.toMatch(code);
    }
  });

  it('reuses the shared table so a link failure reads like a sign-in failure', () => {
    expect(providerActionErrorMessage(sdk('auth/network-request-failed'), 'fallback')).toBe(
      'No connection. Check your network and try again.',
    );
    expect(providerActionErrorMessage(sdk('auth/too-many-requests'), 'fallback')).toBe(
      'Too many attempts. Try again later.',
    );
  });

  it('falls back to the caller-supplied message for an unrecognized code', () => {
    expect(providerActionErrorMessage(sdk('auth/weird-future-code'), 'fallback')).toBe('fallback');
  });

  it('returns null for a user-initiated cancel, so nothing is shown', () => {
    // googleAuth/appleAuth throw a plain Error (no `.code`) on cancel.
    expect(providerActionErrorMessage(new Error('Google Sign-In was cancelled.'), 'fallback')).toBeNull();
    expect(providerActionErrorMessage(new Error('Apple Sign-In was cancelled.'), 'fallback')).toBeNull();
  });

  it("shows this codebase's own thrown messages as-is, since they are already safe", () => {
    expect(providerActionErrorMessage(new Error('Cannot remove your only sign-in method.'), 'fallback')).toBe(
      'Cannot remove your only sign-in method.',
    );
  });

  it('falls back when there is no error object or no message at all', () => {
    expect(providerActionErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(providerActionErrorMessage(null, 'fallback')).toBe('fallback');
    expect(providerActionErrorMessage({ message: '' }, 'fallback')).toBe('fallback');
  });
});

describe('signInErrorMessage', () => {
  it('maps a raw Firebase API-key/config error to the same not-configured message, never the raw SDK string', () => {
    // The exact shape of the bug this covers: native Apple/Google sign-in
    // succeeds, then Firebase's own REST call rejects with this because the
    // app's Firebase config is missing/invalid.
    const raw = {
      code: 'auth/api-key-not-valid.-please-pass-a-valid-api-key.',
      message: 'Firebase: Error (auth/api-key-not-valid.-please-pass-a-valid-api-key.)',
    };
    expect(signInErrorMessage(raw)).toBe(SIGN_IN_NOT_CONFIGURED_MESSAGE);
    expect(signInErrorMessage({ code: 'auth/invalid-api-key', message: 'Firebase: Error (auth/invalid-api-key)' })).toBe(
      SIGN_IN_NOT_CONFIGURED_MESSAGE,
    );
    expect(
      signInErrorMessage({ code: 'auth/configuration-not-found', message: 'Firebase: Error (auth/configuration-not-found)' }),
    ).toBe(SIGN_IN_NOT_CONFIGURED_MESSAGE);
  });

  it('maps firebase.ts\'s FirebaseConfigError (thrown before any Firebase SDK call) to the same message', () => {
    // No `.code` here -- assertFirebaseConfigValid() throws this before
    // initializeAuth() ever runs, so it's caught by name, not code.
    expect(signInErrorMessage({ name: 'FirebaseConfigError', message: 'Firebase config is missing/invalid for: EXPO_PUBLIC_FIREBASE_API_KEY.' })).toBe(
      SIGN_IN_NOT_CONFIGURED_MESSAGE,
    );
  });

  it('maps other known Firebase Auth codes to short, human-readable text', () => {
    expect(signInErrorMessage({ code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' })).toBe(
      'No connection. Check your network and try again.',
    );
    expect(signInErrorMessage({ code: 'auth/too-many-requests', message: 'Firebase: Error (auth/too-many-requests).' })).toBe(
      'Too many attempts. Try again later.',
    );
  });

  it('falls back to one generic message for an unmapped Firebase SDK error, never its raw string', () => {
    expect(signInErrorMessage({ code: 'auth/internal-error', message: 'Firebase: Error (auth/internal-error).' })).toBe(
      'Could not sign in. Please try again.',
    );
  });

  it('shows this codebase\'s own thrown (non-Firebase) error messages as-is -- already static and credential-free', () => {
    expect(signInErrorMessage({ message: 'Apple Sign-In did not return an identity token.' })).toBe(
      'Apple Sign-In did not return an identity token.',
    );
  });

  it('returns null (show nothing) for a user-initiated cancel', () => {
    expect(signInErrorMessage({ message: 'Apple Sign-In was cancelled.' })).toBeNull();
    expect(signInErrorMessage({ message: 'Google Sign-In was cancelled.' })).toBeNull();
  });

  it('returns null (show nothing) for AccountExistsError -- pendingLink already carries its prompt', () => {
    expect(signInErrorMessage({ name: 'AccountExistsError', message: 'An account already exists for this email.' })).toBeNull();
  });

  it('returns null for no error', () => {
    expect(signInErrorMessage(null)).toBeNull();
    expect(signInErrorMessage(undefined)).toBeNull();
  });
});
