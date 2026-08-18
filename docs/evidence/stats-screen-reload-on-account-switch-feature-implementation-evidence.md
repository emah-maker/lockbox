# Feature: Fix Stats-screen staleness on account switch
Issue: #local (manager-delegated workstream; one of three independent, fully-specified fixes — the
other two, a new app icon asset and a horizontal wheel picker for override-presses, are separate
sibling workstreams and out of scope here)
Tech Spec: None — root cause investigated and diagnosed in this session (see Decisions below); a prior
evidence file had already flagged the exact gap without fixing it (see Spec and Design Completeness).
PR: N/A — `fraim/config.json` mode is `conversational` (no repository/branch configured for FRAIM);
changes presented in place in the working tree, no branch or commit created.

## Work List

### Scope
Bug: after switching Google accounts on the same device (sign out → sign in as a different account, or
a direct different-account sign-in on a device still holding another account's data), the Stats screen
kept showing the previous account's session history until the app process restarted or a BLE history
event happened to overwrite it. Root cause: `useStore.ts`'s in-memory `sessions` array — what
`StatsScreen`/`DashboardScreen`/`CalendarScreen` all actually render via `useStore((s) => s.sessions)`
— is populated once at `init()` (`loadSessions()`) and otherwise only updated by BLE's `handleHistory`
and `retagSession`. Two account-lifecycle paths mutate the durable AsyncStorage session log directly,
bypassing the store entirely: `sync/localDataOwner.ts`'s `clearLocalAccountData()` (sign-out/delete,
via `clearSessions()`) and `sync/firestoreSync.ts`'s `syncSessions()` (cross-account/cross-device
merge, via `replaceSessions()`). Neither ever told `useStore` its `sessions` were now stale — an
asymmetry with the equivalent settings path, which already does this correctly
(`useSettingsStore.applyRemoteSettings`/`resetSyncableSettings` are live-state setters, not
storage-only functions).

- [x] `app/src/store/useStore.ts` — added `setSessions(sessions)` action (`set({ sessions })`) so
  external callers that already persisted a session-list change can refresh the live store — ✅ done
- [x] `app/src/auth/useAuthStore.ts` — `signOut()` and `deleteAccount()` each call
  `useStore.getState().setSessions([])` immediately after `clearLocalAccountData()` — ✅ done
- [x] `app/src/sync/firestoreSync.ts` `syncSessions()` — captures `replaceSessions()`'s return value
  and calls `useStore.getState().setSessions(stored)` after the merge — ✅ done
- [x] `app/src/sync/sessionsSyncBridge.ts` — added `markSessionsSeen(sessions)`, called from
  `syncSessions()` immediately *before* `setSessions()`, to stop the bridge's own push-on-change
  subscription from mistaking a cross-device session (one this device never logged) for a newly-logged
  one and re-uploading it under this device's `sessionDocId` — which would create a second Firestore
  doc for the same session and permanently double-count it — ✅ done (see Decisions)
- [x] `docs/rfcs/google-signin-cross-device-sync-architecture.md` §4.4 — documented the new live-store
  mirroring and the `markSessionsSeen` guard — ✅ done

### Validation Requirements
- `uiValidationRequired`: No in the browser/screenshot sense — this is a React Native store/sync fix,
  no new screens/components/visual changes. The observable effect (Stats screen no longer stale after
  an account switch) can't be exercised without a second real Google account and a running app, which
  isn't available this session (see Deferrals).
- `mobileValidationRequired`: No — no native module surface touched.
- Required suites/modes: `tsc --noEmit`, `npm test` (full suite), manual code-trace of both account-
  switch sequences (no multi-account harness available).

### Decisions
- **New `setSessions` action on `useStore`, not a new bridge module.** Mirrors the existing precedent
  in the very same files: `useSettingsStore.applyRemoteSettings`/`resetSyncableSettings` are already
  plain external-facing setters called directly from `firestoreSync.ts`/`localDataOwner.ts` for the
  identical class of problem on the settings side. `useStore.ts`'s own header comment documents it as
  intentionally "zero awareness of auth/network" — adding a generic `setSessions` setter (no Firebase/
  account types, no import of anything auth-related) preserves that; the awareness lives in the callers
  (`useAuthStore.ts`, `firestoreSync.ts`), which already have it.
