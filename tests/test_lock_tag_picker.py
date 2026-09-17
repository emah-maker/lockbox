"""Host tests for the pre-session tag-picker interaction state in
Box-code/lib/lock_tag_picker.py.

TagPicker has no hardware imports (only lock_config, itself pure Python), so
it runs as-is under plain CPython. It's driven here through a FakeUI that
reproduces LockUI's real tag-picker hit-testing geometry (row y-positions,
nav-row y, skip/more x-split) but just records which start/step/cancel calls
fired, instead of touching displayio.

Run: python tests/test_lock_tag_picker.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib"))

from lock_config import SWIPE_MIN_PX, TAG_HOLD_S, BUILTIN_TOPICS
from lock_tag_picker import TagPicker, Select, Cancel, Page

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
    """Reproduces LockUI's real tag-picker geometry (see _build_tag_picker /
    tag_picker_row_at / tag_picker_nav_at in lock_ui.py) so tests exercise
    realistic dead-zones, but records calls instead of drawing anything."""
    W = 172
    ROWS_Y = (70, 110, 150, 190, 230, 270)
    NAV_Y = 308

    def __init__(self):
        self.is_flipped = False
        self._ids = []
        self.calls = []   # ordered log of (method, args) for assertions

    def show_tag_picker(self, page_topics):
        self._ids = [t[0] for t in page_topics]
        self.calls.append(("show_tag_picker", tuple(self._ids)))

    # ROWS_Y[0] - 19: the first row's top edge. The bands tile from there at
    # ROW_PITCH, so every pixel down to the last row's bottom belongs to
    # some row -- see tag_picker_row_at below, and the section at the end of
    # this file that proves this copy equals the firmware's own version.
    ROWS_TOP = 51
    ROW_PITCH = 40

    def tag_picker_row_at(self, y):
        if y < self.ROWS_TOP:
            return None
        i = int((y - self.ROWS_TOP) // self.ROW_PITCH)
        return i if i < len(self._ids) else None

    def tag_picker_topic_for_row(self, row_idx):
        if row_idx is None or row_idx >= len(self._ids):
            return None
        return self._ids[row_idx]

    def tag_picker_nav_at(self, x, y):
        if abs(y - self.NAV_Y) > 18:
            return None
        return 'skip' if x < self.W // 2 else 'more'

    def start_tag_picker_hold(self, row_idx):
        self.calls.append(("start_hold", row_idx))

    def step_tag_picker_hold(self, row_idx, progress):
        self.calls.append(("step_hold", row_idx, round(progress, 2)))

    def cancel_tag_picker_hold(self):
        self.calls.append(("cancel_hold",))

    def start_tag_picker_skip_hold(self):
        self.calls.append(("start_skip_hold",))

    def step_tag_picker_skip_hold(self, progress):
        self.calls.append(("step_skip_hold", round(progress, 2)))

    def cancel_tag_picker_skip_hold(self):
        self.calls.append(("cancel_skip_hold",))

    def step_tag_picker_swipe_progress(self, progress):
        self.calls.append(("step_swipe", round(progress, 2)))

    def clear_tag_picker_swipe(self):
        self.calls.append(("clear_swipe",))

    def names(self, method):
        return [c[0] for c in self.calls if c[0] == method]


ROW0_Y = FakeUI.ROWS_Y[0]
ROW1_Y = FakeUI.ROWS_Y[1]
LAST_ROW_Y = FakeUI.ROWS_Y[-1]
SKIP_X = FakeUI.W // 4
MORE_X = 3 * FakeUI.W // 4
ROW_X = 60   # arbitrary x within a row (rows aren't x-gated)

TOPICS = list(BUILTIN_TOPICS)   # 6 built-ins -> exactly one page by default


def make_picker(topics=None):
    ui = FakeUI()
    topics = TOPICS if topics is None else topics
    tp = TagPicker(ui, topics_fn=lambda: topics)
    tp.show(0)
    ui.calls = []   # ignore show()'s own bookkeeping calls for per-test assertions
    return tp, ui


# (a) tap-and-release on a row below TAG_HOLD_S -- no commit, fill cleared
tp, ui = make_picker()
r = tp.on_touch((ROW_X, ROW0_Y), 0.0, released=False)
check("(a) touch-down on row arms hold, no result", r is None and ("start_hold", 0) in ui.calls)
r = tp.on_touch((ROW_X, ROW0_Y), 0.05, released=True)
check("(a) quick release below TAG_HOLD_S -> no commit", r is None)
check("(a) release clears the hold fill", ("cancel_hold",) in ui.calls)

# (b) hold a row past TAG_HOLD_S -- commits Select(topic) mid-touch
tp, ui = make_picker()
tp.on_touch((ROW_X, ROW0_Y), 0.0, released=False)
r = tp.on_touch((ROW_X, ROW0_Y), TAG_HOLD_S + 0.01, released=False)
check("(b) hold past TAG_HOLD_S commits Select(topic) mid-touch",
      isinstance(r, Select) and r.topic == TOPICS[0][0])

# (c) hold a row, drift a couple pixels within the same row -- NOT canceled
tp, ui = make_picker()
tp.on_touch((ROW_X, ROW0_Y), 0.0, released=False)
r = tp.on_touch((ROW_X + 2, ROW0_Y + 2), 0.3, released=False)
check("(c) small jitter within the same row does not cancel the hold",
      r is None and ("cancel_hold",) not in ui.calls)
r = tp.on_touch((ROW_X + 2, ROW0_Y + 2), TAG_HOLD_S + 0.01, released=False)
check("(c) hold still commits after small in-row jitter", isinstance(r, Select))

# (d) hold a row, drift onto a DIFFERENT valid row -- canceled, no commit
tp, ui = make_picker()
tp.on_touch((ROW_X, ROW0_Y), 0.0, released=False)
r = tp.on_touch((ROW_X, ROW1_Y), 0.3, released=False)
check("(d) drifting onto a different valid row cancels the hold, no commit",
      r is None and ("cancel_hold",) in ui.calls)
r = tp.on_touch((ROW_X, ROW1_Y), 999.0, released=False)
check("(d) no late commit after the row-drift cancel", r is None)

# (e) hold a row, drift to a y with no row at all -- NOT canceled (open dead zone)
tp, ui = make_picker()
tp.on_touch((ROW_X, LAST_ROW_Y), 0.0, released=False)
# Below the LAST row's band, and drifting downward so this is not read as
# the swipe-up cancel. It used to be ROW0_Y - 10, which is inside the first
# row's band -- and the sanity check below asked a BLANK FakeUI, whose
# empty id list answers None for every y on the screen, so it agreed
# either way. Both halves of that were vacuous; ask the picker's own ui.
no_row_y = LAST_ROW_Y + 25
check("(e) sanity: this y really matches no row", ui.tag_picker_row_at(no_row_y) is None)
r = tp.on_touch((ROW_X, no_row_y), 0.3, released=False)
check("(e) drifting into the open dead zone (no row) does not cancel",
      r is None and ("cancel_hold",) not in ui.calls)
r = tp.on_touch((ROW_X, no_row_y), TAG_HOLD_S + 0.01, released=False)
check("(e) hold still commits after drifting into the open dead zone", isinstance(r, Select))

# (f) hold SKIP past TAG_HOLD_S -- commits Select(None)
tp, ui = make_picker()
tp.on_touch((SKIP_X, FakeUI.NAV_Y), 0.0, released=False)
check("(f) touch-down on SKIP arms skip-hold", ("start_skip_hold",) in ui.calls)
r = tp.on_touch((SKIP_X, FakeUI.NAV_Y), TAG_HOLD_S + 0.01, released=False)
check("(f) holding SKIP past TAG_HOLD_S commits Select(None)",
      isinstance(r, Select) and r.topic is None)

# (g) hold SKIP, drift onto MORE -- skip-hold canceled
tp, ui = make_picker()
tp.on_touch((SKIP_X, FakeUI.NAV_Y), 0.0, released=False)
r = tp.on_touch((MORE_X, FakeUI.NAV_Y), 0.3, released=False)
check("(g) drifting from SKIP onto MORE cancels the skip-hold",
      r is None and ("cancel_skip_hold",) in ui.calls)

# (h) swipe up past SWIPE_MIN_PX -- commits Cancel mid-touch
tp, ui = make_picker()
tp.on_touch((ROW_X, ROW0_Y + 100), 0.0, released=False)
r = tp.on_touch((ROW_X, ROW0_Y + 100 - (SWIPE_MIN_PX + 5)), 0.3, released=False)
check("(h) swipe up past SWIPE_MIN_PX commits Cancel mid-touch", isinstance(r, Cancel))

# (i) swipe up short of threshold then release -- no commit
tp, ui = make_picker()
start_y = 200
tp.on_touch((ROW_X, start_y), 0.0, released=False)
tp.on_touch((ROW_X, start_y - (SWIPE_MIN_PX - 5)), 0.3, released=False)
r = tp.on_touch((ROW_X, start_y - (SWIPE_MIN_PX - 5)), 0.3, released=True)
check("(i) short upward swipe, released below threshold -> no commit", r is None)

# (j) release with a big enough upward dy that release-time fallback fires -> Cancel
# (only reachable if the live tick never got a chance to see the full drag --
# construct that by jumping straight from touch-down to a big-dy release.)
tp, ui = make_picker()
start_y = 200
tp.on_touch((ROW_X, start_y), 0.0, released=False)
r = tp.on_touch((ROW_X, start_y - (SWIPE_MIN_PX + 20)), 0.05, released=True)
check("(j) release-time big upward dy fallback fires -> Cancel", isinstance(r, Cancel))

# (k) tap MORE -> Page, page wraps via page-count math with >6 topics
many_topics = [("id{}".format(i), "T{}".format(i), 0) for i in range(14)]  # 3 pages (6+6+2)
tp, ui = make_picker(topics=many_topics)
tp.on_touch((MORE_X, FakeUI.NAV_Y), 0.0, released=False)
r = tp.on_touch((MORE_X, FakeUI.NAV_Y), 0.05, released=True)
check("(k) tap MORE commits Page", isinstance(r, Page))
check("(k) tap MORE advances to page 1", ui.calls[-1] == ("show_tag_picker", tuple(t[0] for t in many_topics[6:12])))
tp.on_touch((MORE_X, FakeUI.NAV_Y), 1.0, released=False)
tp.on_touch((MORE_X, FakeUI.NAV_Y), 1.05, released=True)
check("(k) tap MORE advances to page 2 (partial, 2 topics)",
      ui.calls[-1] == ("show_tag_picker", tuple(t[0] for t in many_topics[12:14])))
tp.on_touch((MORE_X, FakeUI.NAV_Y), 2.0, released=False)
tp.on_touch((MORE_X, FakeUI.NAV_Y), 2.05, released=True)
check("(k) tap MORE wraps back to page 0",
      ui.calls[-1] == ("show_tag_picker", tuple(t[0] for t in many_topics[0:6])))

# (l) Horizontal paging is in SCREEN space, and swipe-LEFT is explicitly a
# no-op (regression: it used to bypass hold-to-confirm and instantly SKIP).
#
# Every point TagPicker sees has already been through LockController._map --
# process() sets _start/_last from its return value -- so dx here is a screen
# delta with the INVERT_X/is_flipped correction applied exactly once. A
# NEGATIVE dx is leftward on the screen the user is looking at, in either
# orientation -- and dragging left is what pages forward, the carousel way
# round: the content follows the finger and the next page arrives from the
# right. Swiping RIGHT is the no-op.
#
# These cases used to assert the opposite sign, on the strength of a comment
# claiming "a physical swipe-LEFT is a POSITIVE mapped dx" -- which conflates
# the touch chip's axis with the screen's, the precise confusion
# LockController._handle_release's own comment warns about. They were pinning
# the bug: _release re-applied the INVERT_X/is_flipped XOR on top of _map's,
# which made paging the only gesture on the box that reversed when the screen
# was flipped.
tp, ui = make_picker()
start_x = 120
tp.on_touch((start_x, FakeUI.NAV_Y), 0.0, released=False)
r = tp.on_touch((start_x + (SWIPE_MIN_PX + 10), FakeUI.NAV_Y), 0.3, released=False)
check("(l) swipe-right live tick: no dominant-vertical swipe triggers, tick is a hold-tick no-op",
      r is None)
r2 = tp.on_touch((start_x + (SWIPE_MIN_PX + 10), FakeUI.NAV_Y), 0.35, released=True)
check("(l) swipe-right release is a no-op -- never Select/Cancel/Page", r2 is None)

# ...and dragging left advances a page. MORE stays tappable in the right half
# either way (tag_picker_nav_at), which is the discoverable route; this is the
# shortcut.
tp, ui = make_picker(many_topics)
tp.on_touch((start_x, FakeUI.NAV_Y), 0.0, released=False)
r3 = tp.on_touch((start_x - (SWIPE_MIN_PX + 10), FakeUI.NAV_Y), 0.35, released=True)
check("(l) swipe-left advances a page", isinstance(r3, Page))

# The whole point of the fix: the gesture must not depend on which way up the
# box is mounted. Everything the user sees on this screen is drawn in screen
# space and rotates WITH the display, so it reads identically in both
# orientations -- and so must the swipe. This is the case that was failing on
# the real box.
for _flipped in (False, True):
    tp, ui = make_picker(many_topics)
    ui.is_flipped = _flipped
    tp.on_touch((start_x, FakeUI.NAV_Y), 0.0, released=False)
    _r = tp.on_touch((start_x - (SWIPE_MIN_PX + 10), FakeUI.NAV_Y), 0.35, released=True)
    check("(l) swipe-left pages with is_flipped=%s" % _flipped, isinstance(_r, Page))

    tp, ui = make_picker(many_topics)
    ui.is_flipped = _flipped
    tp.on_touch((start_x, FakeUI.NAV_Y), 0.0, released=False)
    _r = tp.on_touch((start_x + (SWIPE_MIN_PX + 10), FakeUI.NAV_Y), 0.35, released=True)
    check("(l) swipe-right stays a no-op with is_flipped=%s" % _flipped, _r is None)

# (m) a small swipe (below jitter guard) while a hold is armed does not cancel the hold
tp, ui = make_picker()
tp.on_touch((ROW_X, ROW0_Y), 0.0, released=False)
r = tp.on_touch((ROW_X, ROW0_Y - 5), 0.3, released=False)  # below _SWIPE_JITTER_GUARD_PX (15)
check("(m) sub-jitter-guard drift does not start a swipe-cancel or drop the hold",
      r is None and ("cancel_hold",) not in ui.calls and ("start_hold", 0) in ui.calls
      and ui.names("step_swipe") == [])
r = tp.on_touch((ROW_X, ROW0_Y - 5), TAG_HOLD_S + 0.01, released=False)
check("(m) hold still commits after sub-jitter-guard drift", isinstance(r, Select))

# ----- same-frame double-call behavior on touch-down -----
tp, ui = make_picker()
r = tp.on_touch((ROW_X, ROW0_Y), 0.0, released=False)
check("touch-down frame both arms AND ticks in the same call",
      ("start_hold", 0) in ui.calls and ("step_hold", 0, 0.0) in ui.calls)
check("touch-down frame's tick is a genuine no-op at dt=0 (no premature commit)", r is None)


# ----- the REAL hit-test geometry, not this file's model of it -------------
#
# Everything above runs against FakeUI, which restates LockUI's row math.
# That copy is what let the bug survive: the firmware used a per-row
# centre +/-19px tolerance at a 40px pitch, which leaves a one-pixel dead
# band exactly halfway between every pair of rows (y = 90/130/170/210/250).
# A touch landing on one of those arms nothing at all -- no hold fill, no
# selection, no feedback of any kind, so it reads as an unresponsive
# screen rather than a miss. It is the same gap class the settings list was
# rewritten to remove (see lock_ui_widgets.row_at's comment, and
# settings_row_at, which has tiled bands with no dead zone since SS1b).
#
# So this section stops trusting the copy: it builds the REAL LockUI on the
# host through tests/preview's displayio shim (the same one render.py and
# overflow_check.py use) and hit-tests the firmware's own method, against
# the firmware's own tp_rows_y. Then it proves FakeUI agrees with it at
# every pixel, so the copy above can never drift again without saying so.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "preview"))
import render  # noqa: E402 -- installs the displayio shim as a side effect

real = render.build_ui()
real.show_tag_picker(TOPICS)

check("the real UI has the row geometry this file models",
      tuple(real.tp_rows_y) == FakeUI.ROWS_Y and real.tp_nav_y == FakeUI.NAV_Y)

FIRST_TOP = FakeUI.ROWS_Y[0] - 19          # 51
LAST_BOTTOM = FakeUI.ROWS_Y[-1] + 19       # 289

_dead = [y for y in range(FIRST_TOP, LAST_BOTTOM + 1)
         if real.tag_picker_row_at(y) is None]
check("no dead pixel anywhere between the first and last row: " + repr(_dead),
      _dead == [])

# Each row owns one unbroken run, and they are all the same height -- a
# band that is contiguous but uneven would still be a usability bug, just a
# subtler one.
_runs = {}
for _y in range(0, 321):
    _r = real.tag_picker_row_at(_y)
    if _r is not None:
        _runs.setdefault(_r, []).append(_y)
check("every row owns a contiguous run of pixels: "
      + repr({k: (v[0], v[-1]) for k, v in sorted(_runs.items())}),
      all(v == list(range(v[0], v[-1] + 1)) for v in _runs.values()))
check("all six rows are the same height: "
      + repr({k: len(v) for k, v in sorted(_runs.items())}),
      sorted(_runs) == [0, 1, 2, 3, 4, 5]
      and len({len(v) for v in _runs.values()}) == 1)

# Each row still claims its own centre -- closing the gaps must not shift
# the bands off the labels they are under.
check("every row's centre still maps to that row",
      all(real.tag_picker_row_at(ry) == i
          for i, ry in enumerate(real.tp_rows_y)))

# The band must only grow INWARD. One pixel above the first row was not a
# target before and must not become one.
check("the pixel above the first row is still not a row",
      real.tag_picker_row_at(FIRST_TOP - 1) is None)

# Rows past the end of a short last page stay unclaimed, and must not come
# back as a negative index either -- tag_picker_topic_for_row's own guard
# passes a -1 straight through to self._tp_ids[-1], which would silently
# select the LAST topic instead of none.
real.show_tag_picker(TOPICS[:2])
_short = [real.tag_picker_row_at(ry) for ry in real.tp_rows_y]
check("a two-row page claims only its two rows: " + repr(_short),
      _short == [0, 1, None, None, None, None])
check("a miss is None, never a negative index",
      real.tag_picker_row_at(0) is None and real.tag_picker_row_at(319) is None)
check("a miss cannot resolve to a topic",
      real.tag_picker_topic_for_row(real.tag_picker_row_at(0)) is None)
real.show_tag_picker(TOPICS)

# Where the last row's band now meets the SKIP/MORE row, the nav wins:
# TagPicker._arm (and _release) ask tag_picker_nav_at first, so the overlap
# is resolved by call order rather than left as another gap.
check("the nav row still claims the pixel the last row's band reaches",
      real.tag_picker_nav_at(SKIP_X, LAST_BOTTOM + 1) == 'skip')
_real_tp = TagPicker(real, topics_fn=lambda: TOPICS)
_real_tp.show(0)
_real_tp.on_touch((SKIP_X, LAST_BOTTOM + 1), 0.0, released=False)
check("a touch there arms the skip hold, not a row hold",
      _real_tp._skip_holding and _real_tp._hold_row is None)

# ...and FakeUI above is a faithful stand-in for all of it.
_mismatch = []
for _n in range(0, len(TOPICS) + 1):
    real.show_tag_picker(TOPICS[:_n])
    _fake = FakeUI()
    _fake.show_tag_picker(TOPICS[:_n])
    for _y in range(0, 321):
        if real.tag_picker_row_at(_y) != _fake.tag_picker_row_at(_y):
            _mismatch.append((_n, _y, real.tag_picker_row_at(_y),
                              _fake.tag_picker_row_at(_y)))
check("this file's FakeUI row math matches the firmware's at every pixel"
      + (" -- " + repr(_mismatch[:5]) if _mismatch else ""),
      not _mismatch)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
