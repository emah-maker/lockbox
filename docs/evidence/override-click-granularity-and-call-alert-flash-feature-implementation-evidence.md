# Feature: Widen override-click granularity + strengthen call-alert flash
Issue: #local (delegated workstream from the "box call-alert / override settings" roadmap)
Tech Spec: `docs/rfcs/companion-app-development-approach-technical-design.md` (§4.2/§4.3 BLE `settings`/`alert` characteristics)
PR: N/A — conversational mode (no repo configured in `fraim/config.json`); changes presented in place, no branch/commit created.

## Work List

### Scope
Feature: two independent settings-screen/UX tunables, both already implemented in the working
tree at job start (found uncommitted, unbuilt-upon prior work matching this exact ask) and
verified/validated in this session.

1. **Override-click granularity** — the "Override presses" setting (force-unlock press count) only
   moved in steps of 10 (10/20/.../100 — 10 selectable values) despite being a literal integer press
   count where any value in range is meaningful, not just multiples of ten.
2. **Call-alert flash strength** — the incoming-call overlay's red/amber flash (added in a prior
   session) used the theme's normal muted `C_RED`/`C_AMBER` at 3 Hz, which read as calm/on-brand
   rather than urgent.

- [x] `firmware/lib/lock_config.py` — `OVR_MIN` 10→5, `OVR_STEP` 10→1 (`OVR_MAX` unchanged at 100);
  new `C_ALERT_RED`/`C_ALERT_AMBER` (saturated 0xFF1744/0xFFC400 vs. the muted UI `C_RED`/`C_AMBER`);
  `CALL_ALERT_BLINK_HZ` 3→6 — ✅ done (pre-existing in working tree, verified)
- [x] `firmware/lib/lock_ui.py` — call-alert overlay build/show/animate paths (`_build_call_alert`,
  `show_call_alert`, `animate_call_alert`) switched from `C_RED`/`C_AMBER` to
  `C_ALERT_RED`/`C_ALERT_AMBER` — ✅ done (pre-existing, verified)
- [x] `app/src/screens/SettingsScreen.tsx` — mirrored `OVR_MIN`/`OVR_STEP` constants (5/1) to match
  the firmware — ✅ done (pre-existing, verified)
- [x] `firmware/lib/lock_controller.py`, `firmware/lib/lock_settings.py` — no changes needed; both
  already reference `OVR_MIN`/`OVR_MAX`/`OVR_STEP` by name (no hardcoded 10s), so the widened
  range/step apply automatically — verified by reading, not modified.
- [x] `app/src/screens/SettingsPrimitives.tsx` (`SliderRow`) — no changes needed; it's a continuous
  drag-to-value slider with no tick-mark rendering tied to step count, so a finer step is a pure
  behavior change (finer snap on drag/BLE-write), not a layout change — verified by reading.

### Validation Requirements
- `uiValidationRequired`: Yes — the Override slider's snap granularity (box settings detail page
  `[-]`/`[+]` and the app's `SliderRow`) and the call-alert overlay's flash colors/rate. No
  web/browser surface (React Native app; box is an on-device CircuitPython UI).
- `mobileValidationRequired`: Yes in principle (React Native) — no iOS/Android device/simulator
  available this session; type-check + unit test only (see Validation Results).
- Required suites/modes:
  - **Host (PC):** `python -m py_compile` on every touched firmware module (syntax gate only —
    cannot exercise hardware/`adafruit_ble`/`displayio` imports).
  - **Host (PC):** `npx tsc --noEmit` and `npx jest` (full app suite).
  - **On-device (deferred, no board this session):** confirm the Override detail page now moves by
    1 per tap (5..100) and holding auto-repeats through the range at a reasonable pace; confirm the
    call-alert overlay flashes visibly brighter/more saturated red/amber at the new rate.

### Decisions
- **Step size 1, not something intermediate like 5.** The setting is a literal press-count
  threshold, not a coarse category (unlike sleep/brightness, which are pre-set option lists) — every
  integer in range is a meaningful, distinct choice, so the finest possible granularity is the
  correct "more finely adjustable" reading of the ask, not a partial half-measure.
- **Min lowered 10→5, not left at 10.** Widening only the step while leaving the floor at 10 would
  still forbid low counts (5, 6, 7, 8, 9) that are legitimate "easy override" choices for someone
  who wants the physical-override escape hatch to be low-friction; 5 was chosen as a still-clearly-
  intentional (not accidental single-tap) floor. Max stays at 100 — the existing ceiling was never
  the complaint.
