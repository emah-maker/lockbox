# lock_ui_settings.py -- the on-box settings list and its per-setting detail page.
#
# One of the view mixins LockUI is composed from; see lock_ui.py's header for
# why the class is split this way and what that does and does not change.
# Every method here runs as a method OF LockUI -- `self` is the whole UI, and
# the attributes below are the ones lock_ui.py's __init__ creates.

import displayio
import terminalio
from adafruit_display_text import label
from adafruit_display_shapes.roundrect import RoundRect
from lock_config import C_BG, C_WHITE, C_GREY, C_GREEN, C_RED, C_AMBER, RADIUS_BTN_SM
from lock_ui_common import _bg_tile


def _fmt_sleep(sleep_s):
    """The Sleep row's value text. 0 is SLEEP_OPTIONS's "never sleep" choice,
    not a zero-second timeout (see lock_config.SLEEP_OPTIONS and code.py's
    sleep predicate), so it has to read as OFF rather than "0s" -- which
    would describe the opposite behaviour to the one the box is in.

    A module function, not a method: both the six-row list and the detail
    page render this same value, and the two sites drifting apart is exactly
    how one screen ends up claiming the feature is on while the other says
    it is off. Matches the ON/OFF wording the boolean rows beside it already
    use, so Off does not read as a new kind of value."""
    return "OFF" if sleep_s <= 0 else "{}s".format(sleep_s)


