"""Host tests for the pre-session CONFIRM/CHANGE interaction state in
firmware/lib/lock_topic_confirm.py.

TopicConfirm has no hardware imports (pure Python, like lock_tag_picker.py),
so it runs as-is under plain CPython. It's driven here through a FakeUI that
records press-highlight/show calls instead of touching displayio, plus a
plain hit-test geometry: CONFIRM occupies x in [20, 100), CHANGE x in
[20, 100) too but a different y band -- see CONFIRM_BOX/CHANGE_BOX below
(arbitrary but disjoint, since only "which box (if any)" matters here, not
real on-screen pixels).

Run: python tests/test_lock_topic_confirm.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "firmware", "lib"))

from lock_topic_confirm import TopicConfirm, Confirm, Change, find_topic

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


# Disjoint boxes: (x0, y0, x1, y1)
CONFIRM_BOX = (20, 160, 150, 220)
CHANGE_BOX = (20, 250, 150, 300)
OUTSIDE_PT = (5, 5)             # not in either box
CONFIRM_PT = (85, 190)          # inside CONFIRM_BOX
CHANGE_PT = (85, 275)           # inside CHANGE_BOX


class FakeUI:
    """Records press-highlight/show calls instead of drawing anything; hit
    tests against the fixed boxes above."""

    def __init__(self):
        self.calls = []   # ordered log of (method, args) for assertions

    def show_topic_confirm(self, name):
        self.calls.append(("show_topic_confirm", name))

    def in_topic_confirm_confirm(self, x, y):
        x0, y0, x1, y1 = CONFIRM_BOX
        return x0 <= x <= x1 and y0 <= y <= y1

    def in_topic_confirm_change(self, x, y):
        x0, y0, x1, y1 = CHANGE_BOX
        return x0 <= x <= x1 and y0 <= y <= y1

    def press_topic_confirm(self, which):
        self.calls.append(("press", which))

    def names(self, method):
        return [c[0] for c in self.calls if c[0] == method]


def make_confirm(name="Work"):
    ui = FakeUI()
    tc = TopicConfirm(ui)
    tc.show(name)
    ui.calls = []   # ignore show()'s own bookkeeping call for per-test asserts
    return tc, ui


# (a) tap-and-release on CONFIRM -> Confirm
tc, ui = make_confirm()
r = tc.on_touch(CONFIRM_PT, 0.0, released=False)
check("(a) touch-down on CONFIRM highlights it, no result yet",
      r is None and ("press", "confirm") in ui.calls)
r = tc.on_touch(CONFIRM_PT, 0.05, released=True)
check("(a) release still on CONFIRM commits Confirm", isinstance(r, Confirm))
check("(a) release clears the highlight", ui.calls[-1] == ("press", None))

# (b) press CONFIRM then release outside -> None (no commit)
tc, ui = make_confirm()
tc.on_touch(CONFIRM_PT, 0.0, released=False)
r = tc.on_touch(OUTSIDE_PT, 0.05, released=True)
check("(b) press CONFIRM then release outside -> no commit", r is None)
check("(b) drifting off CONFIRM before release clears the highlight",
      ("press", None) in ui.calls)

# (c) tap-and-release on CHANGE -> Change
tc, ui = make_confirm()
tc.on_touch(CHANGE_PT, 0.0, released=False)
r = tc.on_touch(CHANGE_PT, 0.05, released=True)
check("(c) tap CHANGE commits Change", isinstance(r, Change))

# (d) touch outside both -> None, and no highlight is ever shown
tc, ui = make_confirm()
r = tc.on_touch(OUTSIDE_PT, 0.0, released=False)
check("(d) touch-down outside both buttons never highlights anything",
      r is None and ui.names("press") == [])
r = tc.on_touch(OUTSIDE_PT, 0.05, released=True)
check("(d) release outside both buttons -> None", r is None)

# (e) same-frame touch-down+release edge case (first call IS the release) --
# a fresh touch that begins and ends in the same on_touch call, same as the
# tag picker test's equivalent case.
tc, ui = make_confirm()
r = tc.on_touch(CONFIRM_PT, 0.0, released=True)
check("(e) same-frame down+release on CONFIRM still commits Confirm",
      isinstance(r, Confirm))

tc, ui = make_confirm()
r = tc.on_touch(OUTSIDE_PT, 0.0, released=True)
check("(e) same-frame down+release outside both -> None", r is None)

# (f) press CONFIRM, drift onto CHANGE, release on CHANGE -> still no commit
# (the ORIGINAL press target is what release-time checks, not whatever the
# finger happens to be over at release) -- and CHANGE must never have been
# highlighted along the way, since releasing there was never going to commit.
tc, ui = make_confirm()
tc.on_touch(CONFIRM_PT, 0.0, released=False)
tc.on_touch(CHANGE_PT, 0.1, released=False)
check("(f) drifting from CONFIRM onto CHANGE never highlights CHANGE",
      ("press", "change") not in ui.calls)
r = tc.on_touch(CHANGE_PT, 0.2, released=True)
check("(f) release on CHANGE after starting on CONFIRM -> no commit", r is None)

# (g) press CONFIRM, drift off, drift back onto CONFIRM before release -> commits
tc, ui = make_confirm()
tc.on_touch(CONFIRM_PT, 0.0, released=False)
tc.on_touch(OUTSIDE_PT, 0.1, released=False)
check("(g) drifting off CONFIRM clears the highlight",
      ui.calls[-1] == ("press", None))
r = tc.on_touch(CONFIRM_PT, 0.2, released=True)
check("(g) drifting back onto CONFIRM before release still commits", isinstance(r, Confirm))

# ----- find_topic -----
TOPICS = [("work", "Work", 1), ("study", "Study", 2)]
check("find_topic hit", find_topic(TOPICS, "work") == ("Work", 1))
check("find_topic miss (unknown id)", find_topic(TOPICS, "nope") is None)
check("find_topic empty list", find_topic([], "work") is None)
check("find_topic falsy id (empty string)", find_topic(TOPICS, "") is None)
check("find_topic falsy id (None)", find_topic(TOPICS, None) is None)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
