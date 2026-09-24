# Phone Box — Battery Fuel-Gauge Board: Longlist & Shortlist

**Classification:** BUSINESS CONFIDENTIAL — PROCUREMENT
**Date:** 2026-07-23 · Prototype quantity, USD. Prices read live 2026-07-23.
**Job:** supplier-discovery-and-qualification

---

## The ask, and the objective behind it

**Literal ask:** find a small board to *accurately* measure the battery percentage.

**Objective:** an accurate state-of-charge (SoC) readout for function #5 (battery
sensing/display). Today the firmware (`firmware/lib/lock_battery.py`) reads VBAT
through the incumbent board's 200K/100K divider on GPIO12 and maps volts→percent
with a fixed curve (`batt_pct()` in `lock_config.py`). That is inherently
inaccurate on a single LiPo:

- The LiPo discharge curve is **flat** from ~30–80%, so a few mV of noise swings
  the displayed % by 10–20 points.
- Voltage **sags under load** — the servo actuation pulse and the backlight both
  drop VBAT momentarily, so % reads low mid-action, then jumps back.
- The curve **shifts with temperature and cell age**, and the code already has to
  fudge a `BAT_CHG_COMP = 0.12 V` offset while charging to stop it over-reading.

A dedicated **fuel-gauge IC** fixes this in hardware: it runs a battery model
(OCV relaxation, or OCV + coulomb counting) and outputs a compensated %.

> **Zero-cost alternative, stated honestly (attack-the-objective check):** the
> incumbent Waveshare board has **no** gauge IC — only the divider. Some of the
> inaccuracy could be reduced in firmware alone (rest-voltage OCV lookup, ignore
> readings during a servo pulse, light coulomb integration) for **$0 BOM**. That
> will *not* match a real gauge under the pulsed servo load, but it is the correct
> baseline to weigh a ~$3–6 part against. Recommendation below still favors the
> board, because the ask is for accuracy and the part is cheap and tiny.

---

## Search brief (Phase 1)

