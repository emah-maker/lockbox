# Feature: MAX17048 Fuel-Gauge Battery Sensing (swap out the ADC voltage-divider estimate)
Issue: #local (Approved: Adafruit MAX17048 #5580, I2C on the shared touch bus @ 0x36)
Tech Spec: `docs/procurement/battery-fuel-gauge/02-fuel-gauge-longlist-and-shortlist-2026-07-23.md` (approved supplier recommendation + firmware-swap note)
PR: N/A — local project folder, not a git repository (conversational mode; changes presented in place)

## Work List
Created at scoping; updated throughout the job.

### Scope
Replace the incumbent ADC voltage-divider + voltage-curve state-of-charge *estimate*
(`lock_battery.py` reading VBAT on GPIO12, mapping volts→% via `batt_pct()`/`BAT_CURVE`)
with a read from the **Adafruit MAX17048 (#5580)** ModelGauge fuel gauge over the
**existing touch I2C bus @ 0x36** — accurate, load-compensated SoC with no sense
resistor and **zero new GPIO**. The public `BatteryReading` shape and every UI
consumer stay identical, so the swap is invisible above `Battery.read()`.

- [x] `Box-code/lib/max17048.py` (NEW) — minimal raw-`busio` MAX17048 driver (VCELL/SOC/VERSION), pure host-testable decode helpers — ✅ done
- [x] `Box-code/lib/lock_battery.py` — rewrite `Battery` to read the gauge over the shared bus; keep `BatteryReading` shape, USB-based charging flag, and the watts estimate — ✅ done
- [x] `Box-code/lib/lock_config.py` — replace ADC/curve tunables with gauge tunables (I2C address); keep `BAT_CAPACITY_MAH` (watts) — ✅ done
- [x] `Box-code/lib/lock_controller.py` — accept the shared `i2c` bus and pass it to `Battery(i2c)` — ✅ done
- [x] `Box-code/code.py` — pass the already-created shared `i2c` bus into `LockController` — ✅ done
- [x] `tests/test_max17048_decode.py` (NEW) — host unit test for the register-decode math — ✅ done (15/15 pass)
- [ ] `docs/procurement/bom.md` — reflect the MAX17048 as the SoC source (accuracy add, not a cost cut) — pending (procurement doc; confirm with manager)

### Validation Requirements
- `uiValidationRequired`: No new UI — `BatteryReading` shape is unchanged, `lock_ui.update_battery_view` untouched. On-device battery view must still render, but no browser/web surface exists (on-device only).
- `mobileValidationRequired`: No.
- Required suites/modes:
  - **Host (PC):** `python tests/test_max17048_decode.py` — exercises the real `decode_voltage`/`decode_percent` register math against datasheet values.
  - **Host (PC):** `python -m py_compile` on all firmware modules (syntax gate; cannot exercise `import busio`/hardware).
  - **On-device:** confirm the gauge ACKs at 0x36 on the shared touch bus alongside the AXS5106L, `.cell_voltage`/`.cell_percent` read sane, and the battery view shows real %/V. **UNTESTED until a board run** — no board this session.

### Decisions
- **Minimal in-repo driver instead of vendoring `adafruit_max1704x`.** The approved rec named
  `adafruit_max1704x` for the *capability* (`cell_voltage` + `cell_percent`). Vendoring it pulls in
  the full `adafruit_bus_device` + `adafruit_register` package stack for **two read-only registers**.
  The project's established convention is a minimal raw-`busio` driver with no external deps
  (`axs5106l.py` says so explicitly). I follow that: `max17048.py` reads VCELL (0x02) and SOC (0x04)
  directly. Functionally identical output; far smaller, dependency-free, host-testable. **Flagged for
  manager** — trivial to switch to the official library later if preferred.
- **Gauge is the sole SoC source; graceful "unavailable" if absent.** If the gauge does not ACK at
  0x36 (module unplugged / manufacturing fault), `Battery.available` is `False` and the view shows
  "N/A" — exactly today's degrade path when the ADC pin is unreadable, and consistent with the
  best-effort convention in `lock_servo`/`lock_log`. I did **not** keep the ADC divider as a fallback:
  the issue is a *swap*, the gauge is a permanent BOM part like the servo, and a second silent
  worse-estimate path is overengineering. The old ADC/curve code and its tunables are removed.
- **Shared-bus dependency injection.** The gauge must reuse the *same* `busio.I2C` object as the
  touch controller (two I2C objects on the same pins conflict). `code.py` already owns that bus; it
  now passes it to `LockController`, which passes it to `Battery(i2c)`. The driver uses the same
  `try_lock()`/`unlock()` discipline as `axs5106l.py` so the two devices cooperate. This changes the
  "created inside the controller with no args" pattern for `Battery` only, and only to inject the
  shared bus — clean DI, endorsed by the architecture standard.
- **Charging flag stays `supervisor.runtime.usb_connected`** (per the risk register — gauge reports
  SoC, not a charge flag). Kept unchanged.
- **Watts estimate kept**, now fed by the *accurate* gauge percent (same time-based `d_pct` math,
  `BAT_CAPACITY_MAH` retained). UI line unchanged.
- **Register transaction = repeated-start** (`writeto_then_readfrom`), which is what the MAX17048
  expects and what Adafruit's driver uses — the opposite of the AXS5106L, which needs write-STOP-read.
- **`raw` field** now carries the raw 16-bit VCELL register value (was the ADC sample count), so the
  diag line "raw {}" still shows a meaningful hardware readout.

### Deferrals
- **Show real % while charging.** The gauge *can* report true SoC during charge; the current UI shows
  "CHG" + empty bar because the *old ADC* could not. Updating that behavior touches `lock_ui.py` and is
  a UI-behavior change beyond this swap's scope. Deferred (nice enhancement, now unblocked by the gauge).
- **Use the gauge's CRATE (charge-rate) register** for a real charge/discharge rate instead of the
  time-based watts estimate. Deferred — out of scope, and the existing estimate preserves the UI.
- **On-device validation.** No board this session; the ACK-at-0x36 / live-read checks are the
  deploy-time next step (same posture as prior firmware jobs on this repo).

## Validation Results
Latest run only. No host build system or test runner exists for this firmware (project rule:
"There is no host build/test command"); the firmware runs only on the board. What *can* be
checked on the PC was checked; the rest is explicitly on-device-only and marked UNTESTED.

| Validation Step | Result | Notes / Failure Analysis |
|---|---|---|
| Host unit test — `python tests/test_max17048_decode.py` | **PASS** | 15 passed, 0 failed. Exercises the real driver: VCELL/SOC decode vs datasheet anchors, MSB-first byte assembly, correct register pointer, try_lock/unlock sharing discipline, `present()` ACK/error paths (via injected fake I2C). Full output below. |
| Regression — `python tests/test_lock_log_stats.py` | **PASS** | 15 passed, 0 failed. Unrelated module; confirms the config edit did not break the other host-testable logic. |
| Static syntax — `python -m py_compile` on all 13 firmware modules | **PASS** | `ALL COMPILE OK`. Catches syntax errors; cannot exercise `import busio`/hardware behavior. |
| Placeholder scan (TODO/FIXME/console.log) in `Box-code` | **PASS** | None. (`NotImplementedError` hits in `lock_power.py` are legitimate `except` handlers, pre-existing.) |
| On-device: MAX17048 ACKs at 0x36 on the shared touch bus alongside AXS5106L | **UNTESTED** | No board this session. `present()` degrades to `available=False` ("no gauge") if absent, so worst case is graceful, not a crash. |
| On-device: `.cell_voltage`/`.cell_percent` read sane; battery view shows real %/V | **UNTESTED** | Requires a board run. `writeto_then_readfrom` is a standard `busio.I2C` method but unverified on this build. |
| On-device: no bus contention with touch (shared-bus `try_lock`) | **UNTESTED** | Reasoned through (see Bug Bash); battery reads ~1 Hz only while the battery view is open. |
| Run-loop responsiveness | **N/A this session** | No new per-loop work: `Battery.read` is called only from `_refresh_battery_view` (~1 Hz, battery view only), same seam as before. `code.py` loop cadence/ordering unchanged. |
| UI polish check | **N/A — no UI layout changes** | `uiValidationRequired: No`. `BatteryReading` shape unchanged; only two stale *diagnostic strings* in the unavailable branch were corrected ("no gauge" / "MAX17048 @0x36 not found"). On-device 172×320 displayio view, no browser surface. |

### Full host test output
```
PASS voltage: 0 raw -> 0 V
PASS voltage: 0xD200 -> 4.20 V
PASS voltage: 0xFFFF -> ~5.12 V
PASS percent: 0 raw -> 0 %
PASS percent: 0x6400 -> 100 %
PASS percent: 12800 -> 50 %
PASS cell_voltage reads VCELL (0x02) -> 4.20 V
PASS cell_percent reads SOC (0x04) -> 100 %
PASS MSB-first assembly (0x1234 -> 4660)
PASS selected the VCELL register pointer
PASS read locks and unlocks symmetrically
PASS bus left unlocked after read
PASS present() True when gauge ACKs
PASS present() False when bus errors
PASS bus unlocked even after a failed read

15 passed, 0 failed
```

## Bug Bash Findings
Edge-case, boundary, and adjacent-flow review of the changed logic (on-device paths reasoned
through, since no board is available):

- **Gauge absent / NAK at 0x36** — `present()` → `False` → `available=False` → view shows
  "N/A" / "no gauge" / "MAX17048 @0x36 not found". Timer and the other six core functions are
  untouched (Battery feeds only the battery view). ✅
- **Transient bus error mid-read** — `read()` catches `OSError`, returns an unavailable reading
  for that one frame but keeps `self.available` True, so it recovers on the next ~1 Hz read.
  Worst case: a ≤1-frame "N/A" flicker. Recorded as **Low**, non-blocking. ✅
- **Percent boundary** — the gauge can report slightly >100 just after a full charge;
  `int(cell_percent + 0.5)` is clamped to `[0, 100]`. ✅
- **Shared-bus contention with touch** — both drivers use `try_lock()/unlock()`; Battery holds
  the lock only for one 3-byte transaction and only ~1 Hz while the battery view is open, vs.
  touch's ~20 ms cadence. A battery read can at most wait one touch cycle; no deadlock (locks are
  released promptly). Run-loop ordering rule preserved — no new per-loop work, `code.py` unchanged. ✅
