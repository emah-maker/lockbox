# Firmware

CircuitPython firmware for the Phone Box, running on a **Waveshare
ESP32-S3-Touch-LCD-1.47** (CircuitPython board id
`waveshare_esp32_s3_touch_lcd_1_47`, CircuitPython 10.x).

## Deploying

This folder mirrors the board's `CIRCUITPY` drive. Copy `code.py`,
`safemode.py` and `lib/` onto it:

```bash
cp -r code.py safemode.py lib /Volumes/CIRCUITPY/
```

CircuitPython auto-reloads on every write. Copy all changed files in one pass
and eject cleanly: rapid writes plus auto-reload can corrupt the FAT filesystem
and leave the drive read-only until the board is replugged.

`boot.py` is a local stub and is not deployed.

## Layout

| File | Role |
|---|---|
| `code.py` | Entry point and main loop: display, touch, backlight, CPU scaling, buttons, BLE |
| `safemode.py` | Brownout auto-recovery (retries via reset, capped by an NVM counter) |
| `lib/lock_config.py` | Every tunable, pin, colour and BLE UUID. **Tune here.** |
| `lib/lock_controller*.py` | The state machine (`idle` / `closed` / `picking` / `confirming` / `running` / `done`), gestures, BLE command handling |
| `lib/lock_ui*.py` | displayio scenes, widgets, theme and hit-testing |
| `lib/lock_ble.py`, `lib/lock_protocol.py` | Custom GATT service and payload encoding (the wire contract with `app/src/ble/protocol.ts`) |
| `lib/lock_servo.py` | Servo driver (re-asserts 50 Hz on every move, holds and then relaxes PWM) |
| `lib/lock_battery.py`, `lib/max17043.py` | Battery reading via the MAX17043 fuel gauge |
| `lib/lock_settings*.py` | NVM-backed persistent settings and the settings screens |
| `lib/lock_log.py` | RAM queue of finished sessions, synced to the app over BLE |
| `lib/axs5106l.py` | Custom I²C driver for the AXS5106L touch controller |
| `lib/adafruit_*` | Vendored Adafruit libraries (third-party, not edited) |

The display panel runs with colour inversion, so `lock_config.fix()`
pre-inverts every colour. Use the `C_*` constants rather than raw hex.

## Testing

The firmware is tested on the desktop by stubbing CircuitPython's hardware
modules. From the repo root:

```bash
python3 tests/run_firmware_tests.py
```

Real verification of anything timing- or power-related still happens on the
device. The full hardware context is in
[`docs/handoff/firmware-ai-context.md`](../docs/handoff/firmware-ai-context.md).
