---
reviewContext:
  subjectType: embedded-firmware
  subjectLabel: firmware/ CircuitPython firmware for the Phone Box lockbox
  reviewRef: master (working tree, 2026-08-17)
  scopeSummary: Static audit of all firmware/ modules for correctness, brownout/safe-mode reliability, power management, and touch/servo run-loop responsiveness, checked against the 7 fixed functions and cost-down goal in project_context.md.
  repoIdentifier: lockbox
  branchRef: master
quality:
  composite: 5.7
  gateDecision: "flag"
  securityPosture:
    score: 7
    rationale: "Remote-unlock/unlock-on-call default OFF with explicit anti-cheat rationale; BLE commands rate-limited; one settings field (sleep) skips the bounds-clamping pattern its siblings use."
  availabilityResilience:
    score: 5
    rationale: "Run-loop ordering (touch-before-redraw, deferred CPU-freq switching, PWM 50Hz reassert) correctly follows project_rules.md. The brownout-retry cap in safemode.py can be silently defeated because code.py clears the retry counter on interpreter start rather than after proven-stable operation."
  backupRestore:
    score: 6
    rationale: "NVM settings/session-log persistence uses a sound magic-byte-guarded, graceful-degradation pattern, but Settings.save() rewrites unconditionally on every hold-repeat tick (up to ~12/s), risking flash wear against an 'occasional settings change' usage assumption."
  observabilityOps:
    score: 4
    rationale: "No watchdog timer anywhere in firmware/; brownout is the only automatic recovery path. No host-runnable test suite exists (expected per project_rules.md), so nothing in this review is board-verified."
  releaseSafety:
    score: 6
    rationale: "Deploy routine (batch-write + sync, no unplug) is documented and consistently followed; verification is manual on-device observation only -- an accepted platform constraint, not a gap introduced here."
  governanceRunbooks:
    score: 6
    rationale: "project_context.md/project_rules.md are detailed and mostly accurate, but this audit found them stale in two places."
  criticalRisks: 0
  highRisks: 1
  mediumRisks: 2
  lowRisks: 2
  blockedLaunchCriteria: 0
  restoreTested: false
  failoverValidated: false
  rollbackValidated: false
  coaching: "Move the brownout-retry-counter clear (code.py:11-14) from 'interpreter started' to 'proven stable', so a marginal-battery + servo-brownout failure mode still hits safemode.py's 5-retry cap."
---

# Production Readiness Review -- firmware/ Firmware

## Executive Summary

firmware/ is a mature, heavily self-documented CircuitPython codebase -- most
prior bugs (spring-integration instability, press-position drift, NVM layout
migrations, BLE advertising drop-outs) are already fixed at the source with
the incident preserved in a comment. This review did not find any critical
defect that breaks one of the 7 fixed functions or blocks continued
development. It did find one **high-severity reliability gap** in the
brownout/safe-mode recovery path that undermines the exact guarantee
`safemode.py` exists to provide, plus two medium and two low findings. No
board run was performed for this review (no host build/test exists per
`project_rules.md`); every finding below is a static-analysis read of the
current source, not an on-device observation.

**Gate decision: flag.** No launch blocker, but the brownout-counter finding
should be fixed before the next round of battery/servo-stress testing, since
it is specifically a battery+servo interaction -- the two subsystems most
likely to actually brownout the board in the field.

## Review Context

- **Scope**: `firmware/code.py`, `boot.py`, `safemode.py`, and every module
  under `firmware/lib/` (`lock_config.py`, `lock_controller.py`,
  `lock_ui.py`, `lock_servo.py`, `lock_battery.py`, `max17048.py`,
  `lock_power.py`, `lock_settings.py`, `lock_log.py`, `lock_motion.py`,
  `lock_ble.py`, `axs5106l.py`).
- **Out of scope**: the companion app (`app/`), the website, and enclosure
  CAD.
- **Method**: full read of every in-scope file plus
  `fraim/personalized-employee/context/project_context.md` and
  `.../rules/project_rules.md`. No on-device run was performed -- this
  project has no host-runnable build or test suite by design (CircuitPython
  runs only on the board).

## Dimension Scorecard

