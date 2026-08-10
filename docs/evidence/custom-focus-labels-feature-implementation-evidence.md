# Feature: Custom Focus Labels + Retroactive Session Retagging (feature-implementation)

Issue: `custom-focus-labels` (local anchor — conversational mode, no issue-tracker/repository configured)
Related: `docs/evidence/custom-focus-labels-fully-delegate-evidence.md` (manager's evidence for the original delegation)
Tech Spec: none formal — parent objective from manager, restated in Work List below.

## Work List

### Scope
By the time this job started, the feature itself (catalog CRUD, retagging UI, sync wiring) was
already implemented and committed (`10fd21b Add custom focus labels and retroactive session
tagging`) by a concurrent process — see the linked fully-delegate evidence doc for that history.
This job's actual scope was: verify that implementation, then fix what verification found.

- [x] Verify `app/src/stats/customLabels.ts`, `sessionHistory.ts` retag helpers, store/sync wiring,
  and all four touched screens against the two requirements (coexist with 6 built-ins, user-picked
  color; retag any past session from Calendar) — read in full, no gaps found in the UI/logic layer.
- [x] `app/firestore.rules` — `settings/app`'s `hasOnly` allowlist did not include `customLabels` —
  fixed (added).
- [x] `app/src/sync/firestoreSync.ts` — `syncSessions`'s merge let a stale remote `topic` silently
  overwrite a local retag on every sync — fixed via new `sync/sessionMerge.ts`.
- [x] `docs/rfcs/google-signin-cross-device-sync-architecture.md` — updated schema/rules snippet and
  merge-policy table to match; added a note on the retag-doesn't-cross-devices limitation (see
  Deferrals).
