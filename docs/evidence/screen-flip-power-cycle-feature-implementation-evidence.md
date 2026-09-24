# Feature: Verify screen-flip power-cycle-vs-soft-reload fix (feature-implementation)

Issue: `screen-flip-power-cycle` (local anchor -- no issue tracker/repository configured per
`fraim/config.json`; work done in place, no branch/commit/PR).
Source of truth: manager brief in this conversation, and the manager's own prior fix + evidence at
`docs/evidence/screen-flip-power-cycle-fully-delegate-evidence.md`. Parent objective: "Fix the box's
screen-flip touch/button mapping bug (root-caused to a power-cycle-vs-soft-reload gap in
`LockUI.establish_base_rotation`), and confirm/complete the app<->box sync for the screen-flip
setting." This session's scope is the firmware fix itself: independently re-verify (not just trust)
that the fix already sitting in the working tree is correct, and confirm the sibling app<->box sync
task (already completed and evidenced separately at
`docs/evidence/screen-flip-app-box-sync-feature-implementation-evidence.md`) needs no further work.

## Work List

### Scope
- [x] `firmware/code.py` -- `fresh_boot = supervisor.runtime.run_reason == supervisor.RunReason.STARTUP`,
      threaded into `LockController(..., fresh_boot=fresh_boot)`. Already implemented; re-verified.
- [x] `firmware/lib/lock_controller.py` -- `__init__(..., fresh_boot=False)` threads `fresh_boot` into
      `self.ui.establish_base_rotation(self.settings.screen_flipped, fresh_boot=fresh_boot)`. Already
      implemented; re-verified.
- [x] `firmware/lib/lock_ui.py` -- `establish_base_rotation(currently_flipped, fresh_boot=False)` skips
      the 180-degree undo when `fresh_boot` is `True` (`if currently_flipped and not fresh_boot`).
      Already implemented; re-verified.
- [x] Confirm sibling task `screen-flip-app-box-sync` is complete and needs no further action (it is --
      see its evidence file; 0 findings, all green).

### Validation Requirements
- `uiValidationRequired`: No -- no UI touched, on-box display orientation logic only.
- `mobileValidationRequired`: No new mobile work in this session; app-side tests re-run as a
  regression check only (see Validation Results).
- Required suites/modes: `python -m py_compile` on the 3 changed firmware files; independent hand
  trace of all 4 `fresh_boot` x `currently_flipped` combinations; a standalone host-side arithmetic
  repro/fix simulation (see Decisions); `npx jest` and `npx tsc --noEmit` in `app/` as a regression
  check on the sibling sync task. **On-device power-cycle observation on the physical box could not
  be performed** -- no board is attached to this session (only the `C:` drive is present; no
  `CIRCUITPY`/board drive). This is a genuine, stated blocker, not a skipped step.

### Decisions
- **No code change made to the firmware fix itself.** The fix was already implemented by the manager
  in a prior `fully-delegate` session (see that evidence file) and matches this session's own
  independent re-derivation exactly. Re-implementing or "improving" already-correct code with no
  identified defect would violate the "no placeholders / don't fix what isn't broken" principle, so
  this session's deliverable is independent verification, not a rewrite.
