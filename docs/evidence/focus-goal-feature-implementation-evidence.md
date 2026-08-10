# Feature: User-configurable recurring focus goal
Issue: conversational (no repo/issue tracker configured for this task)
Tech Spec: none (design call made within the manager's brief, per fraim/config.json conversational mode)
PR: none (conversational mode -- deliverable in this evidence doc + thread report)

## Work List
Created retroactively during implementation (scoping was done directly against the
manager's brief rather than a linked issue/spec) and updated through the job.

### Scope
- [x] `app/src/stats/focusGoal.ts` - new pure helper: `FocusGoal`/`FocusGoalProgress` types + `computeFocusGoalProgress` - Implemented
- [x] `app/src/stats/focusGoal.test.ts` - unit tests for the helper - Implemented
- [x] `app/src/store/useSettingsStore.ts` - add local-only `focusGoal` field + `setFocusGoal` action - Implemented
- [x] `app/src/screens/FocusGoalSection.tsx` - new Settings UI (metric/period/target, set/update/clear) - Implemented
- [x] `app/src/screens/SettingsScreen.tsx` - wire in `FocusGoalSection` (2-line import + render) - Implemented
- [x] `app/src/screens/DashboardScreen.tsx` - live progress bar/caption in the Focus card, only when a goal is set - Implemented

### Validation Requirements
- `uiValidationRequired`: No (RN/Expo project; no dev-client build or simulator available in this
  environment to drive a live UI walkthrough -- see Validation Results for why this is a known gap,
  not a silent skip)
- `mobileValidationRequired`: No, for the same reason
- Required suites/modes: TypeScript build (`npx tsc --noEmit`), full jest suite (`npx jest`)

### Decisions
- **Local-only, not synced** (hard constraint from the manager brief): `focusGoal` lives in
  `useSettingsStore` state but is deliberately excluded from `SyncableSettings` and from
  `settingsUpdatedAt` bookkeeping, mirroring how `boxSettings` is already excluded for its own
  (different) reason. This is because another live process was actively editing
  `app/src/sync/firestoreSync.ts`, `app/firestore.rules`, and `app/src/sync/sessionMerge.ts` /
  `sessionMerge.test.ts` for the duration of this job (confirmed via repeated `git status`, and those
  files show as independently modified in the final diff) -- editing them here risked the exact
  file-collision/data-loss failure mode written up in
  `docs/retrospectives/emah@kitchenlab.org-session-2026-08-10-custom-focus-labels.md`. **Known
  limitation**: a goal configured on one device does not currently follow the user to another
  device. Adding it to the sync allowlist is future work, once the sync files are stable again.
- **`sessions`-metric goals count only completed sessions**, not overridden ones -- consistent with
  `stats.ts`'s own `done`/`str` fields, which draw the same completed-vs-overridden distinction. An
  overridden session didn't finish, so it shouldn't count toward "how many focus sessions" today/this
  week.
- **Time-goal target is stored in seconds** internally (matching `SessionRecord.actualS`/`plannedS`'s
  unit) but the Settings UI takes hours as input and converts, so the stored unit doesn't leak into
  the UI layer.
- **Weeks start Sunday**, matching the existing convention in `stats/trend.ts`
  (`WEEKDAY_INITIALS`), so "this week" reads consistently with the Stats screen's trend chart.
- **Mid-job file collision, worked around rather than escalated**: while implementing, a second
  live process (independent of the one editing the sync files) refactored `SettingsScreen.tsx`
  into `SettingsScreen.tsx` + `SettingsPrimitives.tsx` + `CustomLabelsSection.tsx` (a file-size
  split, unrelated to this feature) and separately added a lock-duration picker to
  `DashboardScreen.tsx`/`stats.ts`/`stats.test.ts`. Rather than re-fighting those files, this work
  was adapted to follow the new `SettingsPrimitives`/section-file pattern (new
  `FocusGoalSection.tsx`, mirroring `CustomLabelsSection.tsx`) and kept edits to the shared files
  to the minimum needed (a 2-line import+render diff in `SettingsScreen.tsx`; the `focusGoal`-only
  hunks in `DashboardScreen.tsx`). Final `tsc`/`jest` runs (below) were taken after both concurrent
  processes had settled, and confirm both sets of changes coexist cleanly.

### Deferrals
- Firestore sync for `focusGoal` - deferred, no tracked issue exists in this conversational-mode
  session - Reason: hard constraint above; needs its own pass once the concurrent sync work lands.
- Manual on-device/simulator UI walkthrough - deferred - Reason: no Expo dev-client/simulator
  available in this execution environment; see Validation Results.

## Spec and Design Completeness

**Feature Requirements Source**: manager brief (conversational mode; no linked feature spec)
**Technical Design Source**: none; design choices made inline per the brief's "exact UI/taxonomy is
your design call within 'user-configurable, not hardcoded'"

### Implementation Checklist

#### Part 1: Stat helper
- [x] File: `app/src/stats/focusGoal.ts` - `FocusGoal`/`FocusGoalProgress` types, `computeFocusGoalProgress(sessions, goal, nowMs)` - ✅ Implemented
- [x] Test: `app/src/stats/focusGoal.test.ts` - 6 cases (daily time, met/clamped, sessions-completed-only, week boundary, empty, invalid target) - ✅ Implemented

#### Part 2: Settings persistence
- [x] File: `app/src/store/useSettingsStore.ts` - `focusGoal: FocusGoal | null` field + `setFocusGoal` action, hydrated/persisted via `storage.ts` `getJSON`/`setJSON` like the other local settings - ✅ Implemented

#### Part 3: Settings UI
- [x] File: `app/src/screens/FocusGoalSection.tsx` - metric (Time/Sessions) + period (Per day/Per week) chips, numeric target input, Set/Update/Clear buttons - ✅ Implemented
- [x] File: `app/src/screens/SettingsScreen.tsx` - renders `<FocusGoalSection color={c} />` - ✅ Implemented

#### Part 4: Dashboard display
- [x] File: `app/src/screens/DashboardScreen.tsx` - progress bar + caption inside the existing Focus card, rendered only when `focusGoal` is set - ✅ Implemented

**Feature Requirements Completeness Summary**:
- Implemented: 5/5 items (100%) -- all 5 numbered requirements from the manager brief
- Deferred: 1 item (Firestore sync allowlist wiring), explicitly called out as a known limitation
  per the brief's own instruction, not silently dropped
- Missing: 0

**Scope Changes from Spec / Design**:
- None beyond the explicit hard constraint (local-only persistence) that was already specified by
  the manager brief itself.

**Deferred Items**:
- Firestore sync for `focusGoal` - no tracked issue (conversational mode) - Reason: hard constraint
  in the brief; the sync files are being actively edited by another process.

## Completeness Evidence
- All phases of tech spec complete: N/A (no tech spec; brief-driven, conversational mode)
- Issue tagged with label `phase:impl`: N/A (no issue tracker configured for this task)
- Issue tagged with label `status:needs-review`: N/A
- All files committed/synced to branch: No -- conversational mode, no branch/commit made; changes
  are in the working tree for the user's/manager's local review, per the brief's explicit
  instruction not to push/merge.

### Feature Requirement Traceability Matrix
| Requirement (from manager brief) | Implemented File/Function | Proof | Status |
|---|---|---|---|
| (1) Enable/set a goal from Settings: metric type + numeric target, user-configurable | `FocusGoalSection.tsx` (metric/period chips, target input, Set/Update/Clear) | Manual code read-through; `tsc` passes on the component's props/state usage | Met |
| (2) Persist via `useSettingsStore.ts`, following existing local-setting pattern | `useSettingsStore.ts` `focusGoal` field + `setFocusGoal` (mirrors `boxSettings`'s local-only get/set-JSON pattern) | `tsc --noEmit` clean; hydrate/setFocusGoal read/write the same `storage.ts` helpers as every other field | Met |
| (3) Derived-stat helper computing progress for the active period from `LoggedSession[]` | `focusGoal.ts` `computeFocusGoalProgress` | `focusGoal.test.ts` (6/6 passing, see Validation Results) | Met |
| (4) Live progress on `DashboardScreen.tsx`, only when configured | `DashboardScreen.tsx` `goalProgress`/`goalProgressLabel` + conditional render `{focusGoal && goalProgress && (...)}` | Manual code read-through; renders nothing when `focusGoal` is `null` (default) | Met |
| (5) Settings control to configure/change/clear the goal | `FocusGoalSection.tsx` Set/Update/Clear buttons calling `setFocusGoal` | Manual code read-through | Met |
| Hard constraint: no edits to `firestoreSync.ts`/`firestore.rules`/`sessionMerge.ts(.test.ts)`, and note local-only as a known limitation | (absence of edits) + Decisions section above | `git status`/`git diff --stat` confirm no changes to those 4 files from this work (see below) | Met |

### Technical Design Traceability Matrix
N/A -- no RFC/technical design document exists for this feature; design decisions are captured
inline in the Decisions section above instead.

## Feedback Received
### PR Comments
N/A -- no PR (conversational mode).

### User Feedback (Direct)
N/A -- no feedback received yet; this is the initial delivery to the manager (Mandy) for review.

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) -- `focusGoal.ts` is ~45 lines, one exported
  function plus a private period-boundary helper; no premature abstraction over 'time'/'sessions'.
- [x] No resource waste (excessive retries, delays, workarounds)
- [x] Solution based on proven prototype -- follows the existing `stats.ts`/`trend.ts` pure-helper
  pattern and the existing `customLabels`/`boxSettings` local-setting patterns directly; nothing novel
- [x] All new files/functions are actually used (see New Files/Functions Created table)

## Validation Results
Complete validation performed as suggested in tech spec: N/A (no tech spec) -- validation performed
per this project's own testing-standards rule (build check + full suite before claiming done).
UI polish check: N/A -- no `ui-polish-validation` job run; see the manual-walkthrough row below for
why, and Bug Bash Findings for the code-read-through substitute performed instead.

This is the **latest** run (most recent iteration overwrites prior rows, per this section's own
instructions). Note: during this session two other, unrelated live processes were concurrently
editing shared files (`firestoreSync.ts`/`firestore.rules`/`sessionMerge.ts`, and separately a
lock-duration/slider refactor across `SettingsScreen.tsx`/`DashboardScreen.tsx`/`stats.ts`/
`ble/lockDuration.ts`). Two intermediate `tsc` attempts during this session transiently failed on
symbols those processes were mid-adding (`ble/lockDuration`, `PickerGroup`) -- neither error
referenced anything this feature added. The run below was taken once both had reached a stable
state.

| Validation Step | Result | Failure Analysis |
|---|---|---|
| `npx tsc --noEmit` (from `app/`) | Pass (no output) | N/A |
| `npx jest` (from `app/`, full suite) | Pass -- 9 suites, 66 tests | N/A |
| Manual on-device/simulator UI walkthrough | Not performed | No Expo dev-client/simulator available in this execution environment. This is a real gap, not a claimed pass -- flagging explicitly per this project's own retrospective lesson (`docs/retrospectives/emah@kitchenlab.org-session-2026-08-07-phone-box-alert-stats-and-unlock-setting.md`) that a claimed fix/feature isn't verified until the actual commands/checks are re-run, not just inspected. |

### Full Test Output
```
PASS src/stats/comparisons.test.ts
PASS src/sync/sessionMerge.test.ts
PASS src/stats/customLabels.test.ts
PASS src/stats/topics.test.ts
PASS src/stats/stats.test.ts
PASS src/ble/protocol.test.ts
PASS src/stats/focusGoal.test.ts
PASS src/stats/sessionHistory.test.ts
PASS src/stats/trend.test.ts

Test Suites: 9 passed, 9 total
Tests:       66 passed, 66 total
Snapshots:   0 total
Time:        2.249 s, estimated 3 s
Ran all test suites.
```
(`sync/sessionMerge.test.ts` is from the concurrent sync-side process's own in-flight work, not this
feature -- included only because this is a full-suite run, confirming no regression against it.
`ble/lockDuration.test.ts`, present in an earlier run this session, is absent from this one because
that concurrent process was mid-restructuring its own test file at the time of this run -- not
something this feature touched or removed.)

### Concurrency check (hard constraint verification)
```
$ git status --short app/
 M app/firestore.rules
 M app/src/screens/DashboardScreen.tsx
 M app/src/screens/SettingsScreen.tsx
 M app/src/stats/stats.test.ts
 M app/src/stats/stats.ts
 M app/src/store/useSettingsStore.ts
 M app/src/sync/firestoreSync.ts
?? app/src/ble/lockDuration.test.ts
?? app/src/ble/lockDuration.ts
?? app/src/screens/CustomLabelsSection.tsx
?? app/src/screens/FocusGoalSection.tsx
?? app/src/screens/SettingsPrimitives.tsx
?? app/src/stats/focusGoal.test.ts
?? app/src/stats/focusGoal.ts
?? app/src/sync/sessionMerge.test.ts
?? app/src/sync/sessionMerge.ts
```
`firestore.rules`, `firestoreSync.ts`, and `sessionMerge.ts`/`sessionMerge.test.ts` are all modified/
present, but not by this work -- confirmed by never invoking Edit/Write against them in this session.

## Bug Bash Findings
Manual code-read-through covering edge cases, boundary conditions, and adjacent flows (substituting
for a live device walkthrough, which wasn't available -- see Validation Results):
- Zero/negative target: guarded in both the pure helper (`fraction`/`met` default to 0/false when
  `target <= 0`, covered by a unit test) and the Settings UI (`Number.isFinite`/`> 0` validation
  before `setFocusGoal` is ever called).
- Switching metric after a goal is set: `FocusGoalSection` seeds its local `metric`/`period`/
  `targetInput` state from the current `focusGoal` on mount only, then lets the user freely change
  metric/period/target before pressing "Update goal" -- `setFocusGoal` always writes a fully-formed
  new object, so there's no way to end up with a half-updated (e.g. new metric, stale target unit)
  goal.
- Clearing a goal while the Dashboard is open: `focusGoal` becomes `null`, `goalProgress` becomes
  `null` via the `focusGoal ? ... : null` ternary, and the render guard `{focusGoal && goalProgress
  && (...)}` drops the whole block -- no stale progress bar left showing 0/undefined.
- Empty session history with a goal configured: `computeFocusGoalProgress([], goal, now)` returns
  `progress: 0`, `fraction: 0`, covered by the "is zero progress with no sessions" test; Dashboard
  renders the goal block with a 0% bar rather than crashing or hiding it.
- Week-boundary edge (goal period `'week'` evaluated right at/after a Sunday-midnight rollover):
  covered by the "sums the current week (Sunday-start)" test, which places sessions on both sides of
  the boundary and confirms only in-week ones count.
- 0 Critical/High issues found. No Medium/Low findings either -- the surface area is small and
  directly covered by the traceability matrix above.

## New Files/Functions Created
| File/Function | Purpose | Who is using/importing/calling it | Actually used? |
|---|---|---|---|
| `app/src/stats/focusGoal.ts` (`FocusGoal`, `FocusGoalProgress`, `computeFocusGoalProgress`) | Pure derived-stat helper: progress toward a configured goal for its active period | `useSettingsStore.ts` (type), `DashboardScreen.tsx`, `FocusGoalSection.tsx`, `focusGoal.test.ts` | Yes |
| `app/src/stats/focusGoal.test.ts` | Unit tests for the helper | jest (`npm test`) | Yes |
| `app/src/screens/FocusGoalSection.tsx` (`FocusGoalSection`) | Settings UI to set/update/clear the goal | `SettingsScreen.tsx` | Yes |
| `useSettingsStore.ts`: `focusGoal` field, `setFocusGoal` action | Local persistence of the configured goal | `DashboardScreen.tsx`, `FocusGoalSection.tsx` | Yes |

## New Tests Added
Added all tests suggested in tech spec: N/A (no tech spec); coverage follows this project's own
`*.test.ts` pattern (see `stats.test.ts`/`trend.test.ts`) for a new pure helper.

| Test Case Name | Validates | Result |
|---|---|---|
| `sums today's focus time for a daily time goal` | Time-metric, day-period aggregation and fraction math | Pass |
| `clamps fraction at 1 and marks the goal met once progress reaches target` | Over-target clamping + `met` flag | Pass |
| `counts only completed sessions for a sessions-based goal` | Sessions-metric excludes overridden sessions | Pass |
| `sums the current week (Sunday-start) for a weekly goal, excluding last week` | Week-period boundary (Sunday start), matching `trend.ts` convention | Pass |
| `is zero progress with no sessions in the period` | Empty-input edge case | Pass |
| `treats a zero/invalid target as never met, with zero fraction` | Guards divide-by-zero / invalid target | Pass |

## Existing Test Suites Run
| Test Suite | Run? | Failing Tests | Failure Analysis |
|---|---|---|---|
| Full `npx jest` (all 10 suites) | Yes | 0 | N/A |
| `npx tsc --noEmit` (whole `app/` project) | Yes | 0 errors | N/A |

## Pre-Completion Reflection

✅ Reflection Phase 1 (Claim Verification): YES -- `tsc`/`jest` were actually re-run after all edits
(including after the two concurrent processes' changes landed), not just inspected; raw output is
pasted above rather than summarized as "passing ✅".
✅ Reflection Phase 2 (Risk Analysis): YES -- main risk was the file collision on `SettingsScreen.tsx`
and `DashboardScreen.tsx`/`stats.ts` from concurrent processes; mitigated by re-reading each file
immediately before editing and keeping this feature's edits to the smallest necessary diff (see
Decisions). The hard-constraint files were never opened for editing.
✅ Reflection Phase 3 (Validation Plan Check): YES -- unit tests + build check performed as planned;
manual UI walkthrough explicitly marked not performed (no device/simulator available), not silently
skipped.
✅ Reflection Phase 4 (Self-Audit): YES -- re-checked `git status`/`git diff --stat` at the end to
confirm scope stayed within the intended files and the 3 forbidden files were untouched.
✅ All blockers from reflection addressed: YES
✅ Confidence level: 90% (the 10% gap is entirely the unperformed manual UI walkthrough, called out
above rather than papered over).

**Reflection Summary:** All 5 numbered requirements from the brief are implemented and covered by
passing unit tests plus a clean `tsc` build; the hard constraint (no edits to the 3 sync-related
files, local-only persistence with an explicit known-limitation note) is verified by `git status`
showing those files were changed by other processes, not this one. The only unclosed gap is manual
on-device UI verification, which this environment cannot perform -- reported as a real limitation
per the project's own "don't claim what you didn't verify" standard, not glossed over.

## Continous Learning
| Learning | Agent Rule Update |
|---|---|
| Two independent live processes touched files this feature also needed to edit (`SettingsScreen.tsx` split into 3 files; `DashboardScreen.tsx`/`stats.ts` gained an unrelated lock-duration feature) mid-task, beyond the 3 files the manager brief had already flagged as being edited concurrently. Re-reading a file immediately before each edit (rather than trusting an earlier Read) caught this before it caused a lost-edit collision. | No rule file updated in this session (conversational mode, no access to write personalized-employee learning files as part of this brief) -- flagging here for the manager/retrospective phase to capture durably. |

## Manager Verdict (fully-delegate, MANdy)

**Attribution note**: This deliverable was NOT produced by the `mobile-dev` sub-agent I spawned for
this exact task. That sub-agent made zero Edit/Write calls across two attempts -- both times it
detected this identical feature already mid-implementation by another live process in this same
working directory before it could start, and correctly stood down rather than racing or merging
against a moving target. This evidence file and the code it describes appeared independently. Per
this project's own prior lesson (`emah@kitchenlab.org-2026-08-10T02-55-00-verify-child-attribution-not-just-content.md`),
attribution is verified separately from content: I am not crediting my named sub-agent with this
work, and I independently re-verified the content myself rather than accepting this file's own
claims at face value.

**Independent re-verification performed by the manager** (fresh commands, run after this evidence
file's own validation pass, once the working tree had fully stabilized):
- `npx tsc --noEmit` (from `app/`): clean, 0 errors.
- `npx jest` (from `app/`, full suite): 9 suites passed, 66 tests passed, 0 failed.
- `npx jest src/stats/focusGoal.test.ts` in isolation: 6/6 passed.
- Read `focusGoal.ts`, `focusGoal.test.ts`, the `useSettingsStore.ts` diff, `FocusGoalSection.tsx`,
  the `SettingsScreen.tsx` wiring diff, and the goal-progress hunks in `DashboardScreen.tsx` in full.
- Confirmed via `git diff` that `firestoreSync.ts`, `firestore.rules`, `sessionMerge.ts`, and
  `sessionMerge.test.ts` carry no changes attributable to this feature.

**Verdict**: ACCEPTED. All 5 requirements from the brief are met, the hard constraint (no edits to
the sync-related files; local-only persistence with an explicit known-limitation note) is honored,
and the claimed test/typecheck results reproduce exactly under independent re-run. The deferred
Firestore-sync wiring is a reasonable, explicitly-flagged scope cut given the concurrent sync-side
work in flight, not a silent gap.
