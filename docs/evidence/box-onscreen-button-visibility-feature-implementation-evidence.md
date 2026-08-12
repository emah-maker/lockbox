# Feature: Box on-screen LOCK/OPEN button visibility rework
Issue: n/a (direct manager task, no issue tracker in this local workflow)
Tech Spec: n/a — scope defined directly by manager (Mandy) instructions
PR: n/a (local project folder, no CI/remote workflow per project_context.md)

## Work List

### Scope
- [x] `Box-code/lib/lock_ui.py` - `show_idle()`: drop `set_button('LOCK', ...)` + `_show_button(True)`, hide instead - Done
- [x] `Box-code/lib/lock_ui.py` - `show_closed()`: same as show_idle - Done
- [x] `Box-code/lib/lock_ui.py` - `show_done()`: always `set_button('OPEN', ...)` + `_show_button(True)` regardless of `auto_open` - Done
- [x] `Box-code/lib/lock_ui.py` / `Box-code/lib/lock_controller.py` - update stale "tap LOCK" / "finger landing on the LOCK button" comments - Done
- [x] `Box-code/lib/lock_controller.py` - `LockController._handle_release` in_button() tap region: verified untouched (hit-test coords + state transitions unchanged) - Verified by reading, no edit needed

### Validation Requirements
- `uiValidationRequired`: Yes, but **cannot be executed this session** — no on-device run available (CircuitPython, no host test/build suite per `project_context.md`). Validation performed by reasoning through the state machine and touch dispatch path instead of live/browser/device testing.
- `mobileValidationRequired`: No — this task touches only box firmware UI, not the companion app.
- Required suites/modes: manual reasoning-based state-machine trace (no automated suite exists for this firmware).

### Decisions
- Kept `show_done(auto_open=True)`'s parameter even though it's now unused inside the button-visibility branch, to avoid touching the call site (`go_done` -> `self.ui.show_done(self.settings.auto_open)`) — out of the requested scope.
- Left `_handle_release`'s in-region comment "Button press is checked FIRST..." (lock_controller.py:598-599) unchanged — it describes hit-test geometry, not button visibility, so it isn't stale.
- Did not touch `Box-code/_timer_backup.py` (confirmed via project_context.md as a non-live backup copy, not the entry point).

### Deferrals
- None.

## Spec and Design Completeness

**Feature Requirements Source**: Manager (Mandy) task instructions, verbatim, this session.
**Technical Design Source**: N/A — instructions specified exact functions/behavior directly.

### Implementation Checklist
#### Part 1: lock_ui.py — visibility-only changes
- [x] `show_idle()` - hide button/label instead of drawing "LOCK" - ✅ Implemented
- [x] `show_closed()` - hide button/label instead of drawing "LOCK" - ✅ Implemented
- [x] `show_done()` - always show "OPEN" button, drop the auto_open if/else gate - ✅ Implemented
- [x] Stale comment in `on_touch_down` docblock referencing "the LOCK button" - ✅ Implemented

#### Part 2: lock_controller.py — comment accuracy only (no logic change)
- [x] `press_lock()` docstring ("tap LOCK") - ✅ Implemented
- [x] `_handle_release()` inline comment ("LOCK button starts the countdown") - ✅ Implemented

**Feature Requirements Completeness Summary**: Implemented 6/6 items (100%). Deferred: 0. Missing: 0.
**Technical Design Completeness Summary**: N/A (no separate design doc; spec = manager instructions, fully implemented).

**Scope Changes from Spec / Design**: None — implementation matches the manager's instructions exactly (visibility/comments only, no hit-test/state-machine changes, physical GPIO10/GPIO1 buttons untouched).

## Completeness Evidence
- All phases of tech spec complete: Yes
- Issue tagged with label `phase:impl`: N/A (no issue tracker in this local project)
- Issue tagged with label `status:needs-review`: N/A
- All files committed/synced to branch: Not committed — awaiting Mandy's review per manager instructions ("Return the diff to MANdy for review before this is considered final")

