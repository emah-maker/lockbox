# lock_config.py -- tunables, colors, and small shared helpers.

# The shared pure helpers live in lock_util.py now (lock_config is values,
# lock_util is behaviour). Re-exported here, and imported BEFORE the colour
# tables below because they call fix() at module level, so every existing
# `from lock_config import clamp, fix, ...` keeps working unchanged.
from lock_util import clamp, fix, fmt_hm, fmt_hms, lerp_color, snap_to_option

# ----- Behavior -----
MAX_HOURS = 9                 # hours selectable (0..9)
MAX_SECONDS = MAX_HOURS * 3600 + 55 * 60   # cap is 9h55m, not a clean 9h
DEFAULT_SECONDS = 5 * 60      # time shown on boot (5:00)
MIN_STEP = 5                  # minutes change per swipe on the M column
# Floor for a settable lock duration -- one MIN_STEP (the smallest unit the
# box's own H/M editing UI can express), so the timer can never be armed at
# an unusable 0h00m. Applied everywhere set_seconds can be written to a
# user/app-chosen value (LockController.adjust, apply_ble_command's "start"/
# "dur" handlers) -- go_running() already no-ops at set_seconds<=0, but that
# was only ever a silent-failure backstop, not a floor on the value itself.
MIN_SECONDS = MIN_STEP * 60
SWIPE_MIN_PX = 35             # min vertical travel to count as a swipe

# Print one line per touch release: the RAW point from the touch chip, the
# MAPPED screen point _map turned it into, the deltas, and what the swipe
# branch decided. Off by default; costs nothing when off.
#
# Here because touch/orientation mapping is this project's most-repeated bug
# -- three separate "swipe is backwards / touch is mapped as if unflipped"
# reports are recorded in lock_ui.py's and lock_controller._map's own
# comments, and each was chased by reasoning about INVERT_X/is_flipped from
# source. That reasoning is where it keeps going wrong, because it rests on
# assumptions about the panel (which way its raw axes run, what a 180
# displayio rotation does to them) that cannot be checked from a laptop. One
# line of real numbers from the box settles in a single swipe what a day of
# algebra does not.
#
# Turn on, deploy, swipe once, read the USB serial console, turn off.
TOUCH_DEBUG = False

# Print a periodic frame-time breakdown to the USB serial console: total
# frame ms, and the ms spent in the touch read, ctrl.update(), and BLE
# service separately, plus the worst frame seen since the last line.
#
# Here for the same reason TOUCH_DEBUG is (read its comment): "the UI feels
# laggy" is a report that cannot be chased from a laptop. The run loop's cost
# is split across a touch read over I2C, a displayio refresh whose cost
# depends on which screen is showing and how many shapes it has, an NVM write
# whose cost is a flash erase cycle, and a radio service call -- and which of
# those dominates is not deducible from reading any of them. One line of real
# per-stage numbers off the box identifies the culprit immediately; reasoning
# about it does not.
#
# Off by default and costs nothing when off (the timing calls are inside the
# `if` in code.py, not around it). Turn on, deploy, use the box for a few
# seconds, read the serial console, turn off.
PERF_DEBUG = False
# Seconds between PERF_DEBUG lines -- slow enough that the printing itself
# (USB serial writes are not free) can't become the thing being measured.
PERF_DEBUG_INTERVAL_S = 2.0
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

# ----- Run-loop frame pacing (code.py's tail) -----
# TARGET PERIODS, not sleep durations. code.py used to end with a flat
# `time.sleep(0.02 if backlight.is_on else 0.1)`, which is 20ms added ON TOP
# of however long the frame's work already took -- so a frame doing 20ms of
# touch reading, display refresh and BLE service ran at 25Hz, not the ~50Hz
# the rest of this file's comments assume, and a frame that briefly did more
# (an NVM write, a full-screen repaint) dropped further still. Reported as
# "the ui is just laggy". Now the loop sleeps only the REMAINDER of the
# target period, so work and wait share one budget instead of stacking.
FRAME_AWAKE_S = 0.02          # 50Hz while the screen is on
FRAME_ASLEEP_S = 0.1          # 10Hz asleep -- still fast enough to catch a
                              # physical button press and wake (the reason
                              # the asleep poll is not slower than this)
# Floor, so a frame whose work already overran its target still yields to the
# interpreter rather than spinning. Small enough to be invisible, non-zero so
# this can never become a busy-loop burning current on a battery device.
FRAME_MIN_SLEEP_S = 0.002

# How long code.py's main loop must run, past a first successful ctrl.update(),
# before a normal boot clears safemode.py's brownout-retry counter -- long
# enough to be past initial boot inrush and into a run where the servo could
# plausibly have engaged. See code.py's run loop and safemode.py's 5-retry cap.
BROWNOUT_CLEAR_AFTER_S = 3.0

