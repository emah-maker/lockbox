"""Host tests for the screen-sleep predicate in firmware/code.py.

WHAT SLEEPS, AND WHY IT IS WORTH A TEST. On battery the box blanks the LCD
after `sleep_s` idle seconds, and `backlight.is_on` is then the single input
to three other policies in the same loop: CPU frequency (240MHz -> 80MHz),
whether ctrl.process() runs at all, and whether BLE advertises (lock_ble.
_want_advertise takes `awake`). So the one `if` below is the whole
battery-saving path, not just the brightness.

It shipped broken. LockController.call_alert_active was a plain method, and
code.py read it as a bare attribute -- a bound method object, always truthy,
so `not ctrl.call_alert_active` was permanently False and backlight.off() was
unreachable. Nothing anywhere said so: it parses, it imports, every name
resolves, and on a bench box on USB power (where the predicate is
short-circuited by `not usb` anyway) it looks completely normal.

HOW THIS FILE TESTS IT. code.py is not importable on a host -- it opens
board.DISPLAY, builds the UI, and never returns from its run loop. So rather
than restate the predicate here (a copy would have been written with the same
bug, and would keep passing after a real edit to code.py), the test lifts the
actual `if` test expression out of code.py's AST and evaluates THAT against a
real LockController.call_alert_active and real Settings values. What runs here
is the text that runs on the box.

Run: python tests/test_screen_sleep.py
"""
import ast
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "firmware", "lib"))

for _name in ("board", "pwmio", "supervisor", "microcontroller"):
    if _name not in sys.modules:
        sys.modules[_name] = types.ModuleType(_name)

from lock_controller import LockController  # noqa: E402 -- after the stubs
from lock_config import BLE_CALL_ALERT_S, SLEEP_OPTIONS  # noqa: E402

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


# --- Lift the real predicate out of code.py --------------------------------
#
# Located by what it DOES (its body turns the backlight off), not by line
# number or source text, so moving or rewording it keeps this test pointed at
# the right statement instead of silently testing nothing.
_CODE_PY = os.path.join(REPO, "firmware", "code.py")
_tree = ast.parse(open(_CODE_PY, encoding="utf-8").read(), _CODE_PY)


def _turns_backlight_off(node):
    """True for the `if` whose OWN body blanks the screen. Deliberately not a
    walk() of the whole subtree: this branch is nested inside `if
    backlight.is_on:`, and a subtree walk matches that enclosing statement
    too, whose test is a different (and correct) thing entirely."""
    for stmt in node.body:
        n = stmt.value if isinstance(stmt, ast.Expr) else None
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "off"
                and isinstance(n.func.value, ast.Name)
                and n.func.value.id == "backlight"):
            return True
    return False


_sleep_ifs = [n for n in ast.walk(_tree)
              if isinstance(n, ast.If) and _turns_backlight_off(n)]
check("found exactly one sleep-the-screen branch in code.py",
      len(_sleep_ifs) == 1, "found {}".format(len(_sleep_ifs)))
if len(_sleep_ifs) != 1:
    print("\n{} passed, {} failed".format(_passed, _failed))
    sys.exit(1)

print("      predicate under test: code.py line {}".format(_sleep_ifs[0].test.lineno))
_expr = ast.Expression(_sleep_ifs[0].test)
ast.fix_missing_locations(_expr)
_PREDICATE = compile(_expr, _CODE_PY, "eval")


# --- A controller real enough for it ---------------------------------------
class FakeUI:
    def __init__(self):
        self.alerts = []

    def show_call_alert(self, who):
        self.alerts.append(who)

    def hide_call_alert(self):
        self.alerts.append(None)


class FakeSettings:
    def __init__(self, sleep_s=20, unlock_on_call=False):
        self.sleep_s = sleep_s
        self.unlock_on_call = unlock_on_call


