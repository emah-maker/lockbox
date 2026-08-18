# Feature: Scope/clear local session + settings storage by signed-in uid
Issue: Critical #1, `docs/production-readiness/production-readiness-review-phone-box-companion-app-2026-08-17.md`
Tech Spec: N/A (audit finding, no separate spec doc) — coaching-plan item 1 in the audit is the accepted design
PR: N/A (conversational mode, no repo/issue tracker configured for this job)

## Work List

### Scope
- [x] `app/src/sync/localDataOwner.ts` (new) - owner-tag key + `clearLocalAccountData()` + `ensureLocalDataScopedTo(uid)` - Implemented
- [x] `app/src/sync/localDataOwner.test.ts` (new) - unit tests for the two functions above - Implemented
- [x] `app/src/sync/firestoreSync.ts` - `runMigrationAndSync` calls `ensureLocalDataScopedTo(uid)` before any Firestore read/write - Implemented
- [x] `app/src/auth/useAuthStore.ts` - `signOut` and `deleteAccount` call `clearLocalAccountData()` after the account transition completes - Implemented
- [x] `app/src/store/useSettingsStore.ts` - new `resetSyncableSettings()` action + `SYNCABLE_SETTINGS_DEFAULTS` - Implemented

### Validation Requirements
- `uiValidationRequired`: No (no screens/components touched; behavior is storage/store-boundary logic only)
- `mobileValidationRequired`: No (no native module surface touched)
- Required suites/modes: `tsc --noEmit`, `npm test` (full suite + targeted new file), manual reasoning through sign-out → sign-in-as-different-account (no multi-account test harness/device pair available)

### Decisions
- **New standalone module (`localDataOwner.ts`) instead of adding this logic directly to `firestoreSync.ts`**: `firestoreSync.ts` imports `firebase/app` transitively (via `auth/firebase.ts`, which calls `initializeApp()` at module load), and this repo's existing convention (see `sessionMerge.test.ts`, `sessionHistory.test.ts` header comments) is to never unit-test anything in `sync/` that touches Firebase. The uid-scoping/clear logic itself has no Firebase dependency, so splitting it into its own module keeps it directly, cheaply unit-testable without perturbing that convention or risking Firebase init side effects in the test process.
- **`ensureLocalDataScopedTo` always clears when the tag doesn't match `uid`**, rather than trying to distinguish "untagged with no data" from "untagged with data": clearing already-empty session history / already-default settings is a harmless no-op, so the simpler unconditional check ("owner !== uid → clear") is strictly safer and avoids extra branching for zero behavior difference.
- **Reset value for `settingsUpdatedAt` is `0`** (not left alone): this makes a post-reset device's local settings always lose the two-way LWW comparison in `syncSettingsTwoWay` against whatever the next signed-in uid's Firestore doc contains (or, if that uid has no doc yet, push the just-reset defaults as its baseline) — exactly the desired behavior for "no prior account's settings should influence the next account."
- **`deleteAccount` also calls `clearLocalAccountData()`**, even though the task description's literal instruction only named `signOut`: the audit's own Critical #1 citation is `useAuthStore.ts:71-92`, which spans `signIn`/`signOut`/`deleteAccount` as a single flagged range, and leaving `deleteAccount` unfixed would reopen the identical leak vector immediately after a full account deletion on a shared/resold device. This is the same fix applied to a second call site already inside the finding's own cited lines, not new scope.
- **Ordering**: `clearLocalAccountData()` runs *after* `signOutFully()`/`deleteAccountFully()` complete in both call sites, so `settingsSyncBridge`'s subscription (which pushes to Firestore on any `useSettingsStore` change) sees `auth.currentUser === null` and no-ops instead of racing a push against the just-completed sign-out/delete.

