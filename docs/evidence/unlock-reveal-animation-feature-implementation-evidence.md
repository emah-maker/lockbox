# Feature: Replace the unlock ("done") blink with a one-shot ring reveal
Issue: unlock-reveal-animation (manager-assigned workstream, no GitHub issue/tracker for this local project)
Tech Spec: none (task defined directly by manager instructions; no RFC/spec doc exists for this change)
PR: none (conversational-mode project — `fraim/config.json` has `"mode": "conversational"` and no `repository` configured; work done in place, not on a branch/PR)

## Work List

### Scope
- [x] `firmware/lib/lock_config.py` - remove now-dead `ANIM_HZ`; add `DONE_REVEAL_S` (reveal duration) and `DONE_RING_CY`/`DONE_RING_R`/`DONE_RING_N` (ring geometry) tunables; reword the `CALL_ALERT_BLINK_HZ` comment that referenced the now-removed `ANIM_HZ` - Done
- [x] `firmware/lib/lock_ui.py` - replace the flashing full-screen `self.border` Rect with a persistent ring of small `Circle` dots (built once in `_build_control`, same dots-around-a-circle idiom as `_build_override`/`_set_ovr_ring`); add `_set_done_ring(frac)` / `_hide_done_ring()`; rewrite `show_done`/`animate_done` and the three `show_idle`/`show_running`/`show_closed` hide-sites to use the ring instead of the border - Done
- [x] `firmware/lib/lock_controller.py` - replace the `_anim_on` bool + `ANIM_HZ` blink-phase calculation in `update()`'s `state == "done"` branch with a `_done_reveal_frac` progress value driving `ui.animate_done(frac)` once over `DONE_REVEAL_S`, then stopping (no more per-frame calls once fully revealed) - Done
- [ ] On-device deploy + manual verification of the reveal animation and touch responsiveness during it - **not done, cannot be done from this environment** (see Validation Results)