class FakeController:
    """Bare LockController stand-in carrying only what notify_call and
    call_alert_active touch, so the test never has to construct the real
    Battery/Servo/Settings/SessionLog chain (those need real hardware).

    The three members below are bound off the real class, so this exercises
    the firmware's own definitions -- including whether call_alert_active is
    a property, which is the whole point."""

    notify_call = LockController.notify_call
    consume_call_event = LockController.consume_call_event
    call_alert_active = LockController.call_alert_active

    def __init__(self, sleep_s=20):
        self.ui = FakeUI()
        self.settings = FakeSettings(sleep_s=sleep_s)
        self.state = "running"          # notify_call only acts while locked
        self._call_event = False
        self._call_alert_until = None
        self._call_alert_started = None
        self._call_anim_on = None


def would_sleep(usb, ctrl, idle_for):
    """Evaluate code.py's own predicate for a box idle for `idle_for` seconds.
    now/last_activity are exactly what the run loop feeds it."""
    return bool(eval(_PREDICATE, {}, {   # noqa: S307 -- compiled from our own repo
        "usb": usb,
        "ctrl": ctrl,
        "now": 1000.0,
        "last_activity": 1000.0 - idle_for,
    }))


# --- 1. The predicate ------------------------------------------------------
#
# The first of these is the one that was false on shipped firmware.
ctrl = FakeController(sleep_s=20)
check("on battery, idle past sleep_s, no alert -> screen sleeps",
      would_sleep(usb=False, ctrl=ctrl, idle_for=21.0))
check("on battery, not yet idle past sleep_s -> stays awake",
      not would_sleep(usb=False, ctrl=ctrl, idle_for=19.0))
check("exactly at sleep_s -> stays awake (strict >; sleeps one poll later)",
      not would_sleep(usb=False, ctrl=ctrl, idle_for=20.0))
check("on USB power, however idle -> never sleeps",
      not would_sleep(usb=True, ctrl=ctrl, idle_for=10_000.0))

# sleep_s comes from NVM and is app-adjustable (SLEEP_OPTIONS), so the
# threshold has to track the live setting rather than INACTIVITY_S.
for _s in [o for o in SLEEP_OPTIONS if o > 0]:
    _c = FakeController(sleep_s=_s)
    check("sleep_s={} is the threshold actually used".format(_s),
          would_sleep(False, _c, _s + 1.0) and not would_sleep(False, _c, _s - 1.0))

# --- 1b. Off means never, not immediately ------------------------------
#
# sleep_s == 0 is SLEEP_OPTIONS's "never sleep" choice. The trap is that it
# reads as a threshold: `now - last_activity > 0` is true on essentially
# every frame, so a predicate that only compares would blank the screen
# INSTANTLY for the user who just asked it never to -- the most complete
# possible inversion of the setting, and one that looks like a broken
# backlight rather than a misread option.
check("0 is a real member of SLEEP_OPTIONS, so the box and app can offer Off",
      0 in SLEEP_OPTIONS, repr(SLEEP_OPTIONS))
_off = FakeController(sleep_s=0)
check("Off: an idle box does not sleep after a long idle",
      not would_sleep(usb=False, ctrl=_off, idle_for=10_000.0))
check("Off: nor after one frame, which is what a bare `> 0` compare would do",
      not would_sleep(usb=False, ctrl=_off, idle_for=0.02))
check("Off: nor at exactly zero idle time",
      not would_sleep(usb=False, ctrl=_off, idle_for=0.0))
# A negative can only arrive from a corrupt NVM byte, but it must fail the
# same way Off does rather than the same way a threshold does.
check("a negative sleep_s is treated as Off, not as an instant timeout",
      not would_sleep(usb=False, ctrl=FakeController(sleep_s=-5), idle_for=10_000.0))
# ...and switching back to a real timeout still works on the same controller.
_off.settings.sleep_s = 20
check("switching Off back to 20s restores the timeout",
      would_sleep(usb=False, ctrl=_off, idle_for=21.0)
      and not would_sleep(usb=False, ctrl=_off, idle_for=19.0))

# --- 2. An incoming call holds the screen on -------------------------------
#
# Not just the initial wake: the alert flashes for BLE_CALL_ALERT_S, and a
# sleep timeout landing mid-flash would defeat the point of the alert.
ctrl = FakeController(sleep_s=20)
check("no call yet -> call_alert_active is False", ctrl.call_alert_active is False)

