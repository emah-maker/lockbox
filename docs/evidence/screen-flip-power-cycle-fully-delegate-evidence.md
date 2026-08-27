# DRAFT - Requires Human Approval

# Fully-Delegate: Screen-Flip Touch Mapping Broken After Power Cycle

**Anchor**: conversational mode, no issue tracker configured for this repo (`fraim_connect`'s repo
context carries no `issueTracking` provider). No branch, no commit, no PR -- all changes sit in the
working tree pending review.
**Date**: 2026-08-25

## Executive Summary

**Goal**: manager reported that the buttons/touch are still wrong for the screen-flip orientation,
and suspected it was tied to power cycling.

**Outcome**: root cause found by code inspection, fix implemented, statically verified. **Confidence:
high** -- single, unambiguous root cause with no delegable ambiguity; delegated as a one-node graph
per the job's own process but implemented directly by the manager once the orchestration layer
proved unreachable (`ListAgents` showed no child agent for the emitted ledger task, same
already-documented stalled-pipeline situation as the 2026-08-24 tag-picker session).

**Root cause**: `Box-code/lib/lock_ui.py`'s `establish_base_rotation()` recovers the display's true
native rotation after a CircuitPython *soft reload* (an auto-reload triggered by a file save, which
`board.DISPLAY` survives) by unconditionally subtracting 180 degrees whenever `Settings.screen_flipped`
(persisted in NVM) is `True`. That assumption is correct for a soft reload but wrong for a genuine
**power cycle**: on a real power-on/hard reset, `board.DISPLAY` re-initializes to its hardware-default
rotation, discarding whatever orientation was live before power was lost. If NVM still says
`screen_flipped=True` from before the power loss, the existing logic subtracts 180 from an
already-native raw value, poisoning `_base_rotation`. `LockController._map` reads
`LockUI.is_flipped` (itself derived from `_base_rotation`) to decide whether to invert touch
coordinates, so this poisoning desyncs the touch mapping from the screen's real visual orientation --
exactly the reported "buttons broke, and it's about power cycling" symptom.

**Important context discovered during investigation**: `lock_ui.py`'s existing
`establish_base_rotation`/`is_flipped`/soft-reload-recovery logic (documented in the 2026-08-24
tag-picker retrospective) exists **only in the uncommitted working tree** -- it was apparently
deployed to the physical board via this project's sync-not-git deploy routine but never committed.
This fix is a layer on top of that same uncommitted code, closing its one remaining gap (power cycle,
as opposed to soft reload); it is not a regression of anything committed.

**What was built**:
- `Box-code/code.py`: detects a genuine cold boot via
  `supervisor.runtime.run_reason == supervisor.RunReason.STARTUP` (confirmed against Adafruit's
  CircuitPython `supervisor` docs) and passes it to `LockController` as `fresh_boot`.
- `Box-code/lib/lock_controller.py`: `__init__` accepts `fresh_boot=False` and threads it into
  `self.ui.establish_base_rotation(...)`.
- `Box-code/lib/lock_ui.py`: `establish_base_rotation(currently_flipped, fresh_boot=False)` now skips
  the 180-degree correction whenever `fresh_boot` is `True`, regardless of `currently_flipped` --
  docstring extended to explain the cold-boot-vs-soft-reload distinction.

## Delegation Ledger

Single-node graph (one tightly-coupled 3-file fix -- not parallelizable without recreating the
file-collision risk prior retrospectives already flagged):

| Task ID | Job | Persona | Depends On | Status |
|---|---|---|---|---|
| `fix-screen-flip-power-cycle-desync` | `feature-implementation` | `firmware-dev` | none | Verified-complete, manager-applied (iteration 1, no child agent reachable) |

## Missing Evidence

No child agent picked up the ledger task (`ListAgents` returned only unrelated peer sessions, no
agent addressable for this task), so no separate `feature-implementation` evidence file exists. The
work and its review verdict are both recorded directly in this file.

## Review Verdict

**`fix-screen-flip-power-cycle-desync` -- iteration 1, PASS (self-implemented and self-verified by
manager)**

- `python -m py_compile` on all three changed files (`Box-code/code.py`,
  `Box-code/lib/lock_controller.py`, `Box-code/lib/lock_ui.py`) -- clean.
- Statically traced all 4 boot-state combinations (`fresh_boot` x `currently_flipped`, true/false
  each) through `establish_base_rotation` -> `set_screen_flipped` -> `is_flipped` by hand:
  - Fresh boot, never flipped: unaffected, correct (no correction applied, none needed).
  - Fresh boot, flipped in Settings: **the bug case** -- correction now correctly skipped, so
    `_base_rotation` stays at the true native value and the subsequent `set_screen_flipped(True)`
    call flips relative to the right baseline; `is_flipped` and the physical rotation now agree.
  - Soft reload, never flipped: unaffected, correct (unchanged from prior logic).
  - Soft reload, flipped in Settings: unaffected, correct -- this is the case the existing (already
    working) logic was written for, and it is byte-for-byte unchanged by this fix.
- `git diff` on all three files read in full -- confirmed the new hunks are exactly the threaded
  `fresh_boot` flag and the corrected condition, with no unrelated changes. `lock_ui.py` also carries
  an unrelated, pre-existing uncommitted diff (removal of a `bat_diag` battery diagnostic label) that
  predates this task and was left untouched.

**Caveat**: no host build/test harness exists for this CircuitPython firmware (project convention) --
this fix is verified by static trace-through only, not by an actual power-cycle observed on the
physical board. It needs an on-device test: set the box to flipped in Settings, fully power the box
off and back on (not just save a file / trigger an auto-reload), and confirm the screen renders
flipped and touch/buttons behave correctly in that orientation.

## Risk Areas

1. **Unverified on physical hardware** -- this is a firmware fix for a bug that specifically only
   reproduces on a real power cycle; a soft-reload-only test (e.g. saving a file to trigger CircuitPython's
   auto-reload) will not exercise the fixed path and could give a false sense of confidence. A true
   power-off/power-on cycle is required to confirm.
2. **`lock_ui.py` carries other uncommitted, unrelated work** (the battery diagnostic label removal)
   that this task did not touch or evaluate -- flagging so it isn't mistaken for part of this fix when
   reviewing the diff or deciding what to commit.
3. **No delegation infrastructure was reachable** for this run's ledger (same gap the 2026-08-24
   retrospective already flagged) -- not a new issue, but recorded again since it recurred.

## Human Approval Checklist

- [ ] **Approve or reject the fix as implemented** (the 3 files listed under "What was built").
      Nothing has been committed or pushed -- everything sits in the working tree pending your review.
- [ ] **Test on physical hardware**: set screen-flip on in Settings, fully power-cycle the box (not a
      soft reload), and confirm touch/buttons now behave correctly in the flipped orientation.
- [ ] **If approved**: confirm whether you want this committed now, and whether it should be a
      standalone commit or bundled with the other uncommitted `lock_ui.py`/`lock_controller.py` work
      already sitting in the working tree.
