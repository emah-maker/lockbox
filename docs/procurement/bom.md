# Phone Box — Bill of Materials

**Date:** 2026-07-23 · Prototype quantity, USD.
Two sections: **Current materials** (as-built) and **Battery meter** (fuel-gauge
add-on for accurate battery %).

**Board decision — keep the original board.** We are staying on the
**Waveshare ESP32-S3-Touch-LCD-1.47**. It gives us two things we now need and
don't want to rebuild: **onboard LiPo charging + battery-sense** (charges over
USB-C, no separate charger part) and the **BLE radio** the companion app talks
to. The earlier Sunton board-swap cost-reduction proposal is therefore dropped:
Sunton has no onboard charging (would need a TP4056 + divider added back) and
swapping it carries a full case + firmware redesign — for only a marginal board
saving. Board price basis from the
[supplier shortlist](board-cost-reduction/02-supplier-longlist-and-shortlist-2026-07-19.md)
(read live 2026-07-19). Lines marked *(est.)* are engineering estimates, not
quotes — confirm before ordering.

---

## Current materials

As-built BOM on the retained Waveshare board (~$43.77 per prototype at retail
pricing).

| # | Item | Spec / part | Qty | Unit $ | Line $ | Source |
|---|------|-------------|-----|--------|--------|--------|
| 1 | MCU + display board | **Waveshare ESP32-S3-Touch-LCD-1.47** — 172×320 cap touch, **onboard LiPo charge + batt-sense**, **BLE**, MX1.25 conn | 1 | 24.99 | 24.99 | sourced |
| 2 | Battery | LiPo **2000 mAh** 3.7 V, **103450** (~10×34×50 mm), MX1.25 lead | 1 | 10.95 | 10.95 | est. |
| 3 | Lock actuator | Hobby servo (SG90 class), PWM on GPIO5 | 1 | 3.49 | 3.49 | est. |
| 4 | Buttons / switch | Momentary switch ×2 (lock GPIO1 + override GPIO10) | 2 | 0.50 | 0.99 | est. |
| 5 | Enclosure | 3D-printed Main Case + Lid (filament) | 1 | 2.53 | 2.53 | est. |
| 6 | Wiring / fasteners | JST leads, screws, standoffs, misc | 1 | 0.82 | 0.82 | est. |
| | | | | **Total** | **$43.77** | |

> Charging is **integrated** on the board (firmware reads VBAT via the board's
> 200K/100K divider on GPIO12; charges over USB-C). No separate charger line
> needed. The 3rd case cutout = USB-C access to this board, not a standalone
> charger module.

**Optional cost-down (board retained — no redesign):** these levers still apply
now that the board is fixed. Buying the *same* board from The Pi Hut (~$18.50)
instead of Amazon ($24.99) saves ~$6.49/unit and keeps the onboard charger + BLE.
Bulk-sourcing the est. lines at 10–50 qty (servo → ~$1.50, buttons → ~$0.08 ea,
cell → ~$3.50, wiring → ~$0.50) saves ~$6/unit. Optimizing the print
(15–20% infill, PLA) saves ~$1.20/unit. Moving the lock button on-screen drops
a switch + a case cutout (keep the physical override button for safety).
Together these land the unit at **≈ $28/unit** with zero CAD or firmware
redesign. Battery capacity is a runtime/cost dial: the default **2000 mAh 103450**
cell can drop to a bulk **1000 mAh** (~$3.50) to save ~$7/unit if measured
runtime allows — pick capacity by measured runtime need.

---

## Battery meter — MAX17048 fuel gauge (optional add-on)

*Full analysis: [battery-fuel-gauge shortlist](battery-fuel-gauge/02-supplier-longlist-and-shortlist-2026-07-23.md).*

**Problem:** the current build doesn't measure battery percentage *accurately*.
It reads VBAT through a resistor divider and maps voltage → % with a static
curve (`BAT_CURVE` in `lock_config.py`). The LiPo discharge curve is flat across
~30–80% SoC and servo/backlight load sags the voltage, so the displayed % swings
by ~±10–20% and reads low under load. No firmware tweak removes this — it is a
hardware limitation of voltage-only sensing.

**Fix:** add a **MAX17048 fuel-gauge board** — a ModelGauge IC that fuses coulomb
tracking + voltage + temperature and reports state-of-charge directly (~±1–2%),
with **no sense resistor**. Talks I2C at 0x36 (shares the existing touch bus or a
spare `busio.I2C`; frees GPIO12). CircuitPython support via `adafruit_max1704x`
(`monitor.cell_percent`). At 25.7×20.3×7.2 mm it drops into the battery bay.

| Option | Part | Unit $ | Note |
|---|---|---|---|
| Ready breakout | Adafruit MAX17048 #5580 (JST-PH in/out + Qwiic) | 5.95 | sourced; also Pi Hut / Pimoroni |
| Cheaper breakout | 7Semi MAX17048 mini | ~2–4 (est.) | no Qwiic connectors |
| Cheapest board | Generic MAX17048 module (marketplace) | ~2 (est.) | QC / lead-time risk |
| Volume | Bare MAX17048 IC on custom board | ~1–2 (est.) | production only |

> **This is an accuracy upgrade, not a cost cut** — it *adds* ~$2–6/unit. Take it
> only if accurate % is a product requirement; otherwise the $0 fallback is a
> firmware-only OCV improvement (smoothing + settle-when-idle), which helps but
> cannot fix load sag or the flat curve. Replaces `LC709203F` as the modern pick
> — that chip is EOL (discontinued).

---

## Notes & caveats
- **2000 mAh fits the enclosure (current case):** 103450 (~10×34×50 mm) drops into
  the clear bay window between the charger cutout (ends Z≈53) and the screen
  standoffs (start Z≈112): ≈53 L × 30 W × 18 T mm available, cell uses ~10 mm depth.
- **Cheaper zero-redesign board sourcing:** the *same* incumbent board is ~$18–19
  at The Pi Hut vs. $24.99 Amazon — sourcing switch alone saves ~$6/unit with no
  engineering. Confirm US shipping/duty.
- Est. lines (battery, servo, buttons, enclosure, wiring) are placeholders —
  replace with real quotes before an RFQ.
