# Phone Box — Battery Fuel-Gauge Board: Longlist & Shortlist

**Date:** 2026-07-23 · Prototype quantity, USD. **BUSINESS CONFIDENTIAL — PROCUREMENT**

## Objective
Find a small board to **accurately measure battery percentage** (state-of-charge, SoC)
for the Phone Box, replacing the current voltage-only estimate.

## Why the current method is inaccurate (the real problem)
The incumbent Waveshare board has **no fuel gauge** — `lock_battery.py` reads VBAT
through a 200K/100K divider on GPIO12 and maps that voltage to a percent with a
static open-circuit-voltage curve (`BAT_CURVE` in `lock_config.py`).

Two structural limits no firmware tweak removes:
1. **Flat LiPo curve.** From ~3.75–3.95 V the cell sits nearly flat across ~30–80%
   SoC, so a small voltage error is a large percent error.
2. **Load sag.** The servo actuation and backlight pull current; IR drop makes the
   loaded voltage read low, so the percent sags and jumps under load. The code
   already band-aids this (EMA smoothing, a `BAT_CHG_COMP` charging fudge) —
   evidence the method is being fought, not trusted.

So this is a **hardware accuracy gap**, not a missing feature. A dedicated
**fuel-gauge IC** (ModelGauge-class) fuses coulomb tracking + voltage + temperature
and outputs a stable SoC that recovers from load transients — typically **±1–2%**
vs. the ±10–20% swings a loaded voltage divider gives.

> **Objective-behind-the-request check:** the cheapest path to "better %" is
> firmware-only (smooth harder, settle the reading when idle). It is free but has a
> hard accuracy ceiling — it can never fix load sag or the flat curve. If "accurate"
> is a real product requirement, it needs the gauge IC. Both paths are on the table below.

---

## Longlist (broad channel scan)