class SettingsMixin:
    # =================== settings view ===================
    def _build_settings(self, W, H):
        group = displayio.Group()
        self.settings_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = label.Label(terminalio.FONT, text="SETTINGS", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))

        self.set_rows_y = (70, 110, 150, 190, 230, 270)
        names = ("Override", "Auto-open", "Sleep", "Bright", "R Unlock", "C Unlock")
        self.set_vals = []
        for i, name in enumerate(names):
            y = self.set_rows_y[i]
            nlbl = label.Label(terminalio.FONT, text=name, color=C_WHITE, scale=2)
            nlbl.anchor_point = (0.0, 0.5)
            nlbl.anchored_position = (14, y)
            group.append(nlbl)
            self._fg_widgets.append((nlbl, 'color'))
            vlbl = label.Label(terminalio.FONT, text="", color=C_AMBER, scale=2)
            vlbl.anchor_point = (1.0, 0.5)
            vlbl.anchored_position = (W - 14, y)
            group.append(vlbl)
            self._accent_widgets.append((vlbl, 'color'))
            self.set_vals.append(vlbl)

        h1 = label.Label(terminalio.FONT, text="tap a row to change", color=C_GREY)
        h1.anchor_point = (0.5, 0.5)
        h1.anchored_position = (W // 2, 300)
        group.append(h1)
        self._dim_widgets.append((h1, 'color'))

    def update_settings(self, s):
        self.set_vals[0].text = str(s.override_presses)
        self.set_vals[1].text = "ON" if s.auto_open else "OFF"
        self.set_vals[2].text = _fmt_sleep(s.sleep_s)
        self.set_vals[3].text = "{}%".format(s.bright_pct)
        self.set_vals[4].text = "ON" if s.allow_remote_unlock else "OFF"
        self.set_vals[5].text = "ON" if s.unlock_on_call else "OFF"
        self.ov_count_hint.text = "x{}".format(s.override_presses)

    def settings_row_at(self, y):
        # Tolerance must stay under half the row pitch (40px, was 43px for 5
        # rows) or adjacent rows' hit zones overlap and a tap resolves to
        # whichever row is earlier in set_rows_y.
        for i, ry in enumerate(self.set_rows_y):
            if abs(y - ry) <= 19:
                return i
        return -1

    # ----- per-setting detail page ([-]/[+] buttons or swipe up/down) -----
    _SET_NAMES = ("Override", "Auto-open", "Sleep", "Bright", "R Unlock", "C Unlock")
    # Plain-language explanation of what each row's number/state means in real
    # terms -- a bare "25" or "30s" isn't self-explanatory, especially for
    # Override, which used to just show a count with no context for what it
    # counts toward. Shown only on the detail page (not the 6-row list, which
    # has no vertical room to spare -- see settings_row_at's comment on the
    # tight 40px row pitch).
    _SET_DESCRIPTIONS = (
        "presses to force-unlock",
        "auto-open when timer ends",
        "screen sleep timeout",
        "screen brightness (%)",
        "app can unlock box early",
        "unlock box on incoming call",
    )

    def _fmt_setting(self, idx, s):
        if idx == 0:
            return str(s.override_presses)
        if idx == 1:
            return "ON" if s.auto_open else "OFF"
        if idx == 2:
            return _fmt_sleep(s.sleep_s)
        if idx == 3:
            return "{}%".format(s.bright_pct)
        if idx == 4:
            return "ON" if s.allow_remote_unlock else "OFF"
        return "ON" if s.unlock_on_call else "OFF"

    def _build_setting_detail(self, W, H):
        group = displayio.Group()
        self.setting_detail_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)
        self.sd_name = label.Label(terminalio.FONT, text="", color=C_GREY, scale=2)
        self.sd_name.anchor_point = (0.5, 0.5)
        self.sd_name.anchored_position = (W // 2, 60)
        group.append(self.sd_name)
        self._dim_widgets.append((self.sd_name, 'color'))
        self.sd_value = label.Label(terminalio.FONT, text="", color=C_AMBER,
                                    scale=4)
        self.sd_value.anchor_point = (0.5, 0.5)
        self.sd_value.anchored_position = (W // 2, 130)
        group.append(self.sd_value)
        self._accent_widgets.append((self.sd_value, 'color'))

        # Plain-language meaning of the number/state above (see
        # _SET_DESCRIPTIONS) -- sits in the gap between the big value and the
        # [-]/[+] buttons so "25" reads as "25 presses to force-unlock".
        self.sd_desc = label.Label(terminalio.FONT, text="", color=C_GREY)
        self.sd_desc.anchor_point = (0.5, 0.5)
        self.sd_desc.anchored_position = (W // 2, 164)
        group.append(self.sd_desc)
        self._dim_widgets.append((self.sd_desc, 'color'))

        # on-screen [-] and [+] buttons -- the red/green fill pair is a fixed
        # decrease/increase convention (like the lock-status colors), not
        # accent: recoloring just the "+" side risks landing on an accent hue
        # close to the "-" side's red and making the two buttons look alike.
        # Holding either (or holding a swipe) auto-repeats -- see
        # LockController._update_hold / HOLD_REPEAT_* in lock_config.py.
        self.sd_btn_w = 56
        self.sd_btn_h = 56
        self.sd_btn_y = 196
        self.sd_minus_x = 18
        self.sd_plus_x = W - 18 - self.sd_btn_w
        _sd_minus = RoundRect(self.sd_minus_x, self.sd_btn_y, self.sd_btn_w,
                              self.sd_btn_h, RADIUS_BTN_SM, fill=C_RED,
                              outline=C_WHITE, stroke=2)
        group.append(_sd_minus)
        self._fg_widgets.append((_sd_minus, 'outline'))
        ml = label.Label(terminalio.FONT, text="-", color=C_WHITE, scale=3)
        ml.anchor_point = (0.5, 0.5)
        ml.anchored_position = (self.sd_minus_x + self.sd_btn_w // 2,
                                self.sd_btn_y + self.sd_btn_h // 2)
        group.append(ml)
        self._fg_widgets.append((ml, 'color'))
        _sd_plus = RoundRect(self.sd_plus_x, self.sd_btn_y, self.sd_btn_w,
                             self.sd_btn_h, RADIUS_BTN_SM, fill=C_GREEN,
                             outline=C_WHITE, stroke=2)
        group.append(_sd_plus)
        self._fg_widgets.append((_sd_plus, 'outline'))
        pl = label.Label(terminalio.FONT, text="+", color=C_WHITE, scale=3)
        pl.anchor_point = (0.5, 0.5)
        pl.anchored_position = (self.sd_plus_x + self.sd_btn_w // 2,
                                self.sd_btn_y + self.sd_btn_h // 2)
        group.append(pl)
        self._fg_widgets.append((pl, 'color'))

        h2 = label.Label(terminalio.FONT, text="swipe left = back", color=C_GREY)
        h2.anchor_point = (0.5, 0.5)
        h2.anchored_position = (W // 2, 300)
        group.append(h2)
        self._dim_widgets.append((h2, 'color'))

    def show_setting_detail(self, idx, s):
        self.sd_name.text = self._SET_NAMES[idx]
        self.sd_value.text = self._fmt_setting(idx, s)
        self.sd_desc.text = self._SET_DESCRIPTIONS[idx]
        self.display.root_group = self.setting_detail_group

    def update_setting_detail(self, idx, s):
        self.sd_value.text = self._fmt_setting(idx, s)

    def in_setting_minus(self, x, y):
        return (self.sd_minus_x <= x <= self.sd_minus_x + self.sd_btn_w and
                self.sd_btn_y <= y <= self.sd_btn_y + self.sd_btn_h)

    def in_setting_plus(self, x, y):
        return (self.sd_plus_x <= x <= self.sd_plus_x + self.sd_btn_w and
                self.sd_btn_y <= y <= self.sd_btn_y + self.sd_btn_h)