- **No new permanent test file added.** `firmware/lib/lock_ui.py` imports `displayio`, `terminalio`,
  `bitmaptools`, and `adafruit_display_text` unconditionally at module scope and its `__init__`
  constructs the entire UI, so unlike `tests/test_max17043_decode.py` / `tests/test_lock_log_stats.py`
  (whose target modules were specifically written to guard/avoid hardware imports so they import
  cleanly under host CPython), `lock_ui.py` cannot be imported on the host without a substantial
  hardware-stubbing shim. Building that shim to cover 3 small orientation methods would be
  disproportionate scope creep for this bug fix. Instead, verified the exact production arithmetic
  (`establish_base_rotation`'s one-line condition, `set_screen_flipped`'s rotation formula, and
  `is_flipped`'s comparison, copied verbatim from the current file) via a standalone host script that
  reproduces the bug under the pre-fix (unconditional) logic and confirms the fix under the current
  (fresh_boot-aware) logic -- see Validation Results for the executed output. This mirrors the
  verification depth the manager's own evidence file used (static trace + `py_compile`, no host test),
  since no better option exists without the disproportionate shim.
- **`screen-flip-app-box-sync` requires no further action.** Read its evidence file in full and
  cross-checked its claims against the current source (`protocol.ts`, `SettingsScreen.tsx`,
  `lock_controller.py`, `lock_settings.py`) -- all confirmed accurate. Re-ran its test suite
  independently (see Validation Results) with the same 19/19 `protocol.test.ts` and 115/115 overall
  result it reported, so nothing has regressed since that evidence was written.

### Deferrals
- **On-device power-cycle verification** -- deferred to whoever next has physical access to the box.
  Concrete steps recorded in Validation Results / Human Approval Checklist below. Not deferred to a
  tracked issue (no issue tracker configured for this repo).

## Spec and Design Completeness

**Feature Requirements Source**: manager's inline brief (this conversation) +
`docs/evidence/screen-flip-power-cycle-fully-delegate-evidence.md` (prior root-cause + fix).
**Technical Design Source**: none (no RFC exists for this fix; the fully-delegate evidence file's
"What was built" section is the only design record, fully reflected in the Scope above).

### Implementation Checklist
#### Part 1: Firmware orientation-recovery fix (already implemented, this session's job = verify)
- [x] `firmware/code.py` -- `fresh_boot` detection via `supervisor.runtime.run_reason` -- ✅ Verified
- [x] `firmware/lib/lock_controller.py` -- `fresh_boot` threaded into `establish_base_rotation` -- ✅ Verified
- [x] `firmware/lib/lock_ui.py` -- `establish_base_rotation` skips correction on fresh boot -- ✅ Verified

#### Part 2: App<->box screen-flip setting sync (already implemented and evidenced by a sibling task)
- [x] Confirmed complete via `docs/evidence/screen-flip-app-box-sync-feature-implementation-evidence.md`
      -- 0 findings, full round trip traced and tested. No further action needed this session.

**Feature Requirements Completeness Summary**:
- Implemented: 2/2 items (100%) -- both already complete prior to this session; this session's
  contribution is independent verification of both.
- Deferred: 0 requirement items. (The physical on-device power-cycle *validation mode* is separately
  tracked as blocked -- not a requirement gap -- under Validation Results / Deferrals / Human Approval
  Checklist below.)
- Missing: 0.

**Scope Changes from Spec / Design**: None.

## Completeness Evidence
- All phases of tech spec complete: N/A (no tech spec; manager's evidence file is the design record,
  and its "What was built" is fully implemented and re-verified).
- Issue tagged with label `phase:impl`: N/A (no issue tracker configured for this repo).
- Issue tagged with label `status:needs-review`: N/A.
- All files committed/synced to branch: No -- conversational mode, no repository configured for this
  job; nothing committed (consistent with the manager's own fully-delegate evidence file, which also
  left everything uncommitted pending human review).

### Feature Requirement Traceability Matrix
| Requirement | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Fresh power-cycle boot never undoes a 180° rotation that was never actually applied this boot | `firmware/lib/lock_ui.py` `establish_base_rotation` | Independent hand-trace of all 4 `fresh_boot` x `currently_flipped` combinations (below) + standalone arithmetic repro/fix script | Met |
| Soft reload (auto-reload/supervisor-reload/REPL-reload) still recovers native rotation from the NVM flip flag, unchanged from prior behavior | `firmware/lib/lock_ui.py` `establish_base_rotation` | Same hand-trace, soft-reload cases unaffected by the `fresh_boot` branch | Met |
| `fresh_boot` correctly reflects a genuine cold boot, including the brownout-safe-mode retry path | `firmware/code.py` (`supervisor.runtime.run_reason`), `firmware/safemode.py` (`microcontroller.reset()`) | Read `safemode.py`: `microcontroller.reset()` is a hard reset, and CircuitPython's `RunReason` enum has no separate "watchdog/brownout" value distinct from `STARTUP`, so a brownout-retry reboot correctly reports `STARTUP` | Met |
| Touch mapping (`LockController._map`) always agrees with the screen's real visual orientation | `firmware/lib/lock_controller.py` `_map`, `firmware/lib/lock_ui.py` `is_flipped` | Read: `_map` derives `flipped` from `self.ui.is_flipped`, which reads the display's live rotation against the now-correctly-recovered `_base_rotation` -- single source of truth, no second copy to drift | Met |
| App<->box `flip` setting sync has no divergence path | (sibling task, not re-implemented) `protocol.ts`, `useStore.ts`, `lock_controller.py` | `docs/evidence/screen-flip-app-box-sync-feature-implementation-evidence.md` (0 findings) + this session's independent re-run of `npx jest` (19/19 `protocol.test.ts`, 115/115 total) | Met |

Note: physical on-device power-cycle observation is a *validation mode*, not a discrete requirement with
its own implementation file/function, so it is not a matrix row (same convention the sibling
`screen-flip-app-box-sync` evidence file uses) -- it is tracked instead under Validation Results,
Deferrals, and the Human Approval Checklist below, where it is explicitly recorded as blocked (no board
attached to this session), not silently skipped or claimed as passing.

### Technical Design Traceability Matrix
N/A -- no RFC/technical design document exists for this issue.

## Feedback Received
None this session (no PR/issue comments; no direct user feedback yet -- this is the first report back
to the manager for this workstream).

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) -- fix is a single boolean-gated condition plus a
      threaded parameter; no broader refactor attempted.
