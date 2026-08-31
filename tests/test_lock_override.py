"""Host tests for the physical override button's press handler,
LockController.press_override (Box-code/lib/lock_controller_gestures.py).

WHAT THIS PATH IS. The override button is the box's only always-available
emergency unlock: press it settings.override_presses times (default 25), each
press within settings.override_timeout of the last (default 1.0s, shortened
from 3.0s), and the latch opens. Miss the window once and the counter silently
resets to zero. There is no other way out of a locked box before the timer
expires, so every millisecond of that window is load-bearing.

THE BUG THIS PINS. press_override took no `now` and stamped the press with
self._now -- a cached value written only by process() and update(). code.py
polls the buttons BETWEEN those two calls, so the stamp was always one frame
behind, and while the screen is asleep process() is skipped entirely and the
loop runs at FRAME_ASLEEP_S: a stamp 100ms stale against a 1.0s window, thrown
away on every press. It cannot be seen in the values that come back out -- the
counter still increments, the overlay still draws -- it only shows up as a
sequence that resets sooner than the on-screen bar says it should.

Same construction as test_lock_controller_swipe.py: lock_controller imports
CircuitPython-only modules at module level, so those are stubbed just enough
for the import, and the real mixin method is called against a bare stand-in
rather than a constructed LockController.

Run: python tests/test_lock_override.py
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
from lock_config import OVERRIDE_PRESSES, OVERRIDE_TIMEOUT  # noqa: E402

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS", name)
    else:
        _failed += 1
        print("FAIL", name, "--", detail)


class FakeUI:
    def __init__(self):
        self.shown = []
        self.hidden = 0
        self.timeouts = []

    def show_override(self, count, total):
        self.shown.append((count, total))

    def update_override_timeout(self, remaining, total):
        self.timeouts.append((remaining, total))

    def hide_override(self):
        self.hidden += 1


class FakeSettings:
    def __init__(self, presses=OVERRIDE_PRESSES, timeout=OVERRIDE_TIMEOUT):
        self.override_presses = presses
        self.override_timeout = timeout


class FakeController:
    """Bare LockController stand-in carrying only what press_override and
    _clear_override touch -- no Battery/Servo/Settings/SessionLog chain."""

    press_override = LockController.press_override
    _clear_override = LockController._clear_override

    def __init__(self, state="running", servo_locked=True, **kw):
        self.ui = FakeUI()
        self.settings = FakeSettings(**kw)
        self.state = state
        self._servo_locked = servo_locked
        self._override = 0
        self._override_at = 0.0
        self._now = 0.0
        self.opened = []

    def go_done(self, now, reason=None):
        self.opened.append(("done", now))

    def go_idle(self):
        self.opened.append(("idle", None))


# --- 1. The press is stamped with the caller's clock, not the cached one ----
# The run loop's real shape: update() left self._now at the previous frame,
# the button is polled now, and this frame's `now` is 100ms later (10Hz asleep).
c = FakeController()
c._now = 500.0
c.press_override(500.1)
check("(1) the press is stamped with the time it was read, not the last frame",
      abs(c._override_at - 500.1) < 1e-9, repr(c._override_at))
check("(1) no window is lost to the cached timestamp",
      c._override_at - c._now > 0.0,
      "stamp {} vs cached {}".format(c._override_at, c._now))

# A whole sequence at a cadence that fits the window must keep fitting it.
# 25 presses 0.9s apart, 1.0s window: every gap has 0.1s of slack. Under the
# old stamping each gap measured 0.9 + 0.1 stale = exactly the full window,
# leaving none -- which is how a sequence the bar showed as safe still reset.
c = FakeController()
t = 1000.0
lost = []
for i in range(OVERRIDE_PRESSES - 1):
    c._now = t - 0.1               # cached value lags one asleep frame
    c.press_override(t)
    lost.append(round(t - c._override_at, 9))
    t += 0.9
check("(1) a 0.9s cadence leaves the whole window intact on every press",
      all(g == 0.0 for g in lost), repr(sorted(set(lost))))

# The old no-arg call still works (nothing else calls it, but the default is
# what makes this change safe to land without touching every call site).
c = FakeController()
c._now = 42.0
c.press_override()
check("(1) a no-arg call still falls back to the cached clock",
      abs(c._override_at - 42.0) < 1e-9, repr(c._override_at))

# --- 2. The state gate is exactly what the docstring claims ----------------
# Worth pinning because "nothing happens when I press it" is indistinguishable
# from a dead button, and three of these states are silent no-ops by design.
for st in ("running", "closed"):
    c = FakeController(state=st)
    c.press_override(1.0)
    check("(2) override counts in state " + st,
          c._override == 1 and c.ui.shown == [(1, OVERRIDE_PRESSES)],
          "count {} shown {}".format(c._override, c.ui.shown))

for st in ("idle", "picking", "confirming"):
    c = FakeController(state=st)
    c.press_override(1.0)
    check("(2) override is a silent no-op in state " + st,
          c._override == 0 and c.ui.shown == [],
          "count {} shown {}".format(c._override, c.ui.shown))

c = FakeController(state="done", servo_locked=True)
c.press_override(1.0)
check("(2) override counts in done while the latch is still shut",
      c._override == 1, repr(c._override))

c = FakeController(state="done", servo_locked=False)
c.press_override(1.0)
check("(2) override is a no-op in done once the box is actually open",
      c._override == 0, repr(c._override))

# --- 3. Reaching the target unlocks, and from the right state --------------
c = FakeController(state="running", presses=3)
for i in range(3):
    c.press_override(1000.0 + i * 0.5)
check("(3) hitting the target from running unlocks",
      c.opened == [("done", 1001.0)], repr(c.opened))
check("(3) the unlock carries the press's own timestamp",
      bool(c.opened) and c.opened[0][1] == 1001.0, repr(c.opened))
check("(3) the counter is cleared once it fires", c._override == 0)
check("(3) the overlay is dismissed once it fires", c.ui.hidden == 1)

c = FakeController(state="done", servo_locked=True, presses=3)
for i in range(3):
    c.press_override(1000.0 + i * 0.5)
check("(3) hitting the target from the done holding state force-opens it",
      c.opened == [("idle", None)], repr(c.opened))

# --- 4. Each press restarts the countdown bar at full ----------------------
# The bar is the only warning before a silent reset, so a press that counts
# but does not refill it would show the user a window that is already dying.
c = FakeController()
c.press_override(1.0)
c.press_override(1.5)
check("(4) every counted press refills the countdown bar",
      c.ui.timeouts == [(OVERRIDE_TIMEOUT, OVERRIDE_TIMEOUT)] * 2,
      repr(c.ui.timeouts))

print("")
print("{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