| Dimension | Score /10 | Note |
|---|---|---|
| Security posture | 7 | Anti-cheat defaults are correct; one input-validation gap on a BLE settings field |
| Availability & resilience | 5 | Run-loop ordering is correct; brownout-retry cap can be defeated |
| Backup & restore (NVM) | 6 | Sound persistence pattern; write-amplification risk during hold-repeat |
| Observability & ops | 4 | No watchdog; no host-testable path (expected for this platform) |
| Release safety | 6 | Deploy routine is documented and followed; verification is manual by necessity |
| Governance & runbooks | 6 | project_context.md found stale in two places during this review |

## Evidence Highlights

- `code.py`'s run loop reads touch before the (heavier) clock redraw, defers
  CPU-frequency switches by one frame so they never land mid-gesture, and
  `lock_servo.py`/`lock_controller.py` re-assert 50 Hz PWM on every move and
  every frame of the post-move hold window -- all three project_rules.md
  ordering requirements are honored as written.
- `lock_motion.py`'s `Spring.step` and `lock_ui.py`'s `_step_motion` both
  document and defend against a previously-shipped instability (large-dt
  amplification, NaN/inf propagation) with sub-stepping and a finite-value
  guard -- a good example of a fixed-at-the-root reliability improvement
  already in the codebase.
- `lock_settings.py` and `lock_log.py` both use a magic-byte-guarded NVM
  layout with graceful degradation (missing/undersized NVM region -> empty
  defaults, never a crash) -- the persistence *mechanism* is sound; the
  finding below is about write *frequency*, not the mechanism.

## Top Gaps / Risks

### 1. [HIGH] Brownout-retry counter is cleared before the board has proven it's stable
**File:** `firmware/code.py:11-14`, interacting with `firmware/safemode.py:11-24`

```python
# code.py, lines 11-14 -- runs before ANY hardware init (display/touch/servo)
try:
    microcontroller.nvm[0] = 0
except Exception:
    pass
```

`safemode.py` increments `nvm[0]` and resets on every `BROWNOUT` safe-mode
entry, capping retries at 5 specifically "so a truly dead battery doesn't
reset-loop forever." But `code.py` clears that same counter on its very
first executed line -- before `LockUI`/`Backlight`/`AXS5106L`/`Servo` even
construct. That means the counter only ever reflects "the interpreter
reached line 12," not "the device is actually running stably."

This matters most for exactly the failure mode this product is most exposed
to: `lock_servo.py`'s own header comment notes the servo should be relaxed
"to save battery and avoid adding to boot brownout," i.e. servo current draw
is already known to be able to trip a brownout on this single-cell ~1000 mAh
LiPo. If a marginal/aging battery causes a brownout when the servo actually
engages (not during initial boot inrush, but seconds into a normal run),
the sequence is: boot succeeds -> `nvm[0]` cleared to 0 -> servo engages ->
brownout -> `safemode.py` sees `n=0` (not accumulated from a prior attempt,
because it was just re-zeroed) -> increments to 1 -> resets -> repeats
indefinitely. The 5-retry cap can never engage because every retry attempt
clears the counter again before reaching the point of failure. This defeats
the stated purpose of the cap for the specific failure mode most likely to
occur in the field (a battery that's aged enough to sag under servo load but
not enough to fail at boot inrush).

**Recommendation:** Move the `nvm[0] = 0` clear from "interpreter started"
to "proven stable" -- e.g., after the main `while True` loop has completed
some minimum uptime (a few seconds), or after the first successful
`ctrl.update()` call plus a short delay. This preserves the "a truly dead
battery doesn't reset-loop forever" guarantee for brownouts that happen
after boot, not just during it.

**Untested:** this is a logic-flow read, not a reproduced failure -- no
board run (and certainly no deliberate brownout injection) was performed.

### 2. [MEDIUM] Settings persistence writes NVM on every hold-repeat tick, not just on release
**File:** `firmware/lib/lock_settings.py:79-101` (`Settings.save`), invoked from
`firmware/lib/lock_controller.py:715-735` (`_update_hold`)