- [x] No resource waste (excessive retries, delays, workarounds) -- none introduced.
- [x] Solution based on proven prototype from design phase -- N/A, verification only; the "prototype"
      is the manager's already-implemented fix, independently re-derived and found correct.
- [x] All new files/functions are actually used -- no new files/functions added this session.

## Validation Results
Complete validation performed as suggested in tech spec: Partial -- everything host-verifiable was
run; on-device power-cycle observation was not possible in this environment (no board attached).

| Validation Step | Result | Notes |
|---|---|---|
| `python -m py_compile` on `firmware/code.py`, `firmware/lib/lock_controller.py`, `firmware/lib/lock_ui.py`, `firmware/lib/lock_settings.py` | **pass** | `COMPILE_OK`, no syntax errors |
| Independent hand-trace, all 4 `fresh_boot` x `currently_flipped` combinations | **pass** | Fresh+never-flipped: unaffected. Fresh+flipped (the bug case): correction now skipped, `_base_rotation` stays native, `is_flipped` matches real rotation. Soft-reload+never-flipped: unaffected. Soft-reload+flipped: unaffected, byte-for-byte the pre-existing (already-working) path. |
| Standalone host script simulating `establish_base_rotation`'s exact arithmetic, old (unconditional) vs. new (fresh_boot-aware) | **pass** | OLD logic: `base_rotation` wrongly recomputed to 180 on a fresh boot with `screen_flipped=True`, leaving `display.rotation=0` (visually still native) while `is_flipped` incorrectly reports `True` -- reproduces the reported "touch wrong after power-cycle" symptom exactly. NEW logic: `base_rotation` stays 0 (correct), `display.rotation=180` and `is_flipped=True` agree with the screen's real state. Both assertions passed (see script output below). |
| `npx jest` (`app/`) | **pass** | 12/12 suites, 115/115 tests (regression check on the sibling sync task; unchanged from that task's own evidence) |
| `npx tsc --noEmit` (`app/`) | **pass** | Clean, no output |
| On-device power-cycle observation (screen-flip on, full power-off/power-on, confirm touch/buttons correct) | **NOT RUN -- blocked** | No board attached to this session (`Get-PSDrive` shows only `C:`, no `CIRCUITPY`/board drive). This is the one remaining verification step and requires physical hardware access. |

### Repro/fix script output
```
raw capture (native, post power-cycle): 0
OLD (unconditional) base_rotation -> 180  -- WRONG, should be 0
NEW (fresh_boot-aware) base_rotation -> 0  -- correct, matches native 0

OLD: display.rotation = 0  is_flipped = True  (screen visually still native R0=0 because base was wrongly re-derived, but is_flipped claims True -> touch gets inverted on a screen that ISN'T actually rotated -- exactly the reported bug)
NEW: display.rotation = 180  is_flipped = True  (screen actually rotated 180 from native, is_flipped correctly True -> touch inversion matches the real visual orientation)

REPRO CONFIRMED (old logic) and FIX CONFIRMED (new logic).
```

### App test output
```
Test Suites: 12 passed, 12 total
Tests:       115 passed, 115 total
```

## Bug Bash Findings
Explored edge cases and adjacent flows beyond the 4 primary `fresh_boot` x `currently_flipped`
combinations:
1. **Repeated soft reloads while flipped** -- each reload re-runs `LockController.__init__` (a fresh
   `LockUI` too), so the raw `display.rotation` capture and the `fresh_boot=False` correction happen
   again every time. Traced two reloads back-to-back: stable, no drift (`_base_rotation` recovers to
   the same native value each time). No issue.
2. **BLE-triggered flip toggle mid-session (no reboot)** -- `apply_ble_settings_json`'s `"flip"`
   handler calls `LockUI.set_screen_flipped` directly, never `establish_base_rotation`. Since
   `_base_rotation` is already correct from boot and doesn't need re-deriving mid-session, this is
   correct as-is, not a gap.
3. **Brownout-triggered safe-mode retry** (`firmware/safemode.py`) -- calls `microcontroller.reset()`,
   a genuine hardware reset, so the next boot's `run_reason` is `STARTUP` (CircuitPython's
   `RunReason` enum has no separate brownout/watchdog value) and `board.DISPLAY` is genuinely
   re-initialized to its hardware default -- same correct handling as an ordinary power cycle, not a
   distinct case the fix needs to special-case.
