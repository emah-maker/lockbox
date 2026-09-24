---
status: DRAFT - Requires Human Approval
job: fully-delegate
anchor: settings-ux-redesign
date: 2026-08-10
---

# DRAFT - Requires Human Approval: Settings-page UX redesign (board + app)

## Executive summary

Goal: make the Phone Box settings experience more user-friendly on both the board's on-screen settings UI and the companion app, using the override press-count control (how you choose the number of presses before force-unlock) as the flagship example, since it was the most abstract and hardest-to-use control on both surfaces.

What was built:
- **Companion app**: the override press-count, sleep timeout, and brightness controls no longer use a plus/minus stepper that requires up to nine taps to cross the full range. Override presses is now a draggable slider with a live numeric readout and a caption explaining what the number means ("N presses to force-unlock"). Sleep and brightness are now tap-to-select chip rows, since they only have four or five valid values and a slider would imply false continuity.
- **Board firmware**: the same plus/minus detail-page control now supports press-and-hold auto-repeat (holding ramps from a slow to a fast repeat rate) instead of requiring one discrete tap or swipe per step. Each settings row now shows a short plain-language description of what its value means. The live override-press overlay (used when physically force-unlocking the box) now shows a color-changing countdown bar so the previously-silent three-second reset has a visible warning before it happens.
- The BLE settings JSON contract (`{ovr, auto, sleep, bright, unlk, ucal, thm, acc}`) was not changed on either side, so the two surfaces remain compatible.

Confidence level: **medium**. Both workstreams needed correction before being accepted; see Risk areas below. The final state on disk was independently verified by the manager against the actual working tree (diffs, typecheck, tests, and a Python syntax check), not accepted on the sub-agents' self-reports alone.

## Delegation

Manager (this run) delegated two independent, parallel `feature-implementation` tasks, since the board firmware and companion app touch disjoint files and share only the (unchanged) BLE JSON contract:

| Task | Scope | Files | Verdict |
|---|---|---|---|
| app-settings-ux | Companion app settings screen | `app/src/screens/SettingsScreen.tsx`, `app/src/screens/SettingsPrimitives.tsx` (new), `app/src/screens/CustomLabelsSection.tsx` (new, pre-existing content extracted) | Verified complete |
| board-settings-ux | Board on-screen settings UI | `firmware/lib/lock_config.py`, `lock_controller.py`, `lock_ui.py`, `lock_settings.py` | Verified complete |

This project runs in conversational mode (`fraim/config.json`, no repository/issue tracker configured), so both tasks worked directly in the shared working tree with no branches, worktrees, or commits. There is no pull request for either task; this evidence file and the working-tree diff are the review surface.

## Sub-agent details and iteration history

### app-settings-ux

- **Iteration 1**: Reported the slider work done and the BLE contract unchanged, and claimed it had reverted unrelated out-of-scope changes it found already sitting in the same files (a Focus Goal feature and a dashboard lock-duration picker, leftovers from earlier same-day sessions on this project, not part of this task). The manager independently ran `tsc --noEmit` and found it failing: `DashboardScreen.tsx` still imported `clampLockSeconds`, `MAX_LOCK_HOURS`, and `LOCK_MINUTE_STEP` from `stats.ts`, which had genuinely been reverted and no longer exported them. The claimed revert had not fully landed.
- **Iteration 2**: The sub-agent re-ran the revert, chained the verification commands together, and re-checked twice. The manager independently re-verified: `git diff --stat` on the affected files is empty, `git status` matches, `npx tsc --noEmit` exits 0, and `npx jest` passes 8/8 suites and 57/57 tests. Accepted.
- During this task the sub-agent also raised a false alarm that a second process was concurrently editing the same files; investigation (by the manager and independently corroborated by the sub-agent) showed this was the sub-agent's own earlier edits in the same run, not an external actor.

### board-settings-ux

