# lock_config.py -- tunables, colors, and small shared helpers.

# ----- Behavior -----
MAX_HOURS = 9                 # hours selectable (0..9)
MAX_SECONDS = MAX_HOURS * 3600 + 55 * 60   # cap is 9h55m, not a clean 9h
DEFAULT_SECONDS = 5 * 60      # time shown on boot (5:00)
MIN_STEP = 5                  # minutes change per swipe on the M column
SWIPE_MIN_PX = 35             # min vertical travel to count as a swipe
RELEASE_FRAMES = 2            # consecutive empty touch reads before a "release"
DONE_ANIM_S = 2.0             # auto-dismiss the unlock animation after this (auto-open)
CLOCK_FPS = 25                # clock-view refresh rate while counting down (smooth)
# Duration for the state-indication color transition (status bar fill,
# clock-view active-color flips -- see lock_ui.LockUI.step_color_transitions).
# 200ms sits inside the motion-and-animation skill's "Dropdowns, cards, sheet
# reveals | 150-250ms" band -- these are card-like state surfaces changing on
# an occasional (a few times per session) event, not a rapidly-retriggered
# control, so the standard-animation tier applies. displayio has no alpha, so
# this eases the RGB channels of a single palette entry over several frames
# instead of a cross-fade -- see the color-transition engine's docstring in
# lock_ui.py for why that is a real, cheap technique on this display and not
# an approximation of one.
STATUS_TRANSITION_S = 0.2
# Pixel-space spring for position-based motion (press-depth, success/override
# "pop") -- see lock_motion.Spring. Chosen to feel like the companion app's
# press spring (app/src/ui/AnimatedPressable.tsx: stiffness 300 / damping 30 /
# mass 1) while settling in well under STATUS_TRANSITION_S's 200ms.
SPRING_STIFFNESS = 300.0
SPRING_DAMPING = 30.0
SPRING_MASS = 1.0
PRESS_DEPTH_PX = 3          # how far a pressed control sinks, in pixels
DONE_POP_OFFSET_PX = 16     # how far the "UNLOCKED" message springs up from
# Unlock ("done") reveal, take 2: not a ring -- the manager rejected the
# dots-around-a-circle reveal outright and asked for the OPEN button itself
# to spring to the screen's center instead (see LockUI.show_done/_step_motion
# and the button build in _build_control). DONE_MSG_Y moves the "UNLOCKED"
# message up out of the button's new home; DONE_BTN_CENTER_Y is the button's
# target CENTER y (LockUI computes the RoundRect's top-left from its own
# BTN_H). Both are reasoned from the other permanent widgets' documented
# y-coordinates in _build_control (corner icons end ~y=65, clock/guides are
# hidden in the done state so that band is free, nav hint starts ~y=197) --
# not from an actual render, since no host-runnable renderer exists for this
# display stack. Needs an on-device visual check like every other geometry
# constant in this file.
DONE_MSG_Y = 85
DONE_BTN_CENTER_Y = 155
OVR_POP_OFFSET_PX = 8       # how far the override count bumps on each press
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
C_SURFACE_HILITE = fix(0x2B3340)  # a lighter step of C_SURFACE -- a static "catching light" top edge on a card, since this display has no alpha blending for a real material effect
C_WHITE = fix(0xF0F3F6)
C_BLACK = fix(0x000000)
C_GREY = fix(0x7D8590)
C_GREEN = fix(0x35D07F)
C_RED = fix(0xEF5350)
C_AMBER = fix(0xF2B84B)
# Dedicated call-alert flash colors -- deliberately more saturated/brighter
# than the calmer C_RED/C_AMBER above (which stay muted for normal UI use).
# An incoming call needs to read as urgent, so the alert overlay uses these
# instead of the theme's usual red/amber.
C_ALERT_RED = fix(0xFF1744)
C_ALERT_AMBER = fix(0xFFC400)

# ----- Corner-radius language (RoundRect radii, in px) -----
# Named so the same "how round" decision reads the same way on every screen
# instead of a bare 8/10/12 repeated with no shared meaning across call
# sites (previously: lock_ui.py had the identical literal `8` on the status
# bar and the digital-clock card, but `12` on the LOCK/OPEN button and `10`
# on the settings [-]/[+] buttons, with nothing recording that those three
# values were deliberate rather than drift). This is a box-local scale, not
# shared with the app's own `app/src/theme/tokens.ts` radius scale (that
# file is a separate surface's tokens, sm=8/md=14/lg=20/pill=999 -- similar
# idea, not the same values, and not wired together).
RADIUS_CARD = 8       # status bar, digital-clock card
RADIUS_BTN_SM = 10    # small square controls (settings detail [-]/[+])
RADIUS_BTN_LG = 12    # primary LOCK/OPEN button (larger element)