# ----- Touch -> screen mapping (panel is native 172x320) -----
SWAP_XY = False
INVERT_X = True
INVERT_Y = False

# The board's own CircuitPython board.c (waveshare_esp32_s3_touch_lcd_1_47,
# verified against the adafruit/circuitpython source) hardcodes rotation=0
# when board.DISPLAY is constructed -- this is a fixed property of the board
# support package, not something that varies at runtime. LockUI trusts this
# constant directly as the display's native orientation instead of reading
# display.rotation at boot and trying to guess whether that live value is
# trustworthy: board.DISPLAY can be a supervisor-owned singleton that
# outlives a soft reload, and -- per the 2026-08-25 power-cycle bug report --
# apparently also survives an unexpected in-session reset (e.g. a brownout
# retry) closely enough that a "was this session's boot actually fresh"
# heuristic (CircuitPython's supervisor.runtime.run_reason) is not a
# sufficient signal either. A hardcoded, hardware-verified constant sidesteps
# the whole class of "is the raw captured rotation native or stale" bugs.
NATIVE_ROTATION = 0

# Seed default for Settings.screen_flipped -- lets the box be physically
# mounted upside-down while still reading right-side-up, toggled from the
# app's Settings screen (Settings > Box behaviors > "Flip screen"). Rotates
# the panel 180° (LockUI.set_screen_flipped) and XORs both touch axes on top
# of the INVERT_X/INVERT_Y calibration above (LockController._map) so taps
# still land where the rotated content actually is.
SCREEN_FLIPPED_DEFAULT = False


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


# ----- Battery (MAX17043 fuel gauge, I2C @ 0x36 on the shared touch bus)
# State of charge is read straight off the MAX17043's ModelGauge algorithm --
# no ADC divider and no voltage curve. The gauge is compensated for load and
# temperature in hardware, so we do NOT re-smooth or charge-compensate the value.
# It sits on the AXS5106L touch I2C bus (GPIO41/42/47/48) at a distinct address,
# so it consumes zero additional GPIO. See firmware/lib/max17043.py for the
# register-level driver and decode.
BAT_GAUGE_ADDR = 0x36        # MAX17043 I2C address (fixed in silicon)
BAT_CAPACITY_MAH = 5000      # battery pack size (set to your cell) -- watt estimate only

# Power draw is a derivative of state of charge, so it needs a measuring window
# wide enough for the charge to actually move. The SOC register's LSB is 1/256%
# = 0.0039% -- on a 5000 mAh pack, 0.195 mAh. At a typical ~1 W draw the pack
# loses ~0.073 mAh/s, so a one-second window is BELOW the gauge's resolution and
# reads a flat zero; ~20 s puts several LSBs inside the window. The ceiling is
# what caps a stale reading when draw drops: after this long with no measurable
# change, the true draw must be under what one LSB over that span implies, so
# the displayed number is pulled down to that bound instead of sitting high.
BAT_WATT_WINDOW_S = 20.0     # min span before a draw estimate is computed
BAT_WATT_CEILING_S = 60.0    # after this long with no change, decay the estimate

# Backlight brightness (0.0-1.0), the default level applied at startup
# (lock_power.Backlight) before the user's own bright_pct setting takes over.
BL_LEVEL = 0.5

# ----- Servo lock actuator (external hobby servo on a free GPIO) -----
# Any free GPIO works for PWM. Avoid strapping pins (GPIO0/3/45/46) and pins
# already used (GPIO12 battery, 41/42/47/48 touch, 13-18 SD, LCD pins).
SERVO_PIN = "GPIO5"
SERVO_LOCK_ANGLE = 45        # degrees (-90..90): seed default for
                             # Settings.lock_angle (see lock_settings.py) --
                             # no longer read directly by LockController,
                             # which now uses the (app-adjustable) setting
SERVO_UNLOCK_ANGLE = 0       # seed default for Settings.unlock_angle, ditto
SERVO_ANGLE_MIN = -90        # servo's real range (see lock_servo.Servo._write_angle,
SERVO_ANGLE_MAX = 90         # which already clamps to this) -- shared clamp
                             # bounds for Settings.lock_angle/unlock_angle and
                             # their BLE fields ("langle"/"uangle")
