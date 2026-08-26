# lock_tag_picker.py -- pre-session tag picker interaction state, extracted
# from LockController/LockUI (see the architecture review this responds to):
# the two used to orchestrate this screen's gesture handling across 6+
# scattered methods with no seam between them. LockUI stays the pure
# renderer/hit-tester it already was; this module owns everything about
# WHEN to arm a hold, WHEN a swipe dominates a hold, and WHEN either commits
# -- exposed through one method, on_touch(point, now, released), so
# LockController only has to react to a small, explicit result.
#
# Select/Cancel/Page are tiny tagged results (mirrors lock_protocol.Command's
# __slots__ style) rather than plain tuples, so callers can `isinstance()`
# instead of unpacking by position.
from lock_config import SWIPE_MIN_PX, TAG_HOLD_S, INVERT_X


class Select:
    """Commit a session -- topic is a topic id, or None for an untagged
    (SKIP) session. Only ever produced live, mid-touch (a hold reaching
    TAG_HOLD_S) -- never at release; see on_touch's docstring."""
    __slots__ = ("topic",)

    def __init__(self, topic):
        self.topic = topic


class Cancel:
    """Back out of the picker with no session started."""
    __slots__ = ()


class Page:
    """Advance to the next page of topics; the picker stays open and has
    already told the ui to redraw itself."""
    __slots__ = ()