- **`markSessionsSeen` guard against a duplicate-Firestore-doc regression.** Without it, calling
  `setSessions(stored)` after a cross-device merge would make `sessionsSyncBridge`'s subscribe callback
  see "new" sessions it hasn't personally tracked (anything merged in from another device) and push
  them again via `pushNewSessions`, which builds each doc's ID from *this* device's id
  (`sessionDocId(deviceId, s)`). Since a session's original doc ID was built from whichever device
  first uploaded it, this would create a second, distinct Firestore doc for the same logical session —
  `mergeSessionsPreferLocalTopic` keys strictly by doc ID, so two docs with identical content but
  different IDs merge back in as two separate sessions, permanently inflating focus-time stats on every
  future sync. `syncSessions` already uploads whatever is genuinely new in its own batch, correctly
  keyed — `markSessionsSeen` just stops that from being redundantly (and incorrectly) repeated by the
  bridge. Confirmed this class of guard is an established idiom in this codebase, not new complexity:
  `firestoreSync.ts`'s existing `beginAccountDeletion`/`endAccountDeletion` bracket exists for the exact
  same reason (stopping a push bridge from undoing/duplicating a bulk operation it wasn't the source of).
- **Called `markSessionsSeen` before `setSessions`, not after.** `useStore.subscribe`'s callback (in
  `sessionsSyncBridge.ts`) fires synchronously inside `set()`; marking the sessions seen first ensures
  the callback that fires during `setSessions()` already sees them as accounted for.
- **`useAuthStore.ts`/`firestoreSync.ts` import `useStore.ts` directly, not through a new bridge.**
  Both already sit above `useStore.ts` in the dependency graph for this purpose (neither is imported by
  `useStore.ts`), so no cycle. `firestoreSync.ts` also now imports `sessionsSyncBridge.ts`, which
  already imports `firestoreSync.ts` (for `pushNewSessions`) — a circular import, but a safe one: both
  new usages (`markSessionsSeen` and `pushNewSessions`) are called only from inside function bodies
  (`syncSessions`, the subscribe callback), never referenced at module-evaluation time, which is the
  standard safe pattern for circular ES module dependencies under Metro/TypeScript. Verified no runtime
  or type error resulted (`tsc --noEmit` clean, full `jest` suite green).
- **Did not touch `sync/localDataOwner.ts`.** That module is deliberately Firebase-free and directly
  unit-tested (`localDataOwner.test.ts`) without any BLE/native-module dependency. `useStore.ts`
  transitively imports `react-native-ble-plx` (via `PhoneBoxClient`) at module scope — importing
  `useStore` into `localDataOwner.ts` would drag that into `localDataOwner.test.ts`'s import graph and
  risk breaking a test suite that currently has no native-module mocking. Both of `clearLocalAccountData`'s
  real call sites (`useAuthStore.signOut`/`deleteAccount`) already live in untested, Firebase-aware
  modules, so the `setSessions([])` call was added there instead, right after each `clearLocalAccountData()`
  call — same effect, zero test-risk.

### Deferrals
- **End-to-end manual verification (real two-account switch on a running app)** — deferred, no second
  Google/Firebase test account or device harness available in this session (same limitation the prior
  `production-readiness-critical-1-uid-scoping` evidence file recorded for the identical subsystem).
  Covered instead by a code-level trace of both account-switch sequences (see Validation Results) and
  the existing `sessionMerge.test.ts`/`localDataOwner.test.ts` suites, which are unaffected and still
  pass.

## Validation Results
Latest run only.

