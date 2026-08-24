**DRAFT - Requires Human Approval**

# Fully-Delegate Evidence: Add Sign in with Apple + cross-provider account linking

## Executive summary
Goal: add native Sign in with Apple to the companion app alongside the existing Sign in with Google, gated by runtime provider availability on both platforms, with cross-provider account merging (no duplicate accounts when the same email already owns a Firebase Auth account under the other provider).

Delegated as a single task (splitting would have forced two workstreams to edit the same `useAuthStore.ts`/`SettingsScreen.tsx` concurrently). It returned complete on the first iteration and passed manager verification. **Confidence: high** (first-iteration pass, no corrections issued, no human escalation).

## Delegation ledger and outcome

| Task | Persona | Job | Evidence | PR | Verdict | Iterations |
|---|---|---|---|---|---|---|
| apple-google-signin-merge | mobile-dev | feature-implementation | [add-apple-google-signin-feature-implementation-evidence.md](./add-apple-google-signin-feature-implementation-evidence.md) | none (no repository configured for this run; reviewed as a local working-tree diff on `master`) | verified-complete | 1 |

## What was built
- `app/src/auth/appleAuth.ts` (new): native Sign in with Apple, nonce-based, mirrors `googleAuth.ts`'s structure and no-token-logging discipline.
- `app/src/auth/accountLinking.ts` (new) + `accountLinking.test.ts` (new, 8 tests): shared conflict handler for Firebase's `auth/account-exists-with-different-credential`. Stashes the conflicting credential in memory only, never retries silently, links only after the user proves ownership by signing in with the other provider.
- `useAuthStore.ts`: split `signIn` into `signInWithGoogle`/`signInWithApple`, added `pendingLink` state, made `signOut`/`deleteAccount` provider-aware by reading `user.providerData` directly.
- `SettingsScreen.tsx`: Apple button gated on `AppleAuthentication.isAvailableAsync()` (not `Platform.OS`), plus the "sign in with your other provider to link" prompt UI.
- `app.json`/`package.json`: `expo-apple-authentication` config plugin, `usesAppleSignIn` entitlement, `expo-apple-authentication` + `expo-crypto` dependencies.

## Manager verification performed
Did not accept the child's self-report at face value. Independently re-ran both claimed checks and read every changed/new file directly rather than reviewing the summary alone:
- `npx tsc --noEmit` in `app/` — clean, matches the child's claim.
- `npx jest` (full suite, not just the new file) — 11 suites / 101 tests passed, matches the child's claim.
- Read `accountLinking.ts`, `appleAuth.ts`, `accountLinking.test.ts`, `useAuthStore.ts` in full; grepped `SettingsScreen.tsx` and `googleAuth.ts`'s actual diff (not just the description of it).

Findings confirmed by direct inspection:
- Conflict handler catches only `AuthErrorCodes.NEED_CONFIRMATION`, stores the credential in a module-level variable only (never SecureStore/AsyncStorage/console), clears it before awaiting `linkWithCredential` so a failed link can't retry stale. Both `googleAuth.ts` and `appleAuth.ts` actually route through it (confirmed in `googleAuth.ts`'s diff, not just the summary claim).
- `appleAuth.ts` generates a fresh nonce per attempt (raw kept for Firebase, hashed sent to Apple) and never persists the identity token.
- The reported cancel-on-delete bug fix is present: `deleteAccountFully()` catches `ERR_REQUEST_CANCELED` and falls through to `deleteUser()` instead of aborting, matching Google's graceful-skip-on-cancel behavior.
- Delete-account provider selection correctly avoids stranding Apple-only users: picks Apple's re-auth only when Apple is linked and Google is not; Google's re-auth otherwise (covers Google-only and both-linked accounts). This was the main risk going in and it is handled correctly.
- `SettingsScreen` gates the Apple button on `AppleAuthentication.isAvailableAsync()` per the confirmed requirement, not `Platform.OS`.
- `linkedProviders()` reads Firebase's own `user.providerData` rather than tracked state, so it cannot drift out of sync with what is actually linked.

No corrections were needed. Nothing was coached back to the child.

## Risk areas / gaps disclosed and accepted as real (not silently skipped)
- No live device/simulator run of the native Apple sheet or the linking prompt UI — verified by code trace only. This is a real, disclosed gap; scrutinize this on first real-device test.
- **Human-only blocker:** the "Sign in with Apple" capability must be enabled in the Apple Developer account and the provisioning profile regenerated before this works on a physical device or TestFlight. Cannot be done from code.
- No branch/PR was opened: `fraim/config.json` has no `repository` configured for this session and `gh` is unavailable, so this was reviewed as a direct working-tree diff on `master`. Nothing is staged or committed.

## Human approval checklist
- [ ] Approve staging and committing the working-tree diff (`app/src/auth/appleAuth.ts`, `accountLinking.ts`, `accountLinking.test.ts`, `useAuthStore.ts`, `SettingsScreen.tsx`, `app.json`, `package.json`) — nothing has been committed yet.
- [ ] Confirm the two design decisions this run resolved on your instruction: Apple button visibility is runtime-gated (not platform-gated) on both platforms; cross-provider account linking exists and computes "the other provider" directly (no `fetchSignInMethodsForEmail`, since that API returns `[]` under Firebase's default email-enumeration protection).
- [ ] Enable "Sign in with Apple" capability in the Apple Developer account and regenerate the provisioning profile (required before any device/TestFlight test; cannot be done from this environment).
- [ ] Schedule a real-device/simulator pass to exercise the native Apple sheet and the account-linking prompt before shipping — the current verification is tsc + full jest suite + direct code review only, no live run.

## Catalog gap signal
None. `feature-implementation` was sufficient for the full scope (implementation + its own tests + its own evidence file); no missing job capability surfaced during this run.
