# Feature: Tag-picker swipe-cancel fix, cancel animation, hold-to-confirm tagging, servo angle setting
Issue: firmware-dev workstream (manager: MANdy, parent objective: box tag-picker fixes + servo angle + dashboard label)
Tech Spec: manager brief (inline, no separate RFC)
PR: N/A (working-tree deliverable, reviewed by MANdy before any device deploy)

## Work List
Scope is firmware/lib/lock_ui.py, lock_controller.py, lock_config.py, lock_settings.py ONLY. app/ is out of scope (sibling task).

### Scope
- [x] lock_controller.py - `_handle_release`'s "picking" swipe-up-cancel branch now defers to the cancel-flash completion, which calls `self.ui.hide_tag_picker()` before `go_closed()`/`go_idle()` - bug fix ✅
- [x] lock_ui.py - cancel-flash animation on swipe-up-cancel (rows slide/fade up + up-arrow flash near "swipe up = cancel" hint), driven from the existing per-frame update loop ✅
- [x] lock_controller.py / lock_ui.py - hold-to-confirm tag-picker rows: press-and-hold starts a green fill animation over a fixed duration; release-before-fill cancels; fill-completion commits `go_running(topic=...)` ✅
- [x] lock_config.py - `SERVO_LOCK_ANGLE`/`SERVO_UNLOCK_ANGLE` remain as compiled-in defaults only (now seed `Settings.lock_angle`/`unlock_angle`) ✅
- [x] lock_settings.py - add `lock_angle`/`unlock_angle` fields, NVM-persist (bumped `_MAGIC` 0x62->0x63, extended layout at `_BASE+11`/`_BASE+12`), clamp to [-90, 90] ✅
- [x] lock_controller.py - `engage_lock`/`release_lock` use `self.settings.lock_angle`/`unlock_angle` instead of the fixed constants ✅
- [x] lock_controller.py - `ble_settings_json` adds `langle`/`uangle`; `apply_ble_settings_json` applies+clamps them (key names fixed by contract with the parallel app-side task) ✅

### Validation Requirements
- `uiValidationRequired`: No (CircuitPython displayio UI, no host-runnable renderer for this display stack per existing lock_config.py comments — visual verification is on-device only, which is out of scope unless the human asks to deploy)
- `mobileValidationRequired`: No (app/ is a sibling task)
- Required suites/modes: `python -m py_compile` on every changed file (no automated test suite exists for firmware, confirmed against repo state)