| Validation Step | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` (app/) | ✅ Pass — no errors | |
| `npx jest` (full suite, app/) | ✅ Pass — `Test Suites: 9 passed, 9 total`, `Tests: 89 passed, 89 total` | No suite touches `useStore.ts`/`useAuthStore.ts`/`firestoreSync.ts`/`sessionsSyncBridge.ts` directly (all four are BLE- or Firebase-dependent and, per this repo's own convention, deliberately kept out of the jest-tested surface) — this run is a regression check that the new imports/wiring don't break anything that *is* tested (`sessionMerge.test.ts`, `localDataOwner.test.ts`, the `stats/*` suites). |
| Diff scope check | ✅ Pass | `git diff` limited to `app/src/auth/useAuthStore.ts`, `app/src/store/useStore.ts`, `app/src/sync/firestoreSync.ts`, `app/src/sync/sessionsSyncBridge.ts`, plus the RFC doc update — no other tracked file touched by this workstream. (Two sibling workstreams' uncommitted changes to `SettingsScreen.tsx`/`WheelPicker.tsx` and new icon assets are present in the working tree but untouched by, and unrelated to, this fix.) |
| UI polish check | N/A — no screens/components changed | This fix is store/sync logic only. |

### Manual Reasoning: account-switch sequences (no multi-account harness available)

**Sequence A — sign out, then a different account signs in on the same device (app stays running):**
1. `useAuthStore.signOut()`: `signOutFully()` → `clearLocalAccountData()` (storage wiped, as before) →
   **new:** `useStore.getState().setSessions([])` clears the live array immediately. Stats/Dashboard/
   Calendar re-render with zero sessions the instant sign-out completes, not on next restart.
2. User B signs in: `onAuthStateChanged` → `syncNow()` → `runMigrationAndSync(B.uid)` →
   `ensureLocalDataScopedTo` (no-op, already cleared) → `syncSessions(B.uid)` merges B's empty local set
   with B's own Firestore sessions, `replaceSessions` persists the result, **new:**
   `markSessionsSeen(stored)` then `useStore.getState().setSessions(stored)` makes the live store (and
   therefore Stats/Dashboard/Calendar) reflect exactly B's reconciled session set.

**Sequence B — a different account signs in directly, app never restarted, no intervening sign-out**
(shared/reset device case):
1. Device holds A's sessions in both storage and the live store.
2. B signs in: `runMigrationAndSync(B.uid)` → `ensureLocalDataScopedTo(B.uid)` detects the owner-tag
   mismatch, wipes storage via `clearLocalAccountData()` (live store *not* touched by this call, by
   design — see Decisions) → `syncSessions(B.uid)` runs next in the same `runMigrationAndSync` call,
   merges B's (now-empty) local set with B's Firestore sessions, and its own `setSessions(stored)` call
   updates the live store to B's data. Net effect: the live store transiently still shows A's sessions
   between the wipe and the merge completing (both are awaited in the same async call, no intermediate
   render reads a half-updated state), and ends up correctly showing only B's data once
   `runMigrationAndSync` resolves — the same outcome as sequence A.

**Double-push guard check:** in both sequences, `markSessionsSeen(stored)` runs before `setSessions`,
so `sessionsSyncBridge`'s subscribe callback (which fires synchronously inside `setSessions`'s `set()`
call) sees every session in `stored` already in its `seen` set and pushes nothing — traced by reading
`sessionsSyncBridge.ts`'s subscribe body against the new `markSessionsSeen` implementation line-by-line.

## Bug Bash Findings
- Confirmed `useStore.setSessions` is a plain `set({ sessions })` with no side effects of its own — it
  cannot itself trigger a BLE call, storage write, or Firestore write; only existing subscribers
  (`sessionsSyncBridge`'s push-on-change) react to the resulting state change, which is exactly why the
  `markSessionsSeen` ordering matters and was checked explicitly (see above).
- Confirmed `clearLocalAccountData()` itself is unmodified (still storage-only) — the new
  `setSessions([])` calls live at both of its two call sites in `useAuthStore.ts`, not inside it, so
  `localDataOwner.ts`/`localDataOwner.test.ts` are byte-for-byte unaffected (verified: `git diff` shows
  zero changes to either file).
- Confirmed no other reader of `useStore.sessions` exists beyond `StatsScreen.tsx`, `DashboardScreen.tsx`,
  and `CalendarScreen.tsx` (grepped for `s.sessions` / `useStore((s) =>` across `app/src`) — no other
  screen needed updating for this fix to be complete.
- Confirmed the pre-existing storage-layer race between `syncSessions`'s `replaceSessions` and BLE's
  `handleHistory`'s `appendSessions` (both read-modify-write the same AsyncStorage key without a lock)
  is unchanged by this fix — this diff mirrors whichever write already won into the live store, it
  doesn't add or remove a race that wasn't already there at the storage layer.
- 0 Critical/High findings introduced by this diff; 1 Medium-severity risk identified and fixed inline
  during implementation (the duplicate-Firestore-doc regression from `sessionsSyncBridge`'s push
  subscription — see Decisions, `markSessionsSeen`) rather than left for a separate review pass.

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) — one new store action (`setSessions`, a one-line
  `set()`), one new bridge export (`markSessionsSeen`, a 2-line loop), and four call-site additions; no
  new files, classes, or abstractions.
- [x] No resource waste (excessive retries, delays, workarounds) — no polling/timers; `markSessionsSeen`
  is an O(n) loop over data already in hand from the merge that just ran.
- [x] Solution follows an existing proven pattern — mirrors `useSettingsStore.applyRemoteSettings`/
  `resetSyncableSettings`, the equivalent already-correct pattern for settings in the same files.
- [x] All new files/functions are actually used — `setSessions` used by `useAuthStore.ts` (2 call
  sites) and `firestoreSync.ts` (1 call site); `markSessionsSeen` used by `firestoreSync.ts` (1 call
  site).
- [x] No new files, TODOs, or placeholder code.

## Spec and Design Completeness

**Feature Requirements Source**: Manager-delegated bug report ("Fix Stats-screen staleness on account
switch"), no separate feature spec. Root cause independently investigated this session; the exact gap
had already been identified and explicitly deferred in
`docs/evidence/production-readiness-critical-1-uid-scoping-feature-implementation-evidence.md`'s
Deferrals section ("Known residual gap, flagged not fixed... `useStore.ts`'s in-memory `sessions` array
... is not refreshed by `clearLocalAccountData()` or by the merge inside `syncSessions`"), which this
workstream now closes.
**Technical Design Source**: `docs/rfcs/google-signin-cross-device-sync-architecture.md` §4.2/§4.4,
updated by this workstream to document the fix (see Work List).

### Feature Requirement Traceability Matrix
| Requirement/Acceptance Criteria | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Stats screen (and Dashboard/Calendar) no longer show a stale account's sessions after sign-out | `useAuthStore.ts` `signOut`/`deleteAccount` → `useStore.setSessions([])` | Code trace (Sequence A/B above); `tsc`/`jest` regression clean | Met (code-level; no live multi-account harness this session) |
| ...or after signing in as a different account / merging cross-device data | `firestoreSync.ts` `syncSessions` → `useStore.setSessions(stored)` | Code trace (Sequence A/B above) | Met (code-level) |
| No duplicate/double-counted Firestore session docs introduced by the fix | `sessionsSyncBridge.ts` `markSessionsSeen`, called before `setSessions` in `syncSessions` | Code trace of `subscribe` callback against `markSessionsSeen`'s `seen`-set update | Met |
| No change to `localDataOwner.ts` / its test suite | `git diff` — file untouched | `localDataOwner.test.ts` still 100% pass, unchanged | Met |

**Feature Requirements Completeness Summary**:
- Implemented: 4/4 items (100%)
- Deferred: 1 (live two-account manual verification — no harness available, same limitation as the
  prior related fix)
- Missing: 0

**Scope Changes from Spec / Design**: None beyond what root-causing the bug required — the
`markSessionsSeen` guard was not explicitly requested but is necessary to prevent this fix from
introducing a new, real correctness bug (double-counted stats), not a speculative addition.

## Existing Test Suites Run
| Test Suite | Was it Run | Failing Tests | Failure Analysis |
|---|---|---|---|
| `app/src/stats/*.test.ts` (comparisons, customLabels, sessionHistory, stats, topics, trend) | Yes (full `npm test`) | None | N/A |
| `app/src/sync/sessionMerge.test.ts` | Yes | None | N/A |
| `app/src/sync/localDataOwner.test.ts` | Yes | None | N/A |
| `app/src/ble/protocol.test.ts` | Yes | None | N/A |

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium (post-fix), 0 Low findings. One Medium-severity risk (duplicate Firestore
session docs from an unguarded live-store refresh) was identified during implementation and fixed
inline (`markSessionsSeen`) before this review, rather than shipped and caught later.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`: `app/src/store/useStore.ts`, `app/src/auth/useAuthStore.ts`,
  `app/src/sync/firestoreSync.ts`, `app/src/sync/sessionsSyncBridge.ts`

### Threat Surface Summary
Surface: `mobile` (React Native app code). No new network endpoint, no new user input handling, no new
storage of credentials/PII — this diff only changes which in-memory store a value already fetched from
Firestore/AsyncStorage is written to, plus a de-dup guard against redundant writes.

### Coverage Matrix
| Category | Result |
|---|---|
| Secrets-in-code check | Pass — no secret-shaped strings added (grep for `key\|secret\|token\|password\|api_key`: 0 matches in the diff) |
| Privacy/PII review | Pass — no new field of user data introduced; `setSessions`/`markSessionsSeen` operate on the same `LoggedSession` shape (`startedAt`/`plannedS`/`actualS`/`outcome`/`topic`) already flowing through this code, never logged |
| Data-integrity check (project-specific, given this diff's own risk) | Pass — `markSessionsSeen` guard confirmed by code trace to prevent the duplicate-doc regression (see Decisions/Bug Bash Findings) |

### Findings
None (the one Medium risk found was fixed during implementation, not left open — see Executive Summary).

### Prioritized Remediation Queue
Empty.

### Verification Evidence
Manual diff read of all four changed files confirming: no new I/O beyond the pre-existing
`replaceSessions`/Firestore calls this diff sits next to; no new persisted field; the `markSessionsSeen`
→ `setSessions` ordering holds in the one call site where both are used (`firestoreSync.ts` `syncSessions`).

### Accepted / Deferred / Blocked
None.

### Run Metadata
- Run date: 2026-08-18
- Environment notes: conversational-mode job, no repository/PR configured; reviewed directly against
  the working-tree diff.

## Pre-Completion Reflection
- **Claim verification**: Re-read all four edited files in full post-edit (not just the diff) to
  confirm the `setSessions`/`markSessionsSeen` call ordering is correct in both `useAuthStore.ts` call
  sites and in `firestoreSync.ts`'s `syncSessions`.
- **Risk analysis**: Main risk identified and closed was the duplicate-Firestore-doc regression from
  `sessionsSyncBridge`'s push subscription reacting to the new bulk `setSessions` call (see Decisions).
  Secondary risk (dragging BLE deps into `localDataOwner.test.ts`) was avoided by keeping `useStore`
  out of `localDataOwner.ts` entirely and placing the `setSessions([])` calls at `useAuthStore.ts`'s two
  call sites instead.
- **Validation plan check**: Ran the two automatable checks available (`tsc --noEmit`, full `jest`
  suite) and documented, in three places, that live two-account verification is deferred for lack of a
  harness — consistent with how the identical limitation was handled in the prior related evidence file.
- **Self-audit**: No new files, no TODOs, no placeholder code; diff scoped to exactly the four files
  needed plus one RFC doc update. Confirmed via `git diff` that two other workstreams' concurrent,
  unrelated changes in the working tree (`SettingsScreen.tsx`, `WheelPicker.tsx`, new icon assets) were
  not touched or interfered with.
- Confidence level: 90% — the fix directly closes the exact, previously-diagnosed gap, is minimal, and
  is backed by a full type-check and passing regression suite, but the actual user-visible behavior
  (Stats screen refreshing correctly after a real account switch) is unverified on a running app with a
  second real account, which is the reason this stays below a higher figure.

## Continous Learning
| Learning | Agent Rule Updates |
|---|---|
| A prior evidence file's "Deferrals" section explicitly naming a residual gap (`useStore.sessions` staleness) was the single most valuable piece of scoping context for this task — reading past evidence files for the same subsystem before investigating from scratch turned a from-scratch root-cause hunt into a targeted verification-and-fix. | None — captured here; consistent with existing `project_rules.md` graphify-first guidance for "what did we already decide about Z." |
| A live-state mirror added for a UX fix (staleness) can silently reopen a *different*, more severe correctness bug (duplicate Firestore docs / double-counted stats) if it triggers an existing push-on-change subscription that wasn't written with bulk external replacement in mind. Worth checking for any `store.subscribe(...)` in the same file/adjacent files before adding a new `set()` call site to a store that already has one. | None filed — captured here; no existing rule contradicted. |