| Field | Value |
|---|---|
| Business outcome | Accurate battery-% display (function #5), robust to servo/backlight load |
| Spend category | Commodity electronic component / breakout module, prototype qty |
| Must-haves | Single-cell (1S) LiPo gauge; **CircuitPython library exists** (project rule); I2C; small module; better SoC than a voltage curve |
| Strong-preference | I2C so it can **share the existing touch I2C bus** (no new GPIO); STEMMA-QT/Qwiic plug for solderless bring-up |
| Constraints | CircuitPython runtime only; respect pin map (avoid strapping GPIO0/3/45/46; in use: GPIO12 batt, 41/42/47/48 touch, 13–18 SD, 1/5/10 btn+servo, LCD) |
| Geography | US shipping |
| Disqualifiers | No CircuitPython driver; multi-cell-only; needs a sense resistor we can't place |

**Pin-map finding (verified in `lock_config.py`):** the AXS5106L touch controller
already runs on an I2C bus (GPIO41/42/47/48). Every gauge below is I2C at a
different address (MAX1704x = 0x36), so it **shares the touch bus and consumes
zero additional GPIO** — a key qualifier for this cramped board.

---

## Longlist (Phase 3) — 12 candidates by channel

| # | Candidate | Chip / method | Channel | ~Price | CircuitPython | Note |
|---|-----------|---------------|---------|--------|---------------|------|
| 1 | **Adafruit MAX17048 #5580** | MAX17048 · ModelGauge (OCV, no sense R) | First-party maker | **$5.95** | ✅ first-party `adafruit_max1704x` | STEMMA-QT + JST-PH, 25.7×20.3×7.2 mm, addr 0x36 |
| 2 | Adafruit LC709203F #4712 | LC709203F · OCV | First-party maker | $7.50 | ✅ `adafruit_lc709203f` | **Discontinued** — chip EOL, Adafruit replaced it with #5580 |
| 3 | 7Semi MAX17048 Breakout | MAX17048 | Reseller (Adafruit-design clone) | ~$4–5 (unconf.) | ✅ (same lib) | Sold via Evelta/Robocraze; STEMMA-QT footprint |
| 4 | 7Semi MAX17048 **Mini** Breakout | MAX17048 | Reseller | ~$3–4 (unconf.) | ✅ (same lib) | Smallest footprint variant |
| 5 | SparkFun Qwiic Fuel Gauge MAX17048 | MAX17048 | Competing maker | $5.95 | ⚠️ Arduino-first; works via `adafruit_max1704x` | **Retired / out of stock** |
| 6 | SparkFun LiPo Fuel Gauge MAX17043 (TOL-20680) | MAX17043 · ModelGauge | Competing maker | ~$11 (unconf.) | ⚠️ via `adafruit_max1704x` (43 supported) | Qwiic |
| 7 | SparkFun BQ27441 LiPo Fuel Gauge | BQ27441 · coulomb + OCV | Competing maker | retired | ❌ no maintained CP lib (Arduino/Particle only) | Needs sense resistor; higher accuracy, more setup |
| 8 | DFRobot Gravity Li Battery Fuel Gauge (DFR0563) | MAX17043 | Adjacent / education | ~$6–7 (unconf.) | ⚠️ via `adafruit_max1704x` | Gravity connector = STEMMA/Grove-compatible; screw terminal for cell |
| 9 | HiLetgo MAX17043 module | MAX17043 | Budget marketplace (Amazon) | ~$7 (unconf.) | ⚠️ via `adafruit_max1704x` | Bare module, no plug connector |
| 10 | Generic MAX17048 module (Amazon/AliExpress) | MAX17048 | Budget marketplace | ~$2–6 | ⚠️ via `adafruit_max1704x` | Quality/QC variance; verify it's a real Maxim IC |
| 11 | MAX17260 / MAX1726x class (ModelGauge m5) | coulomb + OCV | Component-level | n/a as tidy 1S breakout | ❌ no first-party CP lib | Highest accuracy; needs sense R + config — overkill here |
| 12 | **Firmware-only, no board** | software OCV/relaxation on existing divider | Incumbent (in-house) | **$0** | n/a (already CP) | Baseline to beat; won't match a gauge under load |

Channels represented: first-party maker, reseller of maker design, competing
maker, adjacent/education vendor, budget marketplace, component-level, and the
incumbent (do-nothing/firmware) path.

---

## Shortlist scorecard (Phase 4)

Weighted criteria, set before scoring. Score 1–5 (5 best); **must-haves gate
before price** (per skill guardrail). "unknown" where evidence is missing.

| Criterion | Weight | #1 Adafruit MAX17048 | #6 SparkFun MAX17043 | #8 DFRobot DFR0563 | #10 Generic MAX17048 | #12 Firmware-only |
|---|--:|:--:|:--:|:--:|:--:|:--:|
| Technical fit (1S, I2C, shares touch bus) | 25% | 5 | 5 | 5 | 5 | 3 |
| **CircuitPython support (must-have)** | 25% | 5 (first-party lib) | 4 (same lib, 43 tested) | 4 (same lib) | 4 (same lib) | 5 (already CP) |
| Accuracy method | 15% | 5 (ModelGauge) | 5 (ModelGauge) | 5 (ModelGauge) | 5 (ModelGauge) | 2 (voltage curve) |
| Bring-up ease (plug + docs) | 15% | 5 (STEMMA-QT + Adafruit guide) | 4 (Qwiic) | 4 (Gravity/screw term) | 2 (bare, no plug) | 5 (no wiring) |
| Availability / US stock | 10% | 5 (in stock) | 3 (unknown) | 4 (unknown) | 4 | 5 |
| Commercial / price | 10% | 4 ($5.95) | 2 (~$11) | 3 (~$6–7) | 5 (~$2–6) | 5 ($0) |
| **Weighted total** | | **4.85** | **4.05** | **4.25** | **4.05** | **3.75** |

Notes on scoring:
- **CircuitPython is the gating must-have.** The `adafruit_max1704x` library
  supports **both MAX17048 and MAX17043**, so every Maxim-based module (rows
  1,3,4,5,6,8,9,10) is drivable with the *same* first-party driver — a big
  qualification advantage for the whole MAX170xx family and against the BQ27441
  (row 7, no maintained CP lib) and the LC709203F (row 2, discontinued chip).
- Accuracy is scored on *method*: ModelGauge/OCV (no sense resistor) beats the
  raw voltage curve; coulomb-counting parts (BQ27441, MAX1726x) would score even
  higher on paper but fail the CP-library / setup gates for a prototype.

---

## Exclusions & risk register (Phase 5)

**Excluded (documented so they're not re-litigated):**

| Candidate | Reason |
|---|---|
| #2 Adafruit LC709203F | Chip is **EOL** (Onsemi, 2021) and the board is discontinued/replaced by #5580. Don't design in a dead part. |
| #5 SparkFun Qwiic MAX17048 | **Retired / out of stock** — same chip as #1, no availability advantage. |
| #7 SparkFun BQ27441 | **No maintained CircuitPython library** (Arduino/Particle only) → fails must-have. Also needs a sense resistor + config: more accuracy than this app needs, more work. |
| #11 MAX17260 / MAX1726x | No first-party CP driver; requires sense resistor + model config. Overkill for a mostly-sleeping lockbox. |

**Risk register:**

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| I2C address/timing clash with AXS5106L touch on the shared bus | Low | Med | MAX1704x = 0x36, distinct from touch; scan bus at bring-up; both are 3.3 V logic |
| Firmware rework: replace `lock_battery.py` ADC path with I2C read | Med | Low | `adafruit_max1704x` gives `.cell_voltage` + `.cell_percent` directly; drop-in swap for `Battery.read()`, keep the same `BatteryReading` shape |
| Physical mount / wiring of an extra module in the enclosure | Low | Low | Module is ~26×20 mm; prior CAD check confirmed ~196×195×27 mm envelope has ample room. Tap SDA/SCL/3V3/GND (4 wires) — no new GPIO |
| Generic (#10) module is a counterfeit/re-marked IC | Med | Med | Only if going budget: buy 1, verify addr 0x36 + sane readings before committing |
| Charge-detect: gauge reports SoC, not "charging" flag | Low | Low | Keep existing `supervisor.runtime.usb_connected` for the charging indicator; gauge supplies %/voltage |
| Adds a line item vs. the current cost-down goal (~+$5.95) | — | Low | It's an *accuracy* upgrade, not a cost cut; if % accuracy isn't worth ~$6, take the $0 firmware path (#12) instead |

---

## Recommendation & next step

**Primary: Adafruit MAX17048 (#5580), $5.95.** Best-scoring, in stock in the US,
first-party CircuitPython library (`adafruit_max1704x`), ModelGauge SoC with **no
sense resistor**, STEMMA-QT plug for solderless bring-up, tiny (26×20 mm), and it
**shares the existing touch I2C bus — zero new GPIO**. This is the accurate,
low-risk answer to the literal ask.

**Budget variant (if the ~$6 matters at volume): a generic MAX17048/MAX17043
module (#10, ~$2–6)** or the **7Semi mini (#4)** — same chip, same
`adafruit_max1704x` driver — but buy one and verify it's a genuine Maxim IC first.

**Decision gate before buying:** the ask is *accuracy*, and a fuel gauge adds
~$5.95 while the current cost priority is BOM reduction. If a firmware-only OCV
improvement (#12, $0) gives "good enough" %, that may be the better call. I can
prototype that firmware change first (free) so you can see how close software
alone gets before spending on the board.

**Recommended action: buy one Adafruit MAX17048 (#5580)** for a bench prototype —
confirm the shared-bus read alongside the AXS5106L touch and validate the
`lock_battery.py` swap — **before** committing the part to the BOM. (RFI/RFQ not
needed at $6 prototype qty.)

---

*Every price/spec claim is backed by a source read live 2026-07-23. Items marked
"unconf." lacked a clean price fetch and are engineering estimates — confirm before
ordering.*

### Sources
- Adafruit MAX17048 #5580 — price/size/specs: https://www.adafruit.com/product/5580
- Adafruit MAX17048 CircuitPython guide: https://learn.adafruit.com/adafruit-max17048-lipoly-liion-fuel-gauge-and-battery-monitor/python-circuitpython
- `adafruit_max1704x` library (MAX17048 **and** MAX17049/43): https://github.com/adafruit/Adafruit_CircuitPython_MAX1704x
- LC709203F EOL / replaced by MAX17048: https://learn.adafruit.com/adafruit-lc709203f-lipo-lipoly-battery-monitor/python-circuitpython and https://www.adafruit.com/product/4712
- SparkFun Qwiic Fuel Gauge MAX17048 (retired): https://www.sparkfun.com/qwiic-fuel-gauge-max17048.html
- SparkFun MAX1704X hookup (accuracy ±7.5 mV, hibernation): https://learn.sparkfun.com/tutorials/lipo-fuel-gauge-max1704x-hookup-guide/all
- SparkFun MAX1704x Arduino library (covers TOL-20680 MAX17043 + SPX-17715): https://github.com/sparkfun/SparkFun_MAX1704x_Fuel_Gauge_Arduino_Library
- SparkFun BQ27441 (coulomb counter, Arduino/Particle lib only): https://docs.particle.io/reference/device-os/libraries/s/SparkFun_BQ27441/
- DFRobot Gravity 3.7V Li Battery Fuel Gauge DFR0563 (MAX17043): https://wiki.dfrobot.com/dfr0563/
- 7Semi MAX17048 breakouts: https://7semi.com/max17048-lipoly-liion-fuel-gauge-mini-breakout/
- HiLetgo MAX17043 (Amazon budget module): https://www.amazon.com/HiLetgo-MAX17043-Lithium-Battery-Converter/dp/B01NBE99EP