`_update_hold` calls `Settings.adjust(...)`, which ends in `self.save()`, on
every hold-to-repeat tick while a user holds `[-]`/`[+]` or a swipe on a
settings detail page. The repeat interval floors at `HOLD_REPEAT_MIN = 0.08s`
(`lock_config.py:302`), so a single sustained hold (e.g. raising Override
from 5 to 500 in one drag) can fire on the order of 10+ full NVM rewrites per
second, each rewriting the whole 10-byte settings block unconditionally.

This is a mismatch between the persistence pattern (built for "an occasional
settings change") and the actual call pattern (a human-paced UI gesture that
can still produce a burst of writes). Repeated, unnecessary flash writes over
the product's lifetime are the kind of thing that erodes NVM endurance well
before other components wear out, in a product that markets configurable
override-press counts and other settings as a normal thing to tune.

**Recommendation:** Keep `adjust()` updating the in-RAM value (so the UI
stays live) but debounce the actual `save()` to fire once when the hold/edit
ends (e.g. in `_handle_release`'s existing "swipe left/right = back" exit
path), not on every intermediate step.

**Untested:** no flash-wear measurement was performed (and can't be, without
a board); this is a code-review inference from the write pattern, not a
verified failure.

### 3. [MEDIUM] One BLE-writable setting skips the input-validation pattern its siblings use
**File:** `firmware/lib/lock_controller.py:517-552` (`apply_ble_settings_json`)

```python
if "ovr" in d:
    st.override_presses = max(OVR_MIN, min(OVR_MAX, int(d["ovr"])))   # clamped
...
if "bright" in d:
    st.bright_pct = max(0, min(100, int(d["bright"])))                # clamped
if "sleep" in d:
    st.sleep_s = int(d["sleep"])                                       # NOT clamped
```

`ovr`, `bright`, `thm`, and `acc` are all clamped to a valid range before
being stored; `sleep` is stored as-is. `Settings.save()` will eventually
clamp it to a byte (0-255) when persisting, but the live in-RAM value used
immediately by `code.py`'s sleep-timeout check
(`now - last_activity > ctrl.settings.sleep_s`) is not validated against the
`SLEEP_OPTIONS` range the on-box UI itself enforces (10/20/30/60s) -- a
malformed or unusual payload from the companion app could set an effectively
0-second or multi-minute-oversized timeout. If `d["sleep"]` is not
int-convertible (e.g. a string or `null`), the resulting `ValueError`
propagates out of `apply_ble_settings_json` uncaught by that method; it is
caught by `lock_ble.py`'s outer `except Exception: pass` in `service()`, so
it does not crash the run loop, but it does mean `st.save()` (the last line
of the method) never runs -- so `ovr`/`auto`/`bright`, etc., already applied
earlier in that same call, take effect in memory but silently fail to
persist for that BLE write.

**Recommendation:** Clamp `sleep_s` the same way `bright_pct` is clamped
(e.g. to a sane min/max, or snap to `SLEEP_OPTIONS` via the same `_step_in`-
style helper `lock_settings.py` already has), and consider validating each
field independently so one malformed field can't skip `save()` for the rest
of a payload's already-applied changes.

**Untested:** no BLE fuzzing/companion-app testing was performed; this is a
static reading of the validation code path.

### 4. [LOW] Misleading comment on the BLE remote-unlock default
**File:** `firmware/lib/lock_controller.py`, in `apply_ble_command`'s `"unlock"` branch (~line 505-506)

The inline comment reads "a remote early-release path: ON by default (see
lock_config. BLE_ALLOW_REMOTE_UNLOCK), toggleable off in Settings." The
actual default, in both `lock_config.py` (`BLE_ALLOW_REMOTE_UNLOCK = False`)
and `lock_settings.py` (`self.allow_remote_unlock = BLE_ALLOW_REMOTE_UNLOCK`),
is **OFF**, with an extended anti-cheat rationale documented in both of those
files. The code's actual behavior (gated by
`self.settings.allow_remote_unlock`) is correct; only the comment is
inverted. Low severity since it doesn't affect behavior, but it directly
contradicts the surrounding codebase's own stated security rationale and
could mislead a future change.

**Recommendation:** Fix the comment to say "OFF by default."

### 5. [LOW] project_context.md is stale in two places surfaced by this audit
**File:** `fraim/personalized-employee/context/project_context.md:30, 62-67`

