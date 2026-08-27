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
  return 'Other';
}

/** Narrows raw providerData ids to the two providers this app's link/unlink
 * actions actually understand, in the same shape useAuthStore.ts's
 * AccountUser.linkedProviders and internal linkedProviders(user) both need.
 * Promoted out of useAuthStore.ts (which used to inline this exact filter
 * +map) so both call sites -- and this module's own unlinkedProviders/
 * canUnlink below -- share one definition instead of drifting apart. */
export function toProviderKinds(providerIds: string[]): AuthProviderKind[] {
  return providerIds
    .filter((id): id is 'google.com' | 'apple.com' => id === 'google.com' || id === 'apple.com')
    .map((id) => (id === 'google.com' ? 'google' : 'apple'));
}

/** §1's "never leave an account with zero sign-in methods" rule: unlinking a
 * provider is only permitted when at least one other provider would remain
 * linked afterward.
 *
 * Takes RAW provider ids, deliberately not the toProviderKinds()-narrowed
 * list: the question "would this account still have a way to sign in?" is
 * about everything Firebase actually has linked, not just the two providers
 * this app's own Link buttons understand. Counting the narrowed list would
 * wrongly refuse a legitimate unlink for an account that also has some third
 * method attached (it would see 1 where Firebase has 2) -- unreachable while
 * Google and Apple are the only providers enabled, but wrong the moment a
 * third is, and it would put this out of step with the website's own account
 * panel, which counts user.providerData directly. */
export function canUnlink(providerIds: string[]): boolean {
  return providerIds.length >= 2;
}

/** Providers NOT currently linked, in a fixed (Google, Apple) order -- what
 * §1's "Not linked yet" affordance offers a Link action for. Callers still
 * need to separately gate Apple on AppleAuthentication.isAvailableAsync()
 * (§1) -- that's a platform/runtime check, not a pure function of `linked`,
 * so it deliberately doesn't live here. */
export function unlinkedProviders(linked: AuthProviderKind[]): AuthProviderKind[] {
  const all: AuthProviderKind[] = ['google', 'apple'];
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

/** Friendly, credential-free text for the link/unlink error codes Firebase
 * can throw (auth/credential-already-in-use when the credential is already
 * tied to a different Firebase user, auth/provider-already-linked on a
 * stale double-tap) -- falls back to the caller-supplied generic message for
 * anything else. Matches this codebase's "never surface a raw Firebase
 * error payload" discipline (design doc §5 checklist item 3) without
 * needing every call site to duplicate this code/message table. */
export function providerActionErrorMessage(code: string | undefined, fallback: string): string {
  if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
    return 'That account is already linked to a different sign-in.';
  }
  if (code === 'auth/provider-already-linked') {
    return 'That sign-in method is already linked.';
  }
  return fallback;
}
