"""Host tests for lock_settings_nav.SettingsNav's PAGE-AWARENESS (phase 2):
arbitrating settings list PAGE 2 (flat indices 6..11 -- Theme/Accent/Flip/
Window/Lock pos/Open pos) as well as page 1's original six rows.

Same house style and FakeUI/FakeSettings pattern as test_lock_settings_nav.py
(that file's own docstring explains the setup this one borrows), but this
file does NOT touch it -- its 66 checks must keep passing unchanged, and this
is a separate file precisely so it can stay that way (see the phase-2 spec).

Page 2 has NO hold-to-confirm row at all (none of its six settings weakens
the lock), so most of the coverage below is: which UI method name gets
called for which page (settings2_row_at/press_settings2_row, never the
page-1 names), the three tap behaviours (Open / plain-switch-toggle /
cycle-on-tap, the last with true wraparound rather than Settings.adjust's
saturating clamp), and that page 2 never arms a hold no matter what row is
tapped.

Run: python tests/test_lock_settings_nav_page2.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib"))

from lock_config import SWIPE_MIN_PX, ACCENT_COLORS
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


# ----- page 2's row semantics (local 0..5 == flat idx - 6) -----
ROW_THEME = 0     # -> flat 6, cycle-on-tap
ROW_ACCENT = 1    # -> flat 7, cycle-on-tap
ROW_FLIP = 2      # -> flat 8, plain switch
ROW_WINDOW = 3    # -> flat 9, Open
ROW_LOCKPOS = 4   # -> flat 10, Open
ROW_OPENPOS = 5   # -> flat 11, Open

_ROW_Y0 = 40    # matches SET_ROWS_TOP
_ROW_H = 44     # matches the phase-2 SET_ROW_PITCH (tightened from 46)
_N_ROWS = 6


def row_y(row):
    return _ROW_Y0 + row * _ROW_H + 20


class FakeUI:
    """Records every call SettingsNav makes. Exposes BOTH pages' row-at/
    press methods under their real, distinct names (settings_row_at vs
    settings2_row_at, press_settings_row vs press_settings2_row) -- if
    SettingsNav ever called the wrong page's method for the active page,
    that would show up here as a call under a name this test isn't
    expecting, not as an AttributeError, so most assertions check the
    EXACT (method, args) tuple rather than just "some press call happened".
    """

    def __init__(self):
        self.calls = []

    def _row_at(self, y):
        if y < _ROW_Y0:
            return -1
        row = (y - _ROW_Y0) // _ROW_H
        return row if row < _N_ROWS else -1

    def settings_row_at(self, y):
        r = self._row_at(y)
        self.calls.append(("settings_row_at", y, r))
        return r

    def settings2_row_at(self, y):
        r = self._row_at(y)
        self.calls.append(("settings2_row_at", y, r))
        return r

    def press_settings_row(self, row):
        self.calls.append(("press_settings_row", row))

    def press_settings2_row(self, row):
        self.calls.append(("press_settings2_row", row))

    # Page 1's hold machinery -- present so a wrongly-page-1-routed call
    # from a page-2 touch does not crash before the assertion catches it,
    # but page 2 must NEVER actually call any of these (checked below).
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
    """Just the fields page 2's nav reads/writes, plus a `saved` counter --
    same "the nav must never call save() itself" contract as page 1's
    FakeSettings (test_lock_settings_nav.py)."""

    def __init__(self, theme_mode=0, accent_idx=0, screen_flipped=False):
        self.theme_mode = theme_mode
        self.accent_idx = accent_idx
        self.screen_flipped = screen_flipped
        self.saved = 0

    def save(self):
        self.saved += 1


def make_nav(settings=None, page=2):
    ui = FakeUI()
    settings = settings if settings is not None else FakeSettings()
    nav = SettingsNav(ui, lambda: settings)
    nav.show(page)
    ui.calls = []   # isolate show()'s own bookkeeping from the test below
    return nav, ui, settings


def tap(nav, row, t0=0.0, t1=0.05):
    y = row_y(row)
    nav.on_touch((10, y), t0, released=False)
    return nav.on_touch((10, y), t1, released=True)


# (1) show(2) switches the page, and defaults still land on page 1
nav = SettingsNav(FakeUI(), lambda: FakeSettings())
check("(1) page defaults to 1 with no show() call yet", nav.page == 1)
nav.show(2)
check("(1) show(2) sets page to 2", nav.page == 2)
nav.show()
check("(1) show() with no args restores page 1 (existing callers unaffected)",
      nav.page == 1)

# (2) a touch-down on page 2 hits settings2_row_at/press_settings2_row, NEVER
#     the page-1 names
nav, ui, settings = make_nav(page=2)
nav.on_touch((10, row_y(ROW_FLIP)), 0.0, released=False)
check("(2) page 2 touch-down calls settings2_row_at",
      ("settings2_row_at", row_y(ROW_FLIP), ROW_FLIP) in ui.calls)
check("(2) page 2 touch-down never calls settings_row_at (page 1's name)",
      "settings_row_at" not in ui.names("settings_row_at"))
check("(2) page 2 touch-down calls press_settings2_row",
      ("press_settings2_row", ROW_FLIP) in ui.calls)
check("(2) page 2 touch-down never calls press_settings_row (page 1's name)",
      not any(c[0] == "press_settings_row" for c in ui.calls))

# (3) Theme (row 0, flat 6): tap cycles, true 2-state flip, no hold ever
for start_mode, want_mode in ((0, 1), (1, 0)):
    nav, ui, settings = make_nav(FakeSettings(theme_mode=start_mode), page=2)
    r = tap(nav, ROW_THEME)
    check("(3) tap on Theme (mode %d) returns Changed(6)" % start_mode,
          isinstance(r, Changed) and r.row == 6)
    check("(3) tap on Theme (mode %d) flips theme_mode to %d" % (start_mode, want_mode),
          settings.theme_mode == want_mode)

# (4) Accent (row 1, flat 7): tap cycles forward with WRAPAROUND, not
#     Settings.adjust's saturating clamp -- the whole reason this row
#     bypasses adjust() (see lock_settings_nav._resolve_tap_page2's comment)
nav, ui, settings = make_nav(FakeSettings(accent_idx=len(ACCENT_COLORS) - 1), page=2)
r = tap(nav, ROW_ACCENT)
check("(4) tap on Accent at the LAST index wraps to 0, not staying put",
      isinstance(r, Changed) and r.row == 7 and settings.accent_idx == 0)

nav2, ui2, settings2 = make_nav(FakeSettings(accent_idx=2), page=2)
r2 = tap(nav2, ROW_ACCENT)
check("(4) tap on Accent mid-strip just advances by one",
      isinstance(r2, Changed) and r2.row == 7 and settings2.accent_idx == 3)

# (5) Flip (row 2, flat 8): plain tap toggles either direction, like page 1's
#     Auto -- and, crucially, NEVER arms a hold (unlike page 1's rows 4/5,
#     which share this same local-row-number space on their own page)
for start_flipped, want_flipped in ((False, True), (True, False)):
    nav, ui, settings = make_nav(FakeSettings(screen_flipped=start_flipped), page=2)
    nav.on_touch((10, row_y(ROW_FLIP)), 0.0, released=False)
    check("(5) touch-down on Flip never starts a hold",
          not any(c[0] == "start_settings_hold" for c in ui.calls))
    check("(5) touch-down on Flip never sets a hold hint",
          not any(c[0] == "set_settings_row_hint" for c in ui.calls))
    r = nav.on_touch((10, row_y(ROW_FLIP)), 0.05, released=True)
    check("(5) tap on Flip (%s) returns Changed(8)" % start_flipped,
          isinstance(r, Changed) and r.row == 8)
    check("(5) tap on Flip (%s) toggles screen_flipped to %s" % (start_flipped, want_flipped),
          settings.screen_flipped is want_flipped)

# (6) Window/Lock pos/Open pos (rows 3/4/5, flat 9/10/11): tap opens the
#     shared detail page at the FLAT index, never the local one
for local_row, flat_idx in ((ROW_WINDOW, 9), (ROW_LOCKPOS, 10), (ROW_OPENPOS, 11)):
    nav, ui, settings = make_nav(page=2)
    r = tap(nav, local_row)
    check("(6) tap on local row %d returns Open(%d)" % (local_row, flat_idx),
          isinstance(r, Open) and r.row == flat_idx, "got %r" % r)

# (7) no hold-to-confirm ANYWHERE on page 2 -- hold past what would be
#     SETTINGS_HOLD_S on page 1 (a long touch) on every row does nothing
#     but a plain tap's own effect; no start/step/cancel-hold call ever fires
for row in range(_N_ROWS):
    nav, ui, settings = make_nav(page=2)
    nav.on_touch((10, row_y(row)), 0.0, released=False)
    nav.on_touch((10, row_y(row)), 5.0, released=False)   # well past SETTINGS_HOLD_S
    check("(7) a long hold on page-2 row %d never starts a hold" % row,
          not any(c[0] == "start_settings_hold" for c in ui.calls))
    check("(7) a long hold on page-2 row %d never steps a hold" % row,
          not any(c[0] == "step_settings_hold" for c in ui.calls))

# (8) the nav never calls settings.save() on page 2 either (same contract as
#     page 1 -- test (16) in test_lock_settings_nav.py)
nav, ui, settings = make_nav(page=2)
tap(nav, ROW_THEME)
tap(nav, ROW_ACCENT)
tap(nav, ROW_FLIP)
tap(nav, ROW_WINDOW)
check("(8) the nav never calls settings.save() while arbitrating page 2",
      settings.saved == 0)

# (9) drift/drag cancellation still applies on page 2 (generic _tick/_release
#     logic, not page-specific) -- a horizontal drag past SWIPE_MIN_PX
#     cancels the press and resolves to None, same as page 1
nav, ui, settings = make_nav(page=2)
y = row_y(ROW_LOCKPOS)
nav.on_touch((10, y), 0.0, released=False)
r = nav.on_touch((10 + SWIPE_MIN_PX + 5, y), 0.3, released=False)
check("(9) horizontal drag on page 2 cancels the press and returns None", r is None)
check("(9) horizontal drag on page 2 clears the press highlight",
      ("press_settings2_row", None) in ui.calls)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
