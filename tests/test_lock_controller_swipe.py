"""Host tests for the horizontal-swipe view-switch direction in
Box-code/lib/lock_controller.py (LockController._handle_release).

lock_controller.py pulls in Battery/Servo/Settings/SessionLog, which import
CircuitPython-only modules (board, pwmio, supervisor, microcontroller) at
module level, so a real LockController can't be constructed off-device.
Those modules are stubbed out here just so `import lock_controller` succeeds
-- none of their attributes are touched, since the tests below build a bare
stand-in object and call the real _handle_release directly instead of going
through LockController.__init__.

process() maps every raw touch point through _map() before it ever reaches
self._start/self._last (see LockController.process), so by the time
_handle_release computes dx = self._last[0] - self._start[0], the INVERT_X/
is_flipped correction has already been applied exactly once. The bug this
guards against: re-applying that same correction to dx in the swipe-decision
line double-corrects and cancels back down to raw-touch-axis sign, so the
view-switch direction silently depended on whatever (INVERT_X, is_flipped)
combination happened to be true at tuning time instead of tracking the
screen. A fixed mapped dx must therefore drive the same view switch under
all four (screen_flipped, INVERT_X) combinations.

Run: python tests/test_lock_controller_swipe.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib"))

for _name in ("board", "pwmio", "supervisor", "microcontroller"):
    if _name not in sys.modules:
        sys.modules[_name] = types.ModuleType(_name)

import lock_controller
from lock_controller import LockController, VIEWS

_passed = 0
_failed = 0


def check(name, cond):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS", name)
    else:
        _failed += 1
        print("FAIL", name)


class FakeUI:
    W = 172
    H = 320

    def __init__(self, is_flipped):
        self.is_flipped = is_flipped

    def in_status(self, x, y):
        return False


class FakeController:
    """Bare LockController stand-in carrying only what _handle_release's
    horizontal-swipe branch touches, so the test never has to construct the
    real Battery/Servo/Settings/SessionLog chain."""

    _handle_release = LockController._handle_release

    def __init__(self, is_flipped):
        self.ui = FakeUI(is_flipped)
        self.state = "idle"          # not "running": exercises the VIEWS branch
        self.view = "control"        # VIEWS = (clock, control, battery, settings)
        self._editing = False
        self._now = 0.0
        self.views_seen = []

    def set_view(self, view):
        self.views_seen.append(view)


def _swipe(is_flipped, invert_x, mapped_dx, mapped_dy=0, view="control"):
    """Run one release with self._start/self._last already at the given
    mapped (post-_map) screen-space delta, for one (is_flipped, INVERT_X)
    combination, and return the view landed on (or None)."""
    lock_controller.INVERT_X = invert_x
    ctrl = FakeController(is_flipped)
    ctrl.view = view
    ctrl._start = (100, 200)
    ctrl._last = (100 + mapped_dx, 200 + mapped_dy)
    ctrl._handle_release()
    return ctrl.views_seen[-1] if ctrl.views_seen else None


_orig_invert_x = lock_controller.INVERT_X
try:
    for is_flipped in (False, True):
        for invert_x in (False, True):
            label = "flipped=%s invert_x=%s" % (is_flipped, invert_x)

            # A LEFTWARD swipe in already-mapped screen space must always
            # advance to the next view (control -> battery), regardless of
            # flip/calibration -- the correction was already applied once by
            # _map before self._start/self._last were ever set.
            #
            # Leftward, not rightward: the content follows the finger, so
            # dragging left brings the next view in from the right. These two
            # cases asserted the opposite until the direction was reported
            # wrong in BOTH orientations -- they had been pinning the bug, and
            # their flip-invariance (the part that IS right, and the reason
            # this file exists) was what made the real fault hard to see: a
            # gesture can be perfectly orientation-independent and still point
            # the wrong way.
            check(
                "swipe left advances view (%s)" % label,
                _swipe(is_flipped, invert_x, -60) == "battery",
            )

            # A rightward swipe must always go back (control -> clock).
            check(
                "swipe right goes back (%s)" % label,
                _swipe(is_flipped, invert_x, 60) == "clock",
            )
finally:
    lock_controller.INVERT_X = _orig_invert_x

# A vertical-dominant drag (dy > dx, both past SWIPE_MIN_PX) must never be
# read as a horizontal swipe -- guards the abs(dx) > abs(dy) gate itself.
# view="battery" so the rest of _handle_release's control-view-only tap/
# button handling (which FakeUI/FakeController don't model) is never reached.
check(
    "vertical-dominant drag does not switch views",
    _swipe(False, False, 40, 100, view="battery") is None,
)

print("\n%d passed, %d failed" % (_passed, _failed))
if _failed:
    sys.exit(1)