ctrl.notify_call("Mom", 1000.0)
check("notify_call raises the alert", ctrl.call_alert_active is True)
check("notify_call sets the wake event for code.py", ctrl.consume_call_event() is True)
check("the wake event fires at most once", ctrl.consume_call_event() is False)
check("mid-alert, an idle box does NOT sleep",
      not would_sleep(usb=False, ctrl=ctrl, idle_for=10_000.0))

# ...and once the alert times out, the ordinary timeout applies again.
ctrl._call_alert_until = None
check("after the alert clears, an idle box sleeps again",
      would_sleep(usb=False, ctrl=ctrl, idle_for=21.0))
check("BLE_CALL_ALERT_S is a real bound, not unlimited",
      isinstance(BLE_CALL_ALERT_S, (int, float)) and 0 < BLE_CALL_ALERT_S < 120,
      repr(BLE_CALL_ALERT_S))

# "unlock when called" takes the other branch of notify_call -- it releases the
# latch instead of flashing, so there is no alert to hold the screen on, but the
# wake event must still fire or the unlock animation plays on a dark screen.
_opened = []
ctrl = FakeController(sleep_s=20)
ctrl.settings.unlock_on_call = True
ctrl.go_done = lambda now, why, force_open=False: _opened.append(force_open)
ctrl.notify_call("Mom", 1000.0)
check("unlock_on_call opens the latch instead of alerting", _opened == [True])
check("unlock_on_call still wakes the screen", ctrl.consume_call_event() is True)

# notify_call is a no-op when the box is not holding a phone.
for _state in ("idle", "done"):
    _c = FakeController()
    _c.state = _state
    _c.notify_call("Mom", 1000.0)
    check("a call while {} raises nothing".format(_state),
          _c.call_alert_active is False and _c.consume_call_event() is False)


# --- 3. The class of bug, not just this instance ---------------------------
#
# The fault was a method read as a bare attribute in a boolean context: always
# truthy, always silent. code.py's loop tests three such flags across three
# different objects (backlight.is_on, ble.connected, ctrl.call_alert_active),
# and any of them regressing from property to method breaks its policy the
# same way. So rather than pin this one name, walk every attribute code.py
# reads as a truth value and confirm none of them is a plain function on the
# firmware class that defines it.
import lock_ble  # noqa: E402 -- after the stubs above, deliberately
import lock_power  # noqa: E402

_FIRMWARE_CLASSES = (LockController, lock_power.Backlight, lock_ble.PhoneBoxBLE)

_kind = {}
for _cls in _FIRMWARE_CLASSES:
    for _base in _cls.__mro__:
        for _name, _val in vars(_base).items():
            if _name.startswith("__"):
                continue
            _kind.setdefault(_name, []).append(
                (_cls.__name__,
                 "method" if isinstance(_val, types.FunctionType) else "value"))


def _bool_context_attrs(tree):
    """Every attribute READ directly as a truth value: an if/while/ternary
    test, an operand of and/or, or the operand of `not`."""
    found = []

    def collect(node):
        if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Load):
            found.append(node)
        elif isinstance(node, ast.BoolOp):
            for v in node.values:
                collect(v)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            collect(node.operand)

    for n in ast.walk(tree):
        if isinstance(n, (ast.If, ast.While, ast.IfExp)):
            collect(n.test)
        elif isinstance(n, ast.BoolOp):
            for v in n.values:
                collect(v)
        elif isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.Not):
            collect(n.operand)
    return found


_uncalled = []
for _node in _bool_context_attrs(_tree):
    for _owner, _k in _kind.get(_node.attr, ()):
        if _k == "method":
            _uncalled.append("code.py:{} `{}` is a method on {} -- missing ()".format(
                _node.lineno, _node.attr, _owner))
check("no firmware method is read as a bare flag in code.py",
      not _uncalled, "; ".join(sorted(set(_uncalled))))

# And the three flags that loop does test are all real properties.
for _cls, _flag in ((LockController, "call_alert_active"),
                    (lock_power.Backlight, "is_on"),
                    (lock_ble.PhoneBoxBLE, "connected")):
    _defn = next((vars(b)[_flag] for b in _cls.__mro__ if _flag in vars(b)), None)
    check("{}.{} is a property, not a method".format(_cls.__name__, _flag),
          isinstance(_defn, property), type(_defn).__name__)


print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
