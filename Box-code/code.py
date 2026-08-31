# code.py -- entry point for the touchscreen lock timer.
# Modules live in /lib: lock_config, lock_ui, lock_power, lock_controller, axs5106l
import gc
import time
import board
import busio
import microcontroller
import supervisor
import digitalio

from axs5106l import AXS5106L
from lock_ui import LockUI
from lock_power import Backlight
from lock_controller import LockController
from lock_ble import PhoneBoxBLE
from lock_config import (BTN_LOCK_PIN, BTN_OVERRIDE_PIN,
                         CPU_FAST, CPU_SLOW, BROWNOUT_CLEAR_AFTER_S,
                         FRAME_AWAKE_S, FRAME_ASLEEP_S, FRAME_MIN_SLEEP_S,
                         PERF_DEBUG, PERF_DEBUG_INTERVAL_S)

# ----- Display + UI -----
# Free heap, reported at the two points where it matters: after the imports
# above (every module's bytecode is resident by now) and after LockUI, which
# is the single biggest allocation on the board -- it builds every screen's
# displayio groups up front.
#
# Here because it is the one question about this firmware a host cannot
# answer. The lock_* modules were split into per-screen mixins, which cost
# ~11KB more bytecode than the three files they replaced (measured; see that
# commit). Whether this board has 11KB to spare is not knowable from a
# laptop, so the box reports it on every boot instead of anyone having to
# remember to go and look. Prints to the USB serial console; discarded
# harmlessly when nothing is attached.
gc.collect()
print("[boot] free after imports:", gc.mem_free())

display = board.DISPLAY
ui = LockUI(display)
backlight = Backlight(display)
gc.collect()
print("[boot] free after UI build:", gc.mem_free())

# ----- Touch -----
try:
    i2c = board.TOUCH_I2C()
except AttributeError:
    i2c = busio.I2C(board.SCL, board.SDA)
reset_pin = getattr(board, "TOUCH_RST", None)
touch = AXS5106L(i2c, reset_pin=reset_pin)

# The MAX17043 fuel gauge shares this same I2C bus (@ 0x36), so hand the bus to
# the controller -> Battery. A second busio.I2C on the same pins would conflict.
ctrl = LockController(ui, touch, i2c)
ble = PhoneBoxBLE()


def _button(name):
    pin = getattr(board, name, None)
    if pin is None:
        return None
    io = digitalio.DigitalInOut(pin)
    io.switch_to_input(pull=digitalio.Pull.UP)
    return io


btn_lock = _button(BTN_LOCK_PIN)
btn_override = _button(BTN_OVERRIDE_PIN)
_prev_lock = True
_prev_override = True

last_activity = time.monotonic()
_cpu_target = 0
_boot_mono = last_activity
_brownout_cleared = False
# BROWNOUT_CLEAR_AFTER_S (lock_config.py): clearing the counter on interpreter
# start (the old behavior) meant every retry re-zeroed it before the board
# ever reached the point of failure, so a servo-triggered brownout seconds
# into a run could reset-loop forever instead of ever hitting safemode.py's
# 5-retry cap.

# PERF_DEBUG accumulators (lock_config.py). Bound unconditionally rather than
# inside `if PERF_DEBUG:` so the names always exist -- the loop's guarded
# blocks read them with `+=`, and a name that only exists in one build is how
# a debug flag turns into a NameError on the box the first time someone flips
# it. Float zeros cost nothing when the flag is off.
_perf_last_report = time.monotonic()
_perf_frames = 0
_perf_total_ms = 0.0
_perf_worst_ms = 0.0
_perf_touch_ms = 0.0
_perf_process_ms = 0.0
_perf_update_ms = 0.0
_perf_ble_ms = 0.0

