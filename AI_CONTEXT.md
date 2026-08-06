# Phone Box — AI Handoff / Context

Context for another AI instance continuing this project. Written 2026‑07 by the
prior assistant. Reflects the deployed state of the code in `Box-code/`.

---

## 1. What this is

A **CircuitPython touchscreen phone‑lock box**: a timed lock. You set a duration,
it drives a **servo** to physically lock a lid, counts down, and unlocks when the
timer ends (or via a manual override). Runs on battery or USB.

- **Board:** Waveshare **ESP32‑S3‑Touch‑LCD‑1.47** (board id `waveshare_esp32_s3_touch_lcd_1_47`)
- **Firmware:** Adafruit **CircuitPython 10.2.1**
- **Display:** 172×320 ST7789, `board.DISPLAY`. **The panel runs with colour
  inversion**, so `lock_config.fix(c) = 0xFFFFFF ^ c` pre‑inverts every colour.
  Always use the `C_*` constants; never raw hex.
- **Touch:** AXS5106L capacitive controller, I²C addr `0x63` on `board.TOUCH_I2C()`
  (GPIO41/42), reset on `board.TOUCH_RST`. Custom driver `lib/axs5106l.py`.

---

## 2. Deploy workflow (IMPORTANT — read before writing to the device)

- **Edit the copy in `Box-code/`**, then copy to the device drive **`D:\`**
  (CIRCUITPY). `Box-code/` is the source of truth (in OneDrive); `D:` is the board.
- **Routine:** compile‑check every file with `python -m py_compile`, then
  **batch‑copy all changed files in one pass**, `sync`, and **md5‑verify** each
  (compare `Box-code/...` vs `/d/...`). Use the Bash tool (Git Bash): `D:` is `/d`.
- **`D:` frequently goes read‑only** ("Read‑only file system") — that's **FAT
  corruption** on the board from rapid writes + CircuitPython auto‑reload. Recovery
  is user‑side: replug / press RESET, or elevated `chkdsk D: /f`. It usually comes
  back writable. Don't fight it; surface it and wait.
- **Mid‑write disconnect can truncate a file to 0 bytes** (happened once to
  `lock_controller.py`). If a copy errors with "No such device," re‑verify/re‑deploy
  once writable and check the file isn't 0 bytes.
- CircuitPython **auto‑reloads** on file write. `safemode.py` auto‑recovers from
  brownout (see §6).
- There is **no build/test suite**; `py_compile` is syntax‑only (board‑only modules
  like `board`, `pwmio`, `displayio` can't be imported on desktop, so that's the
  right check). Real verification is on‑device by the user.

---

## 3. Files

Root of `Box-code/` (→ `D:\`):
- **`code.py`** — entry point + main loop. Creates display, touch, backlight,
  controller. Reads touch, drives CPU scaling + backlight/sleep policy, runs the
  buttons, calls `ctrl.process()` and `ctrl.update()`.
- **`safemode.py`** — brownout auto‑recovery (runs when CircuitPython enters safe
  mode; resets to retry, capped via NVM byte 0).
- **`boot.py`** — local stub only; NOT on the device (there is no boot.py on `D:`).

`Box-code/lib/`:
- **`lock_config.py`** — all tunables, colours, `fmt_hms`, `batt_pct`. **Tune here.**
- **`lock_controller.py`** — state machine, gesture handling, view/nav, buttons,
  servo/battery/settings wiring.
- **`lock_ui.py`** — all displayio scenes (views) + hit‑testing + display helpers.
- **`lock_battery.py`** — battery reader (`Battery`, `BatteryReading`).
- **`lock_servo.py`** — servo driver (`Servo`).
- **`lock_settings.py`** — persistent user settings (`Settings`, NVM‑backed).
- **`lock_power.py`** — `Backlight` (display.brightness on/off + level).
- **`axs5106l.py`** — touch driver.
- Adafruit `.mpy` libs: `adafruit_display_text/`, `adafruit_display_shapes/`
  (rect, roundrect, circle, line, etc.). These are third‑party compiled; not edited.

Keep files < 500 lines (project rule). Read a file before editing it.

---

## 4. State machine (`lock_controller.py`)

States: **`idle`**, **`closed`**, **`running`**, **`done`**.

- **idle** — unlocked. Set the time by swiping up/down on the H / M / S columns
  (hours ±1, minutes ±`MIN_STEP`=5, seconds ±`SEC_STEP`=5). On‑screen **LOCK**
  button → `go_running` (timed lock). Tapping the top **status bar** (shows
  "UNLOCKED") → `go_closed`. The **sensor button** (GPIO1) → `go_closed`.
- **closed** — sensor/status initiated. Servo is driven to the lock angle; screen
  shows the time‑set UI ("CLOSED", amber status) with a **LOCK** button. Swipe
  H/M/S still sets the time. **LOCK** → `go_running`. Tapping the status bar →
  `go_idle` (open). It does NOT count down by itself.
- **running** — timed lock counting down. Servo locked. **No on‑screen cancel**
  (deliberate). Unlock only by the **override button** (see below) or timer expiry.
- **done** — unlocked/finished. If `auto_open` ON: servo already released, the
  "UNLOCKED" animation **auto‑dismisses after `DONE_ANIM_S`=2 s** → idle (no
  button). If `auto_open` OFF: servo **stays held shut**, screen shows an **OPEN**
  button → tap → `go_idle` (releases). After timer/override the **sensor is
  ignored** until you return to idle (RESET/OPEN/status), so a still‑pressed
  sensor can't instantly re‑lock.

**Override button (GPIO10):** press it `settings.override_presses` times (default
25) while running/closed → force unlock → `go_done`. An on‑screen counter overlay
("N/target") shows progress; if you don't press again within `OVERRIDE_TIMEOUT`
=3 s the counter resets and the overlay clears. Pressing it also wakes the screen.

`press_lock()` (sensor) only acts from **idle** (→ `go_closed`); ignored otherwise.

---

## 5. Views & navigation

Top‑level views in `VIEWS = ("clock", "control", "battery", "settings")`.
Horizontal swipe moves between them (control is the home/boot view):
`clock ← control → battery → settings`.

- **control** — the timer/lock screen (idle/closed/running/done all render here).
- **clock** — countdown display with 3 styles, **swipe up/down to cycle**:
  `analog` (white face, hands via a persistent bitmap + `bitmaptools.draw_line`),
  `digital` (big LCD readout), `ring` (dark 270° arch gauge with a gliding tip).
  Hands/gauge derive from fractional remaining time; refreshed at `CLOCK_FPS`=25.
- **battery** — voltage, %, charging state, and a rough watts estimate (see §7).
- **settings** — one page, 4 rows: **Override, Auto‑open, Sleep, Bright**. Tap a
  row → its **detail page** (big value + on‑screen **[−] / [+]** buttons; swipe
  up/down also works; **swipe left = back**). **Auto‑open is a tap‑to‑toggle row**
  (no detail page). Values persist to NVM.

Overlays (not in VIEWS, swapped in via root_group): the **override counter** and
the **setting detail** page. `_editing`/`_edit_idx` track the detail page.

---

## 6. code.py main loop & power policy

Per loop: read USB state → set backlight level + wake policy → **CPU scaling** →
read touch → process touch/gesture → run buttons → `ctrl.update()` → sleep.

- **CPU:** `CPU_FAST`=240 MHz whenever the **screen is on**; `CPU_SLOW`=80 MHz when
  **asleep**. Set only when the target changes (`_cpu_target`) so touch/servo are
  never disrupted by a mid‑interaction clock switch. (Earlier per‑screen scaling
  and a 40 MHz tier were removed — they glitched the servo PWM and touch.)
- **Backlight:** brightness = `settings.bright_level()` in **both** USB and battery
  modes. On USB the screen **stays on**; on battery it sleeps after
  `settings.sleep_s`. `lock_power.Backlight.set_level()` only writes when changed.
- **Loop sleep:** 0.02 s screen‑on, 0.1 s asleep (fast enough asleep to catch a
  button press so buttons wake the screen).
- **safemode.py:** on `SafeModeReason.BROWNOUT`, increments NVM[0] and resets to
  retry (cap 5); `code.py` clears NVM[0] on a successful normal boot.

---

## 7. Battery (`lock_battery.py`) — real hardware constraints

- The board has **NO fuel gauge and NO current sensor**. Battery voltage is on an
  onboard **200K/100K divider (net BAT_ADC) → GPIO12**, an internal **ADC2** net
  (not on the header; resolved via `microcontroller.pin.GPIO12`). Confirmed from
  the board schematic + the CircuitPython board definition.
- **The cell is a standard 1000 mAh LiPo (PL102050):** full **4.2 V**, nominal
  3.7 V (the label number — NOT full), BMS cutoff 2.75 V, max charge 500 mA.
- **Calibration:** the raw ADC under‑reads; `BAT_DIVIDER=3.41` is calibrated so a
  full cell reads ~4.2 V. If it's off, tweak proportionally:
  `new = 3.41 × 4.2 / (your full reading)`. Best done against a multimeter.
- **%** via `BAT_CURVE` (standard LiPo curve, 4.2 V=100% … 3.45 V=0%). Charging
  detected via `supervisor.runtime.usb_connected` (or a rising voltage trend);
  while charging, `BAT_CHG_COMP`=0.12 V is subtracted before mapping % (the charger
  holds voltage elevated, so voltage‑only over‑reads).
- **Watts is a coarse estimate** from the discharge rate (`BAT_CAPACITY_MAH`=1000),
  labelled "(est)". True watts is impossible without a current sensor — an
  **INA219/INA226** on the I²C bus (GPIO41/42, addr 0x40) would give real V + A + W.
- Note: `BAT_PIN_CANDIDATES`/`BAT_VALID_*` are legacy from an auto‑detect phase
  (now unused since the pin is fixed to GPIO12). Harmless.

---

## 8. Servo (`lock_servo.py`)

- External hobby servo. **Signal on GPIO5** (`SERVO_PIN`; any free non‑strapping
  GPIO works). **Power the servo from VBAT or VBUS, NOT 3V3** (a servo can pull
  0.5–1 A; 3V3 can't). **Common ground** with the board; a **470–1000 µF cap**
  across the servo V+/GND is recommended (absorbs inrush → avoids brownout).
- **Angles are fixed:** `SERVO_LOCK_ANGLE=45`, `SERVO_UNLOCK_ANGLE=0` (removed from
  settings per user request). `move(angle)` maps −90..90 → `SERVO_MIN_US`(500)..
  `SERVO_MAX_US`(2500) µs at 50 Hz.
- **PWM is `variable_frequency=True` and re‑asserts 50 Hz on every move and each
  loop while active** — this is the fix for intermittent servo failures caused by
  CPU‑clock changes shifting the PWM timer.
- After a move the servo **relaxes** (`duty=0`) after `SERVO_HOLD_S`=1.0 s to save
  power — EXCEPT in `done` with auto‑open OFF, where it re‑engages and **holds**
  shut (no relax) until OPEN is tapped.
- Wired hooks: `engage_lock()` → move to LOCK; `release_lock()` → move to UNLOCK.

---

## 9. Buttons

- **Sensor / lock button → GPIO1** (`BTN_LOCK_PIN`). From idle → `go_closed`.
- **Override button → GPIO10** (`BTN_OVERRIDE_PIN`). ×N presses → unlock.
- Both wired **button → GPIO → GND**, internal pull‑ups (`switch_to_input(pull=UP)`,
  pressed = LOW). Edge‑detected in `code.py`. A press also wakes the screen.
- Avoid ESP32‑S3 **strapping pins (GPIO0/3/45/46)** for buttons/servo.

---

## 10. Settings & persistence (`lock_settings.py`)

`Settings` fields: `override_presses`, `auto_open`, `sleep_s`, `bright_pct`.
- **Persisted in NVM** (`microcontroller.nvm`) so they survive power‑off without a
  host‑writable filesystem. Layout: byte 0 = brownout counter (safemode); bytes
  8..12 = magic + the 4 settings. **`_MAGIC=0x5D`** — bump it whenever the NVM
  layout changes (forces defaults once; the user re‑sets settings that one time).
- `adjust(idx, direction)` (numeric rows, from +/−/swipe); `toggle_auto()`
  (Auto‑open row). Option ranges: `OVR_MIN/MAX/STEP`=10/100/10, `SLEEP_OPTIONS`,
  `BRIGHT_OPTIONS` (min 10%).

---

## 11. Touch responsiveness

- **Release debounce:** the AXS5106L intermittently drops a frame mid‑touch;
  `process()` requires `RELEASE_FRAMES`=2 consecutive empty reads before treating
  it as a real release, so taps/swipes aren't chopped up. This was the fix for
  "settings not responsive" (CPU was already maxed).
- Touch coords are mapped by `_map()` (`INVERT_X=True`) to match the display;
  hit‑tests (`in_button`, `in_status`, `in_setting_plus/minus`, `settings_row_at`)
  use those mapped coords.

---

## 12. Known limitations / gotchas

- **Red power LED can't be turned off in software** — it's a hardwired power/charge
  indicator on the 5 V rail / charger STAT pin, not on a GPIO. Physical removal
  (desolder the LED or its resistor) is the only way.
- **Watts** = estimate only (no current sensor); INA219 needed for real values.
- **`display.brightness`** may be on/off‑only on this panel rather than true PWM
  dimming — if intermediate `Bright` settings don't visibly dim, the fix would be
  driving the backlight pin (GPIO46/LCD_BL) directly with `pwmio`. (Untested.)
- **`D:` read‑only / FAT corruption** recurs (see §2).
- The **swarm/claude‑flow MCP** in this repo's `CLAUDE.md` was frequently
  disconnected; most work was done with built‑in tools directly. Use whatever
  works.

---

## 13. User preferences (from the working relationship)

- Prefers **plain markdown + in‑conversation** answers; no formal doc/report
  surfaces unless asked.
- Iterates fast and tests on real hardware; give a concrete **test checklist**
  after each change and be honest about hardware limits (don't ship fake readings).
- Deploy = the batch‑write + md5‑verify routine in §2. Wait for "write" when `D:`
  is read‑only rather than retrying blindly.

---

## 14. Quick reference — key config knobs (`lib/lock_config.py`)

| Knob | Value | Meaning |
|------|-------|---------|
| `SERVO_PIN` / lock / unlock | GPIO5 / 45° / 0° | servo signal + fixed angles |
| `SERVO_HOLD_S` | 1.0 | servo hold before relax |
| `BTN_LOCK_PIN` / `BTN_OVERRIDE_PIN` | GPIO1 / GPIO10 | buttons |
| `OVERRIDE_PRESSES` / `OVR_*` | 25 / 10‑100 step 10 | override count (settable) |
| `BAT_SENSE_PIN` / `BAT_DIVIDER` | GPIO12 / 3.41 | battery ADC + calibration |
| `BL_LEVEL` / `BRIGHT_OPTIONS` | 0.5 / 10‑100% | backlight |
| `INACTIVITY_S` / `SLEEP_OPTIONS` | 20 / 10‑60 s | screen sleep |
| `CPU_FAST` / `CPU_SLOW` | 240 / 80 MHz | on / asleep |
| `MIN_STEP` / `SEC_STEP` | 5 / 5 | time‑set steps |
| `RELEASE_FRAMES` | 2 | touch debounce |
| `_MAGIC` (lock_settings) | 0x5D | bump on NVM layout change |