def fmt_hms(secs):
    secs = max(0, int(secs))
    return "{:d}:{:02d}:{:02d}".format(secs // 3600, (secs % 3600) // 60, secs % 60)


def fmt_hm(secs):
    """H:MM, no seconds -- the control ("home") screen's clock label only
    (LockUI.set_clock/set_clock_text). The clock view's analog/digital/ring/
    elapsed styles still show full H:MM:SS via fmt_hms above; this is a
    separate, coarser display, not a change to fmt_hms itself. Rounds UP to
    the next whole minute (except on an exact minute) so the displayed
    minute never ticks down a full minute early -- the same "never show less
    time than is actually left" rule fmt_hms's callers apply via a `+0.999`
    ceiling, just baked in here since there's no seconds digit left to
    absorb the fractional remainder."""
    secs = max(0, int(secs))
    mins = (secs + 59) // 60 if secs % 60 else secs // 60
    return "{:d}:{:02d}".format(mins // 60, mins % 60)


def lerp_color(c0, c1, t):
    """Linear-blend two already-`fix()`ed 0xRRGGBB colors by t in [0, 1].
    fix() is a per-channel bitwise complement (an affine map), so lerping the
    fixed ints gives the exact same result as fixing a lerp of the originals --
    no need to un-invert first. Cheap integer channel math, no allocation, safe
    to call every frame (see LockUI's digital-clock "breathing" highlight)."""
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    r0, g0, b0 = (c0 >> 16) & 0xFF, (c0 >> 8) & 0xFF, c0 & 0xFF
    r1, g1, b1 = (c1 >> 16) & 0xFF, (c1 >> 8) & 0xFF, c1 & 0xFF
    r = int(r0 + (r1 - r0) * t)
    g = int(g0 + (g1 - g0) * t)
    b = int(b0 + (b1 - b0) * t)
    return (r << 16) | (g << 8) | b


# ----- Battery (Adafruit MAX17048 fuel gauge, I2C @ 0x36 on the shared touch bus)
# State of charge is read straight off the MAX17048's ModelGauge algorithm --
# no ADC divider and no voltage curve. The gauge is compensated for load and
# temperature in hardware, so we do NOT re-smooth or charge-compensate the value.
# It sits on the AXS5106L touch I2C bus (GPIO41/42/47/48) at a distinct address,
# so it consumes zero additional GPIO. See Box-code/lib/max17048.py for the
# register-level driver and decode.
BAT_GAUGE_ADDR = 0x36        # MAX17048 I2C address (fixed in silicon)
BAT_CAPACITY_MAH = 5000      # battery pack size (set to your cell) -- watt estimate only

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

# Minimum time between status-bar tap-to-toggle actions (see
# LockController._handle_release's status-bar branch). If the AXS5106L
# chatters/bounces at that screen region, a bounce can exceed RELEASE_FRAMES'
# debounce and read as its own distinct tap, re-triggering go_idle()/
# go_closed() and restarting LockUI's press-depth spring -- visible on
# screen as the status text and press-dip repeatedly bouncing.
#
# Was widened to 1.0s, then 0.35s, to paper over the status text/press-dip
# "moving all over the screen" -- that turned out to be a real bug
# (lock_motion.Spring's integration was numerically unstable at the 0.1s
# worst-case frame-delay LockController.update() clamps to, amplifying error
# ~4.5x per step instead of damping it), now fixed at the source (Spring.step
# sub-steps at a stable dt). Reported as "still unresponsive" at 0.35s, so
# brought down further to a standard hardware-debounce duration (long enough
# to absorb genuine electrical/mechanical touch chatter, which settles in
# tens of ms; short enough that back-to-back deliberate taps both register).
# RELEASE_FRAMES (2 frames, ~40ms at this loop's ~50Hz) is the other source
# of tap-to-registered latency and is not the bottleneck here.
STATUS_TAP_COOLDOWN_S = 0.2

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
# Belt-and-suspenders re-assert: PhoneBoxBLE only calls the radio's actual
# start_advertising() when its OWN cached on/off flag changes, never
# re-confirming that against the real hardware state -- so if advertising
# ever silently drops (a radio hiccup, an aborted connection attempt from a
# phone that gives up mid-handshake, or any _bleio/adapter quirk this code
# has no visibility into) while the cached flag still says "on", nothing
# would ever call start_advertising() again, and the box would sit there
# genuinely undiscoverable while every on-screen signal (screen awake, not
# connected) says it should be found. Reported as "trouble connecting
# sometimes" even with the screen on -- not explained by the sleep-power
# tradeoff (BLE_ADV_WHEN_LOCKED) alone. This forces a fresh
# start_advertising() call periodically regardless of the cached flag.
BLE_ADV_REASSERT_S = 15.0
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
# the same way the old "done" blink used to) -- an important call should be
# hard to miss, not a static banner that blends into an already-lit screen.
# Raised from 3 so the alert reads as more urgent than the old, slower flash.
CALL_ALERT_BLINK_HZ = 6
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
# Custom-label sync (app -> box), best-effort -- see lock_controller.
# apply_ble_labels_json. Mirrored in app/src/ble/protocol.ts as CHAR.labels /
# cmdSetLabels: raw JSON (no opcode prefix -- this has its own characteristic,
# unlike the CHAR.command opcodes), compact {"i":id,"n":name,"c":color}
# objects (name truncated to BLE_LABEL_NAME_MAX_LEN, color a "#rrggbb" hex
# string).
BLE_UUID_LABELS = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0008"   # WRITE (label list)

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
# Override presses used to be a non-uniform 5/10/25/50 staircase (small steps
# while the count was low, growing as it got bigger), retired in favor of a
# flat linear step -- both the box's own swipe-to-adjust and the app's
# slider snapped by equal-width track/hold-repeat slices regardless of the
# staircase's actual value spacing, so the same-size nudge meant a tiny
# change near one end and a huge jump near the other. That inconsistency is
# what a non-uniform range costs; a flat step removes it entirely.
# OVR_MAX was 255 (a single NVM byte's ceiling, see lock_settings.Settings.
# save's old comment) until raised to 500 (manager request) -- override_presses
# now persists across 2 NVM bytes instead of 1 (see Settings.save/_load) to
# fit. Still confirmed safe for LockUI's on-screen "N/N" override counter:
# its widest string was already "255/255" (7 chars) at the old ceiling and is
# "500/500" (also 7 chars) at this one, so no digit-count regression.
OVR_MIN = 5
OVR_MAX = 500
OVR_STEP = 5
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

# ----- Custom label sync (app -> box), best-effort -----
# The box has no independent concept of a "label" -- it just holds whatever
# compact (id, name) pairs the app most recently pushed over BLE_UUID_LABELS,
# purely to populate the pre-session tag picker (see LockUI's tag-picker
# screen / LockController._all_topics). Hard-capped so a large app-side
# label list can't grow the box's RAM or the BLE payload unbounded -- the app
# always pushes its FULL current list (not a delta), so a re-sync after
# trimming on the app side fixes an over-cap list automatically.
BLE_LABEL_MAX_COUNT = 8
BLE_LABEL_NAME_MAX_LEN = 12

# ----- Companion-app theme sync -----
# Mirrors app/src/theme/theme.ts. MODE_COLORS index = THEME_MODES order
# (dark, light); ACCENT_COLORS_DARK/ACCENT_COLORS_LIGHT index = ACCENT_KEYS
# order (mint, coral, amber, sky, violet, rose, teal, indigo). Mode swaps
# background/surface/text everywhere on the box. Accent recolors only
# elements that never carry lock-status meaning (the LOCK/OPEN button fill,
# the analog clock's second hand, the settings screen's values, and the
# elapsed-clock style's time text) -- the red/amber/green STATE colors above
# (locked=red, closed=amber, unlocked=green) are fixed regardless of mode or
# accent, so status stays readable at a glance no matter which theme is
# picked. See lock_ui.LockUI.set_theme.
MODE_COLORS = (
    (C_BG, C_SURFACE, C_WHITE, C_GREY),                       # dark (default)
    (fix(0xF5F6F8), fix(0xFFFFFF), fix(0x111318), fix(0x5B6167)),  # light
)
DEFAULT_MODE_IDX = 0

# Per-mode accent audit (2026-08-15, mirrors app/src/theme/theme.ts's ACCENTS
# comment verbatim): a WCAG contrast pass found every one of the original 6
# accents failed minimum text contrast when drawn as TEXT on the light mode's
# bg/surface (settings values, elapsed-clock time text -- see set_theme's
# _accent_widgets loop) -- they were tuned for dark mode only. DARK below is
# unchanged from before (existing boxes/app installs see no dark-mode
# change); LIGHT is a separately darkened/more-saturated variant of the SAME
# hue, each >=4.5:1 against both light mode's bg and surface. `teal` and
# `indigo` are new accent options (manager request) filling hue gaps the
# original 6 leave open, computed with the same per-mode method from the
# start. Order must stay in exact lockstep with app/src/theme/theme.ts's
# ACCENT_KEYS -- the app pushes a bare accent_idx over BLE (pushBoxSettings
# acc field), not a name, so a reordering here desyncs every paired device
# silently instead of erroring.
ACCENT_COLORS_DARK = (
    fix(0x22C55E),  # mint (default)
    fix(0xEF5350),  # coral
    fix(0xF2B84B),  # amber
    fix(0x38BDF8),  # sky
    fix(0xA78BFA),  # violet
    fix(0xFB7185),  # rose
    fix(0x2DD4BF),  # teal
    fix(0x818CF8),  # indigo
)
ACCENT_COLORS_LIGHT = (
    fix(0x167F3D),  # mint
    fix(0xDE1814),  # coral
    fix(0x94640B),  # amber
    fix(0x0678AB),  # sky
    fix(0x774BF7),  # violet
    fix(0xE10626),  # rose
    fix(0x197C70),  # teal
    fix(0x4C5BF5),  # indigo
)
# Mode-independent alias: BUILTIN_TOPICS' fixed tag-picker dot colors below
# and the accent_idx bounds-check in lock_settings.py/LockUI.set_theme both
# just need *a* stable 8-entry set to index into/measure the length of --
# they intentionally always use the dark-mode swatches regardless of the
# user's chosen mode (see BUILTIN_TOPICS' own comment).
ACCENT_COLORS = ACCENT_COLORS_DARK
DEFAULT_ACCENT_IDX = 0

# Built-in focus topics shown on the box's pre-session tag picker (see
# LockController._all_topics / LockUI's tag-picker screen). Mirrors
# app/src/stats/topics.ts's TOPIC_KEYS/TOPIC_LABELS order and ids exactly --
# these ids are the ones echoed back over BLE (ble_status_json's "tp" field),
# so a mismatch here would make a box-tagged session's topic unrecognizable
# once the app tries to resolve it. The third element is the color for that
# topic's dot on the tag-picker row (see LockUI.show_tag_picker) -- reuses
# ACCENT_COLORS (dark-mode swatches) positionally rather than inventing a
# separate 6-color palette, since it's already the validated set of distinct
# hues this display uses elsewhere. Not tied to the user's own chosen accent
# or mode (that stays whatever ACCENT_COLORS_DARK/LIGHT[accent_idx]
# set_theme picked); this just borrows the same swatches to give each of the
# (at most) 6 built-ins its own fixed, distinct dot.
BUILTIN_TOPICS = (
    ("work", "Work", ACCENT_COLORS[0]),
    ("study", "Study", ACCENT_COLORS[1]),
    ("reading", "Reading", ACCENT_COLORS[2]),
    ("creative", "Creative", ACCENT_COLORS[3]),
    ("exercise", "Exercise", ACCENT_COLORS[4]),
    ("other", "Other", ACCENT_COLORS[5]),
)

# Text drawn directly on an accent fill (the LOCK/OPEN button label) needs a
# color that stays readable against THAT mode's accent fill -- dark mode's
# accents are all light/pastel enough for a single near-black (contrast
# 5.3-9.8:1 measured); light mode's accents are now deliberately darker/more
# saturated (see ACCENT_COLORS_LIGHT above), against which that same
# near-black measures only ~3.3-3.8:1 -- white measures >=4.9:1 against every
# one of them instead. Mirrors the app's per-mode `accentText` exactly (near-
# black for dark mode, white for light mode) -- see set_theme, which now
# assigns btn_label.color from this per mode instead of it being a fixed
# build-time constant.
C_ON_ACCENT_DARK = fix(0x101010)
C_ON_ACCENT_LIGHT = C_WHITE
