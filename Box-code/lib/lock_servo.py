# lock_servo.py -- drives an external hobby servo used as the lock actuator.
# Any free GPIO works for the PWM signal (see SERVO_PIN in lock_config). Angle
# is in degrees (-90..90) mapped to a 50Hz servo pulse. After moving, call
# relax() to stop the pulse so the servo stops drawing holding current (saves
# battery and avoids adding to boot brownout). Power the servo from VBAT/VBUS,
# NOT 3V3, with a common ground and a bulk capacitor.
import board
import pwmio

try:
    import microcontroller
except ImportError:
    microcontroller = None

from lock_config import SERVO_PIN, SERVO_MIN_US, SERVO_MAX_US

_PERIOD_US = 20000        # 50 Hz servo frame


def _resolve(name):
    pin = getattr(board, name, None)
    if pin is None and microcontroller is not None:
        pin = getattr(microcontroller.pin, name, None)
    return pin


class Servo:
    def __init__(self):
        pin = _resolve(SERVO_PIN)
        try:
            # variable_frequency so we can re-assert 50Hz after CPU-clock changes
            self._pwm = (pwmio.PWMOut(pin, frequency=50, variable_frequency=True)
                         if pin is not None else None)
            self.available = self._pwm is not None
        except Exception:
            self._pwm = None
            self.available = False

    def _write_angle(self, angle):
        if not self.available:
            return
        a = max(-90.0, min(90.0, float(angle)))
        us = SERVO_MIN_US + (a + 90.0) / 180.0 * (SERVO_MAX_US - SERVO_MIN_US)
        # dynamic CPU scaling can shift the PWM clock; re-assert 50Hz each move
        try:
            self._pwm.frequency = 50
        except (ValueError, AttributeError):
            pass
        self._pwm.duty_cycle = int(us / _PERIOD_US * 65535)

    def move(self, angle):
        # move to an arbitrary angle (used for the configurable lock/unlock
        # angles and for live preview while tuning them)
        self._write_angle(angle)

    def reassert(self):
        # re-apply 50Hz in case a CPU-clock change shifted the PWM timer
        if self.available:
            try:
                self._pwm.frequency = 50
            except (ValueError, AttributeError):
                pass

    def relax(self):
        # stop sending pulses so the servo stops drawing holding current
        if self.available:
            self._pwm.duty_cycle = 0