### Decisions
- Hold duration: 600ms (`TAG_HOLD_S`, lock_config.py) -- middle of the requested 500-800ms band.
- Cancel-flash duration: 220ms (`TAG_PICKER_CANCEL_ANIM_S`) -- just above `STATUS_TRANSITION_S` (200ms), since this is a swipe-triggered exit affordance rather than a routine state-color flip.
- Cancel-flash mechanics: rows fade toward `C_BG` via `lerp_color` (the same RGB-lerp technique `step_color_transitions` already uses, since displayio has no alpha) while sliding up 22px (`_TP_CANCEL_SLIDE_PX`); an up-arrow icon flashes 3 full on/off cycles, computed from the animation fraction `t` (not wall-clock elapsed time) so it can't drift if a frame is skipped. Driven entirely from `LockController.update()`'s existing per-frame tier -- no new physics/easing system.
- Hold-fill mechanics: a single shared Rect group per the existing `bat_fill_group`/`ov_bar_fill_group` "rebuild only when the (row, width) key changes" idiom, growing left-to-right behind the row's dot+label (z-order: appended before them in the same group).
- Row taps no longer start anything by themselves (replaced by hold-to-confirm); on-screen hint text changed from "tap = tag & start" to "hold = tag & start". SKIP/MORE are unaffected (still single tap).
- `hide_tag_picker()` is the single chokepoint for leaving the picker (already true before this change via `go_running`'s call to it) -- the row-position/color reset for the cancel-flash was placed there rather than inside `step_tag_picker_cancel_anim`'s own t>=1.0 case, because that branch is mathematically unreachable in the normal flow (LockController stops driving the step function and calls `hide_tag_picker()` directly the instant its deadline passes, always at t<1.0).
- NVM layout: bumped `_MAGIC` from 0x62 to 0x63, appended `lock_angle`/`unlock_angle` at `_BASE+11`/`_BASE+12`, stored as `angle+90` (0..180) to fit unsigned NVM bytes without signed-byte handling -- same incremental-layout convention used for `screen_flipped`.
- No on-box Settings-screen UI was added for lock/unlock angle (only NVM storage + BLE wiring) -- the brief scopes the phone-app UI to the sibling task; the box side only needs to store, apply, and expose the values.

### Deferrals
- None within this scope. Dashboard free-text one-time session label and any phone-app servo-angle UI are explicitly owned by the sibling app-side task.

## Spec and Design Completeness

**Feature Requirements Source**: Manager (MANdy) inline brief, this conversation.
**Technical Design Source**: N/A — no RFC; brief specifies exact mechanism (hold timing modeled on `_update_hold`/`_drag_direction`, animation modeled on existing displayio property-update per-tick pattern).

### Implementation Checklist

#### Part 1: Swipe-up-cancel bug fix
- [x] File: lock_controller.py - `_handle_release` picking-state cancel branch defers to the cancel-flash completion in `update()`, which calls `hide_tag_picker()` before `go_closed()`/`go_idle()` - ✅ Implemented

#### Part 2: Cancel flash animation
- [x] File: lock_ui.py - `start_tag_picker_cancel_anim`/`step_tag_picker_cancel_anim`/`_reset_tag_picker_rows` - ✅ Implemented
- [x] File: lock_controller.py - `_handle_release` triggers the animation on swipe-up-cancel; `update()`'s `_picker_cancel_until` tick defers the actual `hide_tag_picker()`/state transition until the flash completes - ✅ Implemented

#### Part 3: Hold-to-confirm tagging
- [x] File: lock_ui.py - `start_tag_picker_hold`/`step_tag_picker_hold`/`cancel_tag_picker_hold` (green fill visual per row) - ✅ Implemented
- [x] File: lock_controller.py - `_start_tag_hold`/`_update_tag_hold` (press/hold/release timing in the picking state) - ✅ Implemented

#### Part 4: Servo angle setting
- [x] File: lock_settings.py - `lock_angle`/`unlock_angle` fields + NVM persistence - ✅ Implemented
- [x] File: lock_controller.py - `engage_lock`/`release_lock`, `ble_settings_json`, `apply_ble_settings_json` - ✅ Implemented

**Feature Requirements Completeness Summary**:
- Implemented: 12/12 items (100%)
- Deferred: 0
- Missing: 0

### Feature Requirement Traceability Matrix
Source of truth: manager (MANdy) inline brief (this conversation) — no separate feature spec exists for this subtask.

| Requirement/Acceptance Criteria | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Swipe-up-cancel must call `hide_tag_picker()` before `go_closed()`/`go_idle()` so the screen doesn't stay stuck on the tag picker | lock_controller.py `update()`'s `_picker_cancel_until` completion branch | Code-trace (Validation Results): the completion branch calls `self.ui.hide_tag_picker()` unconditionally before either `go_closed(now)` or `go_idle()`, on every path | Met |
| Swipe-up-cancel plays a brief animated flash (rows sliding/fading up, up-arrow flashing near the cancel hint) before hiding the picker, using a handful of displayio property updates across a few ticks of the existing update loop, not a new physics/easing system | lock_ui.py `start_tag_picker_cancel_anim`/`step_tag_picker_cancel_anim`/`_reset_tag_picker_rows`; lock_controller.py `update()`'s `_picker_cancel_until` tick | Code-trace: driven entirely from the existing `LockController.update()` per-frame call, updates only `.anchored_position`/`.y`/`.color`/`.hidden` each tick (no new Spring/easing engine); duration `TAG_PICKER_CANCEL_ANIM_S=0.22s` named in lock_config.py | Met |
| Hold-to-confirm tagging: press starts a green fill that grows to cover the row over a concrete 500-800ms duration; release before fill cancels (no tag, back to picker); fill completing auto-commits `go_running(topic=that_id)` | lock_controller.py `_start_tag_hold`/`_update_tag_hold`; lock_ui.py `start_tag_picker_hold`/`step_tag_picker_hold`/`cancel_tag_picker_hold` | Code-trace: `TAG_HOLD_S=0.6` (lock_config.py, within the requested band); `_update_tag_hold` calls `go_running(now, topic=...)` exactly when `progress>=1.0`; `_handle_release`'s picking-block cleanup clears the fill with no `go_running` call on any release before that | Met |
| Hold timing modeled on the existing `_update_hold`/`_drag_direction` continuous-touch pattern, as a single discrete threshold, not a repeating step | lock_controller.py `_start_tag_hold`/`_update_tag_hold`, wired into `process()` the same way `_update_hold` already was | Code-trace: `process()`'s down-branch calls `_start_tag_hold`/`_update_tag_hold` from the same per-frame polling site as `_update_hold`; `_update_tag_hold` has no repeat/ramp logic, just one `progress>=1.0` threshold | Met |
| SKIP and MORE controls unaffected (still single tap) | lock_controller.py `_start_tag_hold` (nav check precedes row check) | Code-trace: `_start_tag_hold` returns immediately without arming a hold when `tag_picker_nav_at` matches; `_handle_release`'s existing skip/more tap handling is untouched | Met |
| Add `lock_angle`/`unlock_angle` to `Settings`, defaulting to `SERVO_LOCK_ANGLE`/`SERVO_UNLOCK_ANGLE` so behavior is unchanged until edited | lock_settings.py `Settings.__init__` | Code-trace: `self.lock_angle = SERVO_LOCK_ANGLE`; `self.unlock_angle = SERVO_UNLOCK_ANGLE` | Met |
| NVM-persist the angle fields, bumping `_MAGIC` and extending the layout the same way `screen_flipped` was added | lock_settings.py `_load`/`save` | Code-trace: `_MAGIC` 0x62->0x63; new offsets `_BASE+11`/`_BASE+12`, same incremental-offset pattern as `screen_flipped`'s `_BASE+10`; NVM-collision check against lock_log.py's `_BASE=24` confirmed clear (Existing Test Suites Run section) | Met |
| Clamp angles to [-90, 90] | lock_settings.py `save()`; lock_controller.py `apply_ble_settings_json` | Code-trace: both clamp via `SERVO_ANGLE_MIN`/`SERVO_ANGLE_MAX` (=-90/90, lock_config.py); `lock_servo.Servo._write_angle` independently clamps the same range as a hardware backstop | Met |
| Apply the settings in `engage_lock`/`release_lock` instead of the fixed constants | lock_controller.py `engage_lock`/`release_lock` | Code-trace: `self.servo.move(self.settings.lock_angle)` / `self.servo.move(self.settings.unlock_angle)`, replacing the old fixed-constant calls | Met |
| Wire into `ble_settings_json` (`langle`/`uangle`) and `apply_ble_settings_json` (same per-field try/except clamp pattern as `ovr`/`sleep`/`bright`); exact key names fixed by contract with the app-side task | lock_controller.py `ble_settings_json`/`apply_ble_settings_json` | Code-trace: `"langle":{}` / `"uangle":{}` added to the JSON template with `st.lock_angle`/`st.unlock_angle`; `apply_ble_settings_json` has matching `if "langle" in d: try: ... except (ValueError, TypeError): pass` blocks, same shape as the `ovr` block | Met |
| Scope limited to lock_ui.py/lock_controller.py/lock_config.py/lock_settings.py; app/ untouched | N/A (negative requirement) | `git status --porcelain` scoped to the repo shows only the 4 files + this evidence doc changed; no changes under `app/` | Met |
| Verify via `python -m py_compile` (no test suite exists) | All 4 changed files + full `firmware` package | Validation Results + Existing Test Suites Run sections: exit 0 on every file | Met |

### Technical Design Traceability Matrix
No RFC/technical design doc exists for this subtask — the manager brief is both the requirements and the design source (it specifies exact mechanisms: reuse the existing update-loop tier, model hold timing on `_update_hold`/`_drag_direction`, pick concrete values and note them). Patterns not explicitly named in the brief (`lerp_color`/`step_color_transitions` for the fade, the `bat_fill_group`/`ov_bar_fill_group` rebuild-on-change idiom for the growing fill) were discovered during implementation to satisfy the brief's "reuse the existing loop, don't invent new machinery" constraint and are recorded in the Work List's Decisions section.

| Design Commitment | Implemented File/Function | Proof | Status |
|---|---|---|---|
| No new physics/easing system for the cancel flash | lock_ui.py `step_tag_picker_cancel_anim` | Direct `t`-driven property writes + the existing `lerp_color` helper; no new Spring/easing class | Met |
| No new repeating-step machinery for the hold (single discrete threshold) | lock_controller.py `_update_tag_hold` | One `progress>=1.0` check, no ramp/interval state like `_update_hold`'s auto-repeat | Met |
| `langle`/`uangle` BLE key names fixed by cross-task contract, not renamed | lock_controller.py `ble_settings_json`/`apply_ble_settings_json` | Exact key strings `"langle"`/`"uangle"` used verbatim | Met |

## Completeness Evidence
 - All phases of tech spec complete: Yes (no separate tech spec exists; manager brief is the source of truth and all 12 traceable items above are Met)
 - Issue tagged with label `phase:impl`: N/A (no issue tracker configured for this subtask)
 - Issue tagged with label `status:needs-review`: N/A
 - All files committed/synced to branch: No — intentionally working-tree-only per the manager brief ("this is a working-tree-only deliverable reviewed by MANdy before any device deploy"); no commit made

## Implementation Quality Checkpoints
 - [x] Code complexity reviewed (no overengineering) — all new functions are short (<=25 lines), <=2 levels of nesting, <=2 params; no new abstraction layers beyond what each of the 4 scope items needed
 - [x] No resource waste (excessive retries, delays, workarounds) — hold/cancel-flash animations reuse the existing per-frame `update()`/`process()` polling tier already in this file (no new timers/threads); fill-bar rebuilds follow the codebase's established "only rebuild the Rect group when the (key) actually changes" idiom (`bat_fill_group`/`ov_bar_fill_group`), not per-frame reallocation
 - [x] Solution based on proven prototype from design phase — no separate prototype phase for this workstream (manager brief was the fully-specified design source); mechanics were modeled directly on existing, working patterns in this codebase (`_update_hold`/`_drag_direction` for the hold timing, `step_color_transitions`/`lerp_color` for the fade, the battery/override fill-bar rebuild idiom for the growing fill) rather than invented from scratch
 - [x] All new files/functions are actually used — no new files; every new/changed function (`_start_tag_hold`, `_update_tag_hold`, `tag_picker_row_at`, `tag_picker_topic_for_row`, `start_tag_picker_hold`, `step_tag_picker_hold`, `cancel_tag_picker_hold`, `start_tag_picker_cancel_anim`, `step_tag_picker_cancel_anim`, `_reset_tag_picker_rows`) is called from the touch loop or `update()` traced in Validation Results above

**QUALITY CHECK FAILURE items found**: None. One pre-existing condition noted, not introduced by this change and out of this task's scope to fix:
 - lock_ui.py (1946 lines) and lock_controller.py (1056 lines) already exceeded this repo's CLAUDE.md "keep files under 500 lines" guideline before this change (they were ~1785/~944 lines respectively). This diff added ~161/~112 lines to files that were already monolithic by that standard. Splitting either file is a large, independent refactor with no relation to the 4 scoped fixes/features here, and the manager brief scoped exactly these 4 files for these 4 specific changes with no refactor requested — flagging for awareness, not fixing in this workstream. RESOLVED (as "no action" — pre-existing, out of scope).

## Validation Results
- `uiValidationRequired`: No -- see Work List (no host-runnable displayio renderer for this stack; on-device visual check is out of scope unless the human requests a deploy)
- UI polish check: N/A -- no `ui-polish-validation` job run (uiValidationRequired is No)

| Validation Step | Result | Notes |
|---|---|---|
| `python -m py_compile firmware/lib/lock_config.py` | Pass | |
| `python -m py_compile firmware/lib/lock_settings.py` | Pass | |
| `python -m py_compile firmware/lib/lock_controller.py` | Pass | |
| `python -m py_compile firmware/lib/lock_ui.py` | Pass | |
| `git status` scope check | Pass | Only the 4 scoped files + this evidence doc changed; no untracked artifact pollution |
| Placeholder/TODO scan (`TODO\|FIXME\|XXX\|fix.?me`, case-insensitive) on lock_ui.py/lock_controller.py | Pass | 0 matches |
| NVM offset collision check | Pass | lock_settings.py now uses `_BASE(8)+11`/`_BASE+12` (max offset 20); lock_log.py's own persisted queue starts at `_BASE=24` -- no overlap, 3-byte gap preserved |
| Manual code-trace: swipe-up-cancel bug fix | Pass | `hide_tag_picker()` now unconditionally precedes `go_closed()`/`go_idle()` on every path out of "picking" (traced go_running's existing call + the new cancel-flash completion path in `update()`) |
| Manual code-trace: hold-to-confirm state machine | Pass | Traced touch-down (`_start_tag_hold`) -> per-frame growth (`_update_tag_hold`) -> commit (progress>=1.0, calls `go_running` before `process()`'s picking-state guard can re-enter) -> release-before-fill (top-of-block cleanup in `_handle_release`) -> drift-off-row cancellation |
| Manual code-trace: cancel-flash + hold interplay | Pass | Confirmed a hold in progress during a swipe-up-cancel self-cancels via the drift check (vertical movement past tolerance changes `tag_picker_row_at`) before release fires; confirmed no new hold can arm during an in-flight cancel flash (`_picker_cancel_until` guard in `_start_tag_hold`) |

## Bug Bash Findings
Traced edge cases (no host-runnable harness exists for this displayio/hardware stack, so this is static code-tracing, not executed):
- Empty/short topic list: `BUILTIN_TOPICS` always has 6 fixed entries (lock_config.py), so the picker is never empty; paging math (`_picker_page_count`) unaffected by this change.
- Page flip mid-hold: not reachable -- paging only happens on a swipe/MORE *release*, which ends the current touch; a hold can only span one continuous touch-down on one page's `_tp_ids`.
- Commit firing mid-touch (before release): confirmed `process()`'s `elif self.state == "picking": self._update_tag_hold(now)` naturally stops firing once `go_running` flips `self.state` to "running" inside the same call, with no separate "committed" flag needed.
- SKIP/MORE vs. row hold priority: `_start_tag_hold` checks `tag_picker_nav_at` first (same priority order as the original tap logic), so a press on SKIP/MORE never arms a hold.
- 0 Critical/High issues found.

## Security Review

### Executive Summary
- 0 Critical, 0 High, 0 Medium, 0 Low findings.
- No escalation items. No blocking action required.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`: firmware/lib/lock_ui.py, firmware/lib/lock_controller.py, firmware/lib/lock_config.py, firmware/lib/lock_settings.py

### Threat Surface Summary
- No surface in the closed set `{web, api, llm-app, data-pipeline, mobile, capability-authoring, docs-only}` matched: all 4 changed files are CircuitPython on-device firmware (displayio UI, NVM settings, BLE GATT peripheral wiring), which none of the surface heuristics cover (the `mobile` heuristic is specifically iOS/Android app code, not embedded firmware). Per threat-surface-classification's "no heuristic matches" case: `surfaces: []`.
- `secrets-in-code-check` and `privacy-and-pii-review` were still run manually against the diff per the "every non-docs-only review" requirement, since these files are not `.md`/docs-only.

### Coverage Matrix
| Category | Status | Notes |
|---|---|---|
| OWASP Top 10 (web) | N/A | surface not detected |
| OWASP API Top 10 | N/A | surface not detected |
| OWASP LLM Top 10 | N/A | surface not detected |
| Capability-authoring review | N/A | surface not detected |
| Secrets in code | Pass | No matches for any detector pattern in the diff (no keys/tokens/PEM blocks/webhooks; only numeric tunables, BLE JSON key names, and NVM byte offsets) |
| Privacy / PII | Pass | New BLE fields (`langle`/`uangle`) are servo-angle integers, not PII; no new logging, telemetry, or third-party egress added; no retention change (same NVM-only persistence pattern as existing settings fields) |

### Findings
None.

### Prioritized Remediation Queue
None.

### Verification Evidence
- Secrets scan: manual pattern review of the diff (`git diff` for the 4 files) against every detector in secrets-in-code-check.md -- no matches.
- Privacy scan: manual review of the diff's data-flow (new `lock_angle`/`unlock_angle` fields flow: NVM <-> Settings <-> BLE `settings` characteristic, same shape as pre-existing `screen_flipped`) -- no PII categories touched.

### Applied Fixes and Filed Work Items
None -- no findings to fix or file.

### Accepted / Deferred / Blocked
None.

### Compliance Control Mapping
N/A -- no active compliance framework specified for this workstream.

### Run Metadata
- Run date: 2026-08-24
- Reviewed diff: working-tree changes to firmware/lib/{lock_ui,lock_controller,lock_config,lock_settings}.py (uncommitted; no commit SHA yet per manager brief -- working-tree-only deliverable)
- Skill errors: none
- Caps hit: none
- Environment notes: no repo-configured OWASP/capability-authoring skills were loaded since no matching surface was detected; this is expected for an embedded-firmware-only diff, not a gap

## New Files/Functions Created
TBD.

## New Tests Added
N/A — no automated test suite exists for firmware (CircuitPython on-device firmware, no host-runnable harness).

## Existing Test Suites Run
N/A — no automated suite exists for firmware (no `testSuiteCommand` configured in fraim/config.json either, confirmed by FRAIM at the implement-regression phase).

### Regression Check (in place of a test suite)
- `python -m py_compile` on every `.py` file under `firmware/lib/` and `firmware/*.py` (not just the 4 changed files) — exit 0, confirms the import-list change in lock_controller.py (dropped `SERVO_LOCK_ANGLE`/`SERVO_UNLOCK_ANGLE`, added `SERVO_ANGLE_MIN`/`SERVO_ANGLE_MAX`/`TAG_HOLD_S`/`TAG_PICKER_CANCEL_ANIM_S`) didn't break any other module in the package.
- Grepped the whole `firmware/` tree for every renamed/changed LockUI method (`tag_picker_topic_at`, `cancel_tag_picker_hold`, `hide_tag_picker`) and both BLE settings functions — only lock_ui.py/lock_controller.py/lock_settings.py/lock_ble.py reference them, and lock_ble.py's calls (`ctrl.ble_settings_json()`/`ctrl.apply_ble_settings_json(sett)`) are unchanged call shapes (same 0-arg / 1-arg signatures), so no other file needed updating.
- Checked for a fixed max-length on the BLE `settings` characteristic (`firmware/lib/lock_ble.py`'s `StringCharacteristic` definition) that the ~26 extra bytes from `"langle":...,"uangle":...` could overflow — no `max_length` kwarg is set on any of this service's characteristics (including `history`/`labels`, which already carry longer variable-length JSON), so this predates the current change and is not a regression it introduces.

## Pre-Completion Reflection
TBD.

## Continous Learning
TBD.
