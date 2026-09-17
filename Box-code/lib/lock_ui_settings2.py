# lock_ui_settings2.py -- the on-box settings list, PAGE 2: six settings
# that used to be app-only (see lock_settings.Settings.adjust's own comment
# on indices 6..11 and lock_config.SERVO_ANGLE_STEP/OVR_TIMEOUT_STEP_TENTHS).
#
# One of the view mixins LockUI is composed from; see lock_ui.py's header
# for why the class is split this way and what that does and does not
# change. Every method here runs as a method OF LockUI -- `self` is the
# whole UI, and the attributes below are the ones lock_ui.py's __init__
# creates (plus this file's own _build_settings2, called alongside it).
#
# SIBLING of lock_ui_settings.py's SettingsMixin, not a subclass or a
# refactor of it -- same geometry (SET_ROWS_TOP/SET_ROW_PITCH/card size,
# imported from lock_ui_widgets.py, never re-declared: two settings pages
# whose rows don't line up when you swipe between them is exactly the drift
# this split guards against) and the same build-once-then-mutate idiom, but
# every method name below is DELIBERATELY DISTINCT from SettingsMixin's
# (settings2_row_at vs settings_row_at, press_settings2_row vs
# press_settings_row, update_settings2 vs update_settings, ...) -- see
# lock_ui.py's header and tests/test_firmware_loads.py, which structurally
# asserts no two of LockUI's mixins define the same name. This page also
# needs NO hold-to-confirm machinery at all (frozen phase-2 spec's
# Interaction section: "No hold-to-confirm on this page" -- none of these
# six weakens the lock), so it has nothing resembling
# start_settings_hold/step_settings_hold/cancel_settings_hold/
# set_settings_row_hint -- there is no page-2 equivalent to add.
#
# Detail-page rows (Window, Lock pos, Open pos) do NOT get their own detail
# screen: they reuse the exact same setting_detail_group/sd_name/sd_value/
# sd_desc/track/stepper SettingsMixin already built (one shared screen for
# every numeric row on either page, keyed by the flat Settings.adjust index
# -- see LockController._edit_idx). What's added here is only the two
# methods that POPULATE those shared widgets for indices 9-11
# (show_setting_detail2/update_setting_detail2), named distinctly from
# SettingsMixin's show_setting_detail/update_setting_detail for the same
# no-collision reason as everything else in this file, since _SET_NAMES/
# _SET_DESCRIPTIONS in lock_ui_settings.py are page 1's own and stay fixed
# at 6 entries (0..5) -- lock_ui_settings.py is not a file this page owns.

import displayio
from lock_config import C_BG, C_SURFACE_HILITE, C_GREY, ACCENT_COLORS_DARK, ACCENT_COLORS_LIGHT
from lock_ui_common import _bg_tile
from lock_ui_kit import build_screen_title
from lock_ui_widgets import (
    build_switch_track, build_switch_knob, switch_knob_cx, row_at,
    build_settings_card, build_settings_row_text, build_settings_value_label,
    build_accent_swatches, fmt_setting, setting_bounds_text,
    SET_ROWS_TOP, SET_ROW_PITCH,
)