# Step for the box's own stepper on the two servo angles (page 2 of the
# settings list). 5 degrees gives 37 steps across the -90..90 range, which the
# detail page's hold-to-repeat ramp crosses comfortably, while still being
# fine enough to dial in a latch that only just catches. A servo angle is
# also the one setting on the box where the RIGHT value is found by watching
# the physical latch move rather than by reading a number, so the step wants
# to be small enough to creep up on it.
SERVO_ANGLE_STEP = 5
SERVO_MIN_US = 500           # pulse width at -90 deg (servo calibration)
SERVO_MAX_US = 2500          # pulse width at +90 deg
SERVO_HOLD_S = 1.0           # keep PWM on this long after a move, then relax

# ----- Physical buttons (wired to GND, internal pull-ups; pressed = LOW) -----
BTN_LOCK_PIN = "GPIO1"       # sensor/lock button
BTN_OVERRIDE_PIN = "GPIO10"  # override button (press OVERRIDE_PRESSES times to unlock)
OVERRIDE_PRESSES = 25        # default; adjustable on the settings screen
# Seconds; no override press within this resets the counter to zero. Seed
# default for Settings.override_timeout -- no longer read directly by
# LockController, which uses the (app-adjustable) setting. Same arrangement
# as SERVO_LOCK_ANGLE/SERVO_UNLOCK_ANGLE below.
#
# Narrowed from 3.0 to 1.0: at 3s the press sequence could be walked away
# from and resumed, which made a count of OVERRIDE_PRESSES a tally rather
# than the sustained effort it is meant to be. At 1s it has to be one
# continuous burst. The depleting bar (LockUI.update_override_timeout) is
# proportional to this, so it simply empties faster -- still ~50 frames of
# animation at the run loop's ~50Hz, and it is the only warning the user gets
# before a silent reset, so it stays worth drawing.
OVERRIDE_TIMEOUT = 1.0
# Bounds for that setting, in TENTHS of a second -- the unit it is stored and
# transmitted in. Tenths, not seconds, for the same reason the servo angles
# are stored with an offset: this is the granularity a user would actually
# reach for, one NVM byte holds it exactly, and it keeps every number on the
# BLE settings wire an integer (see lock_protocol.encode_settings). The app
# divides by 10 once, at the display boundary.
#
# Floor of 0.3s rather than 0: at OVR_TIMEOUT_MIN the counter must still
# survive the gap between two presses of a real human hand, or override
# becomes unreachable -- the one path that exists for when everything else
# has failed. Ceiling of 10s is where "sustained effort" has stopped meaning
# anything.
OVR_TIMEOUT_MIN_TENTHS = 3
OVR_TIMEOUT_MAX_TENTHS = 100
# Step for the box's own stepper on this setting (page 2 of the settings
# list). One tenth of a second per press: the range is only 0.3-10.0s, so a
# coarser step could not express the low end where the setting actually
# matters, and the detail page's hold-to-repeat ramp covers the distance to
# the ceiling without needing a bigger unit.
OVR_TIMEOUT_STEP_TENTHS = 1

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
# Pre-session topic pick (app -> box), best-effort -- see lock_controller.
# apply_ble_pending_topic / lock_topic_confirm.py. A DEDICATED characteristic,
# not another apply_ble_command opcode: apply_ble_command is rate-limited to
# one accepted command per second (BLE_CMD_MIN_INTERVAL below), so a "topic:"
# opcode landing in that same 1s window as "start"/"dur"/"historyAck" could
# silently starve one of them. A pre-session topic pick is occasional
# declarative state -- the same category as `labels` just above, which
# already got its own characteristic for exactly this reason. Payload is a
# bare string (no JSON wrapper): the topic id, or '' meaning "nothing
# pending", the same ''-is-untagged convention encode_status's "tp" field
# already uses.
BLE_UUID_PENDING_TOPIC = "6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0009"  # WRITE (topic id)

# ----- Session log (firmware/lib/lock_log.py) -----
# Cap on the box's own on-device queue of sessions finished while no phone
# was connected -- see lock_log.py's header. Raised from 40 (kept the box
# from growing memory without limit, but wasn't sized for a multi-day phone
# force-quit) to 200 per
# docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
# §3.2. At 9 bytes/entry (see lock_log.py's _ENTRY_SIZE) that's ~1.8KB of
# NVM -- NOT YET CONFIRMED against this board's actual
# len(microcontroller.nvm) at the CircuitPython REPL (that RFC's §7 spike
# #3); lock_log.py's _save() degrades gracefully (persists only as many of
# the newest entries as actually fit -- newest, matching record()'s own
# "the oldest unsynced session is the one worth losing least" eviction) if
# this board's NVM region turns out to be smaller than this implies, but the
# cap itself should be re-checked on real hardware before shipping.
LOG_MAX_PENDING = 200