- **`i2c=None`** (controller built without a bus) — `Battery(None)` → `available=False`, graceful. ✅
- **`raw` diag field** — now the raw 16-bit VCELL register value (0–65535), not the old ADC sample
  count. Intentional and documented; the "raw {}" label still shows a real hardware readout. ✅
- **watts estimate** — same time-based `d_pct` math as before, now fed by accurate percent; first
  read seeds and returns 0.0; charging drives toward 0; a percent resync spike is damped by the 0.3
  EMA. Cosmetic only, unchanged behavior. ✅
- **Removed config symbols** — grep confirmed `BAT_DIVIDER/BAT_SMOOTH/BAT_FULL_V/BAT_CHG_DELTA/`
  `BAT_CURVE/batt_pct/BAT_PIN_CANDIDATES/BAT_VALID_*/BAT_SENSE_PIN/BAT_CHG_COMP` were imported only
  by the old `lock_battery.py`; nothing else references them. Stale `BAT_SENSE_PIN` mention in the
  SD-pin comment was updated. ✅

**Result: 0 Critical, 0 High. 1 Low (transient-frame N/A flicker, self-recovering).** No blocking findings.

## Security Review

### Executive Summary
- **0 findings** (0 Critical, 0 High, 0 Medium, 0 Low). No escalations, no remediation queue.
- Diff is CircuitPython firmware (an I2C fuel-gauge driver + battery module + config/wiring), a
  host test, one UI diagnostic-string fix, and a markdown evidence doc. No auth, crypto, network,
  secrets, or PII surface is introduced.