### Feature Requirement Traceability Matrix
| Requirement | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Hide LOCK button/label in idle/closed, keep tap region live | `lock_ui.py: show_idle, show_closed`; `lock_controller.py: _handle_release` (unchanged) | Code diff; traced `in_button()` gate in `_handle_release` (lines 600-602) still calls `go_running()` unconditionally of button visibility | Met |
| show_done always shows OPEN button regardless of auto_open | `lock_ui.py: show_done` | Code diff — `if auto_open: ... else: ...` replaced with unconditional `set_button`+`_show_button(True)` | Met |
| Done-state tap still calls go_idle() regardless of auto_open | `lock_controller.py: _handle_release` (unchanged) | Traced lines 600-604: `elif self.state == "done": self.go_idle()` has no auto_open gate | Met |
| No change to hit-test coords or state transitions | `lock_ui.py: in_button()`, `lock_controller.py: _handle_release` | Confirmed no diff to `in_button()`, `BTN_X/BTN_Y/BTN_W/BTN_H`, or any `go_*` call | Met |
| Physical GPIO10 (override) / GPIO1 (sense) untouched | `lock_controller.py: press_lock, press_override` | Docstring-only edit to `press_lock`; `press_override` untouched entirely | Met |
| Stale comments updated | `lock_ui.py`, `lock_controller.py` | Code diff — all "LOCK button" / "tap LOCK" references reworded | Met |
| Preserve 7 fixed functions | `Box-code/lib/*` | No touch/servo/battery/settings/boot logic touched; only display show_* calls + comments | Met |

## Feedback Received
### PR Comments
N/A — no PR in this workflow.

### User Feedback (Direct)
| Feedback Content | How Addressed |
|---|---|
| (pending) Mandy's review of the diff | Awaiting response |

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) — this is a pure deletion/inversion of existing show/hide calls plus comment edits, no new abstractions
- [x] No resource waste (excessive retries, delays, workarounds)
- [x] Solution matches the manager's literal instructions (no design phase needed for a spec this precise)
- [x] All new files/functions are actually used — no new files/functions created

## Validation Results
- Complete validation performed as suggested in tech spec: **No — cannot be, no on-device run available this session.** Validated by static reasoning through the state machine instead.
- **This is untested on physical hardware.** No CircuitPython host test suite exists (`project_context.md`: "The firmware runs on-device (CircuitPython); it cannot be unit-tested on the development PC").

| Validation Step | Validation Result | Failure Analysis |
|---|---|---|
| Reasoning trace: idle -> tap timer area -> go_running() | Pass (by inspection) | N/A |
| Reasoning trace: closed -> tap timer area -> go_running() | Pass (by inspection) | N/A |
| Reasoning trace: done (auto_open=True) -> OPEN button shown -> tap -> go_idle() | Pass (by inspection) | N/A |
| Reasoning trace: done (auto_open=False) -> OPEN button shown (unchanged from before) -> tap -> go_idle() | Pass (by inspection) | N/A |
| Grep for other readers of `button.hidden`/`_show_button`/`btn_label`/`in_button(` outside the two target files | Pass — only hits in `_timer_backup.py` (non-live) and the two edited files | N/A |
| Manual review of full diff | Pass — matches spec exactly, no unrelated changes | N/A |

## New Files/Functions Created
None.

## New Tests Added
None — no host test suite exists for this firmware; validation is on-device only (deferred to hardware review).

## Existing Test Suites Run
None exist for `Box-code/` (CircuitPython, on-device only, per `project_context.md`).

## Pre-Completion Reflection
**Reflection Summary:** Re-read both target functions and the full tap-dispatch path (`LockController.process` -> `_handle_release` -> `in_button()`) line by line to confirm no hit-test/state-machine code was touched — only `set_button`/`_show_button` calls and comments. Confirmed via grep that no other code path depends on the button being visible in idle/closed (the press-ring feedback in `on_touch_down` already self-gates on `button.hidden`, so it naturally stops appearing for the now-hidden idle/closed tap region without further changes). Confirmed the physical GPIO10/GPIO1 button handlers (`press_override`, `press_lock`) have no behavioral changes — only `press_lock`'s docstring wording changed.
✅ Reflection Phase 1 (Claim Verification): YES — diff reviewed against every stated requirement above.
✅ Reflection Phase 2 (Risk Analysis): YES — main risk is the complete absence of on-device validation; explicitly flagged as untested on hardware.
✅ Reflection Phase 3 (Validation Plan Check): YES — validation plan is reasoning-only, consistent with this project's stated constraints (no host test suite).
✅ Reflection Phase 4 (Self-Audit): YES.
✅ All blockers from reflection addressed: YES (blocker = no hardware validation; addressed by stating this plainly rather than claiming false confidence).
✅ Confidence level: 90% (logic traced and consistent; residual 10% is inherent to zero on-device testing this session).

## Continous Learning
None — no new durable rule needed; this was a straightforward, fully-specified visibility change.
