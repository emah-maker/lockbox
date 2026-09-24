# Project Context — Phone Box

## What this project is
Phone Box is a physical **phone-lockbox product** that helps people focus by
locking a phone inside an enclosure for a set amount of time. The user sets a
timer on a touchscreen; a servo drives a latch that keeps the box shut until the
timer expires (with an override path for emergencies). The goal is a
**market-ready product**, and the current top priority is **minimizing unit cost
while keeping the same functions** as the existing design.

This is a **local project folder**, not a git repository. Keep onboarding and
work output in project/folder terms — there is no remote, issue tracker, or CI
to integrate with.

## Repository / folder layout
- `firmware/` — CircuitPython firmware for the device.
  - `code.py` — main entry point / run loop (touch polling, power & sleep
    policy, CPU scaling, button handling, countdown/animation).
  - `boot.py`, `safemode.py` — boot and brownout-retry safe-mode recovery
    (uses `microcontroller.nvm[0]` as a brownout counter).
  - `lib/` — device modules:
    - `lock_config.py` — **central tunables**: behavior constants, colors,
      the full **GPIO pin map**, the battery gauge address + pack size, servo
      calibration, button pins, and settings-screen option ranges. Start here
      for hardware. (There is no battery curve or divider calibration — those
      constants were deleted with the MAX17043 swap.)
    - `lock_controller.py` — gesture/state machine tying UI, touch, servo,
      timer, and settings together.
    - `lock_ui.py` — display rendering (timer view, clock/countdown, settings,
      unlock animation). Largest module (1763 lines).
    - `lock_servo.py` — servo lock actuator driver (PWM, hold-then-relax).
    - `lock_battery.py` — LiPo state-of-charge via the MAX17043 fuel gauge
      (I2C @ 0x36 on the shared touch bus); receives the bus by injection and
      exposes the same `BatteryReading` shape. Replaced the old ADC
      voltage-divider + voltage-curve estimate.
    - `max17043.py` — minimal raw-`busio` driver for the Maxim MAX17043 fuel
      gauge (VCELL/SOC register reads); no external dependency, mirrors the
      `axs5106l.py` shared-bus `try_lock` convention.
    - `lock_power.py` — backlight / power management.
    - `lock_settings.py` — user settings persisted in NVM.
    - `axs5106l.py` — AXS5106L capacitive touch controller driver.
    - `adafruit_display_shapes/` — vendored display-shapes helper library.
- Enclosure CAD (project root):
  - `Lid.SLDPRT` / `hardware/cad/lid.step`
  - `Main Case.SLDPRT` / `hardware/cad/main-case.step`
  (SolidWorks native + neutral STEP exports.)

## Hardware target
- **MCU / display:** Waveshare **ESP32-S3 Touch LCD 1.47"** development board —
  172×320 panel, 262K colors, AXS5106L touch, 240 MHz dual-core LX7, Wi-Fi/BLE.
  **Note:** the firmware does **not** use Wi-Fi or BLE at all, so the radio is
  currently paid-for but unused.
- **Lock actuator:** external hobby **servo** on a free GPIO (default `GPIO5`),
  locked angle 45°, unlocked 0°.
- **Power:** single-cell **LiPo, 5000 mAh** as of the **v2** build (confirmed by
  Evan, 2026-09-10); `BAT_CAPACITY_MAH` was raised 1000 → 5000 on 2026-08-17
  (commit 7c30823) to match. The 1000 mAh figure in the BOM below is **v1** and
  is not the installed cell. State of charge is read from an add-on
  **MAX17043 fuel gauge** (I2C @ 0x36, shares the touch bus, no new GPIO); the
  board's own `GPIO12` 3:1 divider is no longer used by firmware. The MAX17043 is a **fuel gauge, not a current sensor**, so
  the watts figure remains an estimate. USB-power-aware brightness & sleep.
- **Inputs:** capacitive touchscreen + two physical buttons — a lock/box-state
  sense button (`GPIO1`) and an override button (`GPIO10`); default override is
  25 presses within a timeout to unlock early.
- **No SD card (2026-07-24 decision):** the product will not ship with a TF/SD
  card. The firmware has no on-screen "stats" view and no BLE stats
  characteristic. `lock_log.py` is present and actively maintained: it
  persists a best-effort session-history queue to NVM, feeding only the
  companion app's history sync (see
  `docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md`
  §3.1/§3.2), not an on-device stats view or its own BLE characteristic.
  GPIO13–18 (formerly reserved for 4-bit SDIO) are free
  again. Session history/streaks were never one of the 7 fixed functions
  below, so this is a scope cut, not a cost-down substitution.

