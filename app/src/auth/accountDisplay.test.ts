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
  it('maps known link/unlink error codes to friendly, credential-free text', () => {
    expect(providerActionErrorMessage('auth/credential-already-in-use', 'fallback')).toBe(
      'That account is already linked to a different sign-in.',
    );
    expect(providerActionErrorMessage('auth/email-already-in-use', 'fallback')).toBe(
      'That account is already linked to a different sign-in.',
    );
    expect(providerActionErrorMessage('auth/provider-already-linked', 'fallback')).toBe(
      'That sign-in method is already linked.',
    );
  });

  it('falls back to the caller-supplied message for anything else', () => {
    expect(providerActionErrorMessage('auth/network-request-failed', 'fallback')).toBe('fallback');
    expect(providerActionErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