- Line 30 describes `lock_ui.py` as "Largest module (~680 lines)"; the
  current file is 1763 lines -- more than 2.5x the documented size, most
  likely from the BLE/theme/motion features added since that line was
  written.
- Lines 62-67 state that "the on-device session-logging + focus-stats
  feature (`lock_log.py`, the on-screen 'stats' view, the BLE stats
  characteristic) has been removed from the firmware" as a 2026-07-24
  decision. `lock_log.py` is present, actively imported by
  `lock_controller.py`, persists to NVM, and is described in its own header
  as recently *hardened* (per
  `docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md`
  §3.1/§3.2) -- i.e. it is a currently-maintained code path, not a removed
  one. The on-screen "stats" *view* and BLE *stats characteristic* referenced
  in that same sentence may well be the things that were actually removed,
  but the sentence as written is broad enough to read as "lock_log.py itself
  is gone," which is incorrect and could mislead a cost-down or
  scope decision that assumes this code path doesn't exist.

**Recommendation:** Update project_context.md to (a) reflect lock_ui.py's
current size, and (b) narrow the 2026-07-24 removal note to name only what
was actually removed (the on-screen stats view / BLE stats characteristic),
distinguishing it from the still-present, still-maintained best-effort
history queue in `lock_log.py`.

## Coaching Plan

1. **Highest leverage**: Fix the brownout-counter timing (`code.py:11-14`) --
   this is the one finding that directly undermines a named reliability
   guarantee (`safemode.py`'s retry cap) for the failure mode the codebase's
   own comments already flag as a known risk (servo current draw vs. a
   single-cell LiPo).
2. Debounce `Settings.save()` to fire on hold-release rather than every
   repeat tick -- cheap fix, removes a real (if slow-burning) flash-wear
   risk.
3. Bring the BLE `sleep` field's validation in line with its `ovr`/`bright`
   siblings.
4. Two low-cost doc/comment fixes (the inverted "ON by default" comment, and
   the two stale project_context.md claims) -- no behavior change, but both
   could mislead a future contributor or planning decision.
5. Consider a watchdog timer as a follow-on (not blocking): brownout
   detection only covers voltage-sag hangs, not a run-loop lockup from an
   unrelated cause (e.g. a wedged I2C peripheral outside the two devices
   already reviewed here).

All five items are code-review findings, not board-verified defects --
validate each on real hardware (per project_rules.md's "verify by running on
the physical device" requirement) before treating any of them as confirmed.

## Source Inventory

- `firmware/code.py`
- `firmware/boot.py`
- `firmware/safemode.py`
- `firmware/lib/lock_config.py`
- `firmware/lib/lock_controller.py`
- `firmware/lib/lock_ui.py`
- `firmware/lib/lock_servo.py`
- `firmware/lib/lock_battery.py`
- `firmware/lib/max17048.py`
- `firmware/lib/lock_power.py`
- `firmware/lib/lock_settings.py`
- `firmware/lib/lock_log.py`
- `firmware/lib/lock_motion.py`
- `firmware/lib/lock_ble.py`
- `firmware/lib/axs5106l.py`

## Launch Decision and Remediation Queue

**Decision: flag.** Nothing here breaks one of the 7 fixed functions or
blocks the cost-down effort; nothing is critical. The brownout-counter issue
is a real gap in a named reliability guarantee and should be fixed before
the next battery/servo endurance pass.

| Priority | Finding | File:line | Effort |
|---|---|---|---|
| 1 | Brownout-retry counter cleared too early | `code.py:11-14` | Small -- move one guarded write |
| 2 | NVM write-amplification during hold-repeat | `lock_settings.py:79-101`, `lock_controller.py:715-735` | Small -- debounce `save()` to release |
| 3 | BLE `sleep` field unvalidated | `lock_controller.py:517-552` | Small -- add a clamp/snap, same pattern as `bright`/`ovr` |
| 4 | Inverted "ON by default" comment | `lock_controller.py` (`apply_ble_command`, `"unlock"` branch) | Trivial -- comment fix |
| 5 | project_context.md stale (line count, lock_log.py removal claim) | `project_context.md:30, 62-67` | Trivial -- doc fix |
