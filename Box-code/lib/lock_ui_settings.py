# lock_ui_settings.py -- the on-box settings list and its per-setting detail page.
#
# One of the view mixins LockUI is composed from; see lock_ui.py's header for
# why the class is split this way and what that does and does not change.
# Every method here runs as a method OF LockUI -- `self` is the whole UI, and
# the attributes below are the ones lock_ui.py's __init__ creates.
#
# Redesigned per settings-ui-spec.md: no scrolling (all six rows fit one
# 46px-pitch screen), real switches for the three boolean settings (toggle
# in place instead of drilling into the detail page), and a visible 158x40
# card per row with NO dead zone between hit bands (see settings_row_at).
# Construction of the reusable switch/row/stepper/track/chevron widgets
# lives in lock_ui_widgets.py as plain functions -- partly because they ARE
# reused (the switch, the bar-width math), and partly to keep this file,
# which owns all of this screen's STATE and touch-driven behaviour, under
# the repo's 500-line cap (settings-ui-spec.md SS9 explicitly allows moving
# more geometry into that module for exactly this reason).

import time
import displayio
import terminalio
from adafruit_display_text import label
from lock_config import (
    C_BG, C_SURFACE_HILITE, C_GREY, C_AMBER, C_ON_ACCENT_DARK, C_ON_ACCENT_LIGHT,
    MODE_COLORS, SET_KNOB_SLIDE_S,
)
from lock_ui_common import _bg_tile
from lock_ui_widgets import (
    build_switch_track, build_switch_knob, switch_knob_cx, bar_fill_width, row_at,
    build_settings_card, build_settings_row_text, build_settings_value_label,
    build_settings_hold_fill, build_stepper_button, build_detail_track_bg,
    build_detail_track_fill, build_detail_labels, build_back_chevron, in_back_region,
    fmt_sleep, fmt_setting, setting_fraction, setting_bounds_text,
    SET_ROWS_TOP, SET_ROW_PITCH, SET_HOLD_FILL_W,
    SD_TRACK_X, SD_TRACK_W, SD_TRACK_MIN_FILL, SD_BTN_W, SD_BTN_H, SD_BTN_Y,
    SD_MINUS_X, SD_PLUS_X,
)


