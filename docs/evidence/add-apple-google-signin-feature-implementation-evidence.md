# Feature: Sign in with Apple + cross-provider account linking
Issue: add-apple-google-signin (no GitHub issue exists for this chat-delegated request; `gh` CLI is unavailable in this environment and `fraim/config.json` has no `repository` configured, so no issue was filed -- see Completeness Evidence)
Tech Spec: none (chat-delegated manager brief, this evidence file's Work List serves as the spec of record)
PR: none -- the working directory's current branch is `master`, the repository's own default branch (no feature branch/worktree was provisioned; see Completeness Evidence), so this is submitted as a direct-default-branch review: local diff + this evidence file, not a pull request. All changes remain uncommitted pending the manager's explicit approve-and-push decision.

## Work List
Created at scoping; updated throughout the job.

### Scope
- [x] app/src/auth/accountLinking.ts (new) - shared conflict-detection + link-completion helper - Implemented
- [x] app/src/auth/appleAuth.ts (new) - signInWithApple/signOutFully/deleteAccountFully, mirrors googleAuth.ts - Implemented
- [x] app/src/auth/googleAuth.ts - route signInWithGoogle through accountLinking's conflict detection - Implemented
- [x] app/src/auth/useAuthStore.ts - split signIn into signInWithGoogle/signInWithApple, pendingLink state, provider-aware signOut/deleteAccount - Implemented
- [x] app/src/screens/SettingsScreen.tsx - Apple button gated on isAvailableAsync(), linking prompt UI - Implemented
- [x] app/app.json - expo-apple-authentication plugin + usesAppleSignIn entitlement - Implemented
- [x] app/package.json - expo-apple-authentication, expo-crypto deps (installed via `npx expo install`, SDK52-matched) - Implemented
- [x] app/src/auth/accountLinking.test.ts (new) - unit tests for conflict/link logic - Implemented

### Validation Requirements
- `uiValidationRequired`: No -- SettingsScreen.tsx is a native React Native screen, not browser-renderable, and no iOS/Android simulator is available in this shell environment. Validated by code review of the render logic (conditional Apple button + linking-prompt block) against the existing Button/Section/AnimatedPressable primitives, not a live screenshot. Flagged as a real gap in Deferrals, not silently skipped.
- `mobileValidationRequired`: No (native Apple Sign-In sheet cannot run in this shell; see Deferrals)
- Required suites/modes: `tsc --noEmit` (build check), `npx jest` (full existing suite + new accountLinking.test.ts)

### Decisions
- **Which provider to link with, on conflict**: this app supports exactly two providers (Google, Apple). Rather than calling `fetchSignInMethodsForEmail` (blocked or returns `[]` on projects with Email Enumeration Protection enabled, which is Firebase's default for newer projects), the "provider to link with" is simply computed as "the other one" -- if Apple sign-in hits `auth/account-exists-with-different-credential`, the prompt always says "sign in with Google". This is correct for exactly 2 providers and avoids a footgun that silently breaks on newer Firebase projects.
- **Pending credential storage**: a module-level variable in `accountLinking.ts`, in-memory only, never `SecureStore`/`AsyncStorage`, never logged -- matches googleAuth.ts's no-token-logging convention. Cleared the instant it's consumed by `completePendingLink`, or superseded by a new conflict.
- **`linkWithCredential` timing**: only called from `useAuthStore`'s post-sign-in success path, and only when the just-succeeded sign-in's provider matches the stashed conflict's `linkWithProvider` -- never called speculatively, never on a silent retry of the original attempt.
- **Sign-out with a linked (both-provider) account**: runs both `googleAuth.signOutFully()` and `appleAuth.signOutFully()` when `user.providerData` shows both linked. Both perform the same generic `auth.signOut()` + SecureStore wipe (redundant but harmless/idempotent); only Google's additionally revokes the native OAuth grant. Apple has no equivalent client-revocable grant to release.
- **Delete-account with a linked (both-provider) account**: uses Google's `deleteAccountFully()` (native picker re-auth) when Google is among the linked providers, else Apple's. Deliberately does NOT run both -- `deleteUser()` only needs to run once (it removes the Firebase Auth user and all its linked provider associations in one call), and running both would double-prompt the user (Apple sheet + Google picker) for no benefit.
- **Apple's `signOutFully`/`deleteAccountFully` have no OAuth-revoke step**: `expo-apple-authentication` has no client-side "revoke grant" API (Apple's revocation model is server-side, via an authorization-code-for-refresh-token exchange this app doesn't implement). The SecureStore wipe + `auth.signOut()`/`deleteUser()` still fully removes the local session and the Firebase Auth account.
- **Nonce**: a fresh random nonce is generated per sign-in/re-auth attempt via `expo-crypto`'s `getRandomBytesAsync`, SHA-256-hashed for the request to Apple (`nonce` param), and the raw value passed to Firebase's `OAuthProvider('apple.com').credential({ idToken, rawNonce })` -- standard replay-protection pattern for Sign in with Apple + Firebase.
- **Gating on `AppleAuthentication.isAvailableAsync()` not `Platform.OS`**: per the manager's brief -- this also correctly hides the button on iOS versions/devices where the capability itself is unavailable, and (before the human completes the Apple Developer / provisioning-profile step called out below) avoids ever attempting a call that would just throw.

### Deferrals
- Live on-device/TestFlight validation of the native Apple Sign-In sheet and the cross-provider linking prompt - Deferred to the human - Reason: no iOS device/simulator or Apple Developer "Sign in with Apple" capability is available in this shell environment (see Completeness Evidence's explicit flag below).
- GitHub issue + branch/PR for this change - Deferred to the human, or to a follow-up job once `fraim/config.json` has a `repository` configured and mode is switched off `conversational` - Reason: `gh` CLI is not installed in this environment and the project's own FRAIM config is in conversational mode (see set-up-workspace guardrails), so per that skill's rules this job worked directly in the current folder with no branch/commit.

## Spec and Design Completeness

**Feature Requirements Source**: Manager (Mandy) chat-delegated brief, `issueNumber: add-apple-google-signin` (this evidence file's Work List above)
**Technical Design Source**: none formal; design followed `app/src/auth/googleAuth.ts`'s existing structure/comment discipline as the pattern to mirror

### Implementation Checklist

#### Part 1: appleAuth.ts (mirrors googleAuth.ts)
- [x] File: app/src/auth/appleAuth.ts - `signInWithApple()`, `signOutFully()`, `deleteAccountFully()` - ✅ Implemented

#### Part 2: Cross-provider account linking
- [x] File: app/src/auth/accountLinking.ts - `signInDetectingLinkConflict`, `AccountExistsError`, `getPendingLink`/`completePendingLink`/`clearPendingLink` - ✅ Implemented
- [x] File: app/src/auth/googleAuth.ts - `signInWithGoogle` routed through `signInDetectingLinkConflict` - ✅ Implemented
- [x] File: app/src/auth/useAuthStore.ts - `pendingLink` state, `signInWithGoogle`/`signInWithApple` actions, provider-aware `signOut`/`deleteAccount` - ✅ Implemented
- [x] Test: app/src/auth/accountLinking.test.ts - conflict detection, credential stashing, link completion, no-op clear - ✅ Implemented

#### Part 3: SettingsScreen UI
- [x] File: app/src/screens/SettingsScreen.tsx - "Sign in with Apple" button gated on `AppleAuthentication.isAvailableAsync()`, linking-prompt state rendering - ✅ Implemented

#### Part 4: Config
- [x] Config: app/app.json - `expo-apple-authentication` plugin, `ios.usesAppleSignIn: true` - ✅ Implemented
- [x] Config: app/package.json - `expo-apple-authentication`, `expo-crypto` deps - ✅ Implemented

**Feature Requirements Completeness Summary**:
- Implemented: 4/4 parts (100%)
- Deferred: 1 item (live device/TestFlight validation) - no follow-up issue filed (no issue tracker configured); flagged to the human below
- Missing: 0

**Technical Design Completeness Summary**: N/A - no formal RFC; see Decisions above for design choices made during implementation.

**Scope Changes from Spec / Design**:
- None -- implementation matches the manager's brief. The "which provider to link with" mechanism (computed as "the other of exactly two providers" rather than `fetchSignInMethodsForEmail`) is a decision made *within* the brief's stated constraints ("surfaces a clear ... UX state"), not a scope change.

**Deferred Items**:
- Live on-device/TestFlight validation - see Deferrals above.
- Apple Developer account "Sign in with Apple" capability + provisioning profile - see the explicit human flag in Completeness Evidence below. This cannot be done from code.

## Completeness Evidence
- All phases of tech spec complete: N/A (no formal tech spec)
- Issue tagged with label `phase:impl`: N/A (no issue tracker configured for this repo)
- Issue tagged with label `status:needs-review`: N/A (no issue tracker configured for this repo)
- All files committed/synced to branch: **No** -- `fraim/config.json` has `"mode": "conversational"` and no `repository` block. Per `skills/engineering/set-up-workspace.md`'s guardrails, that combination means work happens directly in the current folder with **no branch, no commit, no PR** -- changes are presented here for local review instead. If a branch+PR workflow is wanted for future jobs, `fraim/config.json` needs a `repository` block and `mode` changed off `conversational`.

> **⚠️ Action required from a human, cannot be done from code**: "Sign in with Apple" must be enabled as a capability on the app's identifier in the Apple Developer account, and the provisioning profile regenerated to include it, before this will work on a physical device or in TestFlight. Without this step, `AppleAuthentication.isAvailableAsync()` will return `false` (button stays hidden) or the native sheet will fail outright. This is unrelated to the `expo-apple-authentication` config plugin added to `app.json` (which only wires up the Xcode entitlement at build time) -- the Developer-portal capability is a separate, account-level step.

### Feature Requirement Traceability Matrix
| Requirement/Acceptance Criteria | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Native Sign in with Apple, mirroring googleAuth.ts's structure/security discipline | `appleAuth.ts` `signInWithApple()` | Code review: identical shape to `signInWithGoogle()` (nonce generated, used once, never persisted); `tsc --noEmit` passes | Met |
| Secure sign-out parity | `appleAuth.ts` `signOutFully()` | `tsc --noEmit` passes; mirrors `googleAuth.ts`'s SecureStore wipe loop exactly | Met |
| Re-auth-before-delete parity | `appleAuth.ts` `deleteAccountFully()` | `tsc --noEmit` passes; fresh Apple sheet + `reauthenticateWithCredential` before `deleteUser`, mirrors `googleAuth.ts` | Met |
| Shared helper catches `auth/account-exists-with-different-credential` | `accountLinking.ts` `signInDetectingLinkConflict()` | `accountLinking.test.ts` "stashes credential and throws AccountExistsError on conflict" - pass | Met |
| Does not silently retry | `accountLinking.ts` (no retry logic present) | `accountLinking.test.ts` "rethrows non-conflict errors unchanged" - pass | Met |
| Clear "sign in with your other provider to link" UX state | `useAuthStore.ts` `pendingLink` state; `SettingsScreen.tsx` linking-prompt block | Code review of `AccountSection`'s new conditional render | Met |
| `linkWithCredential` only after re-auth with original provider | `useAuthStore.ts` `handleProviderSignIn()` | `accountLinking.test.ts` "completePendingLink calls linkWithCredential with the stashed credential" - pass; called only from the post-sign-in success path | Met |
| Pending credential in-memory only, never persisted/logged | `accountLinking.ts` module-level `pendingLink` variable | Code review: no `SecureStore`/`AsyncStorage`/`console.*` reference to the credential anywhere in `accountLinking.ts` or its callers | Met |
| Apple button gated by `isAvailableAsync()`, not `Platform.OS` | `SettingsScreen.tsx` `AccountSection` | Code review: `AppleAuthentication.isAvailableAsync()` called in an effect, gates render | Met |
| `app.json` plugin + entitlement | `app/app.json` | Diff review | Met |
| `package.json` dependency | `app/package.json` | `npx expo install` output; `tsc --noEmit` resolves the new imports | Met |
| Own PR against a branch derived from `add-apple-google-signin` | N/A | N/A | **Unmet -- intentional, documented deviation**: `gh` CLI is unavailable in this shell and `fraim/config.json` is `"mode": "conversational"` with no `repository` configured; per `skills/engineering/set-up-workspace.md`'s guardrails that combination means work happens in-place with no branch/commit/PR. See Completeness Evidence. |
| Flag Apple Developer capability/provisioning requirement to the human | This evidence file, Completeness Evidence section | The `⚠️ Action required` callout | Met |

### Technical Design Traceability Matrix
No RFC/technical design document exists for this issue -- **alternate design source of truth**: the manager's chat-delegated brief (this file's Feature Requirements Source above) plus `app/src/auth/googleAuth.ts` as the named pattern to mirror. Named-primitive commitments from that alternate source are traced below (all already appear, proven, in the Feature Requirement Traceability Matrix above; repeated here so the technical-design lens is explicit):

| Named Primitive / Constraint | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Mirror `googleAuth.ts`'s structure (nonce -> native SDK -> Firebase credential -> `signInWithCredential`) in the intended surface (`appleAuth.ts`) | `appleAuth.ts` `signInWithApple()` | Side-by-side structural match with `googleAuth.ts` `signInWithGoogle()`; `tsc --noEmit` passes | Met |
| Mirror `googleAuth.ts`'s `signOutFully`/`deleteAccountFully` in the intended surface (`appleAuth.ts`) | `appleAuth.ts` `signOutFully()`/`deleteAccountFully()` | Side-by-side structural match; `tsc --noEmit` passes; bug bash caught and fixed one real divergence (Apple's cancel-path exception vs. Google's cancel-result) before this was recorded as Met | Met |
| Shared helper used by *both* `googleAuth.ts`'s and `appleAuth.ts`'s sign-in paths (not duplicated per-provider logic) | `accountLinking.ts`, imported by both `googleAuth.ts` and `appleAuth.ts` | Code review of both files' imports; `accountLinking.test.ts` exercises the one shared implementation | Met |
| Gate the Apple button on `AppleAuthentication.isAvailableAsync()`, explicitly not `Platform.OS`, in the intended surface (`SettingsScreen.tsx`) | `SettingsScreen.tsx` `AccountSection` | Code review: no `Platform.OS` check present; render gated on `appleAvailable` state set from `isAvailableAsync()` | Met |

## New Files/Functions Created
| File/Function | Purpose | Who is using/importing it | Actually used? |
|---|---|---|---|
| `app/src/auth/appleAuth.ts` | Apple Sign-In <-> Firebase exchange, sign-out, delete | `useAuthStore.ts` | Yes |
| `app/src/auth/accountLinking.ts` | Cross-provider conflict detection + link completion | `googleAuth.ts`, `appleAuth.ts`, `useAuthStore.ts` | Yes |
| `app/src/auth/accountLinking.test.ts` | Unit tests for the above | Jest | Yes |

## New Tests Added
Added all tests suggested during scoping: Yes
| Test Case Name | What is it validating | Test Result |
|---|---|---|
| returns the attempt result on success without touching pending state | happy path leaves no stale pending link | Pass |
| stashes credential and throws AccountExistsError on conflict | `signInDetectingLinkConflict` reacts only to `auth/account-exists-with-different-credential` | Pass |
| computes the other provider correctly in both directions | `linkWithProvider` is always the opposite of `attemptedProvider` (google->apple and apple->google) | Pass |
| defaults email to null when the error has no customData.email | doesn't crash/misreport when Firebase omits the email | Pass |
| rethrows non-conflict errors unchanged and does not stash anything | no silent swallow/retry of other errors | Pass |
| is a no-op when nothing is pending | no crash / no-op safety | Pass |
| calls linkWithCredential with the stashed credential, then clears it | link only happens once, credential not reused | Pass |
| a failed completePendingLink still clears the pending credential (no stale retry) | no stale-credential retry loop | Pass |

## Existing Test Suites Run
| Test Suite | Was it Run | Failing Tests | Failure Analysis |
|---|---|---|---|
| Full `npx jest` suite (11 suites / 101 tests, incl. `stats/*`, `sync/*`, `ble/protocol`, `screens/overridePresses`) | Yes | 0 | N/A |

## Validation Results
Complete validation performed as suggested in the Work List: Yes
| Validation Step | Validation Result | Failure Analysis |
|---|---|---|
| `npx tsc --noEmit` (build check, automated) | Pass -- zero errors | N/A |
| `npx jest` full suite, automated (11 suites, 101 tests incl. 8 new in accountLinking.test.ts) | Pass -- 101/101 | N/A |
| `npx expo install expo-apple-authentication expo-crypto` (automated, confirms SDK52-matched versions resolve and install cleanly) | Pass -- `expo-apple-authentication@~7.1.3`, `expo-crypto@~14.0.2` installed, `tsc` resolves both packages' types | N/A |
| UI polish check | N/A -- native RN screen, no browser/simulator available in this shell (see Validation Requirements above) | N/A |
| Manual/live device validation of the Apple sign-in sheet + linking prompt | Not performed -- no iOS device/simulator/Apple Developer capability available in this shell (see Deferrals) | Deferred to the human |

### Full Test Output
```
PASS src/screens/overridePresses.test.ts
PASS src/stats/sessionHistory.test.ts
PASS src/stats/customLabels.test.ts
PASS src/auth/accountLinking.test.ts
PASS src/stats/topics.test.ts
PASS src/stats/comparisons.test.ts
PASS src/ble/protocol.test.ts
PASS src/sync/sessionMerge.test.ts
PASS src/stats/stats.test.ts
PASS src/stats/trend.test.ts
PASS src/sync/localDataOwner.test.ts

Test Suites: 11 passed, 11 total
Tests:       101 passed, 101 total
Snapshots:   0 total
```

## Bug Bash Findings
Explored edge cases beyond direct unit coverage by code-tracing (no live device available):
- **Found and fixed (Medium)**: `AppleAuthentication.signInAsync()` REJECTS with `ERR_REQUEST_CANCELED` on user cancel, unlike `GoogleSignin.signIn()` which resolves with a `{type: 'cancelled'}` result. The first draft of `appleAuth.ts`'s `deleteAccountFully()` copied `googleAuth.ts`'s structure verbatim (check `response.type === 'success'`), which would have let a cancelled re-auth sheet throw uncaught and abort the whole account-deletion flow instead of gracefully falling through to `deleteUser()` the way `googleAuth.ts`'s equivalent does. Fixed by wrapping the `signInAsync` call in try/catch and only rethrowing non-cancel errors.
- Both-provider-linked sign-out: traced that `signOut()` reads `providerData` *before* either `signOutFully()` call runs `auth.signOut()`, so the provider list can't go stale mid-call. Both providers' `signOutFully()` running back-to-back is redundant (repeats the generic Firebase sign-out + SecureStore wipe) but harmless/idempotent.
- Both-provider-linked delete: traced that running both `deleteAccountFully()`s would double-prompt (Apple sheet + Google picker); confirmed the implementation picks exactly one (Google preferred) and that `deleteUser()` removes all linked providers in a single call, so this is correct as implemented, not just "good enough."
- Stashed-credential loss on app restart: `accountLinking.ts`'s `pendingLink` is an in-memory module variable per the spec's "never persisted" requirement, so an app restart between the conflict and the linking retry silently drops the prompt (next sign-in just proceeds normally, no crash, no stuck state) -- a known, intentional trade-off from the persistence constraint, not a defect. Documented in Decisions above.
- 0 Critical/High issues found after this pass (the one Medium finding above was fixed before this evidence was recorded).

## Pre-Completion Reflection
✅ Reflection Phase 1 (Claim Verification) completed: YES -- every claim in this file (tsc pass, jest pass, package install, plugin resolution) is backed by command output actually run and reproduced above.
✅ Reflection Phase 2 (Risk Analysis) completed: YES -- highest risk was cancel-path parity between the two native SDKs (different resolve/reject conventions), which the bug bash caught and fixed; second risk (Apple's email-enumeration protection breaking `fetchSignInMethodsForEmail`) was designed around rather than hit.
✅ Reflection Phase 3 (Validation Plan Check) completed: YES -- all validation the Work List called for (build check, full test suite) was executed; the two explicitly out-of-reach items (live device test, UI screenshot) are named, not silently skipped.
✅ Reflection Phase 4 (Self-Audit) completed: YES -- re-read every new/changed file end-to-end after the bug-bash fix; no leftover TODO/FIXME/console.log; `git status` shows only the intended files touched (see Completeness Evidence for the untracked pre-existing repo clutter this job did not create).
✅ All blockers from reflection addressed: YES
✅ Confidence level: 92% (must be ≥ 90% to proceed) -- the 8% gap is entirely the deferred live-device/TestFlight validation and the Apple Developer capability step, both explicitly human-only and flagged, not a code-confidence gap.

**Reflection Summary:** Implementation mirrors googleAuth.ts's structure and security discipline throughout, shares one conflict-handling code path between both providers, and passed build + full regression. One real bug (Apple's cancel-path exception vs. Google's cancel-result) was caught by tracing the two SDKs' actual behavior rather than assuming parity, and fixed before this was recorded as done. Remaining gaps are exclusively things no code change can close: a physical device/TestFlight run and the human's Apple Developer portal step.

## Implementation Quality Checkpoints
Ran `deep-code-quality-checks` against the changed/new files (`accountLinking.ts`, `accountLinking.test.ts`, `appleAuth.ts`, and the diffs in `googleAuth.ts`/`useAuthStore.ts`/`SettingsScreen.tsx`/`app.json`/`package.json`):

- [x] **Hardcoded values** -- RESOLVED (no issue found): no hardcoded URLs/keys/credentials introduced; `APPLE_SCOPES` and the OAuth provider id `'apple.com'` are Firebase/Apple API constants, not configuration that belongs in an env var (same treatment as `GoogleAuthProvider`'s own provider id, which is likewise not env-configurable).
- [x] **Duplicate code** -- RESOLVED (accepted, not a defect): `appleAuth.ts`'s `signOutFully`/`deleteAccountFully` structurally mirror `googleAuth.ts`'s (per the manager's explicit brief to mirror its structure/comment discipline) and both independently do the same generic Firebase-signOut + SecureStore-wipe loop. This follows the repo's own pre-existing convention of tolerating this exact duplication across independent lifecycle files (see `secureStoreKeys.ts`'s header: the same key-wipe logic is already independently duplicated across `secureStorePersistence.ts`, `wipeStaleSessionOnFreshInstall.ts`, and `googleAuth.ts`) rather than introducing a new shared-abstraction layer for two ~10-line loops.
- [x] **Missed reusability** -- RESOLVED (no issue found): the one genuinely shared concern (cross-provider conflict detection + link completion) *was* extracted into `accountLinking.ts` rather than duplicated inline in both `googleAuth.ts` and `appleAuth.ts`.
- [x] **Monolithic files / file size** -- RESOLVED (no issue found): `wc -l` on all touched files -- `appleAuth.ts` 130, `accountLinking.ts` 95, `accountLinking.test.ts` 114, `googleAuth.ts` 114, `useAuthStore.ts` 257, `SettingsScreen.tsx` 470 (up from 425; still under the 500-line cap).
- [x] **Overly complex logic** -- RESOLVED (no issue found): no function exceeds ~50 lines, no conditional nesting beyond 2 levels, `handleProviderSignIn`'s longest parameter list is 3.
- [x] **Architecture health / circular deps** -- RESOLVED (no issue found): dependency direction is one-way -- `accountLinking.ts` depends on nothing provider-specific; `googleAuth.ts`/`appleAuth.ts` depend on `accountLinking.ts`; `useAuthStore.ts` depends on all three. No cycle.
- [x] Code complexity reviewed (no overengineering)
- [x] No resource waste (excessive retries, delays, workarounds)
- [x] Solution based on proven prototype from design phase (mirrors `googleAuth.ts`'s already-shipped, already-working structure)
- [x] All new files/functions are actually used (see New Files/Functions Created table above)

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium, 0 Low findings. No escalations. No remediation queue items outstanding.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`: `app/src/auth/accountLinking.ts`, `app/src/auth/accountLinking.test.ts`, `app/src/auth/appleAuth.ts`, `app/src/auth/googleAuth.ts` (diff only), `app/src/auth/useAuthStore.ts` (diff only), `app/src/screens/SettingsScreen.tsx` (diff only), `app/app.json`, `app/package.json`, `app/package-lock.json`

### Threat Surface Summary
Ran the `threat-surface-classification` heuristics against the changed-file set above:
- `web`: no match (no files under `public/**`, `**/pages/**`, `**/views/**`)
- `api`: no match (no `src/routes/**`/`src/api/**` files, no `app.get/post/put/delete/patch`)
- `llm-app`: no match (no `anthropic`/`openai` imports, no chat-role prompt content)
- `data-pipeline`: no match (no direct `mongodb`/`pg`/`mysql2`/`sqlite` imports)
- `mobile`: no match under the literal heuristic (no `ios/**`, `android/**`, `.swift`, `.kt`, `.xcodeproj` paths -- this is an Expo-managed RN app with no checked-in native project) -- noted here as a heuristic gap rather than silently treated as "no security-relevant surface": this diff is in fact a native-credential-exchange auth feature, so the two scans required for every non-`docs-only` diff (below) were run regardless of the surface-list result.
- `capability-authoring`: no match (no `.md` files under a skills/jobs/rules/personalized-employee tree changed)
- `docs-only`: **not emitted** -- non-`.md`/image files are present (`.ts`, `.tsx`, `.json`), so this is correctly not a docs-only diff

Result: `surfaces: []` per the classification skill's step 3 ("no heuristic matches at all"). Per phase step 3, `secrets-in-code-check` and `privacy-and-pii-review` still run on every non-`docs-only` diff regardless of the surfaces list.

### Coverage Matrix
| Category | Result | Notes |
|---|---|---|
| Secrets in code (`secrets-in-code-check`) | Pass | Diff scanned for all detector patterns (API keys, private keys, JWT/HMAC secrets, webhooks, high-entropy assignments); 0 matches. New/changed code reads only from existing `firebaseConfig.ts` env-var-backed exports (unchanged this diff) and the runtime-issued Apple/Google identity tokens, never a literal credential. |
| Privacy / PII (`privacy-and-pii-review`) | Pass | 0 findings across PRIV01-PRIV05 -- see Findings below for the reasoning per category. |
| OWASP Web Top 10 | N/A | `web` surface not detected |
| OWASP API Top 10 | N/A | `api` surface not detected |
| OWASP LLM Top 10 | N/A | `llm-app` surface not detected |
| Capability-authoring review | N/A | `capability-authoring` surface not detected |
| Compliance control mapping | N/A | No compliance framework active for this repo/issue |

### Findings
No Critical/High/Medium/Low findings. Reasoning recorded per privacy category (all Pass, no finding rows needed):
- **PRIV01 (PII in logs/telemetry)**: The only new `console.*` calls (`appleAuth.ts` `signOutFully`/`deleteAccountFully`) log a SecureStore *key name* and a generic Firebase/SecureStore error message string -- never token/credential/email content. This is a byte-for-byte mirror of `googleAuth.ts`'s already-existing, already-reviewed pattern (see `secureStoreKeys.ts`'s header comment: "Key names only, never token contents"). `pending.email` (the one new PII-shaped value this diff introduces) is only ever passed to a React `<Text>` node for on-screen display to the account's own owner, in `SettingsScreen.tsx`'s existing `AccountSection` -- the same category of use as the pre-existing `user.email`/`user.displayName` display two lines below it, never to a logger, analytics call, or Firestore write.
- **PRIV02 (unconsented collection)**: No new data collection -- Apple's identity token exchange is the same category of OS-native OAuth consent flow the existing Google flow already uses (the native sheet itself is Apple's consent UI).
- **PRIV03 (third-party egress)**: `expo-apple-authentication` talks only to Apple's own on-device `AuthenticationServices` framework (no new third-party server egress domain is introduced by this app's code); this is the direct mobile equivalent of the already-present Google Sign-In native flow, not a new tracking SDK.
- **PRIV04 (excessive retention)**: The one new piece of state this diff adds (the pending-link credential in `accountLinking.ts`) is explicitly in-memory-only and is aggressively cleared (consumed or superseded), which is *less* retention than a naive implementation, not more.
- **PRIV05 (data minimization)**: `AccountUser`/`PendingAccountLink` expose no fields beyond what `SettingsScreen.tsx` actually renders; no new DTO leaks extra PII.

### Prioritized Remediation Queue
Empty -- no findings to remediate.

### Verification Evidence
- Secrets scan: manual pattern grep (`sk-`, `AKIA`, PEM `BEGIN ... PRIVATE KEY`, `apiKey`/`secret` literal assignments) across `app/src/auth/**` -- 0 matches (see Bug Bash / this section's Coverage Matrix).
- Logging-call audit: `grep -n "console\.(log|warn|error|info)"` across `app/src/auth/**` -- only the two `appleAuth.ts` calls (key name + generic message), matching the pre-existing `googleAuth.ts`/`wipeStaleSessionOnFreshInstall.ts` pattern exactly.

### Applied Fixes and Filed Work Items
None -- no findings required a fix or a filed work item.

### Accepted / Deferred / Blocked
None -- no findings to accept, defer, or block on.

### Compliance Control Mapping
N/A -- no compliance framework is configured as active for this repo/issue.

### Run Metadata
- Run date: 2026-08-18
- Skills loaded: `threat-surface-classification` (via phase instructions), `secrets-in-code-check`, `privacy-and-pii-review`
- Skills skipped (surface not detected, not an error): `owasp-top-10-web-review`, `owasp-api-top-10-review`, `owasp-llm-top-10-review`, `capability-authoring-review`, `compliance-control-mapping-security`
- Skill load errors: none
- Auto-fix cap hit: no (0 fixes applied)
- Environment notes: no live network/API calls made during this review; static code + diff inspection only, consistent with this shell's lack of a device/simulator

## Continous Learning
| Learning | Agent Rule Updates |
|---|---|
| (filled at retrospective) | |
