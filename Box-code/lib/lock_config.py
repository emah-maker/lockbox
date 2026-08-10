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
# Rate-limit inbound BLE commands that change the latch (new remote path).
# Remote unlock defaults OFF and stays an explicit opt-in (see
# BLE_ALLOW_REMOTE_UNLOCK, the seed default for Settings.allow_remote_unlock,
# which the app's Settings screen can flip on). The app that would send the
# unlock is a *companion* device -- a second phone or tablet paired to the
# box, not the phone locked inside it, which is unreachable until the box
# opens. That means the anti-cheat case is real: defaulting this on would
# make "tap Open on the other device" a standing one-tap escape hatch from
# day one, defeating the reason the box exists. Physical override stays the
# always-available emergency path either way.
BLE_CMD_MIN_INTERVAL = 1.0         # seconds between accepted commands
BLE_ALLOW_REMOTE_UNLOCK = False
# How long an incoming-call notification stays on screen (auto-dismiss).
BLE_CALL_ALERT_S = 20.0
# Flash rate for the incoming-call overlay (color toggles per second, doubled
# like ANIM_HZ's convention) -- an important call should be hard to miss, not
# a static banner that blends into an already-lit screen.
CALL_ALERT_BLINK_HZ = 3
# "Unlock when called": defaults OFF, same anti-cheat rationale as
# BLE_ALLOW_REMOTE_UNLOCK above, but a distinct opt-in -- this one fires from
# an incoming call (any call; iOS CXCallObserver gives no caller identity),
# not a deliberate phone-side tap, so leaving it on is a standing unlock
# trigger that needs no companion-device action at all once armed. Default
# behavior on a call stays alert-through (screen notification, latch shut).
BLE_UNLOCK_ON_CALL = False

# 128-bit vendor UUIDs for the custom PhoneBox service + characteristics. These
# MUST match the app side (app/src/ble/protocol.ts). Keep them in lockstep.
BLE_SERVICE_UUID = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0001"
BLE_UUID_STATUS = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0002"   # READ | NOTIFY
# History: a small RAM-only queue of sessions finished since the app last
# connected (see lock_log.py). No SD card and no NVM writes -- the app is the
# durable store (app/src/stats/sessionHistory.ts); this just bridges the gap
# for sessions that finished while no phone was around to see them live.
BLE_UUID_HISTORY = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0003"  # READ | NOTIFY
BLE_UUID_COMMAND = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0004"  # WRITE
BLE_UUID_SETTINGS = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0005" # READ | WRITE
BLE_UUID_TIME = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0006"     # WRITE (epoch seconds)
BLE_UUID_ALERT = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0007"    # WRITE (call label)

# ----- Session log (Box-code/lib/lock_log.py) -----
# Cap on the box's own on-device queue of sessions finished while no phone
# was connected -- see lock_log.py's header. Raised from 40 (kept the box
# from growing memory without limit, but wasn't sized for a multi-day phone
# force-quit) to 200 per
# docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
# §3.2. At 9 bytes/entry (see lock_log.py's _ENTRY_SIZE) that's ~1.8KB of
# NVM -- NOT YET CONFIRMED against this board's actual
# len(microcontroller.nvm) at the CircuitPython REPL (that RFC's §7 spike
# #3); lock_log.py's _save() degrades gracefully (persists only as many of
# the oldest entries as actually fit) if this board's NVM region turns out
# to be smaller than this implies, but the cap itself should be re-checked
# on real hardware before shipping.
LOG_MAX_PENDING = 200

# ----- Settings screen option ranges (values persisted in NVM) -----
OVR_MIN = 10                 # override presses: min / max / step
OVR_MAX = 100
OVR_STEP = 10
SLEEP_OPTIONS = (10, 20, 30, 60)      # screen-sleep seconds (on battery)
BRIGHT_OPTIONS = (10, 30, 50, 70, 100)    # backlight percent (min 10)

# ----- Settings detail page: [-]/[+] and swipe press-and-hold auto-repeat -----
# A tap (or the start of a swipe) always applies one step immediately (on
# touch-down / threshold-crossing, not release) so the control feels
# responsive; holding past HOLD_REPEAT_DELAY starts auto-repeat so a long
# traversal (e.g. Override 10->100, 9 steps) doesn't need 9 separate taps.
# Each repeat's wait shrinks by HOLD_REPEAT_RAMP, floored at HOLD_REPEAT_MIN.
HOLD_REPEAT_DELAY = 0.4       # seconds held before auto-repeat kicks in
HOLD_REPEAT_START = 0.35      # seconds between the first few repeats
HOLD_REPEAT_MIN = 0.08        # fastest repeat interval once ramped up
HOLD_REPEAT_RAMP = 0.85       # interval *= this factor after each repeat

# ----- Companion-app theme sync -----
# Mirrors app/src/theme/theme.ts. MODE_COLORS index = THEME_MODES order
# (dark, light); ACCENT_COLORS index = ACCENT_KEYS order (mint, coral, amber,
# sky, violet). Mode swaps background/surface/text everywhere on the box.
# Accent recolors ONLY two elements that never carry lock-status meaning (the
# LOCK/OPEN button fill, the analog clock's second hand) -- the red/amber/
# green STATE colors above (locked=red, closed=amber, unlocked=green) are
# fixed regardless of mode or accent, so status stays readable at a glance no
# matter which theme is picked. See lock_ui.LockUI.set_theme.
MODE_COLORS = (
    (C_BG, C_SURFACE, C_WHITE, C_GREY),                       # dark (default)
    (fix(0xF5F6F8), fix(0xFFFFFF), fix(0x111318), fix(0x5B6167)),  # light
)
DEFAULT_MODE_IDX = 0

ACCENT_COLORS = (
    fix(0x22C55E),  # mint (default)
    fix(0xEF5350),  # coral
    fix(0xF2B84B),  # amber
    fix(0x38BDF8),  # sky
    fix(0xA78BFA),  # violet
)
DEFAULT_ACCENT_IDX = 0

# Text drawn directly on an accent fill (the LOCK/OPEN button label) needs a
# fixed dark color, not the mode's fg/dim -- all 5 accents above are light
# enough that a single near-black reads fine on every one, same as the app's
# per-accent `accentText` values, which are all near-black too.
C_ON_ACCENT = fix(0x101010)
