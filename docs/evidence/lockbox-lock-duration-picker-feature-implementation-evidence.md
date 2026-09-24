# Feature: Duration picker for locking the box from the app
Issue: lockbox-lock-duration-picker (conversational delegation, no issue tracker configured)
Tech Spec: none -- scoped directly by the manager's task description in this session
PR: none -- conversational mode, no repository configured for this delegation; reviewed in-thread

## Work List

### Scope
- [x] app/src/screens/DashboardScreen.tsx - add hours/minutes duration picker + "Lock for H:MM" button, gated on the same `canClose` condition as the existing Close button; calls `useStore().startLock(seconds)` - Done
- [x] app/src/stats/stats.ts - add `clampLockSeconds(hours, minutes)`, `MAX_LOCK_HOURS`, `MAX_LOCK_SECONDS`, `LOCK_MINUTE_STEP` (mirrors `firmware/lib/lock_config.py` `MAX_HOURS`/`MIN_STEP`) - Done
- [x] app/src/stats/stats.test.ts - unit tests for `clampLockSeconds` (combination, 9h cap, negative/fractional flooring) - Done

### Validation Requirements
- `uiValidationRequired`: No emulator/device reachable from this non-interactive shell; validated via type-check + unit tests + manual JSX/style review against the existing `SettingsScreen.tsx` `StepperRow` convention. Stated explicitly as not visually verified on-device/simulator.
- `mobileValidationRequired`: No (same reason as above)
- Required suites/modes: TypeScript compile (`npx tsc --noEmit -p .`), full jest suite (`npx jest`), manual code review

### Decisions
- Reused the existing pure-helpers module `app/src/stats/stats.ts` (already imported by `DashboardScreen.tsx` for `formatDuration`/`aggregate`/`completionRate`) for the new clamp helper, rather than adding a new file, per "prefer editing existing files" and to keep the pure/testable logic in one place. (Note: a same-named helper briefly existed at `app/src/ble/lockDuration.ts` from an earlier, unwired attempt at this exact task; it was consolidated into `stats.ts` and, independently of this consolidation, the stray file disappeared from disk mid-session -- see Bug Bash Findings.)
- The firmware (`firmware/lib/lock_controller.py` `apply_ble_command`) already clamps `start:<seconds>` to `[0, MAX_SECONDS]` on its own, so the app-side clamp is a UX correctness measure (the "Lock for H:MM" label must always match what actually happens), not the only safety net.
- New `DurationStepper` is a small local component in `DashboardScreen.tsx`, not extracted to a shared file: `SettingsScreen.tsx`'s `StepperRow` isn't exported and the task explicitly permitted a local component instead of forcing an extraction.
- Default picker value: 0h 25m, an arbitrary but reasonable starting point; not persisted, resets each time the screen remounts.
- No firmware changes -- `firmware/lib/lock_controller.py`'s `start:<seconds>` opcode and `startLock`/`cmdStart` chain were already fully wired; this task was app-UI-only.

### Deferrals
- None.

## Spec and Design Completeness

**Feature Requirements Source**: Manager's task description in this conversation (no formal `docs/feature-specs/` entry exists for this task).
**Technical Design Source**: None (no RFC covers this scoped UI addition); the wire contract it relies on (`cmdStart`/`start:<seconds>`) is documented in `app/src/ble/protocol.ts` and `firmware/lib/lock_controller.py`.

