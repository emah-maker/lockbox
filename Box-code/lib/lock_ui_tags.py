# lock_ui_tags.py -- the pre-session tag picker and the topic-confirm prompt.
#
# One of the view mixins LockUI is composed from; see lock_ui.py's header for
# why the class is split this way and what that does and does not change.
# Every method here runs as a method OF LockUI -- `self` is the whole UI, and
# the attributes below are the ones lock_ui.py's __init__ creates.

import displayio
import terminalio
from adafruit_display_text import label
from adafruit_display_shapes.roundrect import RoundRect
from adafruit_display_shapes.rect import Rect
from adafruit_display_shapes.circle import Circle
from adafruit_display_shapes.triangle import Triangle
from lock_config import C_BG
from lock_config import C_SURFACE
from lock_config import C_WHITE
from lock_config import C_GREY
from lock_config import C_GREEN
from lock_config import C_RED
from lock_config import RADIUS_CARD
from lock_config import RADIUS_BTN_SM
from lock_config import RADIUS_BTN_LG
from lock_ui_common import _bg_tile


class TagPickerMixin:
    # =================== pre-session tag picker ===================
    # Shown before go_running() actually starts the countdown (see
    # LockController.go_picking) so the chosen topic can ride along in the
    # session's log entry. Reuses the settings list's row-tap layout
    # (set_rows_y's 6-row, 40px-pitch pattern) rather than inventing a new
    # one. Best-effort: rows come from LockController._all_topics, which is
    # the 6 built-in topics (mirrors app/src/stats/topics.ts) plus whatever
    # custom labels the app has synced over BLE_UUID_LABELS (see
    # apply_ble_labels_json) -- if more than 6 topics exist they page via the
    # same horizontal-swipe gesture already used to move between top-level
    # views elsewhere, repurposed here (see LockController._handle_release's
    # "picking" branch) since the picker occupies the control view's screen
    # real estate without actually being one of the top-level VIEWS.
    def _build_tag_picker(self, W, H):
        group = displayio.Group()
        self.tag_picker_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        # "TAG THIS SESSION" (16 chars) at scale=2 (12px/glyph) is 192px --
        # wider than this 172px screen on its own, before any row/hint text.
        # "TAG SESSION" (11 chars, 132px) fits with real margin.
        ttl = label.Label(terminalio.FONT, text="TAG SESSION", color=C_GREY,
                          scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 30)
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))

        # Explicit on-screen cancel hint (manager report: accidentally
        # pressing LOCK dropped the user on this screen with no visible way
        # out -- the swipe-up cancel added earlier was real but entirely
        # undiscoverable, a hidden gesture with no on-screen affordance at
        # all, same class of problem the SKIP/MORE nav row below was already
        # built to fix for left/right). Placed above the title (no corner
        # indicators are built on this screen, unlike control/clock, so this
        # row is free) rather than folded into the "tap = tag & start" hint
        # below -- "swipe up = cancel, tap = tag & start" measured wider than
        # this 172px screen even at scale 1.
        cancel_hint = label.Label(terminalio.FONT, text="swipe up = cancel",
                                  color=C_GREY)
        cancel_hint.anchor_point = (0.5, 0.5)
        cancel_hint.anchored_position = (W // 2, 12)
        group.append(cancel_hint)
        self._dim_widgets.append((cancel_hint, 'color'))

        # Live swipe-up-cancel bar (see LockController.process()'s per-frame
        # drag tracking + step_tag_picker_swipe_progress below): a thin red
        # bar just under the "swipe up = cancel" hint that fills left-to-
        # right as the drag approaches SWIPE_MIN_PX, same Rect-rebuild idiom
        # as tp_hold_fill_group (below) so the two read as one consistent
        # "progress toward committing a gesture" visual language, just red
        # for canceling instead of green for confirming.
        self.tp_swipe_fill_group = displayio.Group()
        group.append(self.tp_swipe_fill_group)
        self._tp_swipe_last_key = None

        # Hold-to-confirm fill (see start_tag_picker_hold/step_tag_picker_hold
        # /cancel_tag_picker_hold): a single shared Rect group, same
        # rebuild-on-change idiom as bat_fill_group/ov_bar_fill_group -- only
        # one row can ever be mid-hold at a time on this single-touch device.
        # Appended BEFORE the row dot/label loop below so the fill paints
        # behind them (same z-order convention as the press-feedback rings in
        # _build_control): the row's dot and text stay readable through the
        # green wash instead of being covered by it.
        self.tp_hold_fill_group = displayio.Group()
        group.append(self.tp_hold_fill_group)
        self._tp_hold_last_key = None

        # Dot at a fixed x, name left-anchored just after it -- was a single
        # centered label per row until each row needed its own topic color
        # (built-in or synced-custom, see lock_config.BUILTIN_TOPICS /
        # LockController._synced_labels): centering text AND fitting a dot
        # in the remaining margin doesn't work at this screen's 172px width,
        # so the row layout shifted to dot-then-name instead.
        self.tp_dot_x = 26
        self.tp_dot_r = 6
        self.tp_name_x = 44
        self.tp_rows_y = (70, 110, 150, 190, 230, 270)
        self.tp_row_labels = []
        self.tp_row_dots = []
        for y in self.tp_rows_y:
            dot = Circle(self.tp_dot_x, y, self.tp_dot_r, fill=C_GREY)
            group.append(dot)
            self.tp_row_dots.append(dot)
            lbl = label.Label(terminalio.FONT, text="", color=C_WHITE, scale=2)
            lbl.anchor_point = (0.0, 0.5)
            lbl.anchored_position = (self.tp_name_x, y)
            group.append(lbl)
            self._fg_widgets.append((lbl, 'color'))
            self.tp_row_labels.append(lbl)
        self._tp_ids = []

        # SKIP/MORE controls -- an arrow plus a short label on each side,
        # both tappable (see tag_picker_nav_at) and still swipe-compatible.
        # The old single hint2 line ("swipe: left = skip, right = more", 34
        # chars) overflowed this 172px-wide screen even at scale 1, and
        # swipe-only paging with no visible control was easy to miss --
        # this fixes both by giving each direction its own small, explicit,
        # theme-colored affordance instead of one long unreadable caption.
        self.tp_nav_y = 308

        # SKIP hold-to-confirm fill (see start_tag_picker_skip_hold/
        # step_tag_picker_skip_hold/cancel_tag_picker_skip_hold): grey, not
        # green/red -- SKIP doesn't tag a topic or cancel the picker, it
        # starts an untagged session, so it gets its own neutral color
        # rather than reusing either existing meaning. Appended before the
        # arrow/label below so the fill paints behind them, same z-order
        # convention as tp_hold_fill_group/tp_swipe_fill_group.
        self.tp_skip_fill_group = displayio.Group()
        group.append(self.tp_skip_fill_group)
        self._tp_skip_last_key = None

        # No left arrow here (unlike MORE's, below) -- SKIP dropped its
        # swipe-left shortcut (manager report: it bypassed the hold-to-
        # confirm requirement entirely) and is only reachable by holding the
        # label itself now, so an arrow implying "swipe this way" would be
        # actively misleading.
        # scale=2 (12px/glyph) to match the row labels/title's weight instead
        # of this screen's default caption size, and centered within each
        # half of the screen (W//4, 3*W//4) rather than pinned to the outer
        # edges, now that SKIP no longer needs edge clearance for an arrow.
        skip_lbl = label.Label(terminalio.FONT, text="SKIP", color=C_WHITE, scale=2)
        skip_lbl.anchor_point = (0.5, 0.5)
        skip_lbl.anchored_position = (W // 4, self.tp_nav_y)
        group.append(skip_lbl)
        self._fg_widgets.append((skip_lbl, 'color'))

        more_lbl = label.Label(terminalio.FONT, text="MORE", color=C_WHITE, scale=2)
        more_lbl.anchor_point = (0.5, 0.5)
        more_lbl.anchored_position = (3 * W // 4, self.tp_nav_y)
        group.append(more_lbl)
        self._fg_widgets.append((more_lbl, 'color'))

        self._tp_arrow_right = Triangle(W - 20, self.tp_nav_y - 5, W - 20, self.tp_nav_y + 5,
                                        W - 12, self.tp_nav_y, fill=C_WHITE)
        group.append(self._tp_arrow_right)
        self._fg_widgets.append((self._tp_arrow_right, 'fill'))

    def show_tag_picker(self, page_topics):
        """page_topics: [(id, name, color), ...], up to 6 entries for this page."""
        self._tp_ids = [t[0] for t in page_topics]
        self.cancel_tag_picker_hold()  # clear any residual fill from before this page swap
        self.cancel_tag_picker_skip_hold()
        self.clear_tag_picker_swipe()
        for i, (lbl, dot) in enumerate(zip(self.tp_row_labels, self.tp_row_dots)):
            if i < len(page_topics):
                # 9 chars, not 12 -- at this row's scale=2 (12px/glyph), the
                # dot-then-name layout (see _build_tag_picker) leaves less
                # room for text than the old fully-centered row did. A
                # synced custom label can still be longer than this (up to
                # BLE_LABEL_NAME_MAX_LEN=12) and would truncate here; that's
                # a real display-only limit of this 172px screen, not a
                # sync-side one.
                lbl.text = page_topics[i][1][:9]
                lbl.hidden = False
                dot.fill = page_topics[i][2]
                dot.hidden = False
            else:
                lbl.text = ""
                lbl.hidden = True
                dot.hidden = True
        self.display.root_group = self.tag_picker_group

    def hide_tag_picker(self):
        # The universal chokepoint for leaving this screen -- go_running
        # (tap/skip/more/hold-commit paths) and the live swipe-up-cancel
        # commit (LockController.process()'s per-frame drag tracking) both
        # call this, so clearing any in-progress fill here guarantees the
        # picker never reopens still showing a stale red/green bar.
        self.clear_tag_picker_swipe()
        self.cancel_tag_picker_hold()
        self.cancel_tag_picker_skip_hold()
        # restore whatever top-level view was active before the picker
        self.show_view(self.view)

    def tag_picker_row_at(self, y):
        # Same tolerance convention as settings_row_at.
        for i, ry in enumerate(self.tp_rows_y):
            if abs(y - ry) <= 19 and i < len(self._tp_ids):
                return i
        return None

    def tag_picker_topic_for_row(self, row_idx):
        if row_idx is None or row_idx >= len(self._tp_ids):
            return None
        return self._tp_ids[row_idx]

    def tag_picker_nav_at(self, x, y):
        """'skip' / 'more' if (x, y) landed on that arrow+label control,
        else None. Left half of the row = skip, right half = more -- a
        generous tap target, not just the small triangle glyph itself."""
        if abs(y - self.tp_nav_y) > 18:
            return None
        return 'skip' if x < self.W // 2 else 'more'

    # ----- pre-session tag picker: hold-to-confirm row fill -----
    def start_tag_picker_hold(self, row_idx):
        """Touch-down on a topic row (see LockController._start_tag_hold):
        primes the green fill at zero width -- step_tag_picker_hold grows it
        from here as the hold continues."""
        self._tp_hold_last_key = None
        self.step_tag_picker_hold(row_idx, 0.0)

    def step_tag_picker_hold(self, row_idx, progress):
        """Grows a green Rect leftward-to-rightward across the row as
        `progress` (0..1) advances -- same rebuild-only-on-change idiom as
        update_battery_view/update_override_timeout's fill bars (a fresh
        Rect is cheap; rebuilding one on every unchanged frame is what
        actually costs heap churn, per those functions' comments)."""
        w = max(0, int(round((self.W - 12) * min(1.0, max(0.0, progress)))))
        key = (row_idx, w)
        if key == self._tp_hold_last_key:
            return
        self._tp_hold_last_key = key
        while len(self.tp_hold_fill_group):
            self.tp_hold_fill_group.pop()
        if w > 0:
            y_top = self.tp_rows_y[row_idx] - 16
            self.tp_hold_fill_group.append(Rect(6, y_top, w, 32, fill=C_GREEN))

    def cancel_tag_picker_hold(self):
        """Clears whatever fill is currently showing (hold released early,
        drifted off the row, or committed and about to hide the picker) --
        only one row can be mid-hold at a time on this single-touch device,
        so nothing else needs to know which row it was."""
        if self._tp_hold_last_key is None:
            return
        self._tp_hold_last_key = None
        while len(self.tp_hold_fill_group):
            self.tp_hold_fill_group.pop()

    # ----- pre-session tag picker: hold-to-confirm SKIP fill -----
    def start_tag_picker_skip_hold(self):
        """Touch-down on SKIP (see LockController._start_tag_hold): primes
        the grey fill at zero width, same priming/growth split as
        start_tag_picker_hold/step_tag_picker_hold."""
        self._tp_skip_last_key = None
        self.step_tag_picker_skip_hold(0.0)

    def step_tag_picker_skip_hold(self, progress):
        """Grows a grey Rect across SKIP's left-half hit area as `progress`
        (0..1) advances -- same rebuild-only-on-change idiom as
        step_tag_picker_hold, just spanning the fixed SKIP region instead of
        a per-row one since there's only ever one SKIP control."""
        w = max(0, int(round((self.W // 2 - 12) * min(1.0, max(0.0, progress)))))
        key = w
        if key == self._tp_skip_last_key:
            return
        self._tp_skip_last_key = key
        while len(self.tp_skip_fill_group):
            self.tp_skip_fill_group.pop()
        if w > 0:
            self.tp_skip_fill_group.append(Rect(6, self.tp_nav_y - 14, w, 28, fill=C_GREY))

    def cancel_tag_picker_skip_hold(self):
        """Clears whatever SKIP fill is currently showing (released early,
        drifted off SKIP onto MORE, or committed and about to hide the
        picker)."""
        if self._tp_skip_last_key is None:
            return
        self._tp_skip_last_key = None
        while len(self.tp_skip_fill_group):
            self.tp_skip_fill_group.pop()

    # ----- pre-session tag picker: live swipe-up-cancel bar -----
    def step_tag_picker_swipe_progress(self, progress):
        """Grows a red Rect under the "swipe up = cancel" hint as `progress`
        (0..1, live |dy|/SWIPE_MIN_PX from LockController.process()) tracks
        the drag itself -- not a scripted post-release flash. Same rebuild-
        only-on-change idiom as step_tag_picker_hold, just red and anchored
        under the hint instead of green and per-row, so the two gestures
        read as one consistent "progress toward committing" language."""
        w = max(0, int(round((self.W - 12) * min(1.0, max(0.0, progress)))))
        key = w
        if key == self._tp_swipe_last_key:
            return
        self._tp_swipe_last_key = key
        while len(self.tp_swipe_fill_group):
            self.tp_swipe_fill_group.pop()
        if w > 0:
            self.tp_swipe_fill_group.append(Rect(6, 20, w, 6, fill=C_RED))

    def clear_tag_picker_swipe(self):
        """Clears the red bar -- drag reversed/released below threshold, or
        the picker is closing (commit or otherwise) and needs a clean slate
        for the next time it's shown."""
        if self._tp_swipe_last_key is None:
            return
        self._tp_swipe_last_key = None
        while len(self.tp_swipe_fill_group):
            self.tp_swipe_fill_group.pop()

    # =================== pre-session topic confirm ===================
    # Shown instead of the tag picker (see LockController.go_confirming) when
    # the app has already pushed a topic the box recognises -- CONFIRM starts
    # the session with it unchanged, CHANGE falls through to the tag picker
    # above to pick something else. Geometry below is reasoned the same way
    # every other from-source geometry constant in this file is (see
    # lock_config.py's DONE_MSG_Y comment) -- needs an on-device visual check,
    # no host-runnable renderer exists for this display stack.
    def _build_topic_confirm(self, W, H):
        group = displayio.Group()
        self.topic_confirm_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = label.Label(terminalio.FONT, text="CONFIRM TOPIC", color=C_GREY,
                          scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 30)
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))

        _card = RoundRect(12, 80, 148, 60, RADIUS_CARD, fill=C_SURFACE,
                          outline=C_GREY, stroke=2)
        group.append(_card)
        self._surface_widgets.append((_card, 'fill'))
        self._dim_widgets.append((_card, 'outline'))

        # scale=2 (12px/glyph), not 3 -- fits the wire's full
        # BLE_LABEL_NAME_MAX_LEN=12-char custom-label name (12 * 12px =
        # 144px) inside this 148px card with a hair of margin; scale=3
        # (18px/glyph) would force truncation to ~8 chars. Built-in topic
        # names (see lock_config.BUILTIN_TOPICS) are all well under either
        # bound.
        self.tc_name = label.Label(terminalio.FONT, text="", color=C_WHITE,
                                   scale=2)
        self.tc_name.anchor_point = (0.5, 0.5)
        self.tc_name.anchored_position = (W // 2, 110)
        group.append(self.tc_name)
        self._fg_widgets.append((self.tc_name, 'color'))

        # CONFIRM: primary action -- fg-weighted outline/label, like the
        # LOCK/OPEN button's own outline convention in _build_control.
        self._tc_confirm_x, self._tc_confirm_y = 21, 168
        self._tc_confirm_w, self._tc_confirm_h = 130, 64
        self.tc_confirm_btn = RoundRect(self._tc_confirm_x, self._tc_confirm_y,
                                        self._tc_confirm_w, self._tc_confirm_h,
                                        RADIUS_BTN_LG, fill=C_SURFACE,
                                        outline=C_WHITE, stroke=2)
        group.append(self.tc_confirm_btn)
        self._fg_widgets.append((self.tc_confirm_btn, 'outline'))
        confirm_lbl = label.Label(terminalio.FONT, text="CONFIRM", color=C_WHITE,
                                  scale=2)
        confirm_lbl.anchor_point = (0.5, 0.5)
        confirm_lbl.anchored_position = (self._tc_confirm_x + self._tc_confirm_w // 2,
                                         self._tc_confirm_y + self._tc_confirm_h // 2)
        group.append(confirm_lbl)
        self._fg_widgets.append((confirm_lbl, 'color'))

        # CHANGE: secondary weight -- dim-tracked outline/label, like the
        # tag picker's own SKIP/MORE labels, so it reads as the lesser of
        # the two actions without needing a separate visual language.
        self._tc_change_x, self._tc_change_y = 21, 260
        self._tc_change_w, self._tc_change_h = 130, 48
        self.tc_change_btn = RoundRect(self._tc_change_x, self._tc_change_y,
                                       self._tc_change_w, self._tc_change_h,
                                       RADIUS_BTN_SM, fill=C_SURFACE,
                                       outline=C_GREY, stroke=2)
        group.append(self.tc_change_btn)
        self._dim_widgets.append((self.tc_change_btn, 'outline'))
        change_lbl = label.Label(terminalio.FONT, text="CHANGE", color=C_GREY,
                                 scale=2)
        change_lbl.anchor_point = (0.5, 0.5)
        change_lbl.anchored_position = (self._tc_change_x + self._tc_change_w // 2,
                                        self._tc_change_y + self._tc_change_h // 2)
        group.append(change_lbl)
        self._dim_widgets.append((change_lbl, 'color'))

    def show_topic_confirm(self, name):
        # .text= reassignment on an already-built Label -- same
        # build-once-then-mutate idiom show_tag_picker's row labels and
        # _build_setting_detail's sd_value already use; see this module's
        # header comment on why a fresh Label per call is never acceptable
        # here. Does NOT pass max_glyphs -- this board's installed
        # adafruit_display_text.Label raises TypeError on that kwarg (see
        # the _build_override comment for where that was actually hit
        # on-device).
        self.tc_name.text = name
        self.display.root_group = self.topic_confirm_group

    def hide_topic_confirm(self):
        # Same "safe to call even if this screen was never shown" contract
        # as hide_tag_picker -- LockController.go_running calls both
        # unconditionally from one chokepoint. Also clears any left-over
        # press highlight so the next time this screen shows, it doesn't
        # briefly flash a stale highlighted button from the previous visit.
        self.press_topic_confirm(None)
        self.show_view(self.view)

    def in_topic_confirm_confirm(self, x, y):
        return (self._tc_confirm_x <= x <= self._tc_confirm_x + self._tc_confirm_w and
                self._tc_confirm_y <= y <= self._tc_confirm_y + self._tc_confirm_h)

    def in_topic_confirm_change(self, x, y):
        return (self._tc_change_x <= x <= self._tc_change_x + self._tc_change_w and
                self._tc_change_y <= y <= self._tc_change_y + self._tc_change_h)

    def press_topic_confirm(self, which):
        """Press-highlight for CONFIRM/CHANGE (see lock_topic_confirm.
        TopicConfirm) -- `which` is 'confirm', 'change', or None to clear
        both. A simple outline-color swap rather than the button/status-bar
        press-ring machinery in _build_control: those rings are driven by
        LockController.process's on_touch_down/on_touch_up, which only fire
        while self.view == "control" -- the same reason the tag picker
        above has no press feedback of its own either. This screen isn't a
        top-level view (same as the picker), so TopicConfirm calls this
        directly from its own on_touch instead.

        Restores each button's un-pressed outline from self._fg_color /
        self._dim_color (the SAME live values set_theme just applied) rather
        than a build-time literal -- if a theme push lands while a press
        happens to be in progress, releasing still leaves the right color
        instead of reverting to whatever shade was compiled in."""
        self.tc_confirm_btn.outline = self._accent_color if which == 'confirm' else self._fg_color
        self.tc_change_btn.outline = self._accent_color if which == 'change' else self._dim_color