class Settings2Mixin:
    # Row order fixed by the frozen phase-2 spec's row table -- local index
    # (0..5) + 6 = the FLAT Settings.adjust/detail-page index. Do not
    # renumber, same reasoning _SET_NAMES's comment in lock_ui_settings.py
    # gives for page 1: lock_controller_ble.py's live-refresh path and the
    # shared detail page both key off the flat number.
    _SET2_NAMES = ("Theme", "Accent", "Flip", "Window", "Lock pos", "Open pos")
    # One tuple for BOTH the list and (for the three rows that have one) the
    # detail page -- unlike page 1's separate _SET_LIST_DESCS/
    # _SET_DESCRIPTIONS split. That split existed there because three of
    # page 1's rows are switches with a tighter 17-glyph list budget than
    # their un-budget-constrained detail equivalent; every page-2 row that
    # reaches the list is either a value row (24-glyph budget) or the one
    # switch (Flip, whose desc already fits in 17 glyphs), so the same
    # string satisfies both places' budgets with no truncation risk -- see
    # the frozen spec's row table, which gives exactly one desc per row.
    _SET2_LIST_DESCS = (
        "dark or light",
        "highlight colour",
        "mount upside-down",
        "override press window",
        "servo angle, shut",
        "servo angle, open",
    )
    # Row TAP BEHAVIOUR (cycle / switch / open-detail) is arbitrated by
    # lock_settings_nav.SettingsNav, not here -- this constant is the one
    # piece of that arbitration this file's own _build_settings2 also needs
    # (which row gets a switch widget instead of a value label). See
    # lock_settings_nav.py's _PAGE2_* tuples for the rest.
    _SET2_SWITCH_ROW = 2          # Flip -- the only switch on this page

    def _build_settings2(self, W, H):
        group = displayio.Group()
        self.settings2_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        # "2/2" in the title is the whole discoverability mechanism for
        # this page (frozen spec: page 1's six cards already run to y=314,
        # so there is no room for a footer hint, and a second settings page
        # nobody knows exists is worse than no second page). The "1/2"
        # half of this pairing is a one-line change in lock_ui_settings.py,
        # which this file does not own -- reported separately, not applied
        # here.
        ttl = build_screen_title(W, "SETTINGS 2/2")
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))

        n = len(self._SET2_NAMES)
        self._set2_row_cards = []
        self._set2_value_labels = [None] * n
        self._set2_switch_track = None
        self._set2_switch_knob = None
        # None until the first update_settings2() call -- see _apply_
        # switch2 for why that three-state distinction (None vs True vs
        # False) matters, mirrors SettingsMixin._apply_switch exactly.
        self._set2_switch_state = None
        # Row 7's (Accent) swatch strip is rebuilt from scratch on every
        # apply (see build_accent_swatches' own docstring) -- this Group is
        # just where the current set of dot/ring shapes lives, same
        # "redrawable sub-group appended once, contents replaced on
        # change" idiom as SettingsMixin's _set_hold_fill_group.
        self._set2_accent_group = displayio.Group()
        self._set2_accent_last_key = None
        self._set2_pressed_row = None

        # No hold-to-confirm sweep on this page (see this file's header) --
        # so unlike SettingsMixin's two-pass card/hold-group/text build,
        # nothing needs to paint BETWEEN a row's card and its own text, and
        # a single pass (card, then that row's text/control) is enough.
        for i in range(n):
            band_top = SET_ROWS_TOP + i * SET_ROW_PITCH
            card = build_settings_card(band_top)
            group.append(card)
            self._surface_widgets.append((card, 'fill'))
            self._set2_row_cards.append(card)

            nlbl, dlbl = build_settings_row_text(
                band_top, self._SET2_NAMES[i], self._SET2_LIST_DESCS[i])
            group.append(nlbl)
            self._fg_widgets.append((nlbl, 'color'))
            group.append(dlbl)
            self._dim_widgets.append((dlbl, 'color'))

            if i == self._SET2_SWITCH_ROW:
                track = build_switch_track(band_top + 12)
                group.append(track)
                knob = build_switch_knob(band_top + 23)
                group.append(knob)
                # Deliberately in NO theme registry -- same reasoning as
                # page 1's identical switches (see build_switch_track's own
                # docstring): color is STATE (on/off), not one of the four
                # roles set_theme walks.
                self._set2_switch_track = track
                self._set2_switch_knob = knob
            elif i == 1:
                # Accent: the swatch group instead of a value label -- its
                # actual dot/ring shapes are built by update_settings2 (they
                # need the live theme mode + accent_idx, neither known yet
                # at construction time).
                group.append(self._set2_accent_group)
            else:
                vlbl = build_settings_value_label(band_top)
                group.append(vlbl)
                self._accent_widgets.append((vlbl, 'color'))
                self._set2_value_labels[i] = vlbl

        # View-position dots (lead-owned plumbing, ThemeMixin/lock_ui_kit.py)
        # -- the last row's card now ends at y=302 (SET_ROW_PITCH=44,
        # SET_CARD_H=40), freeing this footer band for them. Page 1's
        # _build_settings needs the identical one-line call; see this
        # feature's report for that exact call site (lock_ui_settings.py is
        # not a file this page owns).
        self._add_view_dots(group, W)

    def update_settings2(self, s):
        self._set2_value_labels[0].text = fmt_setting(6, s)   # Theme
        self._apply_accent_swatches(s)
        self._apply_switch2(s.screen_flipped)
        self._set2_value_labels[3].text = fmt_setting(9, s)    # Window
        self._set2_value_labels[4].text = fmt_setting(10, s)   # Lock pos
        self._set2_value_labels[5].text = fmt_setting(11, s)   # Open pos

    def _apply_accent_swatches(self, s):
        """Rebuild-on-change for row 7's swatch strip -- same
        rebuild-only-if-the-key-moved idiom as SettingsMixin.
        step_settings_hold's _set_hold_last_key, since this can be called
        every time update_settings2 runs (a theme push, entering the page,
        a fully unrelated row's Changed) and not just when Accent itself
        was the row that changed."""
        key = (s.theme_mode, s.accent_idx)
        if key == self._set2_accent_last_key:
            return
        self._set2_accent_last_key = key
        accent_set = ACCENT_COLORS_LIGHT if s.theme_mode == 1 else ACCENT_COLORS_DARK
        ring_color = self._fg_color
        group = self._set2_accent_group
        while len(group):
            group.pop()
        for shape in build_accent_swatches(
                SET_ROWS_TOP + 1 * SET_ROW_PITCH, accent_set, s.accent_idx, ring_color):
            group.append(shape)

    def _apply_switch2(self, is_on):
        """Flip's switch colors + knob position -- single apply path, same
        contract as SettingsMixin._apply_switch (see its docstring for the
        press-highlight-can-swallow-an-OFF-track story this mirrors)."""
        track = self._set2_switch_track
        knob = self._set2_switch_knob
        target_track = self._accent_color if is_on else C_SURFACE_HILITE
        target_outline = self._accent_color if is_on else self._dim_color
        target_cx = switch_knob_cx(is_on)
        was_on = self._set2_switch_state
        if was_on is None or was_on == is_on:
            track.fill = target_track
            track.outline = target_outline
            knob.x0 = target_cx
        else:
            self._start_color_transition(track, 'fill', target_track)
            self._start_color_transition(track, 'outline', target_outline)
            self._start_pos_tween(knob, 'x0', target_cx)
        knob.fill = self._fg_color if is_on else C_GREY
        self._set2_switch_state = is_on

    def settings2_row_count(self):
        return len(self._SET2_NAMES)

    def settings2_row_at(self, y):
        return row_at(y, SET_ROWS_TOP, SET_ROW_PITCH, len(self._SET2_NAMES))

    def press_settings2_row(self, row):
        """Instant highlight-on-press, eased release -- see
        SettingsMixin.press_settings_row's docstring, which this mirrors
        exactly but against this page's own card list."""
        prev = self._set2_pressed_row
        if prev is not None and prev != row:
            self._start_color_transition(self._set2_row_cards[prev], 'fill',
                                         self._live_surface_color())
        self._set2_pressed_row = row
        if row is not None:
            self._set2_row_cards[row].fill = C_SURFACE_HILITE

    # =================== per-setting detail page (rows 9-11 only) ===================
    # Populates the SAME shared widgets SettingsMixin._build_setting_detail
    # built (self.sd_name/self.sd_value/self.sd_desc/self.sd_min_lbl/
    # self.sd_max_lbl/the progress track/the stepper) -- see this file's
    # header for why that screen is shared rather than duplicated, and
    # _refresh_detail_track/press_setting_stepper below are SettingsMixin
    # methods being CALLED, not redefined (both are already fully generic
    # over idx, reading setting_fraction(idx, s) rather than any page-1-
    # specific table).
    def show_setting_detail2(self, idx, s):
        self.sd_name.text = self._SET2_NAMES[idx - 6]
        self.sd_value.text = fmt_setting(idx, s)
        self.sd_desc.text = self._SET2_LIST_DESCS[idx - 6]
        lo, hi = setting_bounds_text(idx)
        self.sd_min_lbl.text = lo
        self.sd_max_lbl.text = hi
        self._sd_track_last_key = None
        self._refresh_detail_track(idx, s)
        self.press_setting_stepper(None)
        self._set_root(self.setting_detail_group)

    def update_setting_detail2(self, idx, s):
        self.sd_value.text = fmt_setting(idx, s)
        self._refresh_detail_track(idx, s)