| # | Part | Channel | Method | Sense resistor | I2C | CircuitPython | Notes |
|---|------|---------|--------|----------------|-----|---------------|-------|
| 1 | **MAX17048** (ADI/Maxim) | OEM IC + many breakouts | ModelGauge (V + coulomb fusion, temp comp) | **No** | 0x36 | **Yes** — `adafruit_max1704x` | Modern single-cell standard; reports % directly |
| 2 | LC709203F (onsemi) | OEM IC | HG-CVR, ±3% | No | Yes | Yes (`adafruit_lc709203f`) | **EOL** — onsemi discontinued; Adafruit board retired |
| 3 | MAX17260 (ADI) | OEM IC | ModelGauge m5 EZ | **Yes** (external) | Yes | Partial | Higher accuracy under heavy load; more parts |
| 4 | MAX17043 / MAX17044 (ADI) | OEM IC | ModelGauge (older) | No | Yes | Yes | Superseded by MAX17048 (worse V accuracy) |
| 5 | LTC4150 coulomb counter | breakout | Pure coulomb count | Yes | No (pulse) | n/a | Relative charge, needs reset — not absolute SoC |
| 6 | Adafruit MAX17048 breakout (#5580) | reseller (Adafruit/Pi Hut/Pimoroni) | = #1 | No | 0x36 | Yes | $5.95, JST-PH in/out + STEMMA QT |
| 7 | 7Semi MAX17048 mini breakout | reseller (Robocraze/Evelta) | = #1 | No | 0x36 | Yes | Cheaper bare breakout, no Qwiic connectors |
| 8 | Generic MAX17048 module | marketplace (Amazon/AliExpress) | = #1 | No | 0x36 | Yes | Cheapest ready board; QC/lead-time risk |
| 9 | SparkFun Qwiic MAX17048 (SPX-17715) | reseller | = #1 | No | 0x36 | via lib | **Retired** — no longer stocked |

---

## Shortlist (scorecard)

Weighted for this project: **accuracy**, **integration effort on the existing board**,
**size/fit**, **cost** (prime directive is cost-down, so a $ add is a real cost).

| Candidate | Accuracy | Integration | Size/fit | Unit cost | Verdict |
|-----------|----------|-------------|----------|-----------|---------|
| **MAX17048 breakout** (Adafruit #5580) | ★★★★★ ±1–2%, no sense R | ★★★★★ I2C 0x36, shares touch bus, frees GPIO12 | ★★★★★ 25.7×20.3×7.2 mm | $5.95 (proto) → ~$2–4 (7Semi/generic) → ~$1–2 bare IC at volume | **PRIMARY** |
| Firmware-only OCV improvement | ★★☆☆☆ ceiling-limited | ★★★★★ no hardware change | n/a | **$0** | **Fallback if accuracy isn't a hard spec** |
| MAX17260 + sense resistor | ★★★★★ best under load | ★★★☆☆ sense R + layout | ★★★★☆ | ~$3–6 IC + R | Overkill; only if heavy-load accuracy matters |

### Primary recommendation — **MAX17048 fuel-gauge breakout**
- **Accuracy:** ModelGauge outputs SoC directly; no sense resistor, no per-cell
  characterization ("EZ" config). Recovers from servo/backlight load transients.
- **Size / fit:** 25.7 × 20.3 × 7.2 mm — drops into the enclosure battery bay
  (prior CAD read: ≈53 L × 30 W × 18 T mm free). No case change expected; confirm on the print.
- **Integration:** wires **in-line with the cell** (cell → gauge → board). Talks
  I2C at **0x36** — can share the existing AXS5106L touch I2C bus or a spare
  `busio.I2C` on two free GPIO. **Frees GPIO12** (the current ADC sense pin).
- **Firmware:** replace the ADC read in `lock_battery.py` with
  `adafruit_max1704x` → `monitor.cell_percent` / `monitor.cell_voltage`; delete
  `BAT_DIVIDER` / `BAT_CURVE` / `BAT_CHG_COMP` calibration. Net simplification.
- **Sourcing:** Adafruit #5580 **$5.95** (also Pi Hut / Pimoroni). Cheaper bare
  boards: 7Semi (~$2–4), generic marketplace (~$2). Bare IC ~$1–2 at volume.

---

## Exclusions (do not re-litigate)
- **LC709203F** — **EOL**; onsemi discontinued and Adafruit retired the board.
  Do not design a new product around an end-of-life part.
- **SparkFun Qwiic MAX17048 (SPX-17715)** — retired / not stocked. Same chip as
  the primary pick, so buy the Adafruit or a generic MAX17048 instead.
- **MAX17043/44** — superseded by MAX17048; no reason to pick the older part.
- **LTC4150 / bare coulomb counters** — measure relative charge and need a reset;
  they don't give an absolute percentage, which is the whole ask.
- **A second/bigger MCU board** — not needed; the gauge is a small add-on IC.

## Risks & flags
- **This is an accuracy upgrade, not a cost cut** — it *adds* ~$2–6/unit against a
  project whose prime directive is lower unit cost. Recommend only if accurate %
  is a product requirement; otherwise take the $0 firmware fallback.
- **Prices read live 2026-07-23** (Adafruit $5.95 confirmed; 7Semi/generic/volume
  figures are estimates — confirm exact SKUs/quantities before an RFQ).
- **I2C bus sharing** with the touch controller is expected to work (different
  address) but is **unconfirmed on this exact board** — validate on the bench, or
  fall back to a dedicated `busio.I2C` on two free GPIO.
- **Fit** is from a prior CAD read of the battery bay, not a physical trial — dry-fit before committing.

## Sources
- [Adafruit MAX17048 breakout (#5580) — $5.95, 25.7×20.3×7.2 mm](https://www.adafruit.com/product/5580)
- [adafruit_max1704x CircuitPython library (cell_percent / cell_voltage, addr 0x36)](https://github.com/adafruit/Adafruit_CircuitPython_MAX1704x)
- [MAX17048 product page (Analog Devices)](https://www.analog.com/en/products/max17048.html)
- [MAX17260 product page (Analog Devices)](https://www.analog.com/en/products/max17260.html)
- [LC709203F specs / status](https://datacapturecontrol.com/articles/io-components/sensors/voltage/lc709203f)
- [7Semi MAX17048 mini breakout](https://7semi.com/max17048-lipoly-liion-fuel-gauge-mini-breakout/)
- [SparkFun Qwiic MAX17048 (SPX-17715) — retired](https://www.sparkfun.com/qwiic-fuel-gauge-max17048.html)