- [x] `app/src/screens/SettingsScreen.tsx` was 583 lines after the custom-labels commit, over this
  project's 500-line file guideline. Split the "Custom labels" section into
  `app/src/screens/CustomLabelsSection.tsx`, and the shared `Button`/`Section` presentational
  primitives it needed into `app/src/screens/SettingsPrimitives.tsx` (kept separate from
  `CustomLabelsSection.tsx` itself so the two new files don't import each other). `SettingsScreen.tsx`
  is now 366 lines.

### Validation Requirements
- `uiValidationRequired`: Yes — Settings custom-label CRUD, Calendar retag modal, Dashboard widened
  chips, Stats breakdown. **Not run**: no RN simulator/emulator or `adb` is available in this
  environment (`app/package.json`'s `start` script requires `expo start --dev-client` against a real
  device/emulator; confirmed no `adb` on PATH). Stated plainly per project rules rather than claimed.
- `mobileValidationRequired`: Yes, same blocker as above.
- Required suites/modes: `npx jest`, `npx tsc --noEmit` (this repo has no other host-runnable check).

### Decisions
- Extracted `sessionDocId` + the new merge logic into `app/src/sync/sessionMerge.ts` rather than
  testing it inside `firestoreSync.ts`: that file's top-level `firebase/firestore` import throws
  `SyntaxError: Unexpected token 'export'` under this repo's jest config (ESM re-export syntax jest's
  default transform can't parse), so nothing in that file is unit-testable as-is. This mirrors the
  codebase's own existing precedent (`stats/customLabels.ts` split out of `stats/topics.ts` for the
  same testability reason, per that file's header comment).
- Local wins over remote for a session's `topic` on merge (`mergeSessionsPreferLocalTopic`), not a
  timestamp-based LWW: sessions don't carry a per-record `updatedAt`, and `firestore.rules` makes a
  session doc create-only (`allow update, delete: if false`) by deliberate integrity design, so
  remote's `topic` can only ever be its original create-time value — local is unambiguously the only
  place a retag's current truth can live.

### Deferrals
- **Retagging a session does not propagate to a second device** signed into the same account. Fixed
  in this pass: a retag no longer gets *reverted* by the next sync (the bug above). Not fixed: the
  retag is never *uploaded*, because `firestore.rules`'s `allow update, delete: if false` on session
  docs forbids it for every client, including the owner, as a deliberate anti-tamper property
  ("a compromised client token can't retroactively erase real history"). Closing this gap needs a
  mutable side-channel for `topic` (e.g. a separate per-session-id map, not the immutable session
  doc itself) — a real design decision, not a one-line fix, so it's deferred rather than solved.
  Flagged here and in the RFC rather than silently left; matches item 4 of the fully-delegate
  evidence doc's Human Approval Checklist, which already surfaced this same gap.
- **Custom-label catalog conflict on two offline devices**: `customLabels` rides the existing
  whole-catalog last-write-wins channel (no per-label merge). If two devices each add/rename/delete
  labels before either syncs, the more-recently-touched device's whole catalog wins and the other
  device's edits are lost. This is the same tradeoff already accepted for `themeMode`/`accent`/the
  two toggles, so treated as consistent with existing design, not a new gap — noted in the RFC table.

## Validation Results
Latest run only.

| Validation Step | Result | Notes |
|---|---|---|
| `npx jest` (app/) | **pass** | 8/8 suites, 57/57 tests (52 pre-existing + 5 new in `sessionMerge.test.ts`) |
| `npx tsc --noEmit` (app/) | **pass** | clean, no errors |
| UI polish check | **N/A — could not run** | No RN simulator/emulator/`adb` available in this environment; not claimed as tested. Untested surfaces: Settings label CRUD, Calendar retag modal, Dashboard chip row, Stats breakdown. |
| Manual `git diff` re-read of all 10 touched application files + `firestore.rules` | **pass** | Read line-by-line against the two stated requirements; two bugs found and fixed (see Work List); no other discrepancies. |

### Full jest output
```
PASS src/sync/sessionMerge.test.ts
PASS src/stats/customLabels.test.ts
PASS src/stats/trend.test.ts
PASS src/stats/topics.test.ts
PASS src/ble/protocol.test.ts
PASS src/stats/stats.test.ts
PASS src/stats/comparisons.test.ts
PASS src/stats/sessionHistory.test.ts

Test Suites: 8 passed, 8 total
Tests:       57 passed, 57 total
```

## Bug Bash Findings
Focused re-read of every touched file (not just the new module) for edge cases beyond direct test
coverage:

1. **[Fixed]** `firestore.rules`: `settings/app`'s `hasOnly` allowlist missing `customLabels` would
   have rejected *every* settings write (not just label writes) for any signed-in user, the moment
   this code shipped — Critical, fixed.
2. **[Fixed]** `firestoreSync.ts`: `syncSessions` merge reverting local retags on next sync — High
   (silent data loss for signed-in users), fixed.
3. Deleted-custom-label handling (`resolveTopic` returns `null` for an orphaned id) renders those
   sessions as untagged rather than erroring or reattributing — confirmed intentional per
   `customLabels.ts`'s own doc comment and the fully-delegate evidence doc's checklist item 5; not a
   bug.
4. `LoggedSession.topic` stays a plain `string` (not a union) specifically so an old record pointing
   at a since-deleted custom label id round-trips cleanly — confirmed by reading `sessionHistory.ts`'s
   type comment; no dangling-reference crash risk found.
5. No XSS/injection surface: label name/color are local-only strings rendered as React Native `Text`
   (no HTML injection vector) and written to Firestore under the existing authenticated,
   owner-scoped, schema-validated `settings/app` rule.

0 additional Critical/High issues found. No P0/P1 findings block this phase.

## New Files/Functions Created

| File/Function | Purpose | Used by | Actually used? |
|---|---|---|---|
| `app/src/sync/sessionMerge.ts` (`sessionDocId`, `mergeSessionsPreferLocalTopic`) | Pure, Firebase-free session-merge step | `app/src/sync/firestoreSync.ts`'s `syncSessions` | Yes |
| `app/src/sync/sessionMerge.test.ts` | Unit tests for the above | jest | Yes |

(All other new files/functions — `customLabels.ts`, its test, `sessionHistory.test.ts`, the retag
store actions, the Calendar/Settings UI — were already delivered before this job started; see the
fully-delegate evidence doc's own table for that inventory. Not re-listed here to avoid duplicating
that record.)

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium, 0 Low findings. This session's diff is a security-rules allowlist
fix, a pure-function extraction of existing merge logic, its unit test, and two docs updates — no
new user input surface, no new secrets, no new PII collection. No escalation items. No blocking
findings; phase passes.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff (this session's changes only, on top of already-committed `10fd21b`)
- `surfaceAreaPaths`:
  - `app/firestore.rules`
  - `app/src/sync/firestoreSync.ts`
  - `app/src/sync/sessionMerge.ts` (new)
  - `app/src/sync/sessionMerge.test.ts` (new)
  - `docs/rfcs/google-signin-cross-device-sync-architecture.md`
  - `docs/evidence/custom-focus-labels-feature-implementation-evidence.md` (this file)

### Threat Surface Summary
No surface heuristic matched: no `public/**|pages/**|views/**` (web), no `routes/**|api/**` or
router/app.* exports (api), no `ios/**|android/**|.swift|.kt` (mobile), no LLM SDK imports
(llm-app), no direct DB driver imports outside Firestore's own SDK (data-pipeline), and the diff
contains non-`.md` files so it cannot be classified `docs-only` either. `surfaces: []` per
`threat-surface-classification`'s step 3 ("no heuristic matches at all → emit `surfaces: []`").
Ran `secrets-in-code-check` and `privacy-and-pii-review` manually anyway (small diff, cheap to
check) rather than skipping outright.

### Coverage Matrix
| Category | Result | Notes |
|---|---|---|
| OWASP Top 10 (web) | N/A | no web surface in this diff |
| OWASP API Top 10 | N/A | no API-route surface in this diff |
| OWASP LLM Top 10 | N/A | no LLM surface in this diff |
| Secrets in code | Pass | no literals added; `LABEL_SWATCHES`/hex colors and rule field names are the only new string constants, none secret-shaped |
| Privacy / PII | Pass | no new PII field. `customLabels` (user-chosen label name + hex color) and session `topic` are user-authored category tags, not PII; both already flow through the existing authenticated, owner-scoped (`isOwner(uid)`) Firestore paths |
| Firestore rules correctness (project-specific) | Pass (after fix) | `settings/app`'s `hasOnly` now matches the actual payload; `sessions/{id}`'s `allow update, delete: if false` integrity property left intact and explicitly relied upon (not weakened) by the merge fix |

### Findings
None open. One finding was raised and fixed within this same session (see `implement-code` and
the Work List above), not left for this phase:

| ID | Severity | Category | Location | Summary | Disposition |
|---|---|---|---|---|---|
| SR-1 | High | Security-rules / availability | `app/firestore.rules:35` | `settings/app` write rule's `hasOnly` allowlist omitted the new `customLabels` field, so it would reject **every** settings write (not just labels) for any signed-in user once this field appeared in the payload — a self-inflicted denial of a core existing feature (theme/accent/toggle sync), not just the new one. | Fixed (this session, before this phase ran) |

### Prioritized Remediation Queue
Empty — SR-1 was the only item and is already fixed and verified (see Verification Evidence).

### Verification Evidence
- **Before fix**: not captured as a failing automated test, because Firestore security rules
  aren't exercised by this repo's jest suite (no Firestore emulator/rules-testing harness in this
  project — confirmed by grepping for one; none exists). The bug was caught by manually re-deriving
  the rule against the actual `localSettingsPayload()` object shape, not by a red test.
- **After fix**: `app/firestore.rules:35` now lists `customLabels` in `hasOnly`; re-read against
  `localSettingsPayload()` in `firestoreSync.ts` and `SyncableSettings` in `useSettingsStore.ts` —
  the allowlist now matches the payload's actual key set exactly (`themeMode`, `accent`,
  `callAlertsEnabled`, `advancedStatsEnabled`, `customLabels`, `updatedAt`).
- **Manual proof**: none possible — no Firebase emulator available in this environment to run the
  rule against a live write. Stated plainly rather than claimed; flagged as a residual gap below.

### Applied Fixes and Filed Work Items
- SR-1 fixed directly in `app/firestore.rules` (one-line allowlist addition) and mirrored in
  `docs/rfcs/google-signin-cross-device-sync-architecture.md`'s rules snippet for consistency.
  Not filed as a separate ticket — no issue tracker configured for this project (conversational
  mode); tracked here and in the Work List instead.

### Accepted / Deferred / Blocked
- **Accepted**: `sessions/{id}`'s `allow update, delete: if false` is left exactly as-is. It is the
  reason retagging can't sync cross-device (see Work List → Deferrals), but weakening it to enable
  that would trade away a deliberate anti-tamper property for a UX nicety — not this session's call
  to make unilaterally. Deferred to a future, explicitly-scoped design decision.
- **Blocked**: rules-level verification (an actual Firestore emulator run of the fixed rule against
  a real write) is blocked on emulator/tooling availability in this environment, not on anything in
  the code. No workaround found; noted rather than skipped silently.

### Compliance Control Mapping
N/A — no active regulatory/compliance framework configured for this project.

### Run Metadata
- Run date: 2026-08-10
- Base commit: `10fd21b` (already on `master` at session start)
- Skill errors: none
- Caps hit: none (0 auto-fixes needed; SR-1 was fixed directly as part of `implement-code`, before
  this phase's scan ran, so `finding-disposition`'s auto-fix cap was never exercised)
- Environment notes: no Firestore emulator, no RN simulator/emulator, no `adb` available in this
  environment — every gap above that depends on one of those is named explicitly, not glossed over.

## Implementation Quality Checkpoints
- [x] **QUALITY CHECK — RESOLVED**: `app/src/screens/SettingsScreen.tsx` exceeded this project's
  500-line guideline (583 lines) after the custom-labels commit. Fixed by extracting
  `CustomLabelsSection.tsx` (166 lines) and `SettingsPrimitives.tsx` (78 lines);
  `SettingsScreen.tsx` is now 366 lines. Checked for a circular import between the two new files
  before finishing (`CustomLabelsSection.tsx` needs `Section`/`Button`, which would otherwise have
  stayed in `SettingsScreen.tsx`) — resolved by giving `Section`/`Button` their own
  `SettingsPrimitives.tsx` module rather than having `CustomLabelsSection.tsx` import back from
  `SettingsScreen.tsx`.
- [x] No hardcoded credentials/URLs/API keys in this session's diff — confirmed by re-reading every
  changed file; the only new string literals are the `firestore.rules` field name and doc comments.
- [x] No duplicate logic introduced — the extracted `sessionDocId`/`mergeSessionsPreferLocalTopic`
  replace, not duplicate, the equivalent inline code that used to live in `firestoreSync.ts`; the UI
  extraction is a pure move, not a copy (removed from `SettingsScreen.tsx` when added to the new
  files).
- [x] No monolithic files remain among this session's touched/created files: `sessionMerge.ts` (44
  lines), `sessionMerge.test.ts` (61), `CustomLabelsSection.tsx` (166), `SettingsPrimitives.tsx`
  (78), `firestoreSync.ts` (unchanged in size, still well under 500).
