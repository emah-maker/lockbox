# Feature: Dashboard Lock-Duration Picker (feature-implementation)

Issue: `lock-duration-picker` (local anchor -- conversational mode, no issue-tracker/repository
configured per `fraim/config.json`; work done in place, no branch/commit/PR).
Source of truth: manager (MANdy)'s `fully-delegate` child brief in this conversation -- no formal
spec/RFC exists for this issue.

## Work List

### Scope
Add an hours+minutes duration picker and a "Lock for H:MM" button to `app/src/screens/
DashboardScreen.tsx`, additive alongside the existing indefinite "Close" button, calling the
already-implemented `useStore().startLock(seconds)` -> `PhoneBoxClient.startLock` ->
`protocol.cmdStart(seconds)` -> firmware `start:<seconds>` opcode. Firmware needed no changes
(confirmed: `Box-code/lib/lock_controller.py`'s `apply_ble_command` already handles `start:<seconds>`
and independently clamps to `MAX_SECONDS`).

- [x] Duration picker (hours 0-9, minutes 0-55 step 5), capped at 9h to match
  `Box-code/lib/lock_config.py`'s `MAX_HOURS = 9`.
- [x] "Lock for H:MM" button calling `useStore().startLock(totalSeconds)`.
- [x] Existing indefinite Close button left untouched, both controls available together.
- [x] Matches `SettingsScreen.tsx`'s `StepperRow` (-/+ button) convention -- no new UI paradigm.
- [x] Respects store boundaries: only calls the pre-existing `useStore().startLock`; no new BLE
  access added to the screen.
- [x] Theme-aware: new style keys live inside `DashboardScreen.tsx`'s existing `styles(t)` factory;
  no hardcoded colors.
- [x] Pure conversion/clamp logic unit-tested.