### Feature Requirement Traceability Matrix
| Requirement/Acceptance Criteria | Implemented File/Function | Proof | Status |
|---|---|---|---|
| H+M duration picker capped at 9h (`MAX_HOURS`/`MAX_SECONDS`) | `DashboardScreen.tsx:65-77,154-184`; `stats.ts` `clampLockSeconds`/`MAX_LOCK_HOURS` | `stats.test.ts` "caps at MAX_LOCK_SECONDS (9h) when the inputs exceed it" | Met |
| Visible only when box idle/done (same gate as Close) | `DashboardScreen.tsx:154` `{canClose && (...)}` | `canClose` is the identical boolean already gating the Close `Pressable` at line 130 | Met |
| "Lock for H:MM" calls `useStore().startLock(totalSeconds)` | `DashboardScreen.tsx:174-182` `onPress={() => startLock(pickSeconds)}` | `startLock` destructured from `useStore()` at line 48; `startLock -> PhoneBoxClient.startLock -> cmdStart` already covered by `protocol.test.ts` | Met |
| Add alongside existing indefinite Close button, don't remove it | `DashboardScreen.tsx:128-147` | Diff is additive around the existing `controlRow` block; `Close` `onPress={closeBox}` untouched | Met |
| Match `SettingsScreen`'s `StepperRow` (-/+) visual convention | `DashboardScreen.tsx:270-306` `DurationStepper` | Manual comparison against `SettingsScreen.tsx:288-315` `StepperRow` -- same -/+ `Pressable` + centered value text shape | Met |
| Respect `useSettingsStore`/`useStore` boundaries | `DashboardScreen.tsx:38-58` | Picker only calls `useStore`'s `startLock`; no new `useSettingsStore` reads/writes added | Met |
| Run `npm test`; add/extend test for clamping logic | `stats.test.ts` `describe('clampLockSeconds')` | `npx jest` -- 9 suites / 66 tests passed | Met |
| No firmware changes | n/a | `git diff` touches only `app/src/**`; `firmware/` untouched | Met |
| Conversational mode: no branch/commit/PR | n/a | No `git commit`/branch commands run this session; working tree left uncommitted for in-thread review | Met |

**Feature Requirements Completeness Summary**: Implemented 9/9 (100%). Deferred: 0. Missing: 0.

### Technical Design Traceability Matrix
N/A -- no RFC/technical design exists for this scoped task; the only binding contract (`cmdStart`/`start:<seconds>`) was pre-existing and unmodified.

**Scope Changes from Spec / Design**: None.

## Completeness Evidence
- All phases of tech spec complete: N/A (no tech spec)
- Issue tagged with label `phase:impl`/`status:needs-review`: N/A (no issue tracker configured for this delegation)
- All files committed/synced to branch: No -- conversational mode leaves the working tree uncommitted by design, for in-thread review

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) -- `DashboardScreen.tsx` stays ~355 lines, well under the 500-line limit
- [x] No resource waste (excessive retries, delays, workarounds)
- [x] Solution based on the manager's scoped plan (no separate design-phase prototype for a change this small)
- [x] All new files/functions are actually used -- `clampLockSeconds`/`MAX_LOCK_HOURS`/`MAX_LOCK_SECONDS`/`LOCK_MINUTE_STEP` are all imported and used in `DashboardScreen.tsx`; `DurationStepper` is used twice (hours, minutes)

## Validation Results
| Validation Step | Result | Notes |
|---|---|---|
| `npx tsc --noEmit -p .` (inside `app/`) | Pass | 0 errors |
| `npx jest` (inside `app/`) | Pass | 9 suites / 66 tests passed, 0 failures |
| UI polish check | N/A -- no simulator/device reachable from this non-interactive shell; not visually verified on-device |
| Manual code review vs. `SettingsScreen.tsx` `StepperRow` convention | Pass | Same -/+ button shape, border/label styling pattern |

### Full Test Output
```
PASS src/stats/topics.test.ts
PASS src/stats/comparisons.test.ts
PASS src/stats/stats.test.ts
PASS src/stats/focusGoal.test.ts
PASS src/stats/sessionHistory.test.ts
PASS src/ble/protocol.test.ts
PASS src/sync/sessionMerge.test.ts
PASS src/stats/trend.test.ts
PASS src/stats/customLabels.test.ts

Test Suites: 9 passed, 9 total
Tests:       66 passed, 66 total
Snapshots:   0 total
Time:        2.508 s
Ran all test suites.
```