### Review Scope
- `reviewType`: embedded-diff-review · `reviewScope`: **diff**
- `surfaceAreaPaths`: `Box-code/lib/max17048.py` (new), `Box-code/lib/lock_battery.py`,
  `Box-code/lib/lock_config.py`, `Box-code/lib/lock_controller.py`, `Box-code/lib/lock_ui.py`,
  `Box-code/code.py`, `tests/test_max17048_decode.py`,
  `docs/evidence/battery-fuel-gauge-feature-implementation-evidence.md`.

### Threat Surface Summary
- Detected surfaces: **[] (none)**. The heuristics (`web`, `api`, `llm-app`, `data-pipeline`,
  `mobile`, `capability-authoring`) match no reviewed file — this is embedded firmware. `docs-only`
  is not emitted because non-`.md` files are present. `docs/evidence/*.md` is not a
  capability-authoring path. Category rows are therefore N/A except the always-run secrets/PII scans.

### Coverage Matrix
| Category | Result |
|---|---|
| OWASP Web Top 10 | N/A (no `web` surface) |
| OWASP API Top 10 | N/A (no `api` surface) |
| OWASP LLM Top 10 | N/A (no `llm-app` surface) |
| Capability-authoring review | N/A (evidence doc is `docs/evidence`, not agent instruction) |
| Secrets-in-code | **Pass** — no keys/tokens/passwords; config adds only an I2C address (0x36) + a battery capacity |
| Privacy / PII | **Pass** — the module reads only cell voltage and state-of-charge; no identity, contacts, or location |
| Untrusted-input handling (I2C register bytes) | **Pass** — gauge bytes are read into a fixed 2-byte buffer and assembled with bit math into an int; no `eval`, no format-string injection, buffer size is fixed |