class TagPicker:
    """Pre-session tag picker: hold a row or SKIP past TAG_HOLD_S to start a
    tagged/untagged session, swipe up past SWIPE_MIN_PX to cancel, tap/swipe
    MORE to page through synced labels. See on_touch for the per-touch-frame
    contract.

    `topics_fn` is called fresh every time a page is computed (show() or a
    MORE advance) so a BLE label push mid-picker-session is reflected on the
    next page render, same as the live-recompute this replaced.
    """

    # Minimum |dy| before a held touch is even considered a swipe-cancel
    # candidate -- see the identical constant's comment history in
    # lock_controller.py before this extraction: a tight guard here hijacked
    # the hold into swipe-mode before TAG_HOLD_S could complete, worst near
    # the bottom of the screen (last row, SKIP, MORE) where sustained
    # pressure naturally drifts upward. SWIPE_MIN_PX is still what actually
    # commits the cancel; this only gates when the live red bar starts
    # rendering at all.
    _SWIPE_JITTER_GUARD_PX = 15

    def __init__(self, ui, topics_fn):
        self.ui = ui
        self._topics_fn = topics_fn
        self._page = 0
        self._active = False
        self._start = None
        self._last = None
        self._hold_row = None
        self._hold_start = 0.0
        self._skip_holding = False

    def _page_count(self):
        n = len(self._topics_fn())
        return max(1, (n + 5) // 6)   # 6 rows per page

    def _page_topics(self, page):
        all_t = self._topics_fn()
        start = page * 6
        return all_t[start:start + 6]

    def show(self, page=0):
        """Resets all touch/hold/swipe state and shows the given page --
        call this instead of touching the ui directly (LockController.
        go_picking)."""
        self._active = False
        self._start = None
        self._last = None
        self._hold_row = None
        self._hold_start = 0.0
        self._skip_holding = False
        self._page = page
        self.ui.show_tag_picker(self._page_topics(page))

    def on_touch(self, point, now, released):
        """Call once per touch-frame while the picker is showing: on every
        frame a finger is down (released=False), and once more on release
        (released=True, point should be the last known point). Infers
        "this is a fresh touch-down" from its own internal state, so the
        caller never has to track a separate "began" flag.

        A touch that begins and ends in the SAME call (the first frame of a
        new touch) both arms whatever it landed on AND runs that frame's
        live tick -- replicating that a fresh touch-down used to
        unconditionally fall through into the per-frame tick in the same
        call, not skip it.

        Returns one of Select/Cancel/Page/None. Select is only ever
        produced live (mid-touch, from a hold reaching TAG_HOLD_S) --
        release-time can only ever yield Cancel, Page, or None. This
        asymmetry is intentional (a plain tap no longer starts a session by
        itself); do not "fix" it.
        """
        if not self._active:
            self._active = True
            self._start = point
            self._last = point
            self._arm(point, now)
        else:
            self._last = point
        if released:
            self._active = False
            return self._release()
        return self._tick(now)

    # ----- touch-down: arm a hold -----
    def _arm(self, point, now):
        x, y = point
        nav = self.ui.tag_picker_nav_at(x, y)
        if nav == 'skip':
            self._skip_holding = True
            self._hold_start = now
            self.ui.start_tag_picker_skip_hold()
            return
        if nav is not None:
            return  # 'more' -- still a plain single tap
        row = self.ui.tag_picker_row_at(y)
        if row is None:
            return
        self._hold_row = row
        self._hold_start = now
        self.ui.start_tag_picker_hold(row)

    # ----- per-frame tick while held -----
    def _tick(self, now):
        x, y = self._last
        dx = x - self._start[0]
        dy = y - self._start[1]
        if abs(dy) >= self._SWIPE_JITTER_GUARD_PX and abs(dy) > abs(dx) and dy < 0:
            if self._hold_row is not None:
                self.ui.cancel_tag_picker_hold()
                self._hold_row = None
            if self._skip_holding:
                self.ui.cancel_tag_picker_skip_hold()
                self._skip_holding = False
            return self._swipe_tick(dy)
        else:
            self.ui.clear_tag_picker_swipe()
            return self._hold_tick(now)

    def _swipe_tick(self, dy):
        progress = min(1.0, abs(dy) / SWIPE_MIN_PX)
        if progress >= 1.0:
            self.ui.clear_tag_picker_swipe()
            return Cancel()
        self.ui.step_tag_picker_swipe_progress(progress)
        return None

    def _hold_tick(self, now):
        if self._skip_holding:
            return self._skip_hold_tick(now)
        if self._hold_row is None:
            return None
        current_row = self.ui.tag_picker_row_at(self._last[1])
        if current_row is not None and current_row != self._hold_row:
            self.ui.cancel_tag_picker_hold()
            self._hold_row = None
            return None
        progress = (now - self._hold_start) / TAG_HOLD_S
        if progress >= 1.0:
            topic = self.ui.tag_picker_topic_for_row(self._hold_row)
            self._hold_row = None
            self.ui.cancel_tag_picker_hold()  # clear the fill before the caller hides the picker
            return Select(topic)
        self.ui.step_tag_picker_hold(self._hold_row, progress)
        return None

    def _skip_hold_tick(self, now):
        nav = self.ui.tag_picker_nav_at(*self._last)
        if nav is not None and nav != 'skip':
            self.ui.cancel_tag_picker_skip_hold()
            self._skip_holding = False
            return None
        progress = (now - self._hold_start) / TAG_HOLD_S
        if progress >= 1.0:
            self._skip_holding = False
            self.ui.cancel_tag_picker_skip_hold()
            return Select(None)
        self.ui.step_tag_picker_skip_hold(progress)
        return None

    # ----- release -----
    def _release(self):
        dx = self._last[0] - self._start[0]
        dy = self._last[1] - self._start[1]
        if self._hold_row is not None:
            self.ui.cancel_tag_picker_hold()
            self._hold_row = None
        if self._skip_holding:
            self.ui.cancel_tag_picker_skip_hold()
            self._skip_holding = False
        self.ui.clear_tag_picker_swipe()
        if abs(dy) >= SWIPE_MIN_PX and abs(dy) > abs(dx):
            if dy < 0:
                return Cancel()
            return None
        if abs(dx) >= SWIPE_MIN_PX and abs(dx) > abs(dy):
            right = (dx < 0) if (INVERT_X != self.ui.is_flipped) else (dx > 0)
            if right:
                return self._advance_page()
            # swipe-left: intentionally a no-op -- SKIP is only reachable via
            # the press-and-hold in _arm/_skip_hold_tick above, not a swipe.
            return None
        if abs(dx) < SWIPE_MIN_PX and abs(dy) < SWIPE_MIN_PX:
            nav = self.ui.tag_picker_nav_at(*self._start)
            if nav == 'more':
                return self._advance_page()
            # a row or SKIP: a plain tap no longer starts a session by itself
            return None
        return None

    def _advance_page(self):
        self._page = (self._page + 1) % self._page_count()
        self.ui.show_tag_picker(self._page_topics(self._page))
        return Page()