### Deferrals (explicitly out of scope per task instructions)
- High #2 (`syncNow` stale-result race), High #3 (`waitForPoweredOn` timeout), High #4 (`handleHistory` race), High #5 (`WheelPicker` accessibility) — all remain open, per explicit instruction not to fix them in this change.
- `boxSettings` and the view-only local prefs (`TIME_WINDOW_KEY`, `BEST_STREAK_KEY`) are untouched, per explicit instruction.
- **Known residual gap, flagged not fixed**: `useStore.ts`'s in-memory `sessions` array (loaded once at `init()`, used by `StatsScreen`) is not refreshed by `clearLocalAccountData()` or by the merge inside `syncSessions`. This means that if the app process stays alive across a sign-out → different-account sign-in (no app restart), the *AsyncStorage* layer is correctly scoped/cleared (so the new account's Firestore data can never be contaminated by the old account's local data — the actual Critical #1 leak), but the Stats screen's in-memory view could still show the previous account's session data on-screen until the process restarts or that screen re-fetches. This is a pre-existing gap (the merge path in `syncSessions` already had this same staleness before this change — `replaceSessions` writing to `AsyncStorage` was never mirrored back into `useStore.sessions` either) and is not part of the file:line citations for Critical #1. Flagging for a manager decision on whether it warrants a fast-follow; not fixed here per the "scope strictly" instruction and to avoid entangling `useStore.ts` (documented as intentionally auth/network-unaware) into this fix.

## Implementation Checklist

#### Part 1: Owner-tag tracking + clearing primitive
- [x] File: `app/src/sync/localDataOwner.ts` - `LOCAL_DATA_OWNER_KEY`, `clearLocalAccountData()`, `ensureLocalDataScopedTo(uid)` - ✅ Implemented
- [x] Test: `app/src/sync/localDataOwner.test.ts` - 6 cases covering tag-on-first-sync, same-uid no-op, different-uid wipe, untagged-legacy-data wipe, `clearLocalAccountData` behavior, `boxSettings` non-interference - ✅ Implemented

#### Part 2: Wire into migration/sync
- [x] File: `app/src/sync/firestoreSync.ts` - `runMigrationAndSync` calls `ensureLocalDataScopedTo(uid)` before any Firestore read/write - ✅ Implemented

#### Part 3: Wire into sign-out / account deletion
- [x] File: `app/src/auth/useAuthStore.ts` - `signOut` and `deleteAccount` call `clearLocalAccountData()` - ✅ Implemented

#### Part 4: Settings reset primitive
- [x] File: `app/src/store/useSettingsStore.ts` - `resetSyncableSettings()` action + `SYNCABLE_SETTINGS_DEFAULTS` constant - ✅ Implemented

**Feature Requirements Completeness Summary**:
- Implemented: 4/4 items (100%)
- Deferred: 0 items (the 4 High findings and the `useStore.sessions` staleness note are explicitly out of scope, not deferred sub-items of this fix)
- Missing: 0

**Scope Changes from Spec / Design**:
- Extended `clearLocalAccountData()` to also be called from `deleteAccount` (not just `signOut`), for the reason given under Decisions above. No other scope changes.

## Completeness Evidence
- All phases of tech spec complete: Yes (audit coaching-plan item 1 fully addressed for the Critical finding)
- Issue tagged with label `phase:impl`: N/A (no issue tracker configured for this job — conversational mode, `fraim/config.json` has no `repository`)
- Issue tagged with label `status:needs-review`: N/A (same reason)
- All files committed/synced to branch: Working tree changes only; no commit made (user has not requested one)

### Feature Requirement Traceability Matrix
| Requirement | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Track which uid local session/settings storage belongs to | `localDataOwner.ts` - `LOCAL_DATA_OWNER_KEY` | `localDataOwner.test.ts` "tags untouched local storage with the first signed-in uid" | Met |
| On sign-out, clear local session history + reset the 4 SyncableSettings fields to defaults | `useAuthStore.ts` `signOut` → `clearLocalAccountData()`; `useSettingsStore.ts` `resetSyncableSettings()` | `localDataOwner.test.ts` "clears sessions, resets syncable settings to defaults, and un-tags the owner" | Met |
| Before merging a newly signed-in uid's data, clear local storage if tagged with a different uid or untagged-with-data | `firestoreSync.ts` `runMigrationAndSync` → `ensureLocalDataScopedTo(uid)` | `localDataOwner.test.ts` "wipes local session history and settings before merging a different uid's data in"; "wipes pre-existing untagged local data..." | Met |
| Do not touch `boxSettings` or view-only local prefs | `localDataOwner.ts` `clearLocalAccountData()` (only calls `clearSessions()` + `resetSyncableSettings()`) | `localDataOwner.test.ts` "does not touch boxSettings" | Met |