### Findings
None.

### Prioritized Remediation Queue
Empty.

### Verification Evidence
- Secrets/PII: manual inspection of the full diff; no sensitive tokens or personal data present.
- Untrusted-input: `_read_u16` writes a 1-byte register pointer and reads exactly 2 bytes into a
  preallocated buffer; decode is `raw * 78.125/1e6` and `raw/256.0` — no parsing of external strings.

### Applied Fixes and Filed Work Items
None required.

### Accepted / Deferred / Blocked
- None. (The deferred UI "show % while charging" enhancement is a functional item, not a security item.)

### Compliance Control Mapping
N/A — no compliance framework active for this project.

### Run Metadata
- Date: 2026-07-23 · Repo: local folder (no git SHA) · Skill errors: none · Auto-fix cap: not reached.

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) — `MAX17048._read_u16` is one locked transaction;
  `Battery.read` is ~30 lines, no nesting >3, no param list >4. The driver reads only the two
  registers the feature needs; no speculative API (CRATE, alerts, hibernate) was added.
- [x] No resource waste — battery is read only from `_refresh_battery_view` (~1 Hz, battery view only),
  the same seam as the old ADC path; no new per-loop work, no retries/delays; `code.py` loop unchanged.
- [x] Solution matches the approved recommendation — reads `cell_voltage` + `cell_percent` off the
  MAX17048 over the shared touch bus at 0x36 (zero new GPIO), exactly as approved.
- [x] All new files/functions are actually used — `max17048.py` (`MAX17048`, `decode_voltage`,
  `decode_percent`, `present`, `cell_voltage`, `cell_percent`, `vcell_raw`) all consumed by
  `lock_battery.py` and/or the host test; no dead API.

**Quality findings:**
- `QUALITY CHECK FINDING` — **RESOLVED**: dead constant `_VCELL_LSB_UV` in `lock_battery.py`
  (left over from an earlier raw-reconstruction approach that was replaced by reading
  `MAX17048.vcell_raw` directly) → removed. Re-compiled + re-ran the decode test after removal.