- **Traversal time checked, not assumed fine.** With `OVR_STEP` now 1, walking the box's on-device
  Override range (5→100, 95 steps) via press-and-hold uses the existing
  `HOLD_REPEAT_START`/`HOLD_REPEAT_RAMP`/`HOLD_REPEAT_MIN` auto-repeat (0.35s→0.08s, ramping ×0.85
  per repeat) already built for exactly this "long traversal via a fine-grained control" case — full
  traversal is ~8-9 seconds held, not 95 separate taps. No config change needed here; this was a
  correctness check on the existing auto-repeat tuning, not a new mechanism.
- **Dedicated alert colors instead of just raising the existing blink rate.** A faster flash alone
  (3→6 Hz) helps, but `C_RED`/`C_AMBER` are deliberately desaturated for calm, everyday UI use
  elsewhere on the box; reusing them for an "attention-grabbing" alert caps how urgent the flash can
  ever look. New `C_ALERT_RED`/`C_ALERT_AMBER` are saturated/high-contrast and used *only* by the
  call-alert overlay, so turning up urgency here doesn't also make the rest of the UI look alarming.
- **Blink rate doubled (3→6 Hz), not pushed higher.** `CALL_ALERT_BLINK_HZ` feeds
  `int((now - started) * hz * 2) % 2` in `lock_controller.py`'s per-frame check — 6 Hz already means
  12 color-flips/second, near the top of what reads as a fast strobe rather than a flicker on this
  display's refresh; going further risks looking like a glitch rather than an alert.
- **No change to `BLE_CALL_ALERT_S` (20s) or the screen-sleep guard.** Those were the subject of an
  earlier session's fix (screen-wake + hold-awake during the alert) and are orthogonal to "make the
  flash itself more attention-grabbing" — left untouched.

### Deferrals
- **On-device validation** — Deferred, no physical board in this session. Documented plainly per
  project rules ("state plainly when a change is untested because no board run was performed").
- **Live iOS/Android app validation** — Deferred, no device/simulator in this session. Type-check +
  unit test only.

## Validation Results
Latest run only.

| Validation Step | Result | Notes |
|---|---|---|
| `python -m py_compile` on `lock_config.py`, `lock_ui.py`, `lock_controller.py`, `lock_settings.py`, `code.py` | ✅ Pass | Syntax gate only — these modules import `board`/`displayio`/`busio` transitively and cannot be executed on host. |
| `npx tsc --noEmit` (app) | ✅ Pass | Clean, no errors against the full current working tree. |
| `npx jest` (full app suite) | ✅ Pass | 8/8 suites, 60/60 tests. |
| On-device (box) | ⏸️ Untested — no physical board this session | Stated plainly per project rules. |
| Mobile app (iOS/Android) | ⏸️ Untested — no device/simulator this session | Type-check + unit test only. |
| UI polish check | N/A — no host-renderable UI surface | Box UI is on-device CircuitPython (`displayio`); app UI is React Native with no simulator/device in this session. Same limitation as the prior `call-alert-unlock-setting` workstream. |
| `git status` cleanliness | ⚠️ Pre-existing untracked clutter, not from this workstream | Numerous stray untracked files/dirs (e.g. `graphify-out/`, `.impeccable/`, and several filename-looking code fragments) were already present in the working tree before this session started and are unrelated to the 3 files touched here (`lock_config.py`, `lock_ui.py`, `SettingsScreen.tsx`). Left untouched — out of scope and not safe to delete without the manager's input on their origin. |

## New Tests Added
None. Both changes are constant/color-value tweaks consumed by existing, already-tested code paths:
`OVR_MIN`/`OVR_STEP` flow through `lock_settings.adjust()` and `SliderRow.snapValue()`, neither of
which branches on the specific constant values (both are generic clamp/snap math already exercised
by every existing settings interaction); `C_ALERT_RED`/`C_ALERT_AMBER` are inert display-color
constants with no logic attached. A test asserting `OVR_MIN === 5` or that a color constant equals
a specific hex value would be a trivial tautology, not a regression guard — the real risk surface
(traversal pacing, NVM range compatibility, slider snap boundaries) was checked by reading the
consuming code directly (see Bug Bash Findings) rather than by new unit tests. The one path with
actual logic and existing test infrastructure, `protocol.ts`'s BLE settings round-trip
(`parseSettings`/`encodeSettings`), is unaffected — `ovr` round-trips as a plain number regardless
of what range/step the UI restricts it to, and is already covered by `protocol.test.ts`.