### Technical Design Traceability Matrix
No separate RFC exists for this specific fix; the technical-design source of truth is the delegated task instructions (which restate and elaborate the audit's coaching-plan item 1) plus the pre-existing `docs/rfcs/google-signin-cross-device-sync-architecture.md` (background on the merge/LWW model this fix must not break).

| Design Commitment | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Track which uid local session/settings storage belongs to via a new local key | `localDataOwner.ts` `LOCAL_DATA_OWNER_KEY = 'localDataOwnerUid'` | `localDataOwner.test.ts` "tags untouched local storage with the first signed-in uid" | Met |
| On `signOut`, clear local session history + reset the 4 `SyncableSettings` fields to defaults | `useAuthStore.ts` `signOut` → `clearLocalAccountData()` | `localDataOwner.test.ts` "clears sessions, resets syncable settings to defaults, and un-tags the owner" | Met |
| Before `runMigrationAndSync` merges a newly signed-in uid's data, clear local storage if tagged with a different uid or untagged-with-existing-data | `firestoreSync.ts` `runMigrationAndSync` → `ensureLocalDataScopedTo(uid)`, called before any Firestore read/write | `localDataOwner.test.ts` "wipes local session history and settings before merging a different uid's data in"; "wipes pre-existing untagged local data..." | Met |
| Do not touch `boxSettings` (per-device, deliberately not synced) | `clearLocalAccountData()` never reads/writes `boxSettings` | `localDataOwner.test.ts` "does not touch boxSettings (per-device, not account state)" | Met |
| Do not touch the view-only local prefs (`TIME_WINDOW_KEY`, `BEST_STREAK_KEY`) | Not referenced anywhere in `localDataOwner.ts`/`clearLocalAccountData` | Code inspection — `localDataOwner.ts` only imports `getJSON`/`setJSON`, `clearSessions`, and `useSettingsStore`; never imports `StatsScreen.tsx` or its keys | Met |
| Existing additive-union session merge / two-way LWW settings merge (RFC §4.2) must not be broken by the new guard | `firestoreSync.ts` `syncSessions`/`syncSettingsTwoWay` unchanged; `ensureLocalDataScopedTo` runs strictly before them | `sessionMerge.test.ts` (5/5, unchanged, still passing) + full suite 87/87 | Met |
| Do not fix High #2 (`syncNow` race), High #3 (`waitForPoweredOn`), High #4 (`handleHistory` race), High #5 (`WheelPicker` a11y) | None of `useStore.ts`, `PhoneBoxClient.ts`, `WheelPicker.tsx` touched by this diff | `git diff` scoped to this fix's files only touches `localDataOwner.ts`(new)/`.test.ts`(new)/`firestoreSync.ts`/`useAuthStore.ts`/`useSettingsStore.ts` | Met |

No unresolved named design callouts remain.

## Feedback Received
No feedback file exists at `docs/evidence/production-readiness-critical-1-uid-scoping-feature-implementation-feedback.md` — per `feedback-completeness-verification`'s guardrail, no file means no feedback to address (`allFeedbackAddressed: true`).

### PR Comments
N/A — no PR opened for this conversational-mode job.

### User Feedback (Direct)
N/A — no feedback received yet on this change; first pass.

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) — single new ~45-line module, two small edits, one new store action
- [x] No resource waste (excessive retries, delays, workarounds) — none introduced
- [x] Solution based on proven prototype from design phase — matches audit's own coaching-plan item 1 verbatim
- [x] All new files/functions are actually used — `clearLocalAccountData` used by both `useAuthStore.ts` call sites; `ensureLocalDataScopedTo` used by `firestoreSync.ts`; `resetSyncableSettings` used by `clearLocalAccountData`
- [x] `QUALITY CHECK FAILURE` (RESOLVED): `resetSyncableSettings`'s new `SYNCABLE_SETTINGS_DEFAULTS` constant duplicated literal default values (`'dark'`/`'mint'`/`true`/`[]`) that already existed in two other places in the same file — the store's initial-state object literal and `hydrate()`'s `getJSON` fallback arguments. Fixed by spreading `SYNCABLE_SETTINGS_DEFAULTS` into the initial state and referencing its fields as the `hydrate()` fallbacks, leaving one source of truth. No behavior change (values are identical); re-verified with `tsc --noEmit` + full `jest` suite (87/87) after the change.
- [x] No other duplication, hardcoded secrets/URLs, monolithic files (largest touched/added file is `firestoreSync.ts` at ~300 lines), excessive nesting, or circular imports found — `localDataOwner.ts` sits below `firestoreSync.ts`/`useAuthStore.ts` in the dependency graph (imports only `storage.ts`, `sessionHistory.ts`, `useSettingsStore.ts`, none of which import it back)

