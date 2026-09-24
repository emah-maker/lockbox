---
status: DRAFT - Requires Human Approval
date: 2026-08-24
job: fully-delegate
anchor: tag-picker-gestures-and-servo-angle-settings
mode: conversational (no issue tracker/PR configured for this project)
---

# DRAFT - Requires Human Approval: Tag-Picker Gestures + Servo Angle Settings

## Executive Summary

**Goal**: Fix the box's pre-session tag picker (swipe-up cancel was broken; add
visible cancel/confirm feedback; prevent accidental mis-tagging) and add two
new phone-adjustable settings (servo lock/unlock angle; a free-text one-time
session label on the Dashboard).

**What was built**:
- Box (`firmware/lib/lock_ui.py`, `lock_controller.py`, `lock_config.py`,
  `lock_settings.py`): fixed the swipe-up-cancel bug, replaced tap-to-tag with
  hold-to-confirm (green fill), replaced the cancel gesture's feedback with a
  live red fill bar, and added an app-adjustable `lock_angle`/`unlock_angle`
  setting (NVM-persisted, BLE-synced as `langle`/`uangle`).
- App (`app/src/**`): numeric-keypad + sign-toggle angle controls in Settings
  wired to the same `langle`/`uangle` BLE keys, and a free-text "tag once"
  field on the Dashboard's `TopicPicker` that tags a session without adding it
  to the saved custom-label catalog.

**Confidence level: medium.** One workstream (app) passed on the first
iteration. The other (box) required a correction cycle on one of its four
items, and that correction was ultimately applied directly by MANdy rather
than by the delegated child (see Risk Areas) after the delegation
infrastructure did not pick it up.

## Sub-Agent Review Surfaces

| Task | Persona | Job | Evidence file | PR | Verdict | Iterations |
|---|---|---|---|---|---|---|
| `app-servo-angle-and-tag-once-label` | mobile-dev | feature-implementation | `docs/evidence/app-servo-angle-and-tag-once-label-feature-implementation-evidence.md` | none (conversational mode) | Accepted | 1 |
| `box-tag-picker-and-angle-setting` | firmware-dev | feature-implementation | `docs/evidence/tag-picker-fixes-and-servo-angle-feature-implementation-evidence.md` | none (conversational mode) | Accepted (with a manager-authored correction, see below) | 2 |

## Risk Areas

1. **Box task, item 2 (cancel animation) failed iteration 1 and the correction
   was applied by MANdy directly, not by the firmware-dev child.**
   - Iteration 1 delivered a fixed 220ms post-release flash (arrow icon +
     rows sliding/fading) matching the *original* brief. A manager coaching
     message issued before that task completed asked for a live red fill bar
     instead (mirroring the already-approved green hold-to-confirm bar), but
     that correction did not reach the child before it finished.
   - When asked for status, `ListAgents` showed no running or reachable
     child agent at all -- the delegation infrastructure had stalled, not
     just run slowly. Rather than continue waiting, MANdy implemented the
     already-fully-specified correction directly in
     `firmware/lib/lock_controller.py` and `lock_ui.py`: replaced the
     deferred, fixed-duration flash (`_picker_cancel_until`,
     `TAG_PICKER_CANCEL_ANIM_S`, the up-arrow widget, row slide/fade) with a
     live red bar driven every touch-poll tick by drag distance
     (`_update_tag_swipe`/`step_tag_picker_swipe_progress`), committing the
     cancel the instant it fills rather than on a scripted timer. Added
     gesture-priority arbitration (`_update_tag_picker_touch`) so a touch
     starting on a topic row hands off cleanly from the green confirm-fill to
     the red cancel-fill if it turns into an upward drag, plus a small
     (4px) jitter guard added during self-review so ordinary finger tremor
     while holding a row can't misfire that handoff and permanently drop an
     in-progress hold.
   - **Human should scrutinize**: this is a firmware change to a physical
     gesture with no test suite (verified by `python -m py_compile` and full
     static trace only, no device-level replay). Recommend a real on-device
     check before or during the next deploy, specifically: (a) holding a row
     stays green and commits at ~0.6s, (b) swiping up grows a red bar and
     commits a cancel the moment it's full, (c) starting on a row and then
     dragging up hands off from green to red without both showing at once,
     (d) a small in-place finger tremor while holding a row does not drop
     the hold.
   - **Attribution note**: `docs/evidence/tag-picker-fixes-and-servo-angle-feature-implementation-evidence.md`
     was written by the firmware-dev child against iteration 1 and describes
     the arrow/flash design, not the red bar actually shipped. It is stale
     relative to the final code; this file is the accurate record of what
     changed in iteration 2.

2. **Delegation infrastructure did not visibly relay a mid-flight manager
   correction to an in-progress/queued child task**, and separately did not
   spawn or surface any agent for iteration 2 at all. This is a process gap
   worth flagging for `sleep-on-learnings`, not something fixed in this run.

## Missing Evidence

- No device deploy was performed for either workstream. Firmware changes
  exist only in the working tree.
- No independent behavioral verification of the box firmware exists beyond
  static compilation and code trace (no CircuitPython test harness in this
  project).

## Human Approval Checklist

- [ ] Review the box firmware diff (`firmware/lib/lock_ui.py`,
      `lock_controller.py`, `lock_config.py`, `lock_settings.py`), especially
      the iteration-2 correction MANdy authored directly.
- [ ] Review the app diff (`app/src/ble/protocol.ts`,
      `app/src/stats/customLabels.ts`, `app/src/screens/ServoAngleSection.tsx`,
      `app/src/screens/servoAngle.ts`, `app/src/screens/TopicPicker.tsx`,
      `app/src/screens/SettingsScreen.tsx`, `app/src/screens/DashboardScreen.tsx`,
      `app/src/store/useSettingsStore.ts`).
- [ ] Decide whether to deploy the firmware to the physical box now (none of
      this has been flashed yet) -- deploy follows this project's existing
      batch-write + single-`sync` routine, no device replug.
- [ ] Decide whether to commit/push this work, and to which branch (no commit
      has been made; this is a working-tree-only deliverable).
- [ ] Confirm the on-device gesture checks listed under Risk Area 1 once
      deployed, since no automated test suite covers this firmware.
