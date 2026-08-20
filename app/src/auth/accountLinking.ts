// accountLinking.ts -- cross-provider account merge for
// auth/account-exists-with-different-credential. Firebase issues a separate
// Auth user per provider by default: without this, a user who first signs in
// with Google and later taps "Sign in with Apple" using the same email would
// either fatally throw with no path forward, or (worse) silently end up with
// a second, empty account under a different uid. This module makes
// googleAuth.ts's and appleAuth.ts's sign-in paths funnel through a single
// conflict handler that stashes the credential that couldn't sign in yet,
// tells the caller which OTHER provider owns the account, and only ever
// calls linkWithCredential once the user has proven ownership by actually
// signing in with that other provider -- never a silent retry.
//
// This app supports exactly two providers (Google, Apple), so "the other
// provider" is computed directly rather than via fetchSignInMethodsForEmail
// -- that API returns [] on Firebase projects with Email Enumeration
// Protection enabled (the default for newer projects), which would silently
// break this flow.
//
// The stashed credential lives in a module-level variable only -- never
// SecureStore/AsyncStorage, never console.* -- matching googleAuth.ts's
// no-token-logging convention. It is cleared the instant it's consumed by
// completePendingLink(), or superseded by a new conflict.
import { AuthErrorCodes, linkWithCredential, type AuthCredential, type User } from 'firebase/auth';

export type AuthProviderKind = 'google' | 'apple';

export interface PendingAccountLink {
  /** The provider whose sign-in attempt hit the conflict. */
  attemptedProvider: AuthProviderKind;
  /** The only other provider this app supports -- must be used to prove ownership before linking. */
  linkWithProvider: AuthProviderKind;
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

function otherProvider(p: AuthProviderKind): AuthProviderKind {
  return p === 'google' ? 'apple' : 'google';
}

/**
 * Runs `attempt` (a provider's signInWithCredential call). On Firebase's
 * auth/account-exists-with-different-credential, does NOT retry or fall back
 * silently: stashes `credential` in memory and throws AccountExistsError so
 * the caller can prompt the user to sign in with their other provider first.
 * Any other error is rethrown unchanged.
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
      pendingLink = { attemptedProvider, linkWithProvider: otherProvider(attemptedProvider), email, credential };
      throw new AccountExistsError(pendingLink);
    }
    throw e;
  }
}

/**
 * Attaches the stashed credential to `user`. Callers must only invoke this
 * once `user` has just signed in successfully via the pending conflict's
 * linkWithProvider (proof of ownership) -- never speculatively.
 */
export async function completePendingLink(user: User): Promise<void> {
  if (!pendingLink) return;
  const { credential } = pendingLink;
  pendingLink = null; // clear before awaiting: a failed link must not retry with a stale credential
  await linkWithCredential(user, credential);
}