### Important process note
**This feature was already fully implemented by a concurrent process before this session finished
scoping it.** Mid-way through reading `DashboardScreen.tsx` to plan the change, a second read (after
setting up this job's evidence context) showed the feature -- and an unrelated "focus goal" feature
-- already present in the working tree, with matching tests already passing. `git diff` on
`app/src/stats/stats.ts` confirmed the `clampLockSeconds`/`MAX_LOCK_HOURS`/`MAX_LOCK_SECONDS` pure
helpers and `app/src/stats/stats.test.ts` confirmed their tests were added by that concurrent
process, not this session. A separate `docs/evidence/focus-goal-feature-implementation-evidence.md`
(untracked, not written by this session) further confirms at least one other job was running
concurrently in this same shared working tree.
This session's actual contribution was: (1) independently scope and design the feature per the
brief before discovering the collision, (2) verify the concurrent implementation line-by-line
against every requirement in the brief (see Traceability Matrix below), (3) run the full test/type
suite to confirm it's green, (4) remove two now-redundant scaffold files
(`app/src/ble/lockDuration.ts`, `app/src/ble/lockDuration.test.ts`) this session had created before
discovering the collision -- deleted rather than left as orphaned dead code duplicating
`stats.ts`'s equivalent, already-tested, already-wired helpers.

### Validation Requirements
- `uiValidationRequired`: Yes -- Dashboard duration-picker steppers and "Lock for H:MM" button.
  **Not run**: no RN simulator/emulator/`adb` available in this environment. Stated plainly rather
  than claimed; reasoned about via full code read only.
- `mobileValidationRequired`: Yes, same blocker as above.
- Required suites: `npx jest`, `npx tsc --noEmit` (this repo's only host-runnable checks).

### Decisions
- Did not extract `SettingsScreen.tsx`'s private `StepperRow` into a shared component for
  `DashboardScreen.tsx` to import. `StepperRow` isn't exported, and doing so would be an unrequested
  refactor of an unrelated screen; the brief asked to match the established stepper *convention*
  (which the new local `DurationStepper` component does, closely), not to force cross-file sharing.
- The pure `clampLockSeconds`/`MAX_LOCK_HOURS`/`MAX_LOCK_SECONDS` helpers landed in
  `app/src/stats/stats.ts` (by the concurrent process) rather than a BLE-domain file. This is a minor
  domain-fit nit (stats.ts is otherwise about session aggregation, not lock duration/BLE), but it
  works, is tested, and re-locating it now would be scope creep on top of someone else's already-
  landed, already-tested code for no functional benefit.

### Deferrals
- UI has not been visually verified on a device/simulator (see Validation Requirements). This is an
  environment limitation (no RN simulator/emulator/`adb` here), consistent with every other UI change
  in this repo's evidence history, not a gap specific to this feature.

## Validation Results
Latest run only.

| Validation Step | Result | Notes |
|---|---|---|
| `npx jest` (app/) | **pass** | 9/9 suites, 66/66 tests (includes `stats.test.ts`'s `clampLockSeconds` describe block: combine, 9h cap, negative/fractional floor) |
| `npx tsc --noEmit` (app/) | **pass** | clean, no errors |
| UI polish check | **N/A -- could not run** | No RN simulator/emulator/`adb` available in this environment; not claimed as tested. Untested surface: Dashboard duration-picker steppers + Lock button. |
| Manual re-read of `DashboardScreen.tsx`, `stats.ts`, `stats.test.ts` against the brief | **pass** | See Traceability Matrix below; no discrepancies found |

### Full jest output
```
PASS src/stats/comparisons.test.ts
PASS src/ble/protocol.test.ts
PASS src/stats/stats.test.ts
PASS src/stats/trend.test.ts
PASS src/stats/topics.test.ts
PASS src/sync/sessionMerge.test.ts
PASS src/stats/focusGoal.test.ts
PASS src/stats/customLabels.test.ts
PASS src/stats/sessionHistory.test.ts

Test Suites: 9 passed, 9 total
Tests:       66 passed, 66 total
```

## Feature Requirement Traceability Matrix

| Requirement/Acceptance Criteria | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Hours+minutes duration picker, capped at 9h (mirrors `lock_config.py` `MAX_HOURS`) | `DashboardScreen.tsx` `pickHours`/`pickMinutes` state + `stepPickHours`/`stepPickMinutes`; `stats.ts` `clampLockSeconds`/`MAX_LOCK_HOURS` | `stats.test.ts` "caps at the box's 9-hour maximum" (`clampLockSeconds(9,30)` and `(20,0)` both -> `MAX_LOCK_SECONDS`) | Met |
| "Lock for H:MM" button calls `useStore().startLock(totalSeconds)` | `DashboardScreen.tsx` `Pressable onPress={() => startLock(pickSeconds)}`, label `` `Lock for ${pickHours}:${String(pickMinutes).padStart(2,'0')}` `` | Direct read of `DashboardScreen.tsx`; `startLock` destructured from `useStore()` (pre-existing action -> `client.startLock` -> `cmdStart`) | Met |
| Add alongside existing indefinite Close button, don't remove/replace | `DashboardScreen.tsx`: original Close/Open `controlRow` unchanged; new `{canClose && (...)}` block inserted after it | `git diff` shows only additions in that region; `Pressable onPress={closeBox}` line unchanged | Met |
| Reuse `SettingsScreen.StepperRow`'s -/+ convention, no new UI paradigm | `DashboardScreen.tsx` local `DurationStepper` component: same -/+ `Pressable` pair, same border/value-text visual language | Side-by-side comparison of `DurationStepper` vs `StepperRow`; no slider/wheel/external-picker package added (checked `app/package.json` -- unchanged) | Met |
| Respect store boundaries (`useStore.ts` is the only thing that talks BLE) | `DashboardScreen.tsx` only calls pre-existing `useStore().startLock`; no new BLE import | `DashboardScreen.tsx` import list has no `ble/PhoneBoxClient` import | Met |
| Theme-aware `styles()` function, no hardcoded colors | New style keys (`pickerBlock`, `pickerRow`, `lockForBtn`, `stepper`, `stepBtn`, `stepValue`) inside the existing `styles(t)` factory | Direct read of `styles(t)`; no literal hex/rgb introduced | Met |
| Unit test for the pure hours/minutes-to-seconds clamp logic | `stats.ts` `clampLockSeconds` | `stats.test.ts` `describe('clampLockSeconds')`, 3 tests, part of the 66/66 passing run | Met |
| Run `npm test`, report result; state UI not visually verified | n/a (process step) | `npx jest`: 9/9 suites, 66/66 pass; `npx tsc --noEmit`: clean; UI explicitly stated as not visually verified (no simulator/emulator/`adb` in this environment) | Met |

## Technical Design Traceability Matrix
N/A -- no RFC/technical design exists for this issue; the brief itself (restated in Scope above) is
the design source, fully covered by the Feature Requirement Traceability Matrix above.

## Bug Bash Findings
Focused re-read of `DashboardScreen.tsx`'s new block, `stats.ts`, and `stats.test.ts` for edge cases
beyond direct test coverage:

1. `canClose` gating (`connected && (status?.st === 'idle' || status?.st === 'done')`) correctly
   hides the whole picker block when disconnected, running, or closed -- confirmed by reading the
   surrounding `{status && (...)}` guard and the `canClose` definition together.
2. At the 9h cap, `stepPickHours` forces `pickMinutes` to 0 and `DurationStepper`'s minutes control
   is passed `disabled={pickHours >= MAX_LOCK_HOURS}` -- confirmed no way to exceed `MAX_LOCK_SECONDS`
   from the UI even before `clampLockSeconds`'s own clamp would catch it.
3. Lock button disables via `pickSeconds <= 0` -- only reachable if a user manually steps both hours
   and minutes down to 0 from the 0h/25m default; confirmed this correctly prevents a zero-duration
   `startLock(0)` call (firmware's `apply_ble_command` would accept `start:0` and immediately
   transition to `running` with a 0-remaining countdown, which is a real firmware-side edge case, but
   the app-side disable already prevents it from being reachable through this button).
4. No `console.log`/TODO/FIXME left in `DashboardScreen.tsx`.

0 Critical/High findings. 0 Medium/Low findings beyond the pre-existing, environment-caused UI
verification gap already recorded above.

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium, 0 Low findings. This session's own diff is a deletion of two dead
scaffold files; the concurrent implementation it verifies is UI wiring to an existing, unchanged BLE
action plus one pure arithmetic helper -- no new input surface, no new secrets, no new PII.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`:
  - `app/src/screens/DashboardScreen.tsx`
  - `app/src/stats/stats.ts`
  - `app/src/stats/stats.test.ts`

### Threat Surface Summary
No heuristic matched: no `public/**|pages/**|views/**` (web), no `routes/**|api/**` (api), no LLM SDK
imports (llm-app), no direct DB driver imports (data-pipeline), no `ios/**|android/**|.swift|.kt`
(mobile -- this is RN/TS app code, not native), and non-`.md` files are present so `docs-only` cannot
apply either. `surfaces: []`. Ran `secrets-in-code-check` and `privacy-and-pii-review` manually anyway
per this repo's own precedent for similarly-shaped diffs (see
`docs/evidence/custom-focus-labels-feature-implementation-evidence.md`).

### Coverage Matrix
| Category | Result | Notes |
|---|---|---|
| OWASP Top 10 (web/api/LLM) | N/A | no matching surface in this diff |
| Secrets in code | Pass | only new literals are numeric constants (`MAX_LOCK_HOURS=9`, minute step `5`), none secret-shaped |
| Privacy / PII | Pass | picker state (hours/minutes) never leaves the device except as the existing `cmdStart(seconds)` BLE opcode, which is not new |

### Findings
None.

### Prioritized Remediation Queue
Empty.

### Verification Evidence
- `npx jest`/`npx tsc --noEmit` output above serves as the functional verification; no security-
  specific test harness exists in this repo (no Firestore/network surface touched by this change).

### Applied Fixes and Filed Work Items
None needed.

### Accepted / Deferred / Blocked
- **Accepted**: `clampLockSeconds`'s domain placement in `stats.ts` rather than a BLE-domain file
  (see Decisions above) -- functional, tested, not worth re-litigating.
- **Blocked**: UI visual verification, blocked on simulator/emulator/`adb` availability in this
  environment, not on anything in the code.

### Compliance Control Mapping
N/A -- no active regulatory/compliance framework configured for this project.

### Run Metadata
- Run date: 2026-08-10
- Base commit: `4c3abc9` (already on `master` at session start; working tree had extensive
  concurrent, uncommitted changes from other in-flight jobs -- see Work List note above)
- Skill errors: none
- Caps hit: none
- Environment notes: no RN simulator/emulator/`adb` available; conversational mode per
  `fraim/config.json` -- no branch/commit/PR created or expected for this delivery.

## Pre-Completion Reflection
- **Claim verification**: every claim above is backed by a direct tool call in this session --
  `Read`/`git diff` for the file contents and diffs, `npx jest`/`npx tsc` output pasted verbatim
  above. Nothing taken on a prior process's word without independently re-reading the actual code.
- **Attribution**: this session did not author the shipped implementation. That is stated plainly
  in the Work List rather than presented as this session's own work, per this project's own learning
  on verifying child/concurrent-work attribution rather than just content.
- **Risk analysis**: lowest-risk class of change (additive UI calling an already-existing,
  already-tested BLE action; one small pure-function addition). The only real open risk is the
  unverified visual layout on an actual device (spacing/wrapping of the new stepper row on a real
  screen size), which is explicitly flagged, not glossed over.
- **Self-audit**: `git status` after this session's only edit (deleting the two duplicate scaffold
  files) shows no other files touched by this session under `app/src`.
- Confidence level: **90%** -- full confidence in the logic/tests (read, run, green); withheld 10%
  for the UI layer, which is unverified on a real device/simulator.
