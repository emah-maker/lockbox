# code.py -- entry point for the touchscreen lock timer.
# Modules live in /lib: lock_config, lock_ui, lock_power, lock_controller, axs5106l
import time
import board
import busio
import microcontroller
import supervisor
import digitalio

# A successful normal boot clears the brownout-retry counter used by safemode.py
try:
    microcontroller.nvm[0] = 0
except Exception:
    pass

from axs5106l import AXS5106L
from lock_ui import LockUI
from lock_power import Backlight
from lock_controller import LockController
from lock_ble import PhoneBoxBLE
from lock_config import (INACTIVITY_S, BL_LEVEL, BL_LEVEL_USB,
                         BTN_LOCK_PIN, BTN_OVERRIDE_PIN,
                         CPU_FAST, CPU_SLOW)

# ----- Display + UI -----
display = board.DISPLAY
ui = LockUI(display)
backlight = Backlight(display)

# ----- Touch -----
try:
    i2c = board.TOUCH_I2C()
except AttributeError:
    i2c = busio.I2C(board.SCL, board.SDA)
reset_pin = getattr(board, "TOUCH_RST", None)
touch = AXS5106L(i2c, reset_pin=reset_pin)

# The MAX17048 fuel gauge shares this same I2C bus (@ 0x36), so hand the bus to
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
    points = touch.touches
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
        ctrl.process(points, now)
        # sleep the screen after inactivity -- but never while USB-powered
        if not usb and now - last_activity > ctrl.settings.sleep_s:
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
    if ctrl.update(now):
        backlight.on()
        last_activity = now

    # BLE companion link is serviced LAST -- after touch, buttons, and update --
    # so radio work can never delay touch sampling or reorder a servo move. It is
    # non-blocking and self-disables if the CP build lacks adafruit_ble.
    ble.service(ctrl, now, backlight.is_on)

    # poll fast enough while asleep that a button press is caught to wake it
    time.sleep(0.02 if backlight.is_on else 0.1)