# ----- NVM region map -----
# One place that says who owns which NVM byte, because nothing on the device
# enforces it: every module just indexes microcontroller.nvm directly, so two
# regions that overlap corrupt each other silently, with no error and no
# obvious symptom beyond settings or queued sessions going strange.
#
#   byte 0        brownout retry counter (safemode.py, cleared by code.py)
#   bytes 1-7     unused
#   bytes 8-23    lock_settings.py: 14 bytes used, 2 reserved for growth
#   bytes 24+     lock_log.py: the pending-session queue, grows with it
#
# lock_settings.py has already added a field three times (see its _MAGIC bump
# history), so treat NVM_SETTINGS_LEN as the real budget: adding a 4th field
# past _BASE+15 must come with raising it here, which moves the log's base
# with it rather than quietly overwriting the queue's magic byte. Raising it
# invalidates every stored queue on existing boxes, so bump lock_log's _MAGIC
# in the same change. tests/test_lock_log_queue.py asserts the two regions
# don't overlap, so getting this wrong fails on the host, not on a board.
NVM_SETTINGS_BASE = 8
NVM_SETTINGS_LEN = 16
NVM_LOG_BASE = NVM_SETTINGS_BASE + NVM_SETTINGS_LEN

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
# Screen-sleep seconds on battery. 0 means NEVER SLEEP -- the option that
# turns the feature off, not a zero-second timeout (code.py's sleep predicate
# guards on sleep_s > 0 before comparing against it; without that guard 0
# would blank the screen almost immediately, the exact opposite).
#
# Worth knowing what Off costs, because it is more than the backlight:
# backlight.is_on is the single input to three other policies in the same run
# loop, so choosing Off also pins the CPU at CPU_FAST instead of CPU_SLOW,
# holds the loop at its 20ms poll instead of 100ms, and leaves BLE
# advertising continuously instead of only while awake-or-locked.
#
# 0 first also means snap_to_option ties round to it: a stray `sleep` of 5
# from the app now lands on Off rather than 10s (see lock_util.snap_to_option
# -- ties go to the lower option). Only reachable from a malformed payload;
# the app sends exact members.
SLEEP_OPTIONS = (0, 10, 20, 30, 60)
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

# ----- Pre-session tag picker: hold-to-confirm row -----
# Hold-to-confirm replaced tap-to-tag (manager report: an accidental tap on a
# row used to commit to a session instantly, no way to back out once the
# finger landed) -- press a row and hold; a green fill (LockUI.
# step_tag_picker_hold) grows to cover the row over this duration, then
# LockController._update_tag_hold auto-commits go_running(topic=...)).
# Releasing before it fills cancels with no tag. Raised from 0.6s to 1.0s
# (manager request, after hardware testing) -- long enough that a quick
# accidental tap can't complete it, short enough not to feel like a stuck
# button.
#
# The swipe-up-cancel gesture doesn't have its own duration constant: its
# red bar (LockUI.step_tag_picker_swipe_progress) tracks live drag distance
# against the existing SWIPE_MIN_PX threshold instead of elapsed time, so
# there's no separate animation length to tune here.
TAG_HOLD_S = 1.0

# ----- Settings list: hold-to-enable on the two security-weakening toggles ---
# "Remote" (Settings.allow_remote_unlock) and "On call"
# (Settings.unlock_on_call) are the box's only standing escape hatches from its
# own purpose -- see BLE_ALLOW_REMOTE_UNLOCK / BLE_UNLOCK_ON_CALL above for why
# both default OFF. An accidental tap that flips either ON silently converts the
# box into a one-tap-openable box, so turning one ON has to be held (an amber
# fill sweeps the row, see LockUI.step_settings_hold). Turning one OFF is the
# safe direction and stays a single instant tap: friction belongs only on the
# dangerous edge, and every other row -- including the "Auto" toggle, which is a
# convenience setting and not a security one -- is a plain tap both ways.
#
# Same 1.0s as TAG_HOLD_S, and deliberately so: one hold duration across the
# whole box is easier to learn than two. Its own constant rather than an import
# of TAG_HOLD_S so the two CAN diverge if one of them is ever retuned alone.
#
# 1.0 rather than the ~0.5-0.6s a general long-press guideline would suggest,
# because this repo already ran that experiment on this hardware with this
# gesture: TAG_HOLD_S was 0.6s and was raised to 1.0s after on-device testing
# because accidental taps were completing it. A measurement from the box beats a
# cross-platform default.
SETTINGS_HOLD_S = 1.0
# How long the settings switch knob takes to slide its 14px of travel. 150ms is
# the motion-and-animation skill's "small control state change" tier -- shorter
# than STATUS_TRANSITION_S's 200ms card band, because a toggle must feel like it
# answered the tap rather than eased into agreeing with it.
SET_KNOB_SLIDE_S = 0.15

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