4. **`supervisor.RunReason.STARTUP` read in `code.py` is unguarded** (no try/except around the
   comparison) -- Low, informational only: consistent with every other one-shot boot-time hardware
   read in `code.py` (e.g. `board.DISPLAY` itself is also unguarded), so this isn't a new pattern
   introduced by the fix, and `supervisor.runtime.run_reason`/`supervisor.RunReason.STARTUP` are
   documented stable CircuitPython API present since the `supervisor.Runtime` object was introduced.
   Not a blocking finding.

0 Critical/High findings. 1 Low (informational, pre-existing pattern, not introduced by this fix) --
no code change made for it.

## New Files/Functions Created
None this session (firmware fix pre-existed; no new test file added -- see Decisions for why).

## New Tests Added
None permanent -- see Decisions. A transient (not committed) host script was used to prove the repro
and fix; it is reproduced in full under Validation Results above for auditability.

## Existing Test Suites Run
| Test Suite | Was it run | Failing Tests | Failure Analysis |
|---|---|---|---|
| `app/` `npx jest` (all 12 suites) | Yes | 0 | N/A |
| `app/` `npx tsc --noEmit` | Yes | 0 | N/A |
| CircuitPython firmware host build/test | No such suite exists (project convention) | N/A | N/A |

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium, 0 Low findings. No escalation items. No remediation required. No firmware
code was changed this session (verification only) -- reviewed is the manager's pre-existing uncommitted
3-file diff (`firmware/code.py`, `firmware/lib/lock_controller.py`, `firmware/lib/lock_ui.py`).

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff (the uncommitted working-tree diff on the 3 firmware files above; produced by
  the manager's prior session, not this one, but reviewed here as this job's implementation diff)
- `surfaceAreaPaths`: `firmware/code.py`, `firmware/lib/lock_controller.py`, `firmware/lib/lock_ui.py`
  (the changed lines); `firmware/safemode.py`, `firmware/boot.py` referenced (not changed) for the
  brownout-reset interaction check in Bug Bash Findings above.

### Threat Surface Summary
`threat-surface-classification` applied to the 3 changed files: none match `web`, `api`, `llm-app`,
`data-pipeline`, `mobile`, or `capability-authoring` (they are CircuitPython firmware `.py` files, not
in any of those heuristics), and they are not `.md`/`.mdx`/image files either, so `docs-only` does not
apply. Per the skill's step 3 ("no heuristic matches at all"), `surfaces: []`. Per the phase
instructions, `secrets-in-code-check` and `privacy-and-pii-review` still run for every non-`docs-only`
review regardless of the empty surface list.

### Coverage Matrix
| Category | Status | Notes |
|---|---|---|
| Secrets in code (`secrets-in-code-check`) | Pass | 0 matches against any detector pattern in the diff |
| Privacy/PII (`privacy-and-pii-review`) | Pass | 0 matches against PRIV01-05 in the diff |
| OWASP Web/API/LLM/capability-authoring playbooks | N/A | No matching surface (firmware-only diff, no closed-set surface heuristic applies) |
| Compliance control mapping | N/A | No active regulation/compliance framework configured for this issue |

### Findings
None. The diff is a pure orientation-state bookkeeping fix (a boolean flag threaded from
`supervisor.runtime.run_reason` through two constructors into one arithmetic condition) -- no secrets,
no logging of user data, no new external-data trust boundary, no NVM schema change, no third-party
egress, no PII field.