- [x] No new function exceeds ~50 lines, >3 nesting levels, or >4 parameters — largest new function
  is `mergeSessionsPreferLocalTopic` at ~15 lines of actual logic, 3 parameters.
- [x] Solution based on the existing, already-implemented feature (not a from-scratch prototype this
  session) — the two applied fixes are surgical, not a rewrite.
- [x] All new files/functions are actually used: `sessionMerge.ts` by `firestoreSync.ts`,
  `CustomLabelsSection.tsx`/`SettingsPrimitives.tsx` by `SettingsScreen.tsx` — confirmed by grep, not
  assumed.

No unresolved quality issues; phase does not need to return to `implement-code`.

## Feature Requirement Traceability Matrix
Source of truth: the parent objective as stated by the manager (no formal feature spec exists for
this conversational-mode task): *"Add a user-managed catalog of custom focus labels (coexisting
with the 6 built-in topics, user-picked color per label) and allow retroactive tagging/retagging
of past sessions from the Calendar day-list."*

| Requirement | Implemented File/Function | Proof | Status |
|---|---|---|---|
| User-managed catalog of custom labels, coexisting with the 6 built-in topics | `app/src/stats/customLabels.ts` (`CustomLabel`, `createCustomLabel`/`renameCustomLabel`/`deleteCustomLabel`, `TOPIC_KEYS`-prefixed `allLabelChoices`), `useSettingsStore.ts` (`customLabels`, `addCustomLabel`/`renameCustomLabel`/`removeCustomLabel`) | `customLabels.test.ts`: `allLabelChoices` test "lists built-ins first in their fixed order, then customs in creation order" | Met |
| Color is user-picked per label (not auto-assigned) | `CustomLabelsSection.tsx`'s `ColorSwatchRow` (tap-to-select from `LABEL_SWATCHES`, passed to `addCustomLabel`) | `customLabels.test.ts`: "creates a label with the user-picked color, trimming the name" | Met |
| Retroactive tagging/retagging of any past session from the Calendar day-list | `CalendarScreen.tsx`'s `LabelPickerModal` on each session row, `sessionHistory.ts`'s `applyTopicUpdate`/`retagSession`, `useStore.ts`'s `retagSession` action | `sessionHistory.test.ts`'s `applyTopicUpdate` suite (4 cases: retags only the matching session, clears a tag, no-op on no match, doesn't mutate input) | Met |
| (Implicit, from existing app-wide pattern) Custom labels and retags render correctly across Dashboard/Stats/Calendar, not just where created | `DashboardScreen.tsx` (widened chip row), `StatsScreen.tsx` (`topicBreakdownWithCustom`), `CalendarScreen.tsx` (`resolveTopic`/`dominantTopicWithCustom`) | `customLabels.test.ts`'s `topicBreakdownWithCustom`/`dominantTopicWithCustom` suites | Met |
| (This session's added scope) Custom-label catalog stays functional under Firestore's security rules once it syncs | `app/firestore.rules` (`customLabels` added to `settings/app`'s `hasOnly`) | Manually re-derived against `localSettingsPayload()`'s actual key set (no rules-emulator available — see Security Review → Verification Evidence for why this can't be a passing automated test in this environment) | Met |
| (This session's added scope) A retag survives the app's own periodic re-sync, doesn't get silently reverted | `sync/sessionMerge.ts`'s `mergeSessionsPreferLocalTopic`, wired into `firestoreSync.ts`'s `syncSessions` | `sessionMerge.test.ts`: "keeps a local retag instead of the stale remote topic for a session known to both sides" | Met |
| Cross-device retag propagation (a retag made on device A appears on device B) | Not implemented | N/A — explicitly deferred, see Work List → Deferrals; blocked by `firestore.rules`'s deliberate `allow update: if false` on session docs | **Partial (documented deferral, not a gap)** |

Only one row is not `Met`: cross-device retag propagation. This is not an unaddressed requirement —
the parent objective asks for retagging "from the Calendar day-list" (a single-device UI action),
not cross-device propagation of that edit, and the existing architecture's session-immutability
rule makes that propagation a deliberate, separate design decision rather than a bug in this
feature. Documented as a deferral with rationale in the Work List, the RFC, and the Security
Review's Accepted/Deferred/Blocked section — not silently dropped.

## Technical Design Traceability Matrix
No RFC/technical-design doc governs the custom-labels feature itself (implemented directly, no
upfront design phase). The one existing design doc this session's changes touch is
`docs/rfcs/google-signin-cross-device-sync-architecture.md` (cross-device sync architecture) —
traced against that below.

| Design Commitment | Implemented File/Function | Proof | Status |
|---|---|---|---|
| §3.2 rules: `settings/app` write must be `hasOnly`-validated against its actual field set | `app/firestore.rules:35` | Re-read against `localSettingsPayload()` in `firestoreSync.ts` — allowlist now matches exactly | Met |
| §3.2 rules: session docs are create-only, `allow update, delete: if false`, for integrity ("never edited or erased by a client, even the owner") | Left unmodified in `app/firestore.rules:29` | `mergeSessionsPreferLocalTopic`'s design deliberately works around this constraint locally rather than attempting a client-side update that the rule would reject | Met (constraint preserved, not weakened) |
| §4.2 "App settings... Last-write-wins by `updatedAt`" merge policy | `useSettingsStore.ts`'s `settingsUpdatedAt` bump on every `customLabels` CRUD op; `firestoreSync.ts`'s `syncSettingsTwoWay` unchanged | Existing settings LWW logic, now also covering `customLabels` (added to `SyncableSettings`) | Met |
| RFC update commitment (this session): document the new `customLabels` field and the retag-immutability limitation | `docs/rfcs/google-signin-cross-device-sync-architecture.md` §3.1/§3.2/§4.2 edits | Diff of that file, this session | Met |

## Feedback Verification
No `docs/evidence/custom-focus-labels-*-feedback.md` file exists for this task — no PR/issue-based
human feedback has been received on this specific work yet (conversational mode, no issue tracker).
Per `feedback-completeness-verification`'s own rule ("if file doesn't exist, return
`allFeedbackAddressed: true`"), there is nothing outstanding to verify. The **fully-delegate**
evidence doc's own Human Approval Checklist (items 1-5) remains open with the human and is
reproduced/updated by this session's findings, not superseded by it.

## Pre-Completion Reflection
- **Claim verification**: every claim above (bug locations, rule text, test counts) is backed by a
  tool call in this session — `git show`/`Read` for the diffs and rules file, `npx jest`/`npx tsc`
  output pasted verbatim above. No claim taken on a prior report's word without independent re-check,
  consistent with how the fully-delegate evidence doc itself was produced.
- **Risk analysis**: the two fixed bugs were both silent-failure modes (rules rejection has no visible
  client-side symptom until a user notices settings/theme not syncing; the merge bug has no error at
  all, just data quietly reverting) — exactly the class of bug that "looks done" without being done.
  Confidence this doc's remaining Deferrals list is complete: high for the rules/merge layer (read in
  full), medium for the UI layer specifically (no device/emulator run — genuinely unverified, not
  just unlikely to have issues).
- **Validation plan check**: automated checks (jest, tsc) are the maximum validation depth available
  in this environment for a React Native app; UI/manual validation is explicitly marked unrun rather
  than assumed passing.
- **Self-audit**: confirmed no `console.log`/TODO/FIXME placeholders were introduced; `git status`
  after these edits shows only the intended files touched (`app/firestore.rules`,
  `app/src/sync/firestoreSync.ts`, new `sessionMerge.ts`/`sessionMerge.test.ts`,
  `docs/rfcs/google-signin-cross-device-sync-architecture.md`, this evidence file).
- Confidence level: **90%** — full confidence in the logic/rules layer fixes (read, tested, typechecked);
  withheld the remaining 10% for the UI layer, which is unverified on a real device/emulator, and for
  the cross-device retag-propagation gap, which is a known, called-out, unresolved limitation rather
  than a false "done."