while True:
    now = time.monotonic()

    # Brightness + sleep policy follow USB power: plugged in -> bright and always
    # on; on battery -> dimmer and sleeps after inactivity.
    usb = supervisor.runtime.usb_connected
    backlight.set_level(ctrl.settings.bright_level())
    if usb and not backlight.is_on:
        backlight.on()
        last_activity = now

    # CPU scaling: screen on -> fast (responsive touch + stable servo PWM);
    # asleep -> slow to save power. Set only when the target actually changes,
    # so touch/servo are never disrupted by a mid-interaction clock switch.
    want_hz = CPU_FAST if backlight.is_on else CPU_SLOW
    if want_hz != _cpu_target:
        _cpu_target = want_hz
        try:
            microcontroller.cpu.frequency = want_hz
        except Exception:
            pass

    # Read + handle touch FIRST so gesture sampling has a steady cadence and is
    # never delayed by the (heavier) clock redraw. process() sets _was_down,
    # which suppresses the clock redraw for this same frame while a finger is
    # down -- keeping swipes consistently responsive in the analog style.
    if PERF_DEBUG:
        _t0 = time.monotonic()
    points = touch.touches
    if PERF_DEBUG:
        _perf_touch_ms += (time.monotonic() - _t0) * 1000.0
    touching = len(points) > 0

    if touching:
        last_activity = now
        if not backlight.is_on:
            # first touch only wakes the screen; ignore it as a gesture
            backlight.on()
            ctrl.reset_gesture()
            time.sleep(0.02)
            continue

    if backlight.is_on:
        if PERF_DEBUG:
            _t0 = time.monotonic()
        ctrl.process(points, now)
        if PERF_DEBUG:
            _perf_process_ms += (time.monotonic() - _t0) * 1000.0
        # sleep the screen after inactivity -- but never while USB-powered,
        # and never mid-alert (an incoming-call flash cut short by the sleep
        # timeout would defeat the point of making it hard to miss).
        # sleep_s == 0 is the user's "never sleep" choice (SLEEP_OPTIONS's
        # Off), NOT a zero-second timeout -- guarded explicitly here, since
        # `now - last_activity > 0` is true on essentially every frame and
        # would blank the screen instantly instead.
        if (not usb and ctrl.settings.sleep_s > 0 and not ctrl.call_alert_active
                and now - last_activity > ctrl.settings.sleep_s):
            backlight.off()
            ctrl.reset_gesture()

    # physical buttons (active-low with pull-ups); act on the press (falling edge)
    if btn_lock is not None:
        v = btn_lock.value
        if _prev_lock and not v:
            ctrl.press_lock(now)
            last_activity = now
            backlight.on()
        _prev_lock = v
    if btn_override is not None:
        v = btn_override.value
        if _prev_override and not v:
            ctrl.press_override()
            last_activity = now
            backlight.on()
        _prev_override = v

    # advance countdown / animation last; wake the screen when the timer finishes
    if PERF_DEBUG:
        _t0 = time.monotonic()
    _woke = ctrl.update(now)
    if PERF_DEBUG:
        _perf_update_ms += (time.monotonic() - _t0) * 1000.0
    if _woke:
        backlight.on()
        last_activity = now

    # Proven-stable check: only clear the brownout-retry counter once the
    # board has run past boot inrush and completed a real update() cycle --
    # not on interpreter start -- so safemode.py's 5-retry cap still catches
    # a brownout triggered later by the servo (see BROWNOUT_CLEAR_AFTER_S above).
    if not _brownout_cleared and now - _boot_mono >= BROWNOUT_CLEAR_AFTER_S:
        _brownout_cleared = True
        try:
            microcontroller.nvm[0] = 0
        except Exception:
            pass

    # BLE companion link is serviced LAST -- after touch, buttons, and update --
    # so radio work can never delay touch sampling or reorder a servo move. It is
    # non-blocking and self-disables if the CP build lacks adafruit_ble.
    if PERF_DEBUG:
        _t0 = time.monotonic()
    ble.service(ctrl, now, backlight.is_on)
    if PERF_DEBUG:
        _perf_ble_ms += (time.monotonic() - _t0) * 1000.0
    ctrl.set_ble_connected(ble.connected)

    # An incoming call redraws the screen (alert overlay, or the unlock
    # animation if "unlock when called" is on) -- wake the backlight so that
    # redraw is actually visible instead of landing on a dark screen.
    if ctrl.consume_call_event():
        backlight.on()
        last_activity = now

    # PERF_DEBUG trace (lock_config.py) -- one line every
    # PERF_DEBUG_INTERVAL_S with the mean and WORST frame of that window,
    # because a user perceives lag as the worst frame, not the average.
    # Everything is inside the guard, so this costs nothing when off.
    if PERF_DEBUG:
        _frame_ms = (time.monotonic() - now) * 1000.0
        _perf_frames += 1
        _perf_total_ms += _frame_ms
        if _frame_ms > _perf_worst_ms:
            _perf_worst_ms = _frame_ms
        if now - _perf_last_report >= PERF_DEBUG_INTERVAL_S:
            _perf_span = now - _perf_last_report
            print("[perf] {}f in {:.1f}s = {:.0f}fps | frame avg {:.1f}ms worst {:.1f}ms"
                  " | touch {:.1f} process {:.1f} update {:.1f} ble {:.1f} (ms, avg)".format(
                      _perf_frames, _perf_span,
                      _perf_frames / _perf_span if _perf_span > 0 else 0.0,
                      _perf_total_ms / _perf_frames, _perf_worst_ms,
                      _perf_touch_ms / _perf_frames, _perf_process_ms / _perf_frames,
                      _perf_update_ms / _perf_frames, _perf_ble_ms / _perf_frames))
            _perf_last_report = now
            _perf_frames = 0
            _perf_total_ms = 0.0
            _perf_worst_ms = 0.0
            _perf_touch_ms = 0.0
            _perf_process_ms = 0.0
            _perf_update_ms = 0.0
            _perf_ble_ms = 0.0

    # Sleep only the REMAINDER of this frame's target period -- see
    # FRAME_AWAKE_S in lock_config.py for why a flat sleep here was wrong.
    # `now` is this frame's start (set at the top of the loop), so the
    # subtraction is the work this frame actually did.
    _target = FRAME_AWAKE_S if backlight.is_on else FRAME_ASLEEP_S
    _remaining = _target - (time.monotonic() - now)
    time.sleep(_remaining if _remaining > FRAME_MIN_SLEEP_S else FRAME_MIN_SLEEP_S)