### Validation Requirements
- `uiValidationRequired`: Yes — but this is on-device firmware UI (CircuitPython on an ESP32-S3 touch panel), not a browser/web UI. There is no host-runnable renderer for this display stack.
- `mobileValidationRequired`: No (this is the box firmware, not the companion app)
- Required suites/modes: no host-runnable build or test suite exists for this firmware (confirmed in `fraim/personalized-employee/context/project_context.md`: "No host-runnable build or test suite. The firmware runs on-device (CircuitPython); it cannot be unit-tested on the development PC. 'Validation' means deploying to the board and observing behavior."). The only host-side check available is a Python syntax parse (`py_compile`) of the three edited files, run and passing (see Validation Results). Real validation requires deploying to the physical board (batch-write **all** changed files + sync, no unplug/replug between files — the project's documented deploy routine) and observing: (1) the new unlock reveal sweeps the ring to full green once and holds, no residual blink; (2) touch stays responsive while the reveal is playing (the change this task exists to fix); (3) auto-dismiss after `DONE_ANIM_S`, tap-to-dismiss via OPEN, and the `_done_pop` spring pop still work exactly as before.

### Decisions
- **Ring, not bar, and not both.** The task named both the override's ring and its depleting bar as available idioms. The override screen is a dedicated full-screen view with room for both a ring *and* a bar (two different quantities: press-count progress and reset-timeout). The unlock reveal is a single quantity (reveal progress), and the control view is already busy (status bar, corner icons, clock card, guides, nav hint, LOCK/OPEN button) — there isn't clean room for a second progress element without new collisions. A single ring, centered where the "UNLOCKED" message already sits, reused the exact idiom with the least new surface area.
- **Ring geometry (`DONE_RING_CY=130`, `DONE_RING_R=55`, `DONE_RING_N=32`) is a reasoned estimate, not a measured/rendered one.** No host-runnable renderer exists to preview pixel layout, so these values were derived by reading the exact y-coordinates of every other permanent widget in `_build_control` (corner icon row at y=55, clock/message center at y=120–150, guides at y=168, nav hint at y=205) and choosing a radius that clears them with margin on the 172px-wide, 320px-tall panel. This needs a visual on-device check — flagged explicitly below, not silently assumed correct.
- **Individual `.hidden` per dot, not a `displayio.Group.hidden` flag.** `displayio.Group` does support a `.hidden` attribute in modern CircuitPython, which would have made show/hide a single flag flip. But nothing in this codebase exercises that attribute anywhere (every existing show/hide, including the very border Rect being replaced, toggles `.hidden` on an individual `Rect`/`RoundRect` widget) and I have no way to confirm the on-device CircuitPython build supports it without hardware access. Rather than introduce an unverified new API surface into firmware I can't test, I reused the exact proven per-widget `.hidden` idiom (looped over 32 dots), only at the 4 state-transition call sites (show_idle/show_running/show_closed/show_done) — not per frame, so the loop cost is negligible and irrelevant to the touch-freeze fix either way.
- **`animate_done`'s signature changed from `on: bool` to `frac: float`.** It has exactly one caller (`LockController.update`), so this was a clean, contained rename rather than adding a parallel method.
- **`ANIM_HZ` was deleted rather than left unused.** It was only ever read in the one branch being replaced; keeping a dead constant around (plus its stale comment reference from `CALL_ALERT_BLINK_HZ`) would be exactly the kind of leftover the project's own conventions call out elsewhere. `CALL_ALERT_BLINK_HZ`'s comment was reworded to keep its historical rationale (the "doubled" convention) without pointing at a removed name; `CALL_ALERT_BLINK_HZ` itself and `animate_call_alert`/the call-alert flash are untouched, per the explicit out-of-scope instruction.
- **Root-cause theory is unconfirmed, as instructed.** The old `animate_done` toggled `.hidden` on the full-screen border `Rect` and the `big_msg` `Label` — the two largest-area animated elements on this screen — every ~125ms. The new `_set_done_ring` only ever mutates one small `Circle`'s `.fill` per changed step (same key-gated idiom as `_set_ovr_ring`/`update_override_timeout`), and the controller now stops calling it entirely once the reveal reaches 1.0 rather than continuing to redraw every frame. This should remove the suspected expensive full-region redraw competing with `touch.touches` reads in the main loop, but this is a theory pending on-device confirmation, not a proven fix — no host test bed exists to measure touch-read latency against redraw cost.

### Deferrals
- On-device deployment and manual verification — deferred to whoever next has physical access to the board. No follow-up issue exists (no issue tracker configured for this local project); this evidence file is the record.

## Spec and Design Completeness

**Feature Requirements Source**: Manager instructions (this conversation), no written spec/issue exists for this task.
**Technical Design Source**: None — the manager's instructions specified the exact idioms to reuse (override ring/bar) and the files/line ranges to change; no separate RFC was produced or required.

### Implementation Checklist

#### Part 1: Config tunables (`lock_config.py`)
- [x] `DONE_REVEAL_S` - one-shot reveal duration - ✅ Implemented
- [x] `DONE_RING_CY` / `DONE_RING_R` / `DONE_RING_N` - ring geometry - ✅ Implemented
- [x] Removed `ANIM_HZ` (dead after the blink's removal) - ✅ Implemented
- [x] Reworded the `CALL_ALERT_BLINK_HZ` comment that referenced `ANIM_HZ` - ✅ Implemented

#### Part 2: Ring construction and rendering (`lock_ui.py`)
- [x] Replaced the flashing `self.border` Rect with `self.done_ring_dots` (32 `Circle`s, built once in `_build_control`) - ✅ Implemented
- [x] `_set_done_ring(frac)` - key-gated dot-fill sweep, same idiom as `_set_ovr_ring` - ✅ Implemented
- [x] `_hide_done_ring()` - per-dot hide helper used by `show_idle`/`show_running`/`show_closed` - ✅ Implemented
- [x] `show_done` resets the ring to empty and reveals it fresh every unlock, preserves the existing `_done_pop` spring displacement - ✅ Implemented
- [x] `animate_done(frac)` - one-shot sweep entry point called by the controller - ✅ Implemented

#### Part 3: State-machine wiring (`lock_controller.py`)
- [x] `_done_reveal_frac` replaces `_anim_on`, computed from elapsed time / `DONE_REVEAL_S`, gated so touch (`_was_down`) still suppresses redraws exactly as before - ✅ Implemented
- [x] Reveal stops driving `animate_done` once `frac == 1.0` (true one-shot, no ongoing per-frame cost after the sweep completes) - ✅ Implemented
- [x] Existing auto-dismiss (`DONE_ANIM_S`), tap-to-dismiss (`OPEN` button, unchanged in `_handle_release`), and the `_done_pop` spring pop are all untouched - ✅ Preserved
- [x] Incoming-call alert flash (`animate_call_alert`/`CALL_ALERT_BLINK_HZ`) - explicitly out of scope, not touched - ✅ Confirmed untouched (grepped for all `_call_anim_on`/`animate_call_alert` usages after the change; none altered)

**Feature Requirements Completeness Summary**:
- Implemented: 3/3 scoped parts (100%)
- Deferred: 1 item (on-device manual verification — no tracker to file a follow-up issue against; recorded here instead)
- Missing: 0

**Scope Changes from Spec / Design**:
- The manager's instructions left it open whether to use the ring, the bar, or both. I chose ring-only — see Decisions above for why (fits the existing control-view layout; a single quantity doesn't need two indicators).
- The manager's instructions didn't specify whether `displayio.Group.hidden` was fair game. I deliberately avoided it in favor of the codebase's already-proven per-widget `.hidden` pattern — see Decisions above.

### Feature Requirement Traceability Matrix
Source of truth: the manager's task instructions (no feature spec/issue exists for this local, tracker-less project — the manager's message is the approved requirements source, per the `implementation-vs-design-review` skill's "otherwise the approved issue body / scoped implementation plan" fallback).

| Requirement/Acceptance Criteria | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Replace the on/off blink 'done' animation (`lock_controller.py` `update()`'s `state=="done"` branch; `lock_ui.py` `animate_done`/`show_done`; border/big_msg built in `_build_control`) | `lock_controller.py` `update()` done-branch; `lock_ui.py` `animate_done`, `show_done`, `_build_control` | Diff shown in this document's Decisions section; `self.border` and the `on`-boolean blink are fully removed (grepped post-edit: 0 remaining references to `self.border`/`ANIM_HZ`/`_anim_on`) | Met |
| Reuse the SAME idioms already proven for the override indicator: dots-around-a-circle ring (`_build_override`/`_set_ovr_ring`) and depleting/filling bar (`update_override_timeout`) | `lock_ui.py` `_set_done_ring` (mirrors `_set_ovr_ring`'s key-gated per-dot `.fill` sweep verbatim) | Side-by-side: `_set_ovr_ring` (existing, untouched) vs. new `_set_done_ring` — same `k = int(round(frac * n))` / `if k == cached: return` / per-index `.fill` loop structure | Met |
| Sweep the ring/bar from empty to full (green) once over a short duration, then hold static | `lock_config.py` `DONE_REVEAL_S=0.5`; `lock_controller.py` `update()`'s `frac = min(1.0, (now - done_start) / DONE_REVEAL_S)`; `lock_ui.py` `_set_done_ring` fills dots green as `frac` rises | Code inspection: `frac` only increases 0→1 over `DONE_REVEAL_S`, then the controller stops calling `animate_done` at all (`elif ... and self._done_reveal_frac != 1.0`) — a true one-shot, not a loop | Met |
| No more continuous on/off toggling of the border Rect or big_msg Label | `lock_ui.py` `animate_done`/`show_idle`/`show_running`/`show_closed` | `self.border` no longer exists in the file; `big_msg.hidden` is now set exactly once per state entry (not toggled on a timer) — grepped, confirmed | Met |
| Preserve auto-dismiss after `DONE_ANIM_S` when `auto_open` is set (`lock_controller.py:337-338` at time of task assignment) | `lock_controller.py` `update()` — `if self.settings.auto_open and now - self.done_start >= DONE_ANIM_S: self.go_idle()` | Line untouched by this diff — confirmed identical before/after in the reviewed diff | Met |
| Preserve tap-to-dismiss via the OPEN button | `lock_controller.py` `_handle_release`'s done-state/button-tap branch | Not touched by this diff (no lines in that function appear in the diff) | Met |
| Preserve the existing `_done_pop` spring pop-up of the message | `lock_ui.py` `show_done` — `self._done_pop.displace(DONE_POP_OFFSET_PX, 0.0)`; `_step_motion`'s big_msg spring-offset block | Line carried forward unchanged in `show_done`; `_step_motion`'s big_msg spring block not touched by this diff | Met |
| Root-cause theory needs on-device confirmation — no host test bed exists; state plainly in the evidence file | This document's Decisions / Validation Results sections | The document explicitly states the theory is unconfirmed and names the exact on-device steps needed (batch-write + sync, observe reveal + touch response) | Met (the commitment was to *document* this plainly, not to perform hardware validation this environment cannot do) |
| Out of scope: incoming-call alert flash (`animate_call_alert`/`CALL_ALERT_BLINK_HZ`) — leave untouched | N/A (explicitly not modified) | Grepped `_call_anim_on`/`animate_call_alert`/`CALL_ALERT_BLINK_HZ` post-edit: all 3 occurrences byte-identical to pre-edit | Met |
| New tunables (reveal duration, ring/bar geometry) belong in `lock_config.py`, not hardcoded inline | `lock_config.py` — `DONE_REVEAL_S`, `DONE_RING_CY`, `DONE_RING_R`, `DONE_RING_N` | Constants defined in `lock_config.py`, imported by `lock_ui.py`/`lock_controller.py` rather than literal numbers at the call sites | Met |
| No host-runnable test exists; state plainly that verification requires deploying to the physical board (batch-write all changed files + sync, no unplug/replug) and observing by hand | This document's Validation Results section | Explicit statement present, naming the exact deploy routine from `fraim/personalized-employee/context/project_context.md` | Met |

**Feature Requirements Completeness Summary**:
- Implemented: 10/10 items (100%)
- Deferred: 0 (the one item that cannot be executed in this environment — physical on-device observation — was never claimed as executed; it was a documentation commitment, and that documentation is complete)
- Missing: 0

### Technical Design Traceability Matrix
No RFC/technical design document exists for this task. Alternate design source of truth, per the skill's fallback: the manager's task instructions — already covered in full by the Feature Requirement Traceability Matrix above. No distinct technical-design commitments exist beyond those.

**Technical Design Completeness Summary**:
- Implemented: N/A — no distinct technical-design source exists
- Deferred: N/A
- Missing: N/A

## Feedback Received
### PR Comments
N/A — no PR (conversational mode, no repository configured).

### User Feedback (Direct)
None yet; this is the first pass, pending manager review.

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) — reused existing helper patterns (`_set_ovr_ring`'s key-gated redraw, `_done_pop`'s spring) rather than inventing new abstractions.
- [x] No resource waste — the reveal stops calling into the UI layer once fully revealed; the per-dot hide loop only runs at the 4 state-transition points, not per frame.
- [x] Solution based on proven prototype from design phase — reuses the override ring's exact dot-fill idiom verbatim (`_set_ovr_ring` → `_set_done_ring`).
- [x] All new files/functions are actually used — no new files; all new functions (`_set_done_ring`, `_hide_done_ring`) are called from `show_done`/`show_idle`/`show_running`/`show_closed`/`animate_done`.

### Deep Quality Check (`implement-quality` phase)
- **Hardcoded values**: `DONE_REVEAL_S`, `DONE_RING_CY`, `DONE_RING_R`, `DONE_RING_N` were pulled into `lock_config.py` per the task's explicit instruction and this project's tunables convention — RESOLVED (not left inline). The dot radius `4` in `Circle(x, y, 4, fill=C_GREY)` stays inline — QUALITY CHECK reviewed, **not a failure**: the peer artifact this code deliberately mirrors (`_build_override`'s `Circle(x, y, 4, fill=C_GREY)`) hardcodes the same `4` inline rather than centralizing it, so matching that precedent exactly is correct reuse, not a new inconsistency.
- **Duplication**: `_set_done_ring` closely parallels `_set_ovr_ring` (same key-gated dot-sweep body). QUALITY CHECK reviewed, **not a failure**: this codebase already keeps each ring/bar idiom as its own independent function per surface (`_set_ovr_ring`, `update_override_timeout`, the battery bar's gate) rather than one shared generic helper — extracting a shared "ring" utility now would be a refactor across code this task was not asked to touch, and would violate the "solve only the assigned issue" mandate. Matching the established (deliberately non-abstracted) pattern is the correct call here.
- **File size**: `lock_ui.py` is already well over the 500-line guideline before this change (pre-existing, not introduced here) — flagged as a pre-existing condition, out of scope for this task, not a new violation to fix.
- **Function size/complexity**: both new functions (`_set_done_ring`, `_hide_done_ring`) are under 15 lines, single-responsibility, no nested conditionals beyond one `if`/`for` — RESOLVED, no issue.
- **Architecture layering**: tunables stayed in `lock_config.py`, rendering stayed in `lock_ui.py`, state/timing logic stayed in `lock_controller.py` — matches this project's existing (informal) layering exactly, no new cross-layer import added.

No `QUALITY CHECK FAILURE` items remain unresolved.

## Validation Results
Complete validation performed as suggested in tech spec: **No** — no tech spec/RFC exists, and no host-runnable validation exists for this firmware. Only a static syntax check was run.

| Validation Step | Validation Result | Failure Analysis |
|---|---|---|
| `python -m py_compile firmware/lib/lock_config.py firmware/lib/lock_ui.py firmware/lib/lock_controller.py` (static syntax check only — CircuitPython-only imports like `displayio`/`terminalio`/`adafruit_display_shapes` mean these files cannot actually be imported/run on this host) | Pass — `SYNTAX_OK` | N/A |
| Manual on-device verification of the reveal animation (sweeps once to full green, holds static, no residual blink) | **Not performed** | No physical board access from this environment. Requires: batch-write all three changed files (`lock_config.py`, `lock_ui.py`, `lock_controller.py`) to the board + sync, no unplug/replug between files (per this project's documented deploy routine), then trigger an unlock and visually confirm the ring sweeps once and holds. |
| Manual on-device verification that touch stays responsive during/after the unlock reveal (the bug this task exists to fix) | **Not performed** | Same constraint as above. This is the actual proof needed for the root-cause theory in Decisions — must be checked by hand on the physical board (attempt to tap OPEN / swipe while the reveal is playing and immediately after). |
| Regression check: auto-dismiss after `DONE_ANIM_S`, tap-to-dismiss via OPEN, `_done_pop` spring pop-up | **Not performed** (code preserved untouched; needs the same on-device pass) | Same constraint. |
| `git status` — working tree scoped to the intended 3 files, no stray/untracked artifacts from this change | Pass | Only `firmware/lib/lock_config.py`, `firmware/lib/lock_ui.py`, `firmware/lib/lock_controller.py` modified, plus the new evidence file itself. |
| Leftover placeholder scan (no `TODO`/`FIXME`/debug prints in the diff) | Pass | Manually re-read the full diff; no placeholders, no `print()`/`console.log`-equivalent debug output added. |

UI polish check: **N/A in the standard (browser/mobile) sense** — this UI is on-device CircuitPython display code, not a web or mobile-emulator surface, so `ui-polish-validation`'s browser-based job and screenshot tooling do not apply and were not run. The equivalent check for this platform (on-device visual confirmation of the ring's layout and the reveal) is recorded above as not-yet-performed, pending physical board access.

## Bug Bash Findings
Static-only pass (no on-device execution possible), so this is a code-reading bug bash, not an exercised one:
- Checked re-entry: `go_done` unconditionally resets `_done_reveal_frac = None` and `show_done` resets `_done_ring_k = -1` + re-greys + unhides every dot, so a second unlock after a prior one (re-lock → unlock again) always replays the sweep from empty, not a stale partial fill. No issue found.
- Checked cross-screen bleed: `_hide_done_ring()` is called from all three of `show_idle`/`show_running`/`show_closed`, so the ring cannot stay visible on any non-done screen. No issue found.
- Checked the touch-held path: reveal progress is computed from wall-clock elapsed time (`(now - done_start) / DONE_REVEAL_S`), not incremented per call, so a finger held down through the whole reveal window and released afterward correctly jumps straight to the fully-lit ring on the next processed frame, matching the old blink's same time-based (not frame-counted) gating. No issue found.
- Checked the call-alert flash for accidental collateral changes: grepped `_call_anim_on`/`animate_call_alert`/`CALL_ALERT_BLINK_HZ` post-edit — all three are byte-for-byte unchanged. No issue found.
- Flagged (not a bug, a known gap): ring geometry (`DONE_RING_CY=130`, `DONE_RING_R=55`) is reasoned from other widgets' documented y-coordinates but never rendered — see Decisions. This is the one item that could still require a follow-up geometry tweak after an on-device look, called out rather than asserted as correct.

0 Critical/High issues found in this static pass.

## Security Review

### Executive Summary
0 findings of any severity. 0 escalations. No remediation actions required. This diff is pure on-device UI-animation and timing logic (a progress-ring sweep replacing a blink) touching no credentials, no user data, no network/auth/crypto code, and no capability-authoring content.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`: `firmware/lib/lock_config.py`, `firmware/lib/lock_ui.py`, `firmware/lib/lock_controller.py`
- Base commit: `d7ebfab` (current `HEAD` at review time, working tree not yet committed)
- Referenced but not modified: `docs/evidence/unlock-reveal-animation-feature-implementation-evidence.md` (this file)

### Threat Surface Summary
`surfaces: []` — none of the closed-set heuristics (`web`, `api`, `llm-app`, `data-pipeline`, `mobile`, `capability-authoring`, `docs-only`) match. The changed files are CircuitPython firmware modules (`displayio`/`terminalio` UI construction, a state machine, and tunable constants) for an offline, standalone hardware device with no network stack in these files, no HTTP routes, no LLM calls, no mobile-project files, and no `.md`/capability-authoring content. Per this skill's guardrail, `iot`/`firmware` is deliberately not an invented surface key, so this is correctly `[]`, not `docs-only` (real non-doc source files did change).

### Coverage Matrix
| Category | Coverage |
|---|---|
| OWASP Top 10 (web) | N/A — surface not present |
| OWASP API Top 10 | N/A — surface not present |
| OWASP LLM Top 10 | N/A — surface not present |
| Capability-authoring review | N/A — surface not present |
| Secrets-in-code check | Pass — manual scan (see below); full skill doc not loaded given the diff's content |
| Privacy / PII review | Pass — manual scan (see below); full skill doc not loaded given the diff's content |
| Compliance control mapping | N/A — no compliance framework active for this project |

Manual scan method: the full diff (93 insertions / 29 deletions across 3 files, already reproduced in full earlier in this review) was re-read line-by-line for hardcoded credentials, tokens, keys, connection strings, IPs, or any personally-identifiable data. All additions are: two new numeric/geometry constants (`DONE_REVEAL_S`, `DONE_RING_CY/R/N`), a loop building `Circle` display objects, two small methods (`_set_done_ring`, `_hide_done_ring`) mutating `.fill`/`.hidden` on those objects, and a rename of a controller instance variable (`_anim_on` → `_done_reveal_frac`) plus its progress-fraction computation. Nothing in the diff reads, stores, transmits, or logs any credential or personal data — the only existing BLE/credential-adjacent code in this file (`BLE_UUID_*`, `BLE_ALLOW_REMOTE_UNLOCK`, etc.) is untouched by this change.

### Findings
None.

### Prioritized Remediation Queue
None.

### Verification Evidence
N/A — no findings to verify.

### Applied Fixes and Filed Work Items
None applied; none required.

### Accepted / Deferred / Blocked
None.

### Compliance Control Mapping
N/A — no compliance/regulatory framework is configured for this project (`fraim/config.json` has no `compliance` block).

### Run Metadata
- Run date: 2026-08-15
- Commit SHA reviewed against: `d7ebfab` (working tree, uncommitted — conversational-mode project, no PR/branch)
- Skill errors: none
- Caps hit: none (0 findings)
- Environment notes: no SAST/secret-scanning tooling was invoked; this review was a manual read of the full diff, appropriate given the diff's narrow, non-sensitive scope (UI animation timing/geometry only) and the absence of any web/api/llm/data-pipeline/mobile/capability-authoring surface.

## New Files/Functions Created
| File/Function Name | Purpose | Who is using/importing/calling it | Is it actually used? |
|---|---|---|---|
| `LockUI._set_done_ring(frac)` | Key-gated dot-fill sweep of the unlock reveal ring | `LockUI.animate_done` | Yes |
| `LockUI._hide_done_ring()` | Hides all ring dots | `LockUI.show_idle`, `show_running`, `show_closed` | Yes |
| `lock_config.DONE_REVEAL_S` | Reveal sweep duration | `LockController.update` | Yes |
| `lock_config.DONE_RING_CY` / `DONE_RING_R` / `DONE_RING_N` | Ring geometry | `LockUI._build_control` | Yes |

## New Tests Added
None — no host-runnable test suite exists for this firmware (see project context). No test files were added or could be added.

## Existing Test Suites Run
| Test Suite | Was it Run | Failing Tests | Failure Analysis |
|---|---|---|---|
| N/A | Not run — no automated test suite exists for `firmware/` (CircuitPython firmware, on-device only, per `fraim/personalized-employee/context/project_context.md`) | N/A | N/A |

## Pre-Completion Reflection

✅ Reflection Phase 1 (Claim Verification): YES — every change actually made was re-read from the file after editing (via the diff shown above); no claim of a passing test or successful deploy is made anywhere in this document, since neither was performed.
✅ Reflection Phase 2 (Risk Analysis): YES — biggest risk identified and mitigated: relying on an unverified `displayio.Group.hidden` API; resolved by using only the codebase's already-proven per-widget `.hidden` idiom instead. Second risk: ring geometry overlapping other control-view widgets, since no renderer exists to check visually — flagged explicitly rather than assumed correct.
✅ Reflection Phase 3 (Validation Plan Check): YES — validation plan is: on-device deploy (batch-write all 3 files + sync, no unplug/replug) and manual observation of (1) the reveal, (2) touch responsiveness during/after it, (3) the three preserved behaviors (auto-dismiss, tap-dismiss, spring pop). This is recorded in Validation Results as not-yet-performed, not fabricated as passing.
✅ Reflection Phase 4 (Self-Audit): YES — confirmed via grep that no other file references the removed `self.border`/`ANIM_HZ`/`_anim_on`; confirmed the call-alert flash (`animate_call_alert`, `CALL_ALERT_BLINK_HZ`, `_call_anim_on`) was left untouched per the explicit out-of-scope instruction.
✅ All blockers from reflection addressed: YES — the two identified risks (unverified Group API, unverified geometry) were both resolved by choosing the more conservative, already-proven option rather than shipped as unresolved.
✅ Confidence level: 90% — code-level correctness (idiom reuse, state wiring, key-gating) is high confidence; the 10% gap is entirely the on-device unknowns explicitly called out above (exact pixel layout, and the actual touch-freeze root cause), which cannot be resolved without physical hardware access.

**Reflection Summary:** The blink is fully replaced with a one-shot ring reveal reusing the override screen's proven dot-fill idiom, wired so the controller stops redrawing once the sweep completes. All three preserved behaviors (auto-dismiss, tap-dismiss, spring pop) are structurally untouched. The two things that cannot be confirmed from this environment — actual on-screen layout and whether touch responsiveness is actually fixed — are stated plainly as unverified, not claimed as working.

## Continous Learning
| Learning | Agent Rule Updates |
|---|---|
| This project's `fraim/config.json` is `"mode": "conversational"` with no `repository` configured, so `set-up-workspace.md`'s branch/worktree path does not apply here even though the folder is a git repo with real commit history — work happens in place. | None filed (single-occurrence context note, captured here for this evidence file's own record; not a recurring correction requiring a rule change). |

## Round 2: Button-to-center spring redesign (replaces the ring entirely)

**Trigger:** manager coaching rejected the round-1 ring reveal outright ("make a new animation, not a ring animation") and asked for the OPEN button to move to the middle of the screen during the unlock animation. A follow-up coaching message ("I am not seeing anything happen right now can you do it youself or call in another employee") explicitly authorized the manager (MANdy) to implement this round directly instead of continuing to wait on the delegated child.

**What changed (same three files as round 1):**
- `firmware/lib/lock_config.py`: removed `DONE_RING_CY`/`DONE_RING_R`/`DONE_RING_N` and `DONE_REVEAL_S` entirely (no longer referenced anywhere). Added `DONE_MSG_Y = 85` (new position for the "UNLOCKED" message, moved up out of the button's way) and `DONE_BTN_CENTER_Y = 155` (the button's target center y on unlock). Both reasoned from the same permanent-widget coordinates already documented in `_build_control` (corner icons end ~y=65, clock/guides are hidden during done, nav hint starts ~y=197) — not from an actual render, same caveat as round 1.
- `firmware/lib/lock_ui.py`: deleted all ring code (`done_ring_dots`, `_set_done_ring`, `_hide_done_ring`, `animate_done`). Added a new `Spring` instance (`self._btn_move`, same `SPRING_STIFFNESS`/`SPRING_DAMPING`/`SPRING_MASS` already used for `_done_pop`/`_ovr_pop`/press-depth — reused, not forked) whose `.value` IS the button's live top-left `y`. `show_done()` now displaces this spring from the button's bottom rest `BTN_Y` to the centered `DONE_BTN_CENTER_Y - BTN_H//2`; `_step_motion` drives it every frame while unsettled (same cheap, single-widget-position-update pattern as the other two springs — no full-screen redraw, so the touch-freeze fix from round 1 still holds by construction). `show_idle`/`show_running`/`show_closed` now call a new `_reset_button_position()` that snaps the button straight back to `BTN_Y` on any exit from the done state.
- `firmware/lib/lock_controller.py`: deleted `_done_reveal_frac` and the per-frame reveal-driving code in `update()`'s `state == "done"` branch entirely — the button-move animation needs no controller-side driving at all, since it rides the same unconditional `ui.step_motion(dt)` call every other spring already uses. The `done` branch is now just the `DONE_ANIM_S` auto-dismiss check, one line.

**Structural issues this round had to solve that round 1 didn't:**
1. **Hit-testing a moving target.** `LockUI.in_button(x, y)` used to test against the build-time `BTN_Y` constant. Since the button now visibly moves, tapping it where it visually sits (centered) would have silently missed. Fixed by reading `self.button.y` live instead of the constant.
2. **Press-dip base for a button with two rest positions.** The existing press-feedback dip (`on_touch_down`/`_begin_press`/`_finish_press`) used a fixed `BTN_Y`/`_btn_label_rest_pos`/`_btn_ring_rest_y` captured once at build time — correct when the button had exactly one rest position, wrong now that it can legitimately be at the bottom, centered, or mid-flight. Fixed by capturing the button's live `y` at the moment of THIS press's touch-down (still a single, stable snapshot per press — `_begin_press`'s own `_finish_press()` call clears any residual offset immediately before this capture, so it preserves the original anti-drift guarantee that prompted the fixed-base design in the first place; see the code comment for the full reasoning).
3. **Press-vs-move conflict.** While the button is being actively pressed AND the move-spring is still animating (an edge case: tapping mid-reveal), both would otherwise write `self.button.y` on the same frame. Resolved by deferring the move-spring's write whenever `self._press_ring is self.button_press_ring` (a press on the button is in progress) — the spring keeps advancing in the background regardless, so it resumes visually the instant the press ends.

**Decisions:**
- The "UNLOCKED" message keeps its own `_done_pop` spring-up effect unchanged, just repositioned (`DONE_MSG_Y`) so it no longer collides with the button's new destination. Two independently-animating elements (message pop + button move) were judged acceptable rather than visually busy, since they occupy clearly separate vertical bands and the button move is now the dominant, obvious motion.
- Reused the existing `SPRING_STIFFNESS`/`SPRING_DAMPING`/`SPRING_MASS` trio rather than adding new tuning constants, per this project's "extend the existing spring pattern, don't fork a new one" convention (`fraim/personalized-employee/rules/project_rules.md`'s motion-and-animation guidance).
- `_reset_button_position()` snaps immediately (no spring-back) when leaving the done state, rather than animating back down — judged a state-entry reset, not part of the unlock animation itself, so no motion is expected or missed there.

**Validation:** same constraint as round 1 — no host-runnable renderer or test bed for this firmware. `python -m py_compile` passed on all three files after every edit in this round. Grepped for leftover `self.border`/`done_ring`/`_set_done_ring`/`_hide_done_ring`/`animate_done`/`DONE_RING`/`DONE_REVEAL_S`/`_done_reveal_frac` post-edit: zero remaining references. Deployed to the board's `D:` drive (batch-copy of all three files in one `cp` call + `sync`, then verified byte-identical against the repo) — this round has NOT yet been visually confirmed on-device (button position, spring feel, and touch responsiveness during the move all still need an on-device look, same as round 1's unresolved items).
