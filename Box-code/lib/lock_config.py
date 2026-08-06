# lock_config.py -- tunables, colors, and small shared helpers.

# ----- Behavior -----
MAX_HOURS = 9                 # hours selectable (0..9)
MAX_SECONDS = MAX_HOURS * 3600
DEFAULT_SECONDS = 5 * 60      # time shown on boot (5:00)
SEC_STEP = 5                  # seconds change per swipe on the S column
MIN_STEP = 5                  # minutes change per swipe on the M column
SWIPE_MIN_PX = 35             # min vertical travel to count as a swipe
RELEASE_FRAMES = 2            # consecutive empty touch reads before a "release"
ANIM_HZ = 4                   # blink speed of the "done" animation
DONE_ANIM_S = 2.0             # auto-dismiss the unlock animation after this (auto-open)
CLOCK_FPS = 25                # clock-view refresh rate while counting down (smooth)
CPU_FAST = 240_000_000       # screen on: responsive touch + stable servo PWM
CPU_SLOW = 80_000_000        # screen asleep: battery saving
INACTIVITY_S = 20             # turn the screen off after this many idle seconds

# ----- Touch -> screen mapping (panel is native 172x320) -----
SWAP_XY = False
INVERT_X = True
INVERT_Y = False


# This panel's init has color INVERSION on (red->cyan, white->black).
# fix() sends the inverse so colors render correctly.
def fix(c):
    return 0xFFFFFF ^ c


# Modern dark theme: a muted slate background with a soft off-white ink and a
# calmer, less saturated accent set (mint/coral/amber) instead of pure
# primaries, used consistently across every screen (including the clock faces,
# which used to be stark white cards).
C_BG = fix(0x0D1117)
C_SURFACE = fix(0x161B22)   # slightly-raised card fill (e.g. the digital clock)
C_WHITE = fix(0xF0F3F6)
C_BLACK = fix(0x000000)
C_GREY = fix(0x7D8590)
C_GREEN = fix(0x35D07F)
C_RED = fix(0xEF5350)
C_AMBER = fix(0xF2B84B)


def fmt_hms(secs):
    secs = max(0, int(secs))
    return "{:d}:{:02d}:{:02d}".format(secs // 3600, (secs % 3600) // 60, secs % 60)


# ----- Battery (Adafruit MAX17048 fuel gauge, I2C @ 0x36 on the shared touch bus)
# State of charge is read straight off the MAX17048's ModelGauge algorithm --
# no ADC divider and no voltage curve. The gauge is compensated for load and
# temperature in hardware, so we do NOT re-smooth or charge-compensate the value.
# It sits on the AXS5106L touch I2C bus (GPIO41/42/47/48) at a distinct address,
# so it consumes zero additional GPIO. See Box-code/lib/max17048.py for the
# register-level driver and decode.
BAT_GAUGE_ADDR = 0x36        # MAX17048 I2C address (fixed in silicon)
BAT_CAPACITY_MAH = 1000      # battery pack size (set to your cell) -- watt estimate only

# Backlight brightness (0.0-1.0). On battery -> dimmer to save power; on USB ->
# brighter since power isn't a concern.
BL_LEVEL = 0.5
BL_LEVEL_USB = 1.0

# ----- Servo lock actuator (external hobby servo on a free GPIO) -----
# Any free GPIO works for PWM. Avoid strapping pins (GPIO0/3/45/46) and pins
# already used (GPIO12 battery, 41/42/47/48 touch, 13-18 SD, LCD pins).
SERVO_PIN = "GPIO5"
SERVO_LOCK_ANGLE = 45        # degrees (-90..90): locked position (fixed)
SERVO_UNLOCK_ANGLE = 0       # unlocked position (fixed)
SERVO_MIN_US = 500           # pulse width at -90 deg (servo calibration)
SERVO_MAX_US = 2500          # pulse width at +90 deg
SERVO_HOLD_S = 1.0           # keep PWM on this long after a move, then relax

# ----- Physical buttons (wired to GND, internal pull-ups; pressed = LOW) -----
BTN_LOCK_PIN = "GPIO1"       # sensor/lock button
BTN_OVERRIDE_PIN = "GPIO10"  # override button (press OVERRIDE_PRESSES times to unlock)
OVERRIDE_PRESSES = 25        # default; adjustable on the settings screen
OVERRIDE_TIMEOUT = 3.0       # seconds; no override press within this resets the counter

# ----- BLE companion link (adafruit_ble GATT peripheral) -----
# The ESP32-S3 radio is already on the board ($0 added), previously unused. This
# turns it on as a GATT peripheral so the phone app can read live status,
# sync the wall clock, and push an "important call" alert that the box
# renders as an on-screen notification. Best-effort: if adafruit_ble/_bleio are
# absent from the CP build the timer runs normally and BLE is simply disabled.
# BLE is serviced once per run loop AFTER touch+update (see code.py), never
# inside a touch/servo interaction, so the run-loop ordering rule is preserved.
BLE_ENABLED = True
BLE_NAME = "PhoneBox"
BLE_ADV_INTERVAL = 0.2             # seconds between advertising packets
# Advertise only when the screen is awake OR the box is locked, to bound the
# radio's current draw against the brownout budget (servo peaks share VBAT).
BLE_ADV_WHEN_LOCKED = True
# Rate-limit inbound BLE commands that change the latch (new remote path). The
# physical press-count override stays the true emergency path; a remote unlock
# defaults OFF -- see BLE_ALLOW_REMOTE_UNLOCK.
BLE_CMD_MIN_INTERVAL = 1.0         # seconds between accepted commands
BLE_ALLOW_REMOTE_UNLOCK = False    # keep the focus contract: alert-through, not auto-open
# How long an incoming-call notification stays on screen (auto-dismiss).
BLE_CALL_ALERT_S = 20.0

# 128-bit vendor UUIDs for the custom PhoneBox service + characteristics. These
# MUST match the app side (app/src/ble/protocol.ts). Keep them in lockstep.
BLE_SERVICE_UUID = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0001"
BLE_UUID_STATUS = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0002"   # READ | NOTIFY
BLE_UUID_COMMAND = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0004"  # WRITE
BLE_UUID_SETTINGS = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0005" # READ | WRITE
BLE_UUID_TIME = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0006"     # WRITE (epoch seconds)
BLE_UUID_ALERT = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0007"    # WRITE (call label)

# ----- Settings screen option ranges (values persisted in NVM) -----
OVR_MIN = 10                 # override presses: min / max / step
OVR_MAX = 100
OVR_STEP = 10
SLEEP_OPTIONS = (10, 20, 30, 60)      # screen-sleep seconds (on battery)
BRIGHT_OPTIONS = (10, 30, 50, 70, 100)    # backlight percent (min 10)