class SettingsMixin:
    # =================== settings list ===================
    # Renamed per SS2.3 ("short name, meaning in the description line"):
    # Auto-open -> Auto, R Unlock -> Remote, C Unlock -> On call. Index order
    # 0..5 is UNCHANGED -- Settings.adjust and lock_controller_ble.py's
    # _edit_idx both depend on it, and this tuple also feeds the detail
    # page's sd_name, so a reorder here would silently retarget both.
    _SET_NAMES = ("Override", "Auto", "Sleep", "Bright", "Remote", "On call")
    # Terse, list-only descriptions (SS2.3) -- the list has no vertical room
    # for the longer _SET_DESCRIPTIONS strings below (17-glyph budget on a
    # switch row, see SS2.2), so this is a DELIBERATELY separate tuple, not
    # a truncation of _SET_DESCRIPTIONS at render time -- truncating a
    # sentence live risks cutting it somewhere that reads wrong; writing a
    # second, genuinely shorter sentence for the same idea does not.
    _SET_LIST_DESCS = (
        "presses to force-unlock",
        "open at timer end",
        "screen sleep timeout",
        "screen brightness",
        "app can open box",
        "open on a call",
    )
    # Rows 1/4/5 are booleans and get a real switch instead of a value
    # label + detail page (SS Governing Principle item 2 -- "fewer taps").
    _SET_SWITCH_ROWS = (1, 4, 5)

    def _build_settings(self, W, H):
        group = displayio.Group()
        self.settings_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = label.Label(terminalio.FONT, text="SETTINGS", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 20)
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))
        # No "tap a row to change" hint here anymore (was at y=300, SS2.1) --
        # it collided with row 5's card, and a row that looks like a
        # card/switch does not need a caption telling you it is tappable.

        n = len(self._SET_NAMES)
        self._set_row_cards = []
        self._set_row_descs = []
        self._set_value_labels = [None] * n
        self._set_switch_tracks = [None] * n
        self._set_switch_knobs = [None] * n
        # Last-applied on/off per switch row, None until the first
        # update_settings() call -- see _apply_switch for why that
        # three-state distinction (None vs True vs False) matters.
        self._set_switch_state = [None] * n

        # Pass 1: every row's CARD, and only the cards -- see
        # build_settings_card's docstring for why the hold-to-confirm sweep
        # below needs this split into two passes rather than one loop
        # building card+text together.
        for i in range(n):
            card = build_settings_card(SET_ROWS_TOP + i * SET_ROW_PITCH)
            group.append(card)
            self._surface_widgets.append((card, 'fill'))
            self._set_row_cards.append(card)

        # Hold-to-confirm sweep (SS6): one shared Rect group, same idiom as
        # lock_ui_tags.py's tp_hold_fill_group -- only one row can ever be
        # mid-hold at a time. Appended after all six cards but before any
        # name/desc/switch below, so it paints ON TOP of whichever row's
        # card it belongs to, and every row's text/switch still paints on
        # top of IT.
        self._set_hold_fill_group = displayio.Group()
        group.append(self._set_hold_fill_group)
        self._set_hold_last_key = None
        self._set_pressed_row = None

        # Pass 2: name/desc/switch-or-value, on top of the fill group above.
        for i in range(n):
            band_top = SET_ROWS_TOP + i * SET_ROW_PITCH
            nlbl, dlbl = build_settings_row_text(
                band_top, self._SET_NAMES[i], self._SET_LIST_DESCS[i])
            group.append(nlbl)
            self._fg_widgets.append((nlbl, 'color'))
            group.append(dlbl)
            self._dim_widgets.append((dlbl, 'color'))
            self._set_row_descs.append(dlbl)

            if i in self._SET_SWITCH_ROWS:
                track = build_switch_track(band_top + 12)
                group.append(track)
                knob = build_switch_knob(band_top + 23)
                group.append(knob)
                # Deliberately in NO theme registry -- track/knob color is
                # STATE-dependent (SS3); update_settings (_apply_switch) is
                # the single apply path, re-deriving both from the live
                # self._accent_color/self._fg_color every call, which is
                # also why the controller re-calls it right after set_theme.
                self._set_switch_tracks[i] = track
                self._set_switch_knobs[i] = knob
            else:
                vlbl = build_settings_value_label(band_top)
                group.append(vlbl)
                self._accent_widgets.append((vlbl, 'color'))
                self._set_value_labels[i] = vlbl

    def update_settings(self, s):
        self._set_value_labels[0].text = str(s.override_presses)
        self._apply_switch(1, s.auto_open)
        self._set_value_labels[2].text = fmt_sleep(s.sleep_s)
        self._set_value_labels[3].text = "{}%".format(s.bright_pct)
        self._apply_switch(4, s.allow_remote_unlock)
        self._apply_switch(5, s.unlock_on_call)
        # Kept exactly as before the redesign -- the control view's own
        # override-count hint (lock_ui_control.py) has no other update path.
        self.ov_count_hint.text = "x{}".format(s.override_presses)

    def _apply_switch(self, row, is_on):
        """Single apply path for one switch row's colors + knob position
        (SS3) -- see update_settings's own comment on why the controller
        always routes state changes through here, including a bare theme
        refresh with no toggle of its own."""
        track = self._set_switch_tracks[row]
        knob = self._set_switch_knobs[row]
        target_track = self._accent_color if is_on else C_SURFACE_HILITE
        # See build_switch_track's docstring: ON hides the outline inside the
        # accent fill; OFF keeps a dim silhouette so a press-highlighted card
        # (also C_SURFACE_HILITE) can't swallow the track whole.
        target_outline = self._accent_color if is_on else self._dim_color
        target_cx = switch_knob_cx(is_on)
        was_on = self._set_switch_state[row]
        if was_on is None or was_on == is_on:
            # First paint, or the state genuinely did not just change (this
            # call is a theme refresh, or update_settings running because
            # some OTHER row changed) -- a direct, unanimated assignment.
            # Only a REAL OFF<->ON flip below gets the eased/tweened
            # treatment; otherwise every visit to this screen would replay
            # the "just flipped" animation on switches nobody touched.
            track.fill = target_track
            track.outline = target_outline
            knob.x0 = target_cx
        else:
            self._start_color_transition(track, 'fill', target_track)
            self._start_color_transition(track, 'outline', target_outline)
            self._start_pos_tween(knob, 'x0', target_cx)
        # Knob COLOR always snaps -- a small shape, not worth a second
        # engine entry to ease (easing it too buys nothing visible).
        knob.fill = self._fg_color if is_on else C_GREY
        self._set_switch_state[row] = is_on

    def settings_row_count(self):
        return len(self._SET_NAMES)

    def settings_row_is_switch(self, row):
        return row in self._SET_SWITCH_ROWS

    def settings_row_at(self, y):
        # Full-band hit test (SS1b/SS8): every pixel from SET_ROWS_TOP to the
        # last row's bottom edge belongs to SOME row -- no +/-19px tolerance
        # gap between adjacent bands like the old center-distance test left.
        return row_at(y, SET_ROWS_TOP, SET_ROW_PITCH, len(self._SET_NAMES))

    def press_settings_row(self, row):
        """Instant highlight-on-press, eased release (SS2.4) -- mirrors
        press_topic_confirm's contract (lock_ui_tags.py): the press itself
        is a plain, immediate .fill write (a touch must never lag); release
        eases via the existing _start_color_transition engine, reading the
        surface color live off the current theme rather than a build-time
        literal, exactly as that docstring requires. Tracks which row (if
        any) is currently pressed, since this drives N row cards instead of
        a fixed pair of buttons."""
        prev = self._set_pressed_row
        if prev is not None and prev != row:
            self._start_color_transition(self._set_row_cards[prev], 'fill',
                                         self._live_surface_color())
        self._set_pressed_row = row
        if row is not None:
            self._set_row_cards[row].fill = C_SURFACE_HILITE

    def start_settings_hold(self, row):
        """Touch-down on an OFF risky row (SS6) primes the amber fill at
        zero width -- step_settings_hold grows it from here."""
        self._set_hold_last_key = None
        self.step_settings_hold(row, 0.0)

    def step_settings_hold(self, row, progress):
        """Grows the amber sweep across the row's card interior as
        `progress` (0..1) advances toward SETTINGS_HOLD_S -- rebuild-only-
        on-change, same idiom as lock_ui_tags.py's step_tag_picker_hold.
        Amber, not tag-picker green: the user is WEAKENING the lock here,
        not confirming a selection (settings-ui-spec.md SS6's color note)."""
        w = bar_fill_width(SET_HOLD_FILL_W, progress)
        key = (row, w)
        if key == self._set_hold_last_key:
            return
        self._set_hold_last_key = key
        while len(self._set_hold_fill_group):
            self._set_hold_fill_group.pop()
        fill = build_settings_hold_fill(row, w)
        if fill is not None:
            self._set_hold_fill_group.append(fill)

    def cancel_settings_hold(self):
        """Clears whatever amber fill is showing -- released early, drifted
        off the row, or committed and about to repaint via update_settings.
        Only one row can be mid-hold at a time, so nothing else needs to
        know which one it was (same contract as cancel_tag_picker_hold)."""
        if self._set_hold_last_key is None:
            return
        self._set_hold_last_key = None
        while len(self._set_hold_fill_group):
            self._set_hold_fill_group.pop()

    def set_settings_row_hint(self, row, text):
        """Live desc-line swap (SS6.1): `text` while a hold is armed (e.g.
        "hold to enable"), or None to restore the row's real description --
        the discoverability mechanism appears exactly when the finger is
        already down, so it can never be missed, and costs no permanent
        screen space the rest of the time.

        The hint also turns AMBER, matching the hold bar growing directly
        beneath it (SET_HOLD_FILL_* in lock_ui_widgets.py): the two are one
        message -- "this needs a deliberate hold" -- and amber is this
        palette's existing caution role. Restored from self._dim_color, the
        SAME live value set_theme just applied, rather than the build-time
        C_GREY literal: a theme push landing mid-hold would otherwise leave
        the desc stuck on whatever shade was compiled in once the hold ends
        (press_topic_confirm's docstring in lock_ui_tags.py documents the
        identical requirement for its own release path)."""
        lbl = self._set_row_descs[row]
        if text is not None:
            lbl.text = text
            lbl.color = C_AMBER
        else:
            lbl.text = self._SET_LIST_DESCS[row]
            lbl.color = self._dim_color

    def _live_surface_color(self):
        """The current theme's surface color, read live off self._mode_idx
        instead of a build-time literal -- press_topic_confirm's docstring
        (lock_ui_tags.py) documents the same requirement for its own
        release-easing target. MODE_COLORS is the exact tuple set_theme
        itself unpacks (lock_ui_theme.py), so indexing it here by the live
        mode gives the identical value with no second copy to drift out of
        sync -- this file does not touch lock_ui_theme.py to get it."""
        return MODE_COLORS[self._mode_idx][1]

    def _on_accent_color(self):
        """Text color for a glyph on a live-accent fill -- same per-mode
        choice set_theme makes for the LOCK/OPEN button's label."""
        return C_ON_ACCENT_LIGHT if self._mode_idx == 1 else C_ON_ACCENT_DARK

    # =================== per-setting detail page ===================
    # Reached only from numeric rows (0, 2, 3) now -- boolean rows toggle in
    # the list and never open this page at all (SS Governing Principle
    # item 2). Keeps the longer, original _SET_DESCRIPTIONS below (more
    # horizontal room here than the list has); only the list's own
    # descriptions (_SET_LIST_DESCS above) were shortened.
    _SET_DESCRIPTIONS = (
        "presses to force-unlock",
        "auto-open when timer ends",
        "screen sleep timeout",
        "screen brightness (%)",
        "app can unlock box early",
        "unlock box on incoming call",
    )

    def _build_setting_detail(self, W, H):
        group = displayio.Group()
        self.setting_detail_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        # Back control (SS4) -- the single biggest ease-of-use fix on this
        # screen: the only way out used to be an undiscoverable horizontal
        # swipe, advertised by a "swipe left = back" caption at y=300
        # (gone below, replaced by this). The swipe itself still works
        # unchanged (lock_controller_gestures.py's _handle_release checks it
        # first) -- this chevron+label is an ADDITIONAL, discoverable exit,
        # same "add a control, don't replace a gesture" move tag_picker_
        # nav_at made for SKIP/MORE (lock_ui_tags.py).
        self._sd_back_chevron = build_back_chevron(C_GREY)
        group.append(self._sd_back_chevron)
        self._dim_widgets.append((self._sd_back_chevron, 'fill'))

        # See build_detail_labels' own docstring (lock_ui_widgets.py) for
        # why these six otherwise-unrelated labels share one builder.
        (back_lbl, self.sd_name, self.sd_value, self.sd_desc,
         self.sd_min_lbl, self.sd_max_lbl) = build_detail_labels(W)
        for lbl in (back_lbl, self.sd_name, self.sd_desc,
                   self.sd_min_lbl, self.sd_max_lbl):
            group.append(lbl)
            self._dim_widgets.append((lbl, 'color'))
        group.append(self.sd_value)
        self._accent_widgets.append((self.sd_value, 'color'))

        # Progress track (SS4): see build_detail_track_bg/_fill's own
        # comments (lock_ui_widgets.py) for the bg's theme-fixed reasoning
        # and the fill's live-accent-at-rebuild-time contract.
        self._sd_track_bg = build_detail_track_bg()
        group.append(self._sd_track_bg)
        self._sd_track_fill_group = displayio.Group()
        group.append(self._sd_track_fill_group)
        self._sd_track_last_key = None

        # Stepper (SS4). Deliberate color change: the old [-]/[+] were a
        # fixed red/green fill pair, "like the lock-status colors...
        # recoloring just the '+' side risks landing on an accent hue close
        # to the '-' side's red and making the two buttons look alike"
        # (this file's previous revision). Real concern, but the fix isn't
        # accent either -- dropping red/green for a neutral, IDENTICAL pair
        # (build_stepper_button) sidesteps that clash outright instead of
        # hunting for a third color that avoids it: a stepper isn't a
        # danger/safety control the way LOCKED/CLOSED/UNLOCKED status is,
        # so spending the palette's strongest signal on "add 5 to a number"
        # overstates it, and Apple's own steppers are two identical neutral
        # segments.
        self.sd_btn_w, self.sd_btn_h, self.sd_btn_y = SD_BTN_W, SD_BTN_H, SD_BTN_Y
        self.sd_minus_x, self.sd_plus_x = SD_MINUS_X, SD_PLUS_X
        self._sd_stepper_pressed = None
        self.sd_minus_btn, self.sd_minus_label = build_stepper_button(SD_MINUS_X, "-")
        self.sd_plus_btn, self.sd_plus_label = build_stepper_button(SD_PLUS_X, "+")
        for btn, glyph in ((self.sd_minus_btn, self.sd_minus_label),
                          (self.sd_plus_btn, self.sd_plus_label)):
            group.append(btn)
            self._surface_widgets.append((btn, 'fill'))
            self._fg_widgets.append((btn, 'outline'))
            group.append(glyph)
            self._fg_widgets.append((glyph, 'color'))
        # No "swipe left = back" caption here anymore (was at y=300) -- the
        # back chevron+label built at the top of this function is what
        # replaces it; the swipe itself still works, it just no longer
        # needs a caption to be discoverable.

    def show_setting_detail(self, idx, s):
        self.sd_name.text = self._SET_NAMES[idx]
        self.sd_value.text = fmt_setting(idx, s)
        self.sd_desc.text = self._SET_DESCRIPTIONS[idx]
        lo, hi = setting_bounds_text(idx)
        self.sd_min_lbl.text = lo
        self.sd_max_lbl.text = hi
        # Force a repaint even if the incoming idx's fraction happens to
        # produce the same width the PREVIOUS idx last drew -- the rebuild
        # guard below only knows about widths, not which setting they
        # belong to.
        self._sd_track_last_key = None
        self._refresh_detail_track(idx, s)
        self.press_setting_stepper(None)   # clear any stale press highlight
                                            # left over from a previous visit
        self.display.root_group = self.setting_detail_group

    def update_setting_detail(self, idx, s):
        self.sd_value.text = fmt_setting(idx, s)
        self._refresh_detail_track(idx, s)

    def _refresh_detail_track(self, idx, s):
        """Track FILL only -- rebuild-on-change idiom (SS4/SS9, same
        _tp_hold_last_key-style guard as step_settings_hold above), since
        this runs on every hold-repeat tick from _update_hold
        (lock_controller_gestures.py), not just once per screen visit."""
        w = bar_fill_width(SD_TRACK_W, setting_fraction(idx, s),
                           SD_TRACK_MIN_FILL)
        if w == self._sd_track_last_key:
            return
        self._sd_track_last_key = w
        while len(self._sd_track_fill_group):
            self._sd_track_fill_group.pop()
        if w > 0:
            self._sd_track_fill_group.append(
                build_detail_track_fill(w, self._accent_color))

    def in_setting_minus(self, x, y):
        return (self.sd_minus_x <= x <= self.sd_minus_x + self.sd_btn_w and
                self.sd_btn_y <= y <= self.sd_btn_y + self.sd_btn_h)

    def in_setting_plus(self, x, y):
        return (self.sd_plus_x <= x <= self.sd_plus_x + self.sd_btn_w and
                self.sd_btn_y <= y <= self.sd_btn_y + self.sd_btn_h)

    def in_settings_back(self, x, y):
        return in_back_region(x, y)

    def press_setting_stepper(self, which):
        """Press-highlight for [-]/[+] (SS4) -- `which` is 'minus', 'plus',
        or None. Guards on the PREVIOUS call's result (unlike
        press_settings_row, which is called only on real press/release
        events) because _update_hold calls this every single frame while
        editing, pressed or not -- without the guard, an idle frame would
        re-trigger _start_color_transition every tick, and since that
        engine restarts its own lerp from whatever is CURRENTLY on screen,
        a genuine in-flight release-ease would never be allowed to finish."""
        if which == self._sd_stepper_pressed:
            return
        prev = self._sd_stepper_pressed
        self._sd_stepper_pressed = which
        if prev is not None:
            btn = self.sd_minus_btn if prev == 'minus' else self.sd_plus_btn
            glyph = self.sd_minus_label if prev == 'minus' else self.sd_plus_label
            self._start_color_transition(btn, 'fill', self._live_surface_color())
            glyph.color = self._fg_color
        if which is not None:
            btn = self.sd_minus_btn if which == 'minus' else self.sd_plus_btn
            glyph = self.sd_minus_label if which == 'minus' else self.sd_plus_label
            btn.fill = self._accent_color
            glyph.color = self._on_accent_color()

    # =================== position-tween engine (SS5.2) ===================
    # See lock_ui.py's _pos_tweens comment for why this is a SECOND engine
    # rather than folded into _color_transitions (lock_ui_theme.py): the two
    # move disjoint attribute kinds by construction, so they can never race
    # on one widget. Currently the switch knob's `.x0` is the only user.
    def _start_pos_tween(self, obj, attr, to_v, duration=SET_KNOB_SLIDE_S):
        """Position-tween counterpart of _start_color_transition -- same
        drop-and-restart-cleanly behavior on a fast retrigger, same
        ease-out-cubic curve, but writes an int-valued position attribute
        instead of an RGB triple."""
        frm = getattr(obj, attr)
        if frm == to_v:
            return
        self._pos_tweens = [t for t in self._pos_tweens
                            if not (t[0] is obj and t[1] == attr)]
        self._pos_tweens.append([obj, attr, frm, to_v, time.monotonic(), duration])

    def step_pos_tweens(self):
        """Called from ControlMixin._step_motion (lock_ui_control.py) every
        frame -- same tier as step_color_transitions, cheap once settled (a
        single empty-list check)."""
        if not self._pos_tweens:
            return
        now = time.monotonic()
        still_running = []
        for obj, attr, frm, to, start, duration in self._pos_tweens:
            t = (now - start) / duration
            if t >= 1.0:
                setattr(obj, attr, to)
            else:
                it = 1.0 - t
                eased = 1.0 - it * it * it   # ease-out cubic, same curve as
                                              # step_color_transitions
                setattr(obj, attr, int(round(frm + (to - frm) * eased)))
                still_running.append([obj, attr, frm, to, start, duration])
        self._pos_tweens = still_running
