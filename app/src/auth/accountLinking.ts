// accountLinking.ts -- cross-provider account merge for
// auth/account-exists-with-different-credential. Firebase issues a separate
// Auth user per provider by default: without this, a user who first signs in
// with Google and later taps "Sign in with Apple" using the same email would
// either fatally throw with no path forward, or (worse) silently end up with
// a second, empty account under a different uid. This module makes
// googleAuth.ts's and appleAuth.ts's sign-in paths funnel through a single
// conflict handler that stashes the credential that couldn't sign in yet,
// tells the caller which OTHER providers might own the account, and only
// ever calls linkWithCredential once the user has proven ownership by
// actually signing in with one of those providers -- never a silent retry.
//
// This app supports exactly three providers (Google, Apple, email/password --
// accountDisplay.ts's providerLabel/toProviderKinds cover all three), so
// "which other providers might this be" is computed directly (every
// supported provider except the one that just conflicted) rather than via
// fetchSignInMethodsForEmail -- that API returns [] on Firebase projects with
// Email Enumeration Protection enabled (the default for newer projects,
// enabled on this one), which would silently break this flow. This used to
// be a straight google<->apple flip (otherProvider()) back when there were
// only two providers; with three, "the other one" is no longer a single
// answer, so the caller is handed every remaining candidate and lets the user
// prove ownership with whichever one they actually have. Note that
// email/password sign-in (emailAuth.ts's signInWithEmail) never itself
// produces this conflict -- see that function's own comment -- so it can
// still be a valid candidate to COMPLETE a link (useAuthStore.ts's
// handleProviderSignIn checks candidateProviders on any successful sign-in,
// regardless of how that sign-in was reached) without ever being a path that
// throws AccountExistsError.
//
// The stashed credential lives in a module-level variable only -- never
// SecureStore/AsyncStorage, never console.* -- matching googleAuth.ts's
// no-token-logging convention. It is cleared the instant it's consumed by
// completePendingLink(), or superseded by a new conflict.
import { AuthErrorCodes, linkWithCredential, type AuthCredential, type User } from 'firebase/auth';

export type AuthProviderKind = 'google' | 'apple' | 'password';

/** Every provider this app supports, used to compute a conflict's
 * candidateProviders below. Order matters only for that computed list's
 * readability -- accountDisplay.ts's unlinkedProviders defines the order
 * that actually matters for UI (§1's Link-button list). */
const ALL_PROVIDER_KINDS: AuthProviderKind[] = ['google', 'apple', 'password'];

export interface PendingAccountLink {
  /** The provider whose sign-in attempt hit the conflict. */
  attemptedProvider: AuthProviderKind;
  /** Every OTHER provider this app supports -- signing in successfully with
   * ANY one of these proves ownership and completes the link (see
   * useAuthStore.ts's handleProviderSignIn). REPLACES the old single
   * `linkWithProvider` field from when this app supported only two
   * providers total, where "the other one" was unambiguous. */
  candidateProviders: AuthProviderKind[];
  /** Display-only, from Firebase's error.customData.email. Never logged. */
  email: string | null;
  /** The credential that couldn't sign in yet. Consumed by completePendingLink(), never persisted. */
  credential: AuthCredential;
}

export class AccountExistsError extends Error {
  readonly pending: PendingAccountLink;
  constructor(pending: PendingAccountLink) {
    super('An account already exists for this email with a different sign-in method.');
    this.name = 'AccountExistsError';
    this.pending = pending;
  }
}

let pendingLink: PendingAccountLink | null = null;

export function getPendingLink(): PendingAccountLink | null {
  return pendingLink;
}

export function clearPendingLink(): void {
  pendingLink = null;
}

/**
 * Runs `attempt` (a provider's signInWithCredential call). On Firebase's
 * auth/account-exists-with-different-credential, does NOT retry or fall back
 * silently: stashes `credential` in memory and throws AccountExistsError so
 * the caller can prompt the user to sign in with one of the other providers
 * first. Any other error is rethrown unchanged.
 *
 * Only googleAuth.ts's signInWithGoogle and appleAuth.ts's signInWithApple
 * route their signInWithCredential call through this: this conflict code is
 * specific to that call, which rejects when the credential's provider
 * doesn't match what's already on file for the email. emailAuth.ts's
 * signInWithEmail deliberately does NOT wrap itself with this -- see that
 * function's own comment for why signInWithEmailAndPassword cannot produce
 * this code at all.
 */
export async function signInDetectingLinkConflict<T>(
  attemptedProvider: AuthProviderKind,
  credential: AuthCredential,
  attempt: () => Promise<T>,
): Promise<T> {
  try {
    return await attempt();
  } catch (e: any) {
    if (e?.code === AuthErrorCodes.NEED_CONFIRMATION) {
      const email = typeof e?.customData?.email === 'string' ? e.customData.email : null;
      const candidateProviders = ALL_PROVIDER_KINDS.filter((p) => p !== attemptedProvider);
      pendingLink = { attemptedProvider, candidateProviders, email, credential };
      throw new AccountExistsError(pendingLink);
    }
    throw e;
  }
}

/**
 * Attaches the stashed credential to `user`. Callers must only invoke this
 * once `user` has just signed in successfully via one of the pending
 * conflict's candidateProviders (proof of ownership) -- never speculatively.
 */
export async function completePendingLink(user: User): Promise<void> {
  if (!pendingLink) return;
  const { credential } = pendingLink;
  pendingLink = null; // clear before awaiting: a failed link must not retry with a stale credential
  await linkWithCredential(user, credential);
}