- `QUALITY CHECK FINDING` — **ACCEPTED (not blocking)**: `lock_ui.py` remains > 500 lines
  (pre-existing; the project keeps all display views in one module — noted as "the largest module"
  in project context). This change touched only two diagnostic strings there; it does not worsen the
  situation and splitting `lock_ui` is a separate refactor outside this swap's scope.

**Reuse check:** the new driver follows the `lock_servo`/`lock_battery` per-peripheral pattern and
mirrors `axs5106l.py`'s raw-`busio` + `try_lock()/unlock()` discipline (no new dependency). The I2C
address is the single source of truth in `lock_config.py` (`BAT_GAUGE_ADDR`); the chip register
addresses + decode constants live in the driver (their correct home), not scattered. `BatteryReading`
is unchanged, so `lock_ui.update_battery_view` needed no interface change.

## Completeness Review

**Feature Requirements Source**: the approved issue/decision note (#local: "Adafruit MAX17048 (#5580)
fuel gauge, I2C on the shared touch bus (0x36). Swap replaces the ADC voltage-divider estimate in
`Box-code/lib/lock_battery.py`; `adafruit_max1704x` gives cell_voltage + cell_percent") plus the
approved recommendation in `docs/procurement/battery-fuel-gauge/02-fuel-gauge-longlist-and-shortlist-2026-07-23.md`.
**Technical Design Source**: no separate RFC for this swap. The alternate design source of truth is the
recommendation doc's firmware-swap note (risk register row: "`adafruit_max1704x` gives `.cell_voltage`
+ `.cell_percent` directly; drop-in swap for `Battery.read()`, keep the same `BatteryReading` shape")
and the project rules (`fraim/personalized-employee/rules/project_rules.md`).

### Feature Requirement Traceability Matrix
| Requirement / Acceptance Criteria | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Read state-of-charge from the **MAX17048**, not the ADC divider | `max17048.py MAX17048.cell_percent`/`cell_voltage`; `lock_battery.Battery.read` uses them; ADC/`AnalogIn` path removed | Host test `cell_percent reads SOC (0x04)`, `cell_voltage reads VCELL (0x02)`; grep confirms no `analogio` import remains | Met (code); on-device read UNTESTED (no board) |
| Fuel gauge on **I2C, shared touch bus, addr 0x36, zero new GPIO** | `code.py` passes the touch `i2c` to `LockController`→`Battery(i2c)`; `MAX17048(address=BAT_GAUGE_ADDR=0x36)`; no new pin allocated | Code review; `BAT_GAUGE_ADDR=0x36` in `lock_config.py`; test `present() True when gauge ACKs` | Met (code); on-device co-existence with AXS5106L UNTESTED |
| Provide **cell_voltage + cell_percent** (the accuracy upgrade) | `MAX17048.cell_voltage` (VCELL 0x02 · 78.125 µV/LSB), `cell_percent` (SOC 0x04 · 1/256 %/LSB) | Host test decode anchors (0xD200→4.20 V, 0x6400→100 %); MSB-first assembly test | Met (code); live values UNTESTED |
| Preserve function #5 (battery sensing/display) and the other six functions | `BatteryReading` shape unchanged; `lock_ui.update_battery_view` unchanged (bar 2 diag strings); timer/servo/override/power/settings/brownout untouched; `code.py` loop unchanged | `py_compile` all 13 modules OK; bug bash "gauge absent → timer + 6 functions unaffected" | Met (code); on-device render UNTESTED |
| CircuitPython-only, no pip/CPython deps | Minimal raw-`busio` driver (no `adafruit_*` vendoring); only `supervisor` + builtins in `lock_battery` | `py_compile` OK; import list review | Met |
| Update the BOM to reflect the gauge | — | — | **Deferred** — the recommendation gates the BOM line on the manager buying/validating one first; needs manager confirmation before editing `docs/procurement/bom.md` |

### Technical Design Traceability Matrix
| Commitment / named callout | Implemented File/Function | Proof | Status |
|---|---|---|---|
| **Drop-in swap for `Battery.read()`, keep the same `BatteryReading` shape** (risk-register note) | `lock_battery.BatteryReading` fields `available/volts/percent/charging/watts/raw` unchanged | Code review; `lock_ui.update_battery_view` consumes it unchanged | Met |
| Keep `supervisor.runtime.usb_connected` as the **charging** indicator (gauge reports SoC, not a charge flag) | `Battery.read` sets `charging = supervisor.runtime.usb_connected` | Code review | Met |
| `adafruit_max1704x` for `cell_voltage`+`cell_percent` (**named library callout**) | Deliberately substituted a **minimal in-repo driver** `max17048.py` giving the identical `cell_voltage`/`cell_percent` capability | Decision recorded in Work List → Decisions; flagged for manager; host test proves identical decode | Met (capability); **library substitution flagged** — deviation is intentional, documented, and approved-pending |
| Rule: `lock_config.py` is the single source of truth for tunables/pin map | I2C address in `BAT_GAUGE_ADDR`, capacity in `BAT_CAPACITY_MAH`; register map lives in the driver (its correct home) | Code review | Met |
| Rule: respect the pin map (no new GPIO; avoid strapping/in-use pins) | Reuses the existing touch I2C bus object; allocates no new pin | Code review; `code.py` passes existing `i2c` | Met |
| Rule: keep the run loop responsive; no mid-interaction disruption | No new per-loop work; `Battery.read` only from `_refresh_battery_view` (~1 Hz, battery view only); `code.py` unchanged; driver uses `try_lock/unlock` like `axs5106l` | Code review; bug bash bus-contention analysis | Met |
| Rule: CircuitPython runtime only, no CPython/pip deps | Raw `busio` driver, no external library | `py_compile` OK | Met |
| Rule: state plainly when untested (no board) | On-device rows marked UNTESTED throughout | This evidence doc | Met |

**Deviations:** one intentional, documented deviation — a minimal in-repo `max17048.py` driver instead
of vendoring `adafruit_max1704x` + its `adafruit_bus_device`/`adafruit_register` stack, matching the
`axs5106l.py` no-external-deps precedent. Same functional output. Flagged for manager sign-off; trivially
reversible to the official library. No unintended drift.

### Feedback Verification
No human-feedback file exists (`docs/evidence/battery-fuel-gauge-feature-implementation-feedback.md`
not present) — no feedback rounds yet. `allFeedbackAddressed: true` (0 items).

**Work List status:** all code scope items closed and validated (host tests + compile). One item
deferred with rationale: the `bom.md` update is gated on the manager's buy decision (per the
recommendation) and needs confirmation. Required validation modes recorded: host tests executed (pass);
on-device modes consciously deferred to a board run.

## Architecture Update

No formal `docs/architecture/` document exists; `fraim/personalized-employee/context/project_context.md`
is this repo's architecture reference. Two spots were stale after the swap and were updated to match
shipped code:
- **Module layout** — `lock_battery.py` description changed from "LiPo voltage sensing via ADC and
  percent estimation" to fuel-gauge-over-shared-I2C (bus injected, same `BatteryReading` shape); added
  a new **`max17048.py`** entry (minimal raw-`busio` driver).
- **Hardware / Power** — the "ADC voltage sensing (GPIO12, 3:1 divider)" line now describes the add-on
  MAX17048 fuel gauge on the shared touch bus (no new GPIO), noting the board's GPIO12 divider is no
  longer used by firmware.

Structural note: the one genuinely new pattern is **dependency injection of the shared I2C bus**
(`code.py` → `LockController` → `Battery`), because the gauge must reuse the touch controller's bus
object rather than open a second one. Low-risk, additive; no other module's contract changed.