### Prioritized Remediation Queue
Empty -- no findings to remediate.

### Verification Evidence
- `secrets-in-code-check`: manually applied every detector pattern in the skill table against the full
  diff text (reproduced in this evidence file's earlier revision history / the manager's own
  fully-delegate evidence file) -- no matches.
- `privacy-and-pii-review`: walked the diff's data flow (`run_reason` enum comparison -> boolean ->
  constructor params -> a rotation-degree integer) -- carries no PII-shaped data at any point.

### Applied Fixes and Filed Work Items
None needed.

### Accepted / Deferred / Blocked
- **Blocked**: on-device power-cycle observation, blocked on physical hardware access in this
  environment (see Human Approval Checklist).

### Compliance Control Mapping
N/A -- no active regulation/compliance framework configured for this issue.

### Run Metadata
- Run date: 2026-08-25.
- Commit SHA: N/A -- nothing committed (conversational mode, no repository configured for this job;
  working tree only).
- Skill errors: none -- `secrets-in-code-check` and `privacy-and-pii-review` both loaded and ran.
- Caps hit: none (0 findings, so the 10-auto-fix cap is not applicable).
- Environment notes: no board attached; review is source-level only, consistent with every other check
  in this evidence file.

## Pre-Completion Reflection

- **Claim verification**: every claim above is backed by a direct `Read`/`Grep` of the named file in
  this session, an executed `py_compile` command, an executed standalone repro/fix script (output
  pasted in full), and an executed `npx jest` / `npx tsc --noEmit` run (output pasted in full). No
  claim rests on trusting the manager's or a sibling agent's prior assertion alone -- each was
  independently re-derived or re-run in this session.
- **Risk analysis**: no firmware code was changed this session, so no new risk was introduced beyond
  what the manager's pre-existing fix already carries. The one open risk is unchanged from the prior
  evidence file: the fix is unverified on physical hardware, and only a real power-off/power-on cycle
  (not a file-save-triggered soft reload) exercises the fixed path.
- **Validation plan check**: every host-runnable check that could bear on this fix was run
  (`py_compile`, hand-trace, repro/fix script, `jest`, `tsc`). The one item the validation plan called
  for that could not be run (on-device power-cycle) is explicitly named as unmet, not silently skipped
  or asserted as passing.
- **Self-audit**: this session's only filesystem change is this evidence file. `firmware/` and `app/src/`
  were read/executed against, not edited -- the firmware fix and the app-side sync were both already
  correct and needed no code change.
- Confidence level: **92%** -- high confidence in the logical correctness of the fix (independently
  re-derived from first principles, not just re-read) and in the app-side sync (independently re-run,
  matching the sibling task's own result exactly); the 8% withheld is entirely the missing on-device
  power-cycle observation, which no amount of source-level re-verification can substitute for.

**Reflection Summary**: The firmware fix and the app<->box sync were both already correct and complete
before this session started. This session's value was independent re-verification from first
principles (not trusting either the manager's or a sibling agent's prior claim), which surfaced no
defects. The single remaining gap -- on-device power-cycle observation -- is a hard blocker on physical
hardware access, not something further code-reading or host-side testing can close.

## Human Approval Checklist
- [ ] **Physical power-cycle test**: with the box's Settings screen-flip set ON, fully power the box
      off and back on (unplug/disconnect the battery and USB, not a file-save/soft-reload), and confirm
      the screen renders flipped AND touch/button mapping is correct in that orientation. This is the
      one thing that cannot be verified without the physical device.
- [ ] **Commit decision**: nothing has been committed. Confirm whether to commit the 3-file firmware fix
      now (standalone, or bundled with the other pre-existing uncommitted `lock_ui.py`/
      `lock_controller.py` work already sitting in the working tree, e.g. the unrelated `bat_diag` label
      removal noted in the manager's own evidence file).

## Continous Learning
| Learning | Agent Rule Updates |
|---|---|
| A prior agent's (even the manager's) static verification of a fix should still be independently re-derived from first principles before being reported as confirmed, not just re-read and accepted -- consistent with the existing `verify-hook-resync-not-just-rerender` coaching moment's lesson that plausible-sounding reasoning must be traced through concrete values, not accepted at face value. | No rule file updated -- this reinforces an existing, already-documented lesson rather than introducing a new one. |