## Bug Bash Findings
- Checked `lock_settings.py` NVM persistence path (`nvm[_BASE + 1] = max(1, min(255, int(...)))`
  and boot-time load `max(OVR_MIN, min(OVR_MAX, ...))` implicitly via `adjust()`): a box upgraded
  from the old 10-100/step-10 firmware with a previously saved value (e.g. 30) loads fine under the
  new range — no migration needed, since the new range (5-100) is a superset of the old (10-100)
  and the NVM byte format is unchanged (no magic-byte bump required, unlike the earlier `ucal` add).
- Checked the settings-detail description string ("presses to force-unlock") still reads correctly
  at the new floor (e.g. "5 presses to force-unlock") — no wording assumed a multiple of 10.
- Checked `SliderRow`'s `snapValue` (`Math.round((v - min) / step) * step + min`) with `step=1`,
  `min=5`: reduces to `Math.round(v - 5) + 5`, i.e. plain integer rounding — no divide-by-zero or
  off-by-one at the boundaries (5 and 100 both reachable and clamped correctly by the trailing
  `Math.min(max, Math.max(min, ...))`).
- 0 Critical/High findings.

## Implementation Quality Checkpoints
 - [x] Code complexity reviewed (no overengineering) — RESOLVED: the change is 3 constant edits
   (`OVR_MIN`/`OVR_STEP` numbers, 2 color literals) plus updated color-variable references inside
   already-existing functions; no new abstractions, classes, or control flow added.
 - [x] No resource waste (excessive retries, delays, workarounds) — RESOLVED: no loops, retries, or
   timing logic added; the existing `HOLD_REPEAT_*` auto-repeat tuning was checked (not modified) and
   found already adequate for the new step size (see Decisions above).
 - [x] Solution based on proven prototype from design phase — RESOLVED: follows the exact convention
   already established for the two prior related tunables in this file — the earlier
   `CALL_ALERT_BLINK_HZ` addition and the `SLEEP_OPTIONS`/`BRIGHT_OPTIONS` option-list pattern both
   already lived in `lock_config.py` with an app-side mirror comment ("keep these ranges in
   lockstep") — this change reuses that same pattern rather than inventing a new one.
 - [x] All new files/functions are actually used — RESOLVED: no new files/functions were added; the
   two new named color constants (`C_ALERT_RED`, `C_ALERT_AMBER`) are used in all 3 places the old
   `C_RED`/`C_AMBER` alert usages were (`_build_call_alert`, `show_call_alert`, `animate_call_alert`
   in `lock_ui.py`) — verified via grep, no orphaned reference.
 - [x] No hardcoded-value duplication / missed reuse — RESOLVED: `OVR_MIN`/`OVR_MAX`/`OVR_STEP` and
   the two alert colors are defined once in `lock_config.py` and imported everywhere they're used
   (`lock_controller.py`, `lock_settings.py`, `lock_ui.py`); the app-side mirror in
   `SettingsScreen.tsx` is a deliberate, documented duplication (cross-language — TS can't import
   the CircuitPython config module), consistent with the existing `SLEEP_OPTIONS`/`BRIGHT_OPTIONS`
   mirrors already in that file.
 - [x] File size / monolith check — RESOLVED: no file grew meaningfully (2-8 line diffs); none of
   the 3 touched files were pushed over any size concern (`lock_ui.py` is the largest module at
   ~690 lines, pre-existing, not grown by this change).

## Pre-Completion Reflection
- **Claim verification**: Every changed line was read in context (not just diffed) before being
  called correct — confirmed `lock_controller.py`/`lock_settings.py` reference the constants by
  name (so the range/step change propagates without touching those files), and confirmed
  `SliderRow` has no step-count-dependent rendering (no tick marks) before concluding the app side
  needed only the constant mirror update.
- **Risk analysis**: Main risk was "does step=1 make the box's physical control tedious" — checked
  against the existing hold-repeat tuning rather than assumed fine; main secondary risk (NVM
  migration on upgrade) checked against the actual clamp code, not assumed safe.
- **Validation plan check**: Ran everything host-executable (py_compile, tsc, jest) and stated
  plainly what's deferred (on-device, mobile) rather than claiming untested paths as verified.
- **Self-audit**: No new files, no new dependencies, no TODOs left; the app/firmware constants stay
  in lockstep per the existing "keep these ranges in lockstep" comment convention.
- Confidence level: 95% — the only unverified pieces are on-device visual/tactile feel (flash
  brightness, hold-repeat pacing), which need a physical board and are called out as deferred, not
  claimed as done.

## Spec and Design Completeness

**Feature Requirements Source**: Manager-delegated workstream description — "Widen override-click
granularity and strengthen call-alert flash," parent objective "Make the box's force-open
click-count setting more finely adjustable, and make the incoming-call screen flash more
attention-grabbing." No feature spec or RFC scoped this specific pair of tunable adjustments; the
delegation text is the requirements source of truth.
**Technical Design Source**: None (no RFC covers this pair of tunables specifically). The
implementation follows the pre-existing config/mirror pattern already established for adjacent
tunables in `docs/rfcs/companion-app-development-approach-technical-design.md` (§4.2/§4.3, BLE
`settings` characteristic) and in the prior `call-alert-unlock-setting` workstream's flash
mechanism, rather than a new design document.

### Feature Requirement Traceability Matrix
| Requirement/Acceptance Criteria | Implemented File/Function | Proof (Test Name/Curl output) | Status |
|---|---|---|---|
| Force-open click-count setting is more finely adjustable | `firmware/lib/lock_config.py` (`OVR_MIN` 10→5, `OVR_STEP` 10→1); `firmware/lib/lock_settings.py` `Settings.adjust()` (consumes the constants unmodified); `app/src/screens/SettingsScreen.tsx` (mirrored `OVR_MIN`/`OVR_STEP`); `app/src/screens/SettingsPrimitives.tsx` `SliderRow.snapValue()` | Manual proof: `snapValue` traced with `min=5, step=1` → `Math.round((v-5)/1)*1+5` = every integer 5..100 individually reachable (was every multiple of 10, 10 values, now 96 values). `python -m py_compile` pass on `lock_config.py`/`lock_settings.py`; `npx tsc --noEmit` pass on `SettingsScreen.tsx`. On-device tactile feel of the box's `[-]`/`[+]` buttons deferred (no board this session, see Deferrals). | Met |
| Incoming-call screen flash is more attention-grabbing | `firmware/lib/lock_config.py` (`CALL_ALERT_BLINK_HZ` 3→6; new `C_ALERT_RED`/`C_ALERT_AMBER`); `firmware/lib/lock_ui.py` (`_build_call_alert`, `show_call_alert`, `animate_call_alert` now use the saturated alert colors instead of the muted theme `C_RED`/`C_AMBER`) | Manual proof: grep confirms all 3 call-alert render paths in `lock_ui.py` reference `C_ALERT_RED`/`C_ALERT_AMBER` (0 remaining `C_RED`/`C_AMBER` references in the call-alert build/show/animate functions); `lock_controller.py`'s flash-phase calc (`int((now - started) * CALL_ALERT_BLINK_HZ * 2) % 2`) now toggles at 12 flips/sec instead of 6. `python -m py_compile` pass on `lock_config.py`/`lock_ui.py`. On-device visual confirmation deferred (no board this session, see Deferrals). | Met |

**Feature Requirements Completeness Summary**:
- Implemented: 2/2 items (100%)
- Deferred: 0 items requiring a follow-up issue (on-device visual/tactile confirmation is a stated
  session limitation, not a scope deferral — no issue tracker configured for this repo, so it's
  flagged to the manager directly per project convention).
- Missing: 0

### Technical Design Traceability Matrix
| Requirement/Acceptance Criteria | Implemented File/Function | Proof (Test Name/Curl output) | Status |
|---|---|---|---|
| Named callout: keep firmware/app numeric-range constants "in lockstep" (existing convention documented at `SettingsScreen.tsx:17-18` and `lock_config.py:157-159`) | `app/src/screens/SettingsScreen.tsx` `OVR_MIN=5`/`OVR_STEP=1` mirrors `firmware/lib/lock_config.py` `OVR_MIN=5`/`OVR_STEP=1` exactly | Manual side-by-side value comparison of both files; `npx tsc --noEmit` + `npx jest` pass, confirming no downstream type/consumer breakage from the mirrored constants | Met |
| BLE `settings` characteristic contract (RFC §4.2/§4.3): `ovr` round-trips as a plain integer, UI-side range/step is a client-side constraint only | `app/src/ble/protocol.ts` `parseSettings`/`encodeSettings` (unchanged) | `npx jest src/ble/protocol.test.ts` — pass, round-trip unaffected since `ovr`'s wire format never encoded range/step, only the value | Met |

**Technical Design Completeness Summary**:
- Implemented: 2/2 items (100%)
- Deferred: 0
- Missing: 0

**Scope Changes from Spec / Design**: None — no RFC scoped this pair of tunables, so there is no
design baseline to deviate from; the change follows existing conventions rather than introducing new
ones (see Decisions in Work List).

**Deferred Items**: None requiring a follow-up issue (see Feature Requirements Completeness Summary
above for the on-device-validation caveat).

## Feedback Received
No feedback file exists for this issue (`docs/evidence/override-click-granularity-and-call-alert-flash-feature-implementation-feedback.md` not present) — this is a fresh workstream with no prior review round. `feedback-completeness-verification`: N/A, 0 feedback items, `allFeedbackAddressed = true` vacuously.

## Security Review

### Executive Summary
0 findings (Critical: 0, High: 0, Medium: 0, Low: 0). Nothing blocking; no auto-fixes needed.
This diff is three constant/color-value edits (a numeric range/step and two color literals) with
no new input handling, network calls, storage, or auth/crypto surface.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`: `firmware/lib/lock_config.py`, `firmware/lib/lock_ui.py`, `app/src/screens/SettingsScreen.tsx`

### Threat Surface Summary
No surface from the classification's closed set `{web, api, llm-app, data-pipeline, mobile,
capability-authoring, docs-only}` matched:
- `firmware/lib/*.py` — on-device CircuitPython firmware constants/display code; not `web`/`api`/
  `data-pipeline` (no DB driver imports), not `mobile` (not under `ios/**`/`android/**`, no
  `.swift`/`.kt`).
- `app/src/screens/SettingsScreen.tsx` — React Native app source, but outside the `mobile` surface's
  concrete heuristic (native `ios/**`/`android/**`/`.swift`/`.kt` paths only); not `web` (not under
  `public/**`/`pages/**`/`views/**`).
- No `.md` files changed → not `docs-only`.

Per the classification skill's guardrail ("no heuristic matches → `surfaces: []`, mark coverage
N/A"), `surfaces = []`.

### Coverage Matrix
| Category | Result |
|---|---|
| OWASP Top 10 Web | N/A — no `web` surface |
| OWASP API Top 10 | N/A — no `api` surface |
| OWASP LLM Top 10 | N/A — no `llm-app` surface |
| Capability-authoring review | N/A — no `capability-authoring` surface |
| Secrets-in-code check | Pass — no secret-shaped strings in the diff (only numeric constants and 6-hex-digit color literals: `0xFF1744`, `0xFFC400`) |
| Privacy/PII review | Pass — no user data touched; the diff changes a press-count threshold and display colors only |

### Findings
None.

### Prioritized Remediation Queue
Empty — no findings to remediate.

### Verification Evidence
- Manual diff read of all three changed files (see Review Scope) confirming only numeric
  literals/color constants changed, no new I/O, storage, or auth/crypto code paths introduced.
- `git diff` grep for secret/credential-shaped patterns (`key|secret|token|password|api_key|ssn|email`)
  against the three changed files: 0 matches.

### Applied Fixes and Filed Work Items
None — no findings required a fix.

### Accepted / Deferred / Blocked
None.

### Compliance Control Mapping
N/A — no active compliance framework configured for this workstream.

### Run Metadata
- Run date: 2026-08-10
- Commit SHA: N/A (uncommitted working-tree diff; conversational mode, no branch/commit created)
- Skill errors: none
- Caps hit: none (0 auto-fixes attempted, cap is 10/run)
- Environment notes: reviewed as a working-tree diff (`git diff`), not a PR diff — no GitHub PR/issue integration configured in `fraim/config.json` for this repo.

## Continuous Learning
| Learning | Agent Rule Updates |
|---|---|
| For settings that are literal counts (not categorical option lists), "more finely adjustable" should default to the finest granularity the underlying value supports (step=1), not an arbitrary intermediate step — the distinction between a slider over a continuous/count quantity and a picker over discrete presets matters for how "finer" gets interpreted. | None — captured here in evidence; general enough to note but not yet a durable project rule. |
