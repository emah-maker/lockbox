"""Host tests for the settings-list interaction state in
Box-code/lib/lock_settings_nav.py.

SettingsNav has no hardware imports (lock_config -> lock_util, both pure
Python), so it runs as-is under plain CPython -- same deal as TagPicker in
test_lock_tag_picker.py, which is this file's template. It's driven here
through a FakeUI that reproduces LockUI's real settings-row hit-testing
geometry (a 46px band per row starting at y=40) but just records which
press/hold/hint calls fired, instead of touching displayio.

The rows that matter most here are 4 ("Remote") and 5 ("On call"): the box's
only two security-weakening settings, and the only rows that ever arm a
hold. Turning either OFF is a plain tap (safe direction); turning either ON
requires a hold past SETTINGS_HOLD_S, and only a COMPLETED hold may do it --
an accidental tap on an OFF risky row must be inert. Most of the checks below
exist to pin exactly that asymmetry and its edge cases (drift, drag, jitter,
mid-touch commit, no double-commit on release).

Run: python tests/test_lock_settings_nav.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib"))

from lock_config import SETTINGS_HOLD_S, SWIPE_MIN_PX
from lock_settings_nav import SettingsNav, Open, Changed

_passed = 0
_failed = 0


def check(name, ok, detail=""):
    global _passed, _failed
    if ok:
        _passed += 1
        print("PASS " + name)
    else:
        _failed += 1
        print("FAIL " + name + ((" -- " + detail) if detail else ""))


# ----- fixed row semantics (see lock_settings_nav._HOLD_ROWS's comment) -----
ROW_OVERRIDE = 0   # numeric
ROW_AUTO = 1       # boolean, plain tap either way
ROW_SLEEP = 2      # numeric
ROW_BRIGHT = 3     # numeric
ROW_REMOTE = 4     # boolean, hold-to-enable
ROW_ONCALL = 5     # boolean, hold-to-enable

NUMERIC_ROWS = (ROW_OVERRIDE, ROW_SLEEP, ROW_BRIGHT)
HOLD_ROWS = (ROW_REMOTE, ROW_ONCALL)

_ROW_Y0 = 40   # matches LockUI's real settings-row band start
_ROW_H = 46    # ...and its per-row height
_N_ROWS = 6


def row_y(row):
    """A comfortable mid-row y for row index N (40 + N*46 + 20) -- avoids
    magic numbers scattered through the tests below, and matches the real
    band LockUI.settings_row_at uses."""
    return _ROW_Y0 + row * _ROW_H + 20


class FakeUI:
    """Records every call SettingsNav makes instead of drawing anything.
    settings_row_at is programmable (self.row_at_fn) so a test can force a
    miss (-1) independently of the default geometry."""

    def __init__(self):
        self.calls = []   # ordered log of (method, *args) for assertions
        self.row_at_fn = self._default_row_at

    def _default_row_at(self, y):
        if y < _ROW_Y0:
            return -1
        row = (y - _ROW_Y0) // _ROW_H
        if row >= _N_ROWS:
            return -1
        return row

    def settings_row_at(self, y):
        row = self.row_at_fn(y)
        self.calls.append(("settings_row_at", y, row))
        return row

    def press_settings_row(self, row):
        self.calls.append(("press_settings_row", row))

    def start_settings_hold(self, row):
        self.calls.append(("start_settings_hold", row))

    def step_settings_hold(self, row, progress):
        self.calls.append(("step_settings_hold", row, progress))

    def cancel_settings_hold(self):
        self.calls.append(("cancel_settings_hold",))

    def set_settings_row_hint(self, row, text):
        self.calls.append(("set_settings_row_hint", row, text))

    def names(self, method):
        return [c[0] for c in self.calls if c[0] == method]


class FakeSettings:
    """Just the fields SettingsNav reads/writes, plus a `saved` counter --
    the nav must NEVER call save() itself; the controller's single debounced
    save() call is the only persistence point (see Changed's docstring and
    _resolve_tap's row==1 comment)."""

    def __init__(self, auto_open=False, allow_remote_unlock=False, unlock_on_call=False):
        self.auto_open = auto_open
        self.allow_remote_unlock = allow_remote_unlock
        self.unlock_on_call = unlock_on_call
        self.saved = 0

    def save(self):
        self.saved += 1


def make_nav(settings=None):
    ui = FakeUI()
    settings = settings if settings is not None else FakeSettings()
    nav = SettingsNav(ui, lambda: settings)
    return nav, ui, settings


def _risky_field(settings, row):
    return settings.allow_remote_unlock if row == ROW_REMOTE else settings.unlock_on_call


# (1) tap on each numeric row opens its detail page
for _row in NUMERIC_ROWS:
    nav, ui, settings = make_nav()
    y = row_y(_row)
    nav.on_touch((10, y), 0.0, released=False)
    r = nav.on_touch((10, y), 0.05, released=True)
    check("(1) tap on numeric row %d returns Open(%d)" % (_row, _row),
          isinstance(r, Open) and r.row == _row,
          "got %r" % r)

# (2) tap on row 1 (Auto) flips auto_open, both directions
nav, ui, settings = make_nav(FakeSettings(auto_open=False))
y = row_y(ROW_AUTO)
nav.on_touch((10, y), 0.0, released=False)
r = nav.on_touch((10, y), 0.05, released=True)
check("(2) tap on Auto (off->on) returns Changed(1) and flips the field",
      isinstance(r, Changed) and r.row == ROW_AUTO and settings.auto_open is True)
nav.on_touch((10, y), 0.0, released=False)
r = nav.on_touch((10, y), 0.05, released=True)
check("(2) tap on Auto (on->off) returns Changed(1) and flips the field back",
      isinstance(r, Changed) and r.row == ROW_AUTO and settings.auto_open is False)

# (3) tap on an ON risky row turns it off, single tap, no hold
for _row in HOLD_ROWS:
    kwargs = {"allow_remote_unlock": True} if _row == ROW_REMOTE else {"unlock_on_call": True}
    nav, ui, settings = make_nav(FakeSettings(**kwargs))
    y = row_y(_row)
    nav.on_touch((10, y), 0.0, released=False)
    check("(3) touch-down on an ON risky row (%d) never arms a hold" % _row,
          ("start_settings_hold", _row) not in ui.calls)
    check("(3) touch-down on an ON risky row (%d) sets no hint" % _row,
          not any(c[0] == "set_settings_row_hint" for c in ui.calls))
    r = nav.on_touch((10, y), 0.05, released=True)
    check("(3) tap on ON risky row %d returns Changed(%d)" % (_row, _row),
          isinstance(r, Changed) and r.row == _row)
    check("(3) tap on ON risky row %d turns the field off" % _row,
          _risky_field(settings, _row) is False)

# (4) tap on an OFF risky row does nothing -- field must stay untouched
for _row in HOLD_ROWS:
    nav, ui, settings = make_nav()
    y = row_y(_row)
    nav.on_touch((10, y), 0.0, released=False)
    r = nav.on_touch((10, y), 0.05, released=True)   # quick tap, well under SETTINGS_HOLD_S
    check("(4) quick tap on OFF risky row %d returns None" % _row, r is None)
    check("(4) quick tap on OFF risky row %d leaves the field OFF" % _row,
          _risky_field(settings, _row) is False)

# (5) holding an OFF risky row past SETTINGS_HOLD_S commits LIVE, mid-touch
for _row in HOLD_ROWS:
    nav, ui, settings = make_nav()
    y = row_y(_row)
    nav.on_touch((10, y), 0.0, released=False)
    r = nav.on_touch((10, y), SETTINGS_HOLD_S + 0.01, released=False)   # released=False: still mid-touch
    check("(5) holding OFF risky row %d past SETTINGS_HOLD_S commits Changed(%d) mid-touch" % (_row, _row),
          isinstance(r, Changed) and r.row == _row)
    check("(5) the commit actually flips the field to True", _risky_field(settings, _row) is True)

# (6) holding just under SETTINGS_HOLD_S then releasing -- no commit, field stays OFF
for _row in HOLD_ROWS:
    nav, ui, settings = make_nav()
    y = row_y(_row)
    nav.on_touch((10, y), 0.0, released=False)
    nav.on_touch((10, y), SETTINGS_HOLD_S - 0.05, released=False)
    r = nav.on_touch((10, y), SETTINGS_HOLD_S - 0.05, released=True)
    check("(6) releasing just under SETTINGS_HOLD_S on row %d returns None" % _row, r is None)
    check("(6) releasing just under SETTINGS_HOLD_S on row %d leaves it OFF" % _row,
          _risky_field(settings, _row) is False)

# (7) step_settings_hold progress is monotonically increasing and never >= 1.0
#     in a call that also steps (the commit call itself never steps)
nav, ui, settings = make_nav()
y = row_y(ROW_REMOTE)
nav.on_touch((10, y), 0.0, released=False)
for _t in (0.2, 0.4, 0.6, 0.8):
    nav.on_touch((10, y), _t, released=False)
progresses = [c[2] for c in ui.calls if c[0] == "step_settings_hold"]
check("(7) step_settings_hold progress is monotonically increasing",
      progresses == sorted(progresses) and len(progresses) == len(set(progresses)),
      "got %r" % progresses)
check("(7) step_settings_hold progress never reaches 1.0", all(p < 1.0 for p in progresses),
      "got %r" % progresses)
r = nav.on_touch((10, y), SETTINGS_HOLD_S + 0.01, released=False)
check("(7) the commit call itself does not also call step_settings_hold",
      isinstance(r, Changed) and
      len([c for c in ui.calls if c[0] == "step_settings_hold"]) == len(progresses))

# (8) touch-down on an OFF risky row sets the "hold to enable" hint, and it
#     is restored to None on the ordinary tap-release path
nav, ui, settings = make_nav()
y = row_y(ROW_REMOTE)
nav.on_touch((10, y), 0.0, released=False)
check("(8) touch-down on an OFF risky row sets the hold hint",
      ("set_settings_row_hint", ROW_REMOTE, "hold to enable") in ui.calls)
nav.on_touch((10, y), 0.05, released=True)
check("(8) release restores the hint to None",
      ("set_settings_row_hint", ROW_REMOTE, None) in ui.calls)

# (8b) ...and it is restored on the drift-cancel path too
nav, ui, settings = make_nav()
nav.on_touch((10, row_y(ROW_REMOTE)), 0.0, released=False)
nav.on_touch((10, row_y(ROW_ONCALL)), 0.3, released=False)   # drift onto a different row cancels
check("(8b) drift-cancel restores the hint to None",
      ("set_settings_row_hint", ROW_REMOTE, None) in ui.calls)

# (8c) ...and on the horizontal-drag-cancel path too
nav, ui, settings = make_nav()
y = row_y(ROW_REMOTE)
nav.on_touch((10, y), 0.0, released=False)
nav.on_touch((10 + SWIPE_MIN_PX + 5, y), 0.3, released=False)
check("(8c) drag-cancel restores the hint to None",
      ("set_settings_row_hint", ROW_REMOTE, None) in ui.calls)

# (9) touch-down on a numeric row never arms a hold and never sets a hint
for _row in NUMERIC_ROWS:
    nav, ui, settings = make_nav()
    nav.on_touch((10, row_y(_row)), 0.0, released=False)
    check("(9) touch-down on numeric row %d does not start a hold" % _row,
          not any(c[0] == "start_settings_hold" for c in ui.calls))
    check("(9) touch-down on numeric row %d sets no hint" % _row,
          not any(c[0] == "set_settings_row_hint" for c in ui.calls))

# (10) a horizontal drag past SWIPE_MIN_PX cancels the press (and any hold)
#      and returns None -- the controller's view-switch swipe owns this
nav, ui, settings = make_nav()
y = row_y(ROW_OVERRIDE)
nav.on_touch((10, y), 0.0, released=False)
r = nav.on_touch((10 + SWIPE_MIN_PX + 5, y), 0.3, released=False)
check("(10) horizontal drag on a plain row cancels the press", r is None)
check("(10) horizontal drag clears the press highlight",
      ("press_settings_row", None) in ui.calls)

nav, ui, settings = make_nav()
y = row_y(ROW_REMOTE)
nav.on_touch((10, y), 0.0, released=False)
r = nav.on_touch((10 + SWIPE_MIN_PX + 5, y), 0.3, released=False)
check("(10) horizontal drag on an armed hold row cancels the hold too",
      r is None and ("cancel_settings_hold",) in ui.calls)
check("(10) horizontal drag never commits the risky field",
      settings.allow_remote_unlock is False)

# (11) a vertical drag past SWIPE_MIN_PX also cancels -- no scrolling on this screen
nav, ui, settings = make_nav()
y = row_y(ROW_OVERRIDE)
nav.on_touch((10, y), 0.0, released=False)
r = nav.on_touch((10, y + SWIPE_MIN_PX + 5), 0.3, released=False)
check("(11) vertical drag cancels the press and returns None", r is None)
check("(11) vertical drag clears the press highlight",
      ("press_settings_row", None) in ui.calls)

# (12) drifting onto a DIFFERENT row cancels the hold, and continuing to
#      hold there commits nothing
nav, ui, settings = make_nav()
nav.on_touch((10, row_y(ROW_REMOTE)), 0.0, released=False)
r = nav.on_touch((10, row_y(ROW_ONCALL)), 0.3, released=False)
check("(12) drifting onto a different row cancels the hold, no commit",
      r is None and ("cancel_settings_hold",) in ui.calls)
r2 = nav.on_touch((10, row_y(ROW_ONCALL)), SETTINGS_HOLD_S + 5.0, released=False)
check("(12) continuing to hold on the drifted-to row never commits", r2 is None)
check("(12) neither risky field was flipped by the drift",
      settings.allow_remote_unlock is False and settings.unlock_on_call is False)

# (13) after a hold commits mid-touch, the subsequent release must not
#      double-commit or re-toggle
nav, ui, settings = make_nav()
y = row_y(ROW_REMOTE)
nav.on_touch((10, y), 0.0, released=False)
r = nav.on_touch((10, y), SETTINGS_HOLD_S + 0.01, released=False)
check("(13) mid-touch hold commit fires", isinstance(r, Changed))
r2 = nav.on_touch((10, y), SETTINGS_HOLD_S + 0.05, released=True)
check("(13) the release after a committed hold returns None", r2 is None)
check("(13) the release after a committed hold does not re-toggle the field",
      settings.allow_remote_unlock is True)

# (14) press_settings_row(None) is called by the time a touch ends, on every path
def _ends_with_unpress(calls):
    return ("press_settings_row", None) in calls

nav, ui, settings = make_nav()   # tap
nav.on_touch((10, row_y(ROW_OVERRIDE)), 0.0, released=False)
nav.on_touch((10, row_y(ROW_OVERRIDE)), 0.05, released=True)
check("(14) tap path ends with press_settings_row(None)", _ends_with_unpress(ui.calls))

nav, ui, settings = make_nav()   # drift-cancel
nav.on_touch((10, row_y(ROW_REMOTE)), 0.0, released=False)
nav.on_touch((10, row_y(ROW_ONCALL)), 0.3, released=False)
check("(14) drift-cancel path ends with press_settings_row(None)", _ends_with_unpress(ui.calls))

nav, ui, settings = make_nav()   # drag-cancel
y = row_y(ROW_OVERRIDE)
nav.on_touch((10, y), 0.0, released=False)
nav.on_touch((10 + SWIPE_MIN_PX + 5, y), 0.3, released=False)
check("(14) drag-cancel path ends with press_settings_row(None)", _ends_with_unpress(ui.calls))

nav, ui, settings = make_nav()   # committed hold
y = row_y(ROW_REMOTE)
nav.on_touch((10, y), 0.0, released=False)
nav.on_touch((10, y), SETTINGS_HOLD_S + 0.01, released=False)
check("(14) committed-hold path ends with press_settings_row(None)", _ends_with_unpress(ui.calls))

nav, ui, settings = make_nav()   # miss (row -1)
ui.row_at_fn = lambda y: -1
nav.on_touch((10, 0), 0.0, released=False)
nav.on_touch((10, 0), 0.05, released=True)
check("(14) a touch that armed nothing still ends with press_settings_row(None)",
      _ends_with_unpress(ui.calls))

# (15) show() clears armed press/hold state and the hint mid-hold
nav, ui, settings = make_nav()
y = row_y(ROW_REMOTE)
nav.on_touch((10, y), 0.0, released=False)
ui.calls = []   # isolate show()'s own bookkeeping from the arm above
nav.show()
check("(15) show() clears the press highlight", ("press_settings_row", None) in ui.calls)
check("(15) show() cancels an in-flight hold", ("cancel_settings_hold",) in ui.calls)
check("(15) show() restores the hint to None", ("set_settings_row_hint", ROW_REMOTE, None) in ui.calls)
check("(15) show() resets internal armed/hold/active state",
      nav._armed_row is None and nav._holding is False and nav._active is False)

# (16) the nav never calls settings.save() -- across a battery of interactions
nav, ui, settings = make_nav(FakeSettings())
# tap open, toggle Auto both ways, turn a risky row off then on via hold,
# drift-cancel, drag-cancel, and a plain show() -- exercise everything.
nav.on_touch((10, row_y(ROW_OVERRIDE)), 0.0, released=False)
nav.on_touch((10, row_y(ROW_OVERRIDE)), 0.05, released=True)
nav.on_touch((10, row_y(ROW_AUTO)), 1.0, released=False)
nav.on_touch((10, row_y(ROW_AUTO)), 1.05, released=True)
nav.on_touch((10, row_y(ROW_AUTO)), 2.0, released=False)
nav.on_touch((10, row_y(ROW_AUTO)), 2.05, released=True)
nav.on_touch((10, row_y(ROW_REMOTE)), 3.0, released=False)
nav.on_touch((10, row_y(ROW_REMOTE)), 3.0 + SETTINGS_HOLD_S + 0.01, released=False)   # -> ON
nav.on_touch((10, row_y(ROW_REMOTE)), 4.0, released=False)
nav.on_touch((10, row_y(ROW_REMOTE)), 4.05, released=True)   # -> OFF
nav.on_touch((10, row_y(ROW_ONCALL)), 5.0, released=False)
nav.on_touch((10, row_y(ROW_REMOTE)), 5.3, released=False)   # drift-cancel
nav.on_touch((10, row_y(ROW_OVERRIDE)), 6.0, released=False)
nav.on_touch((10 + SWIPE_MIN_PX + 5, row_y(ROW_OVERRIDE)), 6.3, released=False)   # drag-cancel
nav.show()
check("(16) the nav never calls settings.save()", settings.saved == 0)

# (17) a touch-down that misses every row arms nothing and returns None on release
nav, ui, settings = make_nav()
ui.row_at_fn = lambda y: -1
r = nav.on_touch((10, 999), 0.0, released=False)
check("(17) a miss touch-down arms no row and returns None immediately", r is None)
check("(17) a miss touch-down starts no hold", not any(c[0] == "start_settings_hold" for c in ui.calls))
r2 = nav.on_touch((10, 999), 0.05, released=True)
check("(17) a miss touch's release also returns None", r2 is None)

# ----- extra: same-call arm-and-tick, and the _active "fresh touch-down" contract -----

# A fresh touch-down (released=False) both arms AND ticks in the SAME call --
# mirrors lock_tag_picker.TagPicker's identical contract (see this module's
# own on_touch docstring, which points at TagPicker's for the rationale).
nav, ui, settings = make_nav()
y = row_y(ROW_REMOTE)
r = nav.on_touch((10, y), 0.0, released=False)
check("touch-down frame both arms AND ticks in the same call",
      ("start_settings_hold", ROW_REMOTE) in ui.calls and
      ("step_settings_hold", ROW_REMOTE, 0.0) in ui.calls)
check("touch-down frame's tick is a genuine no-op at dt=0 (no premature commit)", r is None)

# Continuing an already-active touch (no release in between) must NOT re-arm:
# _active being True routes subsequent calls through the "else" branch, which
# only updates _last, so a second call at the same point must not press the
# row again.
nav, ui, settings = make_nav()
y = row_y(ROW_OVERRIDE)
nav.on_touch((10, y), 0.0, released=False)
nav.on_touch((10, y), 0.1, released=False)
check("continuing an active touch does not re-arm (press fires exactly once)",
      ui.calls.count(("press_settings_row", ROW_OVERRIDE)) == 1)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