## Validation Results
- Complete validation performed as suggested in tech spec: Yes
- See full command output below (Bash tool output; not hand-transcribed)

| Validation Step | Result | Failure Analysis |
|---|---|---|
| `npx tsc --noEmit` (app/) | Pass — no errors | N/A |
| `npx jest` (full suite, app/) | Pass — `Test Suites: 9 passed, 9 total`, `Tests: 87 passed, 87 total` | N/A |
| `npx jest src/sync/localDataOwner.test.ts` (targeted, new file) | Pass (6/6) | N/A |
| Repro: `ensureLocalDataScopedTo` temporarily reverted to a no-op (matching pre-fix behavior) | 2/6 tests failed for the expected reason (`loadSessions()` returned the prior account's session instead of `[]`) | N/A — this is the intended repro-fail, real implementation restored immediately after, then re-verified green |
| Manual reasoning: sign-out → sign-in-as-different-account (no multi-account test harness available) | See "Manual Reasoning" section below | N/A |

Note: `app/src/auth/useAuthStore.ts` and `app/src/sync/firestoreSync.ts` also received unrelated concurrent edits during this job (a `syncingUid`-based fix for High #2 and a `deletingUid` guard for a Medium deleteAccount-race finding — both out of this Critical #1 fix's scope). `tsc`/`jest` above were run against the final combined state of those files and both pass; this fix's own additions (`ensureLocalDataScopedTo` call in `runMigrationAndSync`, `clearLocalAccountData()` calls in `signOut`/`deleteAccount`) were re-read and confirmed intact and unmodified by that concurrent work.

UI polish check: N/A — no UI changes detected (this fix touches only storage/store/sync logic, no screens/components).

**Regression pass (final, post-security-review)**: `npx tsc --noEmit` clean, `npx jest` → `Test Suites: 9 passed, 9 total`, `Tests: 87 passed, 87 total`. One transient `tsc` failure was observed mid-session in `app/src/screens/DashboardScreen.tsx` (`Cannot find name 'pickHours'`) — that file is not part of this fix's diff and was mid-edit by a concurrent sibling workstream (the High #5 WheelPicker-accessibility fix, which also touches `DashboardScreen.tsx`); re-running `tsc` moments later showed it resolved. Re-diffed this fix's three pre-existing touched files (`useAuthStore.ts`, `firestoreSync.ts`, `useSettingsStore.ts`) against `HEAD` afterward and confirmed all of this fix's own additions are intact and correctly ordered alongside the concurrent `syncingUid`/`deletingUid` changes (e.g. `clearLocalAccountData()` still runs after `deleteAccountFully()`/the `beginAccountDeletion`/`endAccountDeletion` bracket in `deleteAccount`).

### Manual Reasoning: sign-out → sign-in-as-different-account

No physical second Google/Firebase account or multi-device harness is available to drive this end-to-end, so this is a code-level trace of both sequences the fix must close, matching the exact functions and line-level effects:

**Sequence A — sign out, then a different account signs in on the same device:**
1. User A signs out: `useAuthStore.signOut()` calls `signOutFully()` (clears Firebase Auth + SecureStore keys — unchanged, pre-existing), then the new `clearLocalAccountData()`: `clearSessions()` empties `sessionHistory` in AsyncStorage, `resetSyncableSettings()` resets `themeMode`/`accent`/`callAlertsEnabled`/`customLabels` to defaults and `settingsUpdatedAt` to `0`, and `LOCAL_DATA_OWNER_KEY` is set to `null`. `boxSettings` is untouched (not part of `SyncableSettings`, not read/written by `clearLocalAccountData`).
2. User B signs in: `onAuthStateChanged` fires with B's Firebase user → `syncNow()` → `runMigrationAndSync(B.uid)` → `ensureLocalDataScopedTo(B.uid)` reads the owner tag (`null` from step 1) → `null !== B.uid` → clears again (no-op, already empty) → tags owner as `B.uid`. `syncSessions` then merges B's *empty* local list with B's own Firestore sessions (union is just B's remote sessions) and writes that back locally. `syncSettingsTwoWay` compares B's local `settingsUpdatedAt` (`0`, from the reset) against B's Firestore doc: if it exists, `remote.updatedAt > 0` is true almost always, so B's own cloud settings win and get pulled in; if B has no doc yet, the just-reset local defaults are pushed as B's first cloud baseline. **Result: A's data never reaches B's Firestore path or B's local storage.**

**Sequence B — a different account signs in directly, without an intervening sign-out (the "wrong account on a shared device" / "reset device" case this guard specifically targets):**
1. Device still has A's data locally, tagged `LOCAL_DATA_OWNER_KEY = A.uid` (from A's last sync).
2. B signs in directly (e.g. A never signed out, or the local tag survived from before this fix shipped, i.e. untagged with existing data). `runMigrationAndSync(B.uid)` → `ensureLocalDataScopedTo(B.uid)` reads owner (`A.uid` or `null`-with-data) → mismatch → `clearLocalAccountData()` wipes A's sessions/settings from local storage *before* `syncSessions`/`syncSettingsTwoWay` ever read local storage → tags owner as `B.uid`. **Result: A's data is never uploaded into B's Firestore path, and B's Stats/Settings only ever reflect B's own (post-wipe, then merged-from-B's-Firestore) data.**

