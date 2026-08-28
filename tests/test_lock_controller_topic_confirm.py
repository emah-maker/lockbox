"""Host tests for the pre-session CONFIRM/CHANGE wiring in
Box-code/lib/lock_controller.py (LockController.apply_ble_pending_topic /
go_confirming / _apply_topic_confirm_result / go_running / the LOCK-button
branch of _handle_release).

Same stub-module trick as tests/test_lock_controller_swipe.py:
lock_controller.py pulls in Battery/Servo/Settings/SessionLog, which import
CircuitPython-only modules (board, pwmio, supervisor, microcontroller) at
module level, so a real LockController can't be constructed off-device.
Those modules are stubbed out here just so `import lock_controller` succeeds
-- the tests below build bare stand-in objects and call the real bound
methods directly instead of going through LockController.__init__.

Run: python tests/test_lock_controller_topic_confirm.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib"))

for _name in ("board", "pwmio", "supervisor", "microcontroller"):
    if _name not in sys.modules:
        sys.modules[_name] = types.ModuleType(_name)

from lock_controller import LockController
from lock_topic_confirm import Confirm, Change
from lock_config import BUILTIN_TOPICS

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


BUILTIN_ID = BUILTIN_TOPICS[0][0]     # "work"
BUILTIN_NAME = BUILTIN_TOPICS[0][1]   # "Work"


# =========================================================================
# apply_ble_pending_topic: decode + validate against _all_topics()
# =========================================================================
class FakeApplyController:
    apply_ble_pending_topic = LockController.apply_ble_pending_topic
    _all_topics = LockController._all_topics

    def __init__(self):
        self._synced_labels = []
        self._pending_app_topic = None


ctrl = FakeApplyController()
ctrl.apply_ble_pending_topic(BUILTIN_ID)
check("apply_ble_pending_topic stores a known built-in id",
      ctrl._pending_app_topic == BUILTIN_ID)

ctrl = FakeApplyController()
ctrl.apply_ble_pending_topic("not_a_real_topic")
check("apply_ble_pending_topic stores None for an unknown id",
      ctrl._pending_app_topic is None)

ctrl = FakeApplyController()
ctrl._pending_app_topic = BUILTIN_ID   # something previously pending
ctrl.apply_ble_pending_topic("")
check("apply_ble_pending_topic('') clears a previously-pending topic",
      ctrl._pending_app_topic is None)


# =========================================================================
# LOCK-button branch of _handle_release: re-validates at press time and
# routes to go_confirming (known topic) or go_picking (unknown/None) --
# the explicit no-regression requirement.
# =========================================================================
class RecordingTagPicker:
    def __init__(self):
        self.shown = []

    def show(self, page):
        self.shown.append(page)


class RecordingTopicConfirm:
    def __init__(self):
        self.shown = []

    def show(self, name):
        self.shown.append(name)


class FakeUI:
    """Only what _handle_release's control-view LOCK-button path touches --
    a fixed point always reads as "on the button", never on the status bar,
    so a zero-delta press/release always falls through to that branch."""

    def in_status(self, x, y):
        return False

    def in_button(self, x, y):
        return True


class FakeReleaseController:
    """Bare LockController stand-in exercising the real _handle_release /
    go_confirming / go_picking / _all_topics methods, without constructing
    the real Battery/Servo/Settings/SessionLog chain."""

    _handle_release = LockController._handle_release
    go_confirming = LockController.go_confirming
    go_picking = LockController.go_picking
    _all_topics = LockController._all_topics

    def __init__(self, pending_app_topic):
        self.ui = FakeUI()
        self.state = "idle"
        self.view = "control"
        self._editing = False
        self._now = 0.0
        self._start = (50, 50)
        self._last = (50, 50)
        self._synced_labels = []
        self._pending_app_topic = pending_app_topic
        self.tag_picker = RecordingTagPicker()
        self.topic_confirm = RecordingTopicConfirm()


ctrl = FakeReleaseController(pending_app_topic=BUILTIN_ID)
ctrl._handle_release()
check("known pending topic -> LOCK goes to go_confirming (state)",
      ctrl.state == "confirming")
check("known pending topic -> go_confirming shows the resolved name",
      ctrl.topic_confirm.shown == [BUILTIN_NAME])
check("known pending topic -> the tag picker is never shown",
      ctrl.tag_picker.shown == [])

ctrl = FakeReleaseController(pending_app_topic="not_a_real_topic")
ctrl._handle_release()
check("unknown id -> LOCK falls through to go_picking (state)",
      ctrl.state == "picking")
check("unknown id -> the tag picker is shown at page 0",
      ctrl.tag_picker.shown == [0])
check("unknown id -> the confirm screen is never shown",
      ctrl.topic_confirm.shown == [])

ctrl = FakeReleaseController(pending_app_topic=None)
ctrl._handle_release()
check("None (nothing pending) -> LOCK falls through to go_picking -- the "
      "explicit no-regression case",
      ctrl.state == "picking" and ctrl.tag_picker.shown == [0])


# =========================================================================
# _apply_topic_confirm_result: the Change branch must restore self.state to
# self._picking_from BEFORE calling go_picking -- go_picking's own first
# line (`self._picking_from = self.state`) would otherwise capture
# "confirming" instead, breaking the picker's own Cancel-back routing.
# =========================================================================
class RecordingGoPicking:
    """Stands in for the real go_picking -- deliberately NOT the real
    method, so this test isolates exactly what _apply_topic_confirm_result
    itself does to self.state before handing off, independent of
    go_picking's own internals (which test_lock_controller_swipe.py-style
    tests don't need to re-verify here)."""

    def __init__(self):
        self.state_seen_at_call = "unset"

    def __call__(self, now):
        self.state_seen_at_call = self._owner.state


