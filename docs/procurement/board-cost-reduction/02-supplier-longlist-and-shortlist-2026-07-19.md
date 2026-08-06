# Board Alternative — Supplier Longlist & Shortlist

**Classification:** BUSINESS CONFIDENTIAL — PROCUREMENT
**Date:** 2026-07-19 · **Job:** supplier-discovery-and-qualification
**Goal:** Cut the dominant Phone Box BOM line — the ~$25 Waveshare ESP32-S3
Touch LCD 1.47" board (~62% of the $40.77 per-prototype BOM) — while preserving
all 7 functions and staying on CircuitPython.

## Requirement set (qualification criteria)
Must-haves (a miss disqualifies):
1. CircuitPython-supported MCU with a working `displayio` build.
2. Integrated color display, usable rectangular area ≈172×320 or larger.
3. **Capacitive** touch on the display (the swipe-set timer depends on it).
4. Free PWM GPIO for the servo.
5. LiPo charging + a battery-voltage ADC path (onboard, or addable).
6. ≥3 free GPIO (2 buttons + override) and NVM for settings.

Cost angle: firmware uses **no Wi-Fi/BLE**, so a radio-free MCU pays for nothing
unused. Geography: US hobby/prototype channels. Pricing basis: prototype quantity.

## Incumbent
**Waveshare ESP32-S3-Touch-LCD-1.47** — 172×320, AXS5106L capacitive touch,
Wi-Fi/BLE (unused), official CircuitPython `waveshare_esp32_s3_touch_lcd_1_47`.
**$24.99** ([Amazon B0F8B8JF74](https://www.amazon.com/Waveshare-Development-Resolution-Dual-core-Processor/dp/B0F8B8JF74)).

## Longlist (14 candidates, by channel)

| Board | Channel | MCU (radio) | Display | Touch (cap?) | LiPo chg / batt sense | CircuitPython | Price (USD) |
|---|---|---|---|---|---|---|---|
| Sunton ESP32-2432S024C (2.4") | budget vendor | ESP32 (WiFi/BLE) | 2.4" 240×320 ILI9341 SPI | CST820 (yes) | no / no | **official build** | ~$13–18 |
| Sunton ESP32-2432S032C (3.2") | budget vendor | ESP32 (WiFi/BLE) | 3.2" 240×320 SPI | GT911 (yes) | no / no | **official build** | ~$15–20 |
| Sunton ESP32-2432S028R (CYD) | budget vendor | ESP32 (WiFi/BLE) | 2.8" 240×320 ILI9341 | XPT2046 (**resistive**) | no / no | official build | ~$10–15 |
| LILYGO T-Display-S3 **Touch** | OEM-direct | ESP32-S3 (WiFi/BLE) | 1.9" 170×320 ST7789 | CST816 (yes) | TP4054 / IO4 | **official build** | $20–36 (volatile) |
| Waveshare RP2040-Touch-LCD-1.28 | OEM-direct | RP2040 (**no radio**) | 1.28" **round** 240×240 | CST816S (yes) | yes / unconfirmed | **official build** | $22.99 direct |
| Waveshare RP2350-Touch-LCD-1.28 | OEM-direct | RP2350 (**no radio**) | 1.28" **round** 240×240 | CST816S (yes) | yes / **yes (demo)** | **official build** | ~$24–27 |
| Waveshare ESP32-S3-Touch-LCD-2 | OEM-direct | ESP32-S3 | 2.0" 240×320 | CST816D (yes) | yes / — | official build | $25.99 |
| Guition JC2432W328C | budget vendor | ESP32 | 2.8" 240×320 ST7789 SPI | CST820 (yes) | unconfirmed | no build; bring-up feasible | ~$13–18 |
| Guition JC3248W535C | budget vendor | ESP32-S3 | 3.5" 320×480 **QSPI** | AXS15231B (yes) | onboard chg | **none (QSPI unsupported)** | ~$17 |
| Elecrow CrowPanel 2.4/2.8" | budget vendor | ESP32 | 240×320 ST7789 SPI | varies | onboard chg | no build; bring-up feasible | $16–25+ |
| Waveshare RP2350-Touch-LCD-2.8 | OEM-direct | RP2350 (no radio) | 2.8" 240×320 | 5-pt cap (yes) | yes / — | no build (custom def) | $28.95 |
| Adafruit ESP32-S3 Reverse TFT Feather | reference | ESP32-S3 | 1.14" 240×135 | **none** | yes / MAX17048 | first-class | $24.95 |
| Adafruit PyPortal | reference | SAMD51+ESP32 | 3.2" 320×240 | resistive | no / no | first-class | $54.95 |
| Pimoroni Presto | OEM-direct | RP2350B (WiFi) | 4" 480×480 | cap (yes) | no / no | none (MicroPython) | ~$74 |

## Shortlist scorecard
Weights: technical fit (cap touch + rect screen + PWM) 35% · CircuitPython quality
25% · cost reduction 20% · battery integration 12% · supply risk 8%.

| # | Board | Price | Cost outcome | Verdict |
|---|---|---|---|---|
| 1 | **Sunton ESP32-2432S024C** | ~$15 | board line ~$25 → ~$16.5 all-in (adds ~$1.5 charger/divider) → **saves ~$8–9/unit (~20% of BOM)** | **Primary.** Official CircuitPython, CST820 capacitive, 240×320 (larger than incumbent), free PWM. Only gap = no onboard battery hardware. |
| 2 | Sunton ESP32-2432S032C | ~$18 | saves ~$5–6/unit | Backup; larger 3.2" GT911. |
| 3 | ~~LILYGO T-Display-S3 Touch~~ | ~$37 (confirmed) | **not a cost win** | **Dropped:** live US price $36.95–38.95 (ProtoSupplies) and sold out at lilygo.cc US — dearer than the incumbent. |
| 4 | Waveshare RP2350-Touch-LCD-1.28 | ~$24 | ~$1–3 saving, radio-free | Only if radio-free is prioritized over UI; **1.28" round screen is a real UI-fit risk**. |

## Purchase links (checked 2026-07-19)
Only prices read live on the listing are quoted as exact; Amazon/waveshare.com
block price scraping (URL confirmed to resolve to the right product, price ~typical).

| Board | Buy link(s) | Price | Stock / note |
|---|---|---|---|
| **Sunton ESP32-2432S024C** (2.4" cap) | [Amazon US — DIYmalls](https://www.amazon.com/DIYmalls-ESP32-2432S024C-Capacitive-ESP-WROOM-32-Development/dp/B0CLGD2DG6) | ~$15 (not live-readable) | Confirm it's the **C** (capacitive) SKU |
| **Sunton ESP32-2432S032C** (3.2" cap) | [Amazon US — DIYmalls](https://www.amazon.com/DIYmalls-ESP32-2432S032C-I-Capacitive-ESP-WROOM-32-Development/dp/B0CLGDHS16) | ~$18 (not live-readable) | Capacitive IPS confirmed |
| Waveshare RP2350-Touch-LCD-1.28 | [The Pi Hut](https://thepihut.com/products/rp2350-mcu-board-with-1-28-round-touch-ips-lcd) · [Waveshare](https://www.waveshare.com/rp2350-touch-lcd-1.28.htm) | **£18.30 (~$23)** live | In stock; round screen |
| Waveshare RP2040-Touch-LCD-1.28 | [The Pi Hut](https://thepihut.com/products/rp2040-microcontroller-with-a-1-28-round-touch-lcd) · [Waveshare](https://www.waveshare.com/rp2040-touch-lcd-1.28.htm) | **£22.10 (~$28)** live | ~16 units left |
| ~~LILYGO T-Display-S3 Touch~~ | [ProtoSupplies (US)](https://protosupplies.com/product/lilygo-t-display-s3-touch/) · [lilygo.cc](https://lilygo.cc/products/t-display-s3) | **$36.95–38.95** live | **Not a cost win** — dearer than incumbent; sold out at lilygo US |
| **Incumbent** ESP32-S3-Touch-LCD-1.47 | [The Pi Hut](https://thepihut.com/products/esp32-s3-1-47-touch-display-dev-board-with-sd-slot) · [Amazon US](https://www.amazon.com/Waveshare-Development-Resolution-Dual-core-Processor/dp/B0F8B8JF74) | **£14.40 (~$18–19)** live @ Pi Hut vs ~$25 Amazon | See note below |

> **Cheap win, zero redesign:** the *same* incumbent board is **£14.40 (~$18–19)** at
> The Pi Hut vs. the ~$25 Amazon basis — sourcing the current board from a cheaper
> channel saves ~$6/unit with no engineering work. Confirm US shipping/duty on the order.

## CAD check — can a larger battery fit?
Measured from the STEP files (units = mm; bounding box of part geometry):
- **Main Case:** ≈ **196 × 195 mm footprint**, wall height **~27 mm** (usable interior
  depth ~20–25 mm after floor/lid clearance), interior footprint ~190 × 190 mm after walls.
- **Lid:** ≈ 130 × 27 mm raised section (closes over the case).

**Conclusion: space is not the constraint.** The current 1000 mAh cell (~50×34×5 mm)
uses a tiny fraction of a ~190×190 mm floor. A phone occupies only part of that
footprint, leaving large free area beside it. A much larger LiPo fits easily — the
only tight axis is **thickness** (~15–20 mm of depth realistically available after the
phone + servo/latch mechanism), and high-capacity flat cells are typically 6–12 mm
thick. So capacity can grow substantially (roughly **2000–5000 mAh**, e.g. a 606090 /
~4000 mAh pack) on space alone. Practical limits become the board's charge current,
cost, and weight — **not** the enclosure.

*Caveat:* this is envelope-level from the STEP point geometry; I can't see the exact
internal pocket, phone cradle, or servo clearance without SolidWorks. Confirm the free
pocket beside the phone and the servo swing before finalizing a specific cell.

## Exclusions (do not re-litigate)
- **Sunton 2432S028R** — resistive touch fails the swipe UI.
- **Guition JC3248W535 / VIEWE AMOLED** — QSPI displays; CircuitPython `displayio` has no QSPI support.
- **Guition JC2432W328C / Elecrow CrowPanel** — no official CircuitPython build (custom bring-up); fallback only.
- **Waveshare ESP32-S3-Touch-LCD-2** ($26), **RP2350-2.8** ($29, no build), **Adafruit Reverse Feather** ($25, no touch), **PyPortal** ($55), **Pimoroni Presto** ($74, no CircuitPython) — fail cost and/or a must-have.

## Risk register (recommended path: Sunton 2432S024C)
| Risk | Severity | Mitigation |
|---|---|---|
| Free-GPIO scarcity on CYD boards | High | Prototype must confirm ≥4 free pins (servo PWM + 2 buttons + override) **and** a free ADC before committing. |
| No onboard LiPo charge/battery sense | Medium | Add external TP4056 + ~3:1 divider (~$1.50); re-implement USB-power detection. |
| Touch driver port AXS5106L → CST820 | Low | CircuitPython CST8xx libs exist; repoint `lock_controller.py` gesture logic. |
| UI re-layout 172×320 → 240×320 | Medium | Rework `lock_ui.py` layout constants (more area available). |
| Budget-vendor revision/pin drift | Medium | Buy from a named reseller; lock SKU/revision. |

## Recommended next step
**Buy one Sunton ESP32-2432S024C (~$15) for a bench prototype/demo** to validate
free-GPIO count, `displayio` + CST820 touch bring-up, and the battery add-on
**before** switching the design. This is a technical-validation demo, not an RFQ
(off-the-shelf part, prototype quantity).

## Sources
- Incumbent price: [Amazon B0F8B8JF74](https://www.amazon.com/Waveshare-Development-Resolution-Dual-core-Processor/dp/B0F8B8JF74) · CircuitPython [waveshare_esp32_s3_touch_lcd_1_47](https://circuitpython.org/board/waveshare_esp32_s3_touch_lcd_1_47/)
- Sunton 2432S024C: [circuitpython.org board](https://circuitpython.org/board/sunton_esp32_2432S024C/) · 2432S032C: [board](https://circuitpython.org/board/sunton_esp32_2432S032C/) · 2432S028R: [board](https://circuitpython.org/board/sunton_esp32_2432S028/) · [Random Nerd CYD](https://randomnerdtutorials.com/cheap-yellow-display-esp32-2432s028r/)
- LILYGO T-Display-S3: [CircuitPython](https://circuitpython.org/board/lilygo_tdisplay_s3/) · [Touch specs (espboards)](https://www.espboards.dev/esp32/lilygo-t-display-s3-touch/) · [lilygo.cc](https://lilygo.cc/products/t-display-s3)
- Waveshare RP2040-1.28: [CircuitPython](https://circuitpython.org/board/waveshare_rp2040_touch_lcd_1_28/) · RP2350-1.28: [CircuitPython](https://circuitpython.org/board/waveshare_rp2350_touch_lcd_1_28/) · ESP32-S3-Touch-LCD-2: [CircuitPython](https://circuitpython.org/board/waveshare_esp32_s3_touch_lcd_2/)
- Guition JC3248W535 (QSPI/no CircuitPython): [atomic14](https://www.atomic14.com/esp32/boards/guition-jc3248w535/) · JC2432W328: [maxpill/JC2432W328](https://github.com/maxpill/JC2432W328)
- Adafruit Reverse TFT Feather: [product 5691](https://www.adafruit.com/product/5691) · PyPortal: [4116](https://www.adafruit.com/product/4116) · Pimoroni Presto: [shop](https://shop.pimoroni.com/en-us/products/presto)

**Note on prices:** Amazon/reseller figures read live 2026-07-19 and fluctuate;
waveshare.com/lilygo.cc/pimoroni.com JS-render or block automated fetch, so some
direct prices are inferred from resellers — confirm direct pricing before purchase.