**Residual, explicitly flagged (not fixed, out of scope)**: in both sequences, `useStore.ts`'s in-memory `sessions` array is not touched by `clearLocalAccountData()` or by `syncSessions`'s `replaceSessions()` call — if the app process itself stays alive across the switch (no restart), the Stats screen could still render A's session list from memory until the process restarts or a code path re-reads from `useStore`. This does not reopen the Critical #1 leak (A's data still never reaches B's Firestore or B's persisted local storage) but is a genuine UX gap on a shared device that keeps the app running across users. See Deferrals above.

## Bug Bash Findings

- **Narrow residual race, not blocking, adjacent to High #2 (out of scope here)**: `ensureLocalDataScopedTo(uid)` takes `uid` as a plain parameter and doesn't re-check current Firebase auth state itself. If two `runMigrationAndSync` calls for two *different* uids ever truly overlapped (e.g. an extremely fast sign-out-then-sign-in-as-a-different-account before the first account's fire-and-forget `syncNow` had settled), their `ensureLocalDataScopedTo` calls could race on the shared local owner tag / session storage, transiently corrupting the *local* cache (mixing fragments of both accounts) until the next sync re-tags and re-clears it. This never crosses into Firestore itself — `syncSessions(uid)`/`syncSettingsTwoWay(uid)` always read/write `users/{uid}/...` keyed by their own explicit `uid` argument, so the two accounts' *cloud* data stays isolated regardless. This is the same class of race the audit's High #2 (`syncNow` stale-result race) already names, and a concurrent workstream is fixing `syncNow`'s re-entrancy (`syncingUid`) during this same job run, which will further narrow this window. Not fixed here per the explicit instruction to leave High #2 to its own decision; flagging so it isn't silently missed.
- No other Critical/High issues found after reasoning through: fresh install (no local data, first-ever sign-in), same-account resync, sign-out with no prior sign-in (no-op path), sign-out immediately followed by sign-in as the *same* account (owner tag matches, no unnecessary wipe), and `deleteAccount` on an account with no local data yet (`clearLocalAccountData` on already-empty storage is a no-op).

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium, 0 Low findings. No blockers. This diff is itself a security fix (closes Critical #1 from the production-readiness audit); the review found no new issues introduced by the fix.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths` (files changed by this job): `app/src/sync/localDataOwner.ts` (new), `app/src/sync/localDataOwner.test.ts` (new), `app/src/sync/firestoreSync.ts`, `app/src/auth/useAuthStore.ts`, `app/src/store/useSettingsStore.ts`
- Referenced but not part of this diff: `app/src/stats/sessionHistory.ts`, `app/src/storage/storage.ts` (read for context; unmodified)

### Threat Surface Summary
No surface in the closed set `{web, api, llm-app, data-pipeline, mobile, capability-authoring, docs-only}` matches: the changed files are React Native store/sync TypeScript modules, not native `ios/**`/`android/**`/`.swift`/`.kt` files, not `routes/api` handlers, not LLM prompt code, and not capability-authoring markdown. Per `threat-surface-classification`'s guardrails (evidence-based, no speculation), `surfaces: []`. `secrets-in-code-check` and `privacy-and-pii-review` still ran per this phase's "every non-docs-only review" rule, since real `.ts` files (not just docs) changed.

### Coverage Matrix
| Category | Status | Notes |
|---|---|---|
| `secrets-in-code-check` | Pass | Ran against the full diff; 0 matches across all detectors |
| `privacy-and-pii-review` | Pass | Ran against the full diff; 0 findings across PRIV01-05 |
| OWASP Top 10 Web | N/A | `web` surface not detected |
| OWASP API Top 10 | N/A | `api` surface not detected |
| OWASP LLM Top 10 | N/A | `llm-app` surface not detected |
| Capability-authoring review | N/A | `capability-authoring` surface not detected |
| Compliance control mapping | N/A | No compliance framework active for this project |

### Findings
None.

### Prioritized Remediation Queue
None — no findings to remediate.

### Verification Evidence
- No findings were generated, so there is no before/after fix proof to link. Existing functional verification (tsc clean, 87/87 jest tests, manual repro trace) is recorded above under `## Validation Results`.
- Privacy consideration reviewed and accepted (not a finding): `ensureLocalDataScopedTo`/`clearLocalAccountData` persist the bare Firebase `uid` string to AsyncStorage (`localDataOwnerUid`) unencrypted. This is a strictly less sensitive artifact than what the device already durably stores for the same signed-in session (the actual auth credential, held in SecureStore per `auth/secureStoreKeys.ts`), carries no directly-identifying information on its own (no email/name/photo — consistent with `useAuthStore.ts`'s existing "never log user.email/displayName/photoURL/uid" convention, which governs logging, not this bookkeeping use), and is the minimum data needed to implement the uid-scoping guard (data-minimization: only the uid, nothing else, no new PII fields).

### Applied Fixes and Filed Work Items
None — no findings to apply or file.

### Accepted / Deferred / Blocked
- Accepted: storing the bare `uid` locally for owner-tag bookkeeping (see Verification Evidence above) — rationale as stated, no action needed.

### Compliance Control Mapping
N/A — no compliance framework configured for this project (`fraim/config.json` has no compliance customization).

### Run Metadata
- Run date: 2026-08-17
- Skills loaded: `secrets-in-code-check.md`, `privacy-and-pii-review.md` (both loaded successfully, no load errors)
- Skills not loaded (surface not detected, per step 3's on-demand rule): `owasp-top-10-web-review.md`, `owasp-api-top-10-review.md`, `owasp-llm-top-10-review.md`, `capability-authoring-review.md`, `compliance-control-mapping-security.md`
- Auto-fix cap hit: No (0 fixes applied)
- Environment notes: conversational-mode job, no repository/PR configured; review performed directly against the working tree diff

## New Files/Functions Created
| File/Function | Purpose | Who is using/importing/calling it | Actually used? |
|---|---|---|---|
| `app/src/sync/localDataOwner.ts` | Owner-tag tracking + clear/guard primitives | `firestoreSync.ts`, `useAuthStore.ts` | Yes |
| `localDataOwner.ts` `LOCAL_DATA_OWNER_KEY` | AsyncStorage key name for the owner tag | `localDataOwner.ts` itself, `localDataOwner.test.ts` | Yes |
| `localDataOwner.ts` `clearLocalAccountData()` | Clears sessions + resets syncable settings + un-tags owner | `useAuthStore.ts` (`signOut`, `deleteAccount`), `localDataOwner.ts`'s own `ensureLocalDataScopedTo` | Yes |
| `localDataOwner.ts` `ensureLocalDataScopedTo(uid)` | Guards a merge against blending a different account's data | `firestoreSync.ts` `runMigrationAndSync` | Yes |
| `useSettingsStore.ts` `resetSyncableSettings()` | Resets the 4 syncable fields + `settingsUpdatedAt` to defaults | `localDataOwner.ts` `clearLocalAccountData()` | Yes |
| `useSettingsStore.ts` `SYNCABLE_SETTINGS_DEFAULTS` | Default values for the 4 syncable fields | `resetSyncableSettings()` | Yes |
| `app/src/sync/localDataOwner.test.ts` | Unit test suite for the new module | Run via `npm test` | Yes |

## New Tests Added
| Test Case Name | Validates | Result | Failure Analysis |
|---|---|---|---|
| `ensureLocalDataScopedTo` › tags untouched local storage with the first signed-in uid | First-ever sync tags storage without needlessly wiping | Pass | N/A |
| `ensureLocalDataScopedTo` › does not clear local data on a second sync for the same uid | Normal repeat-sync path is unaffected | Pass | N/A |
| `ensureLocalDataScopedTo` › wipes local session history and settings before merging a different uid's data in | Core Critical #1 fix: different-uid guard | Pass | N/A |
| `ensureLocalDataScopedTo` › wipes pre-existing untagged local data (an install predating this fix) before its first tagged sync | Legacy/untagged-with-data case | Pass | N/A |
| `clearLocalAccountData` › clears sessions, resets syncable settings to defaults, and un-tags the owner | Sign-out/delete-account clearing behavior | Pass | N/A |
| `clearLocalAccountData` › does not touch boxSettings | Explicit non-goal from task instructions | Pass | N/A |

## Existing Test Suites Run
| Test Suite | Was it Run | Failing Tests | Failure Analysis |
|---|---|---|---|
| `app/src/stats/*.test.ts` (comparisons, topics, customLabels, sessionHistory, trend, stats) | Yes (full `npm test`) | None | N/A |
| `app/src/sync/sessionMerge.test.ts` | Yes (full `npm test`) | None | N/A |
| `app/src/ble/protocol.test.ts` | Yes (full `npm test`) | None | N/A |
| `app/src/sync/localDataOwner.test.ts` (new) | Yes | None | N/A |

## Pre-Completion Reflection

✅ Reflection Phase 1 (Claim Verification) completed: YES — every validation claim below is backed by an actual command run in this session (tsc, jest full suite, jest targeted, the repro-revert-and-rerun).
✅ Reflection Phase 2 (Risk Analysis) completed: YES — considered and documented the `useStore.sessions` in-memory staleness residual, the ordering requirement vs. `settingsSyncBridge`/`sessionsSyncBridge`, and the `settingsUpdatedAt=0` LWW interaction.
✅ Reflection Phase 3 (Validation Plan Check) completed: YES — matches the Work List's stated validation requirements (tsc, jest, manual reasoning; no UI/mobile validation needed).
✅ Reflection Phase 4 (Self-Audit) completed: YES — re-read the diff against the audit's exact file:line citations and the task's explicit inclusions/exclusions before finalizing.
✅ All blockers from reflection addressed: YES
✅ Confidence level: 95%

**Reflection Summary:** The fix closes the exact mechanism the audit describes — local storage can no longer be merged into or overwrite a different uid's Firestore data — via a small, independently-testable module rather than scattering uid-checks across `firestoreSync.ts`/`useAuthStore.ts`. The one open item is a pre-existing, narrower UX staleness gap in `useStore.ts`'s in-memory session list, explicitly flagged rather than silently left unmentioned or silently fixed out-of-scope.

## Architecture Documentation Update

`docs/rfcs/google-signin-cross-device-sync-architecture.md` updated (this fix introduces a real structural addition to the sync architecture — a local-storage account-boundary guard — that the RFC didn't previously describe):
- New **§4.4 Local storage account-boundary guard**: describes `localDataOwnerUid`, `ensureLocalDataScopedTo`, and `clearLocalAccountData` in present-tense, current-state terms, and how they relate to §4.2's merge policy.
- **§5 checklist item 10** (logout wipe) extended to also require verifying local AsyncStorage (session history + settings) is wiped, not just Keychain/Auth state — this closes the exact documentation gap the audit cited (the existing checklist item only ever tested Keychain/`auth.currentUser`).
- New **§5 checklist item 17**: verifies the wrong-account/shared-device guard specifically.
- Checked the added text for delta-framing language (`since issue|rather than from|used to|previously|no longer|before this|was replaced`) — no matches introduced by this edit.

## Continous Learning
| Learning | Agent Rule Update |
|---|---|
| This repo's `sync/` unit tests deliberately avoid importing anything that transitively initializes Firebase at module load (`initializeApp()` runs at import time in `auth/firebase.ts`); splitting Firebase-free logic into its own module keeps it testable without fighting that constraint. | None filed — already discoverable from the existing test file header comments; no new durable rule needed. |