## Key functions (the "same functions" constraint for cost-down)
1. Touchscreen H:M:S timer set by vertical swipes (0–9 hours).
2. Servo-driven physical lock that stays shut until the timer expires.
3. Emergency **override** (press-count) to unlock early.
4. USB/battery-aware power management: dim + sleep on battery, bright + always-on
   on USB; CPU frequency scaling to save power.
5. Battery level sensing and display.
6. Persisted user settings (override count, sleep timeout, brightness) in NVM.
7. Brownout-safe boot recovery.

Any cost-reduction proposal must preserve these functions.

## Cost baseline (established 2026-07-19)
Optimization target volume: **prototype quantities**. Functions are
**negotiable** (parts may be substituted if the functions above are preserved).

Estimated per-prototype BOM ≈ **$56.26** (v2). The two v2-only rows are
**market comps priced on Amazon 2026-09-10, not receipts** — Evan's actual
purchase prices are not recorded; swap them in if you get them.

| Component | Basis | Per unit |
|---|---|---|
| Waveshare ESP32-S3 1.47" Touch board | $25 ea | $25.00 |
| 5000 mAh LiPo battery (v2 cell) | est. $13.99 — comp, range $13.59–$14.49 | ~$13.99 |
| MAX17043 fuel gauge breakout (v2 add-on) | est. $9.99 — comp, range $8.32–$11.40 | ~$9.99 |
| ~~1000 mAh LiPo battery~~ (v1, superseded) | $8.49 ea | — |
| Servo (lock actuator) | $4 ea (cheaper at scale) | $4.00 |
| Screws + threaded inserts | $1 / build | $1.00 |
| Hinges ×2 | $4 / 20 → $0.20 ea | $0.40 |
| Tactile buttons ×2 (box-state sense) | $6 / 40 → $0.15 ea | $0.30 |
| On/off button ×1 | $7 / 30 → $0.23 ea | $0.23 |
| Override switch ×1 (momentary, mechanical) | est. panel-mount | ~$0.50 |
| Wires (hookup/dupont, estimate) | est. | ~$0.75 |
| Capacitor ×1 (small) | est. | ~$0.10 |

Assumptions to confirm against a real build: **2 tactile (box-state) + 1 on/off
button + 1 mechanical override switch per unit**, and **~$0.75 of wire**. The
two v2 rows carry the weakest evidence in this table: they are **comparable
listings priced on Amazon on 2026-09-10, not what Evan paid**. Treat them as
order-of-magnitude only, and replace them with the real figures from his order
history if precision matters. (Sizing note: a 5000 mAh single cell comes as
115659 / 955565 / 706090 — the **606090** the 2026-07-19 space study named as an
example tops out near 4000 mAh, so the installed cell is a different footprint
than that doc assumed.) The
override switch is a mounted momentary pushbutton driving `BTN_OVERRIDE_PIN`
(`GPIO10`); estimated higher than the bare tactile buttons because it is a
durable panel-mount part cycled repeatedly (default 25 presses to unlock).

**Cost structure (v2, on the estimates above):** Waveshare board **~44%**,
battery **~25%**, MAX17043 gauge **~18%**, servo **~7%**; everything else
combined **~6%**. This is a real shift from v1's **~62% / ~21% / ~10%**: the
board is no longer the dominant line, and the fuel gauge now costs more than
the servo. Cost reduction still lives mostly in (a) the display/MCU board — a
radio-free or cheaper MCU + display could remove unused Wi-Fi/BLE cost — but
(b) is no longer "battery sizing" as a cut: v2 deliberately went *larger*, and
the earlier note that capacity is a tradeoff rather than a cut is what actually
happened. A third lever now exists: the gauge is a breakout, so a bare
MAX17043 (or folding it onto a custom board) would take most of that ~18%.

## Local workflows
- **No host-runnable build or test suite.** The firmware runs on-device
  (CircuitPython); it cannot be unit-tested on the development PC. "Validation"
  means deploying to the board and observing behavior.
- **Deploy routine:** batch-write **all** changed files to the board, then sync
  — do **not** unplug/replug between files. A read-only `D:` drive is a sign of
  FAT corruption on the board.