## Bug Bash Findings
- During implementation, a pre-existing, untracked pair of files (`app/src/ble/lockDuration.ts` + `lockDuration.test.ts`) was discovered mid-session -- an apparent earlier, unwired attempt at this exact same helper (identical `MAX_LOCK_HOURS=9`/`clampLockSeconds` signature, verified against the real `MIN_STEP=5` in `lock_config.py`). Consolidated onto it briefly, then -- independently of any action taken here -- both files disappeared from disk before the type-check re-run, consistent with a concurrent process/agent touching this same working tree (the repo working directory is under OneDrive sync, and `DashboardScreen.tsx` was also observed to gain unrelated `focusGoal` code between an initial read and a follow-up edit attempt in this session). Recovered by re-adding the helper directly in the stable, tracked `stats.ts` file instead of depending on a file whose lifetime proved unreliable. No data was lost -- the vanished files were untracked and unreferenced by any other code.
- No other issues found after edge case (0h0m, 9h0m cap, negative/fractional stepper input) and boundary exploration.
- Severity: Low (informational) -- flagging for the human because it indicates something else is actively writing to this same working directory outside this session's control, which is relevant to know before further conversational-mode (no-worktree) work happens here.

## New Files/Functions Created
| File/Function | Purpose | Used By | Actually Used? |
|---|---|---|---|
| `stats.ts` `clampLockSeconds(hours, minutes)` | Convert picker H/M into a clamped total-seconds value for `startLock` | `DashboardScreen.tsx` | Yes |
| `stats.ts` `MAX_LOCK_HOURS`, `MAX_LOCK_SECONDS`, `LOCK_MINUTE_STEP` | Constants mirroring `lock_config.py`'s `MAX_HOURS`/`MIN_STEP` | `DashboardScreen.tsx`, `stats.test.ts` | Yes |
| `DashboardScreen.tsx` `DurationStepper` | Local -/+ stepper matching `SettingsScreen`'s `StepperRow` visual convention | `DashboardScreen.tsx` (hours row, minutes row) | Yes |

## New Tests Added
| Test Case | Validates | Result |
|---|---|---|
| `clampLockSeconds` "combines hours and minutes into seconds" | Basic H/M -> seconds conversion | Pass |
| `clampLockSeconds` "caps at MAX_LOCK_SECONDS (9h) when the inputs exceed it" | 9h firmware cap is enforced app-side | Pass |
| `clampLockSeconds` "floors negative or fractional input at 0" | Defensive flooring of malformed input | Pass |

## Existing Test Suites Run
| Test Suite | Run? | Failing Tests | Notes |
|---|---|---|---|
| `app/` full jest suite (9 suites) | Yes | 0 | Includes `protocol.test.ts` (unaffected by this change) and all `stats/*.test.ts` |

## Pre-Completion Reflection
✅ Reflection Phase 1 (Claim Verification): YES -- every claim above (tsc clean, 66/66 tests, file line ranges) was produced by an actual tool call in this session, not asserted from memory.
✅ Reflection Phase 2 (Risk Analysis): YES -- main risk identified is the concurrent-process interference noted in Bug Bash Findings; mitigated by keeping the final implementation in a stable, tracked file rather than the file that vanished.
✅ Reflection Phase 3 (Validation Plan Check): YES -- validation plan (tsc + jest + manual review) matches what the task's own instructions asked for ("run npm test... UI-only wiring may not need new tests, use judgment"); on-device UI validation explicitly flagged as not performed rather than fabricated.
✅ Reflection Phase 4 (Self-Audit): YES -- re-read the final diff end-to-end against the requirement list above before writing this document.
✅ All blockers from reflection addressed: YES.
✅ Confidence level: 95%.

**Reflection Summary:** The change is small, additive, fully type-checked, and covered by passing unit tests for its only non-trivial logic (the clamp helper). The one open item is that this could not be visually confirmed running in a simulator/on a phone -- stated plainly rather than claimed. The concurrent-file-disappearance incident is noted for the human's awareness but did not affect the correctness of the final, tracked implementation.

## Continuous Learning
| Learning | Agent Rule Update |
|---|---|
| Working "in place" (conversational mode, no worktree isolation) in a repo whose folder lives under active OneDrive sync -- and possibly alongside another concurrent agent/process -- means files can appear/disappear mid-session outside this session's own edits. Re-verify a file's existence/tracked status before depending on it across multiple tool calls, especially after a "file modified since read" error. | Not written to a durable rule file in this session -- flagging in evidence for the human/manager to decide whether `set-up-workspace.md`'s conversational-mode guidance should call this out explicitly. |