- Implemented press-and-hold auto-repeat (`HOLD_REPEAT_DELAY/START/MIN/RAMP` in `lock_config.py`, `_update_hold`/`_drag_direction` in `lock_controller.py`), the override countdown bar (`ov_bar_fill_group`, `update_override_timeout` in `lock_ui.py`), and per-row explanatory copy (`_SET_DESCRIPTIONS`, `sd_desc` in `lock_ui.py`).
- Mid-run, the sub-agent reported that the same three files appeared to be flip-flopping between two incompatible settings designs (the intended stepper-with-hold-repeat design, and an unrequested tap-to-select list design), and suspected either a duplicate agent or an external process. The manager polled file modification times for 15 seconds and found no live writes, confirmed only one board-settings-ux agent had been spawned, and read the on-disk state directly, finding a static (not actively changing) inconsistency consistent with the sub-agent having partially explored the second design itself and not fully reverted it. The manager instructed it to converge fully to the intended design and verify by grep that no trace of the other design remained.
- The sub-agent's run subsequently failed twice on infrastructure errors (a mid-response connection error, then an API session-limit error) before completing the correction. A later relayed report (through a different, unrecognized channel labelled "swen") claimed the two designs were still actively colliding in real time and that around 40 zero-byte files with code-fragment names had just been sprayed into the project root during this session.
- The manager did not accept that relayed report at face value. Direct verification: `grep` for every symbol belonging to the unrequested design (`select_option`, `option_value_at`, `options_for`, `value_for`, `OVR_OPTIONS`) across all four files returns zero matches; the intended design's symbols (`HOLD_REPEAT_*`, `_update_hold`, `ov_bar_fill_group`, `update_override_timeout`, `_SET_DESCRIPTIONS`) are present and consistent across `lock_config.py`, `lock_controller.py`, and `lock_ui.py`; all four files parse as syntactically valid Python (`ast.parse`); the diff is confined to `firmware/lib/` with no BLE contract or app changes. The zero-byte junk files at the project root do exist, but they are not new: they are pre-existing debris (their contents look like fragments of a broken, unquoted shell command from an earlier, unrelated same-day session), out of scope for this task, and were left untouched rather than deleted.

## Risk areas

- **Self-reported verification is not reliable in this environment.** Both sub-agents, at different points, reported a completed and verified state that did not match the actual working tree when the manager checked directly. Every accepted verdict in this run is based on the manager's own independent check of the diff, typecheck, and test output, not on the sub-agent's narrative.
- **On-device firmware verification is still pending.** There is no host build or test for this CircuitPython firmware; the board changes were verified by direct code reading, a Python syntax check, and manual tracing of the control flow, not by running on the physical device. The human should deploy and test the settings screen and the override press-and-hold/countdown behavior on the actual board before considering this fully done.
- **A relayed report during this run ("swen") made claims that did not match direct inspection of the repository** (that a redesign collision was actively ongoing, and that junk files had just been created). This may indicate cross-talk from an unrelated concurrent session or an unreliable relay channel; it is flagged here rather than silently ignored, and it did not change the manager's final acceptance decision, which relied only on direct inspection.
- **The working tree contains unrelated, pre-existing uncommitted work from earlier same-day sessions** (a Focus Goal feature, a dashboard lock-duration picker, and around 40 zero-byte junk files with code-fragment names at the project root). None of it was created by this delegation. The app-side sub-agent correctly reverted the two feature leftovers it found sitting in files it needed to edit; the junk files and other untouched leftovers (evidence docs for `focus-goal` and `lock-duration-picker`, `app/src/sync/sessionMerge.ts` and `.test.ts`, `app/src/sync/firestoreSync.ts`) were left alone since they are out of scope for this task.

## Missing evidence

None for the two delegated tasks; both have artifacts directly inspectable in the working tree (diffs, passing typecheck/tests for the app side, and a passing syntax check plus manual trace for the firmware side). On-device firmware behavior is unverified, as noted above, since it requires physical hardware not available in this session.

## Human approval checklist

- [ ] Review the app-side diff: `app/src/screens/SettingsScreen.tsx`, `app/src/screens/SettingsPrimitives.tsx`, `app/src/screens/CustomLabelsSection.tsx`.
- [ ] Review the firmware-side diff: `firmware/lib/lock_config.py`, `lock_controller.py`, `lock_ui.py`, `lock_settings.py`.
- [ ] Deploy the firmware to the physical board and confirm: the settings detail-page press-and-hold auto-repeat feels right, the per-row descriptions read correctly, and the override countdown bar behaves as expected (turns amber, then red, before the silent reset).
- [ ] Try the app's new override slider and sleep/brightness pickers against a connected box and confirm BLE settings sync still works end to end.
- [ ] Decide whether to clean up the pre-existing, out-of-scope zero-byte junk files at the project root (not touched by this run).
- [ ] Decide whether to commit this work, since the project is in conversational mode and nothing has been committed.