class FakeApplyResultController:
    _apply_topic_confirm_result = LockController._apply_topic_confirm_result

    def __init__(self, picking_from):
        self.state = "confirming"
        self._picking_from = picking_from
        self._pending_app_topic = BUILTIN_ID
        self._recorder = RecordingGoPicking()
        self._recorder._owner = self
        self.go_picking = self._recorder
        self.go_running_calls = []

    def go_running(self, now, topic=None):
        self.go_running_calls.append(topic)


for _picking_from in ("idle", "closed"):
    ctrl = FakeApplyResultController(_picking_from)
    ctrl._apply_topic_confirm_result(Change(), 0.0)
    check("Change restores self.state to _picking_from (%s) before go_picking runs" % _picking_from,
          ctrl._recorder.state_seen_at_call == _picking_from)
    check("Change leaves self.state as _picking_from afterward (%s)" % _picking_from,
          ctrl.state == _picking_from)
    check("Change never calls go_running (%s)" % _picking_from,
          ctrl.go_running_calls == [])

ctrl = FakeApplyResultController("idle")
ctrl._apply_topic_confirm_result(Confirm(), 0.0)
check("Confirm calls go_running with the pending app topic",
      ctrl.go_running_calls == [BUILTIN_ID])


# =========================================================================
# go_running: clears _pending_app_topic (and hides both pre-session
# screens) on EVERY entry path -- including the set_seconds<=0 guard path,
# since the clearing/hiding happens at the very top, ahead of that guard.
# =========================================================================
class RecordingRunUI:
    def __init__(self):
        self.hide_calls = []

    def hide_tag_picker(self):
        self.hide_calls.append("tag_picker")

    def hide_topic_confirm(self):
        self.hide_calls.append("topic_confirm")

    def show_running(self):
        pass


class FakeRunController:
    go_running = LockController.go_running

    def __init__(self, set_seconds):
        self.ui = RecordingRunUI()
        self.set_seconds = set_seconds
        self._pending_app_topic = BUILTIN_ID
        self._session_topic = None
        self._override = None
        self.deadline = None
        self.views_set = []

    def engage_lock(self):
        pass

    def set_view(self, view):
        self.views_set.append(view)


ctrl = FakeRunController(300)
ctrl.go_running(0.0, topic=BUILTIN_ID)
check("go_running (normal path) clears the pending app topic",
      ctrl._pending_app_topic is None)
check("go_running (normal path) hides both pre-session screens",
      "tag_picker" in ctrl.ui.hide_calls and "topic_confirm" in ctrl.ui.hide_calls)
check("go_running (normal path) actually starts the session",
      getattr(ctrl, "state", None) == "running")

ctrl = FakeRunController(0)   # the set_seconds<=0 guard path
ctrl.go_running(0.0, topic=BUILTIN_ID)
check("go_running (guard path, set_seconds<=0) still clears the pending app topic",
      ctrl._pending_app_topic is None)
check("go_running (guard path) still hides both pre-session screens",
      "tag_picker" in ctrl.ui.hide_calls and "topic_confirm" in ctrl.ui.hide_calls)
check("go_running (guard path) does not actually start a session",
      getattr(ctrl, "state", None) != "running")

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
