"""Host tests for the one state that holds the latch indefinitely --
LockController.go_done's auto-open-off branch (Box-code/lib/
lock_controller_states.py) and the servo half of update()
(lock_controller.py).

WHAT HOLDING MEANS HERE. Every other servo move is followed by relax():
SERVO_HOLD_S of PWM to let the horn arrive, then the pulse stops so the
servo draws no holding current (lock_servo.py's header). "auto_open off,
timer expired, box still shut" is the exception -- the latch has to stay
driven until somebody taps OPEN, so go_done clears _servo_relax_at instead
of arming it.

WHY THAT ONE LINE IS LOAD-BEARING. _servo_relax_at is not only the relax
deadline; it is also the flag update() tests before calling
servo.reassert(). Clearing it to hold the latch therefore also switched OFF
the 50Hz re-assert -- in the single state that needs it most, because it is
the only one where the pulse is still running minutes later. lock_servo.py
says twice (_write_angle and reassert) that "dynamic CPU scaling can shift
the PWM clock", and code.py drops the CPU from CPU_FAST to CPU_SLOW the
moment the screen sleeps. On battery, a session that ends with nobody
standing at the box does exactly that: expire, hold, sleep, downclock -- and
nothing re-asserts the frame the servo is being driven with.

The two halves of that chain live in different files, so neither one looks
wrong on its own. tests/test_screen_sleep.py owns the other half (what the
sleep predicate does, and that CPU frequency is one of the things keyed off
backlight.is_on).

Same construction as tests/test_lock_override.py: lock_controller imports
CircuitPython-only modules at module level, so those are stubbed just enough
for the import. The controller stand-in SUBCLASSES the real LockController
and supplies the attributes __init__ would have built, so every method
exercised below -- update, go_done, engage_lock, release_lock, go_idle -- is
the firmware's own.

Run: python tests/test_lock_servo_hold.py
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "Box-code", "lib"))

for _name in ("board", "pwmio", "supervisor", "microcontroller"):
    if _name not in sys.modules:
        sys.modules[_name] = types.ModuleType(_name)

from lock_controller import LockController  # noqa: E402 -- after the stubs
from lock_config import SERVO_HOLD_S  # noqa: E402

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS " + name)
    else:
        _failed += 1
        print("FAIL " + name + ((" -- " + detail) if detail else ""))


class FakeServo:
    """Records the three things the controller can ask of a servo. reassert()
    is the one under test: on real hardware it re-applies the 50Hz frame, so
    counting calls is counting how often a drifted PWM clock would be
    corrected."""

    def __init__(self):
        self.available = True
        self.angles = []
        self.reasserts = 0
        self.relaxes = 0

    def move(self, angle):
        self.angles.append(angle)

    def reassert(self):
        self.reasserts += 1

    def relax(self):
        self.relaxes += 1

    @property
    def driving(self):
        """True while the servo is still being pulsed -- i.e. moved at least
        once and not relaxed since."""
        return bool(self.angles) and self.relaxes == 0


class FakeUI:
    """Permissive on purpose: this file measures the servo, and naming every
    screen call the controller makes would just be a second, staler copy of
    LockUI's method list. is_flipped is a real property because _map reads it
    as one."""

    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        def _record(*a, **k):
            self.calls.append(name)
        return _record

    @property
    def is_flipped(self):
        return False


class FakeReading:
    available = True
    percent = 80
    volts = 3.9
    charging = False
    watts = None


class FakeBattery:
    def read(self, now):
        return FakeReading()


class FakeSettings:
    def __init__(self, auto_open=False):
        self.auto_open = auto_open
        self.lock_angle = 45
        self.unlock_angle = 0
        self.override_presses = 25
        self.override_timeout = 1.0
        self.sleep_s = 20

    def save(self):
        pass


class FakeLog:
    def __init__(self):
        self.records = []

    def record(self, *a):
        self.records.append(a)


class Box(LockController):
    """A real LockController with a hand-built set of attributes instead of
    the hardware chain __init__ would construct. Every METHOD is inherited,
    so what runs below is the firmware."""

    def __init__(self, auto_open=False, now=1000.0):
        self.ui = FakeUI()
        self.servo = FakeServo()
        self.battery = FakeBattery()
        self.settings = FakeSettings(auto_open=auto_open)
        self.log = FakeLog()
        self.state = "idle"
        self.view = "control"
        self.set_seconds = 300
        self.deadline = now + 300
        self.done_start = 0.0
        self._now = now
        self._last_frame_t = None
        self._last_fkey = None
        self._last_bkey = None
        self._was_down = False
        self._override = 0
        self._override_at = 0.0
        self._servo_relax_at = None
        self._servo_locked = False
        self._done_force_open = False
        self._pending_log = None
        self._session_topic = None
        self._pending_app_topic = None
        self._wall_epoch0 = None
        self._wall_mono0 = None
        self._call_alert_until = None
        self._call_alert_started = 0.0
        self._call_anim_on = None
        self._editing = False
        self._edit_idx = 0
        self._hold_dir = 0

    def run_for(self, seconds, start, step=0.02):
        """Advance the run loop the way code.py does -- update() once per
        frame, nothing else touched."""
        t = start
        end = start + seconds
        while t < end:
            t += step
            self.update(t)
        return t


# --- 1. The premise: expiring with auto_open off holds the latch -----------
box = Box(auto_open=False)
box.state = "running"
box.deadline = 1000.0
t = box.run_for(0.1, 1000.0)          # crosses the deadline -> go_done
check("timer expiry with auto_open off lands in the holding state",
      box.state == "done" and box._servo_locked,
      "state {} locked {}".format(box.state, box._servo_locked))
check("the latch is engaged, not released",
      box.servo.angles[-1] == box.settings.lock_angle, repr(box.servo.angles))
check("and it is still being driven -- no relax while holding",
      box.servo.driving, "relaxes {}".format(box.servo.relaxes))

# Contrast: the ordinary auto-open path stops the pulse on schedule, which is
# what makes the holding state the one exception.
auto = Box(auto_open=True)
auto.state = "running"
auto.deadline = 1000.0
auto.run_for(SERVO_HOLD_S + 0.2, 1000.0)
check("with auto_open ON the servo relaxes after SERVO_HOLD_S",
      auto.servo.relaxes >= 1, "relaxes {}".format(auto.servo.relaxes))


# --- 2. A held latch must keep its 50Hz frame re-asserted ------------------
#
# This is the bug. The servo is driven for as long as the box waits for
# someone to tap OPEN -- minutes, and on battery the screen sleeps and the
# CPU drops to CPU_SLOW during them -- but update() only calls reassert()
# while _servo_relax_at is set, and the holding branch is the one place that
# deliberately clears it.
_before = box.servo.reasserts
t = box.run_for(3.0, t)
check("the held latch is still being driven three seconds on",
      box.servo.driving, "relaxes {}".format(box.servo.relaxes))
check("update() keeps re-asserting 50Hz while the latch is held",
      box.servo.reasserts > _before,
      "reasserts stuck at {} across 3s of frames".format(box.servo.reasserts))

# It has to keep happening, not fire once: the CPU change lands at whatever
# moment the screen happens to sleep, which is minutes after the hold began.
_mid = box.servo.reasserts
t = box.run_for(3.0, t)
check("...and is still re-asserting three seconds after that",
      box.servo.reasserts > _mid,
      "{} -> {}".format(_mid, box.servo.reasserts))


# --- 3. Holding must not leak into the states that relax -------------------
#
# The hold is not a property of the servo, it is a property of ONE state. If
# it outlived that state the box would pulse the servo forever, which is the
# battery drain relax() exists to prevent (lock_servo.py's header) -- a
# quieter regression than the one above, and a worse one for a box left in a
# bag.
opened = Box(auto_open=False)
opened.state = "running"
opened.deadline = 1000.0
t = opened.run_for(0.1, 1000.0)
check("(3) holding before OPEN is tapped", opened.servo.driving)
opened.go_idle()                       # the OPEN tap
t = opened.run_for(SERVO_HOLD_S + 0.5, t)
check("(3) tapping OPEN ends the hold and the servo relaxes",
      opened.servo.relaxes >= 1 and not opened.servo.driving,
      "relaxes {}".format(opened.servo.relaxes))
_settled = opened.servo.reasserts
opened.run_for(1.0, t)
check("(3) nothing keeps re-asserting once the servo has relaxed",
      opened.servo.reasserts == _settled,
      "{} -> {}".format(_settled, opened.servo.reasserts))

# Same for the other two ways out of the holding state: both re-drive the
# servo through engage_lock/release_lock, so both must re-arm the ordinary
# relax timer rather than inherit the hold.
for _exit, _fn in (("go_closed", lambda b: b.go_closed(b._now)),
                   ("go_running", lambda b: b.go_running(b._now))):
    b = Box(auto_open=False)
    b.state = "running"
    b.deadline = 1000.0
    _t = b.run_for(0.1, 1000.0)
    b._now = _t
    _fn(b)
    _t = b.run_for(SERVO_HOLD_S + 0.5, _t)
    check("(3) leaving the holding state via {} restores the relax timer".format(_exit),
          b.servo.relaxes >= 1 and not b.servo.driving,
          "relaxes {}".format(b.servo.relaxes))

# And a plain move outside the holding state still relaxes on schedule --
# the hold flag must start clear, not default on.
plain = Box(auto_open=False)
plain._now = 2000.0
plain.engage_lock()
plain.run_for(SERVO_HOLD_S + 0.5, 2000.0)
check("(3) an ordinary engage_lock still relaxes after SERVO_HOLD_S",
      plain.servo.relaxes == 1, "relaxes {}".format(plain.servo.relaxes))


print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
