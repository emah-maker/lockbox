# lock_ui_theme.py -- screen orientation, palette, and the two corner indicators.
#
# One of the view mixins LockUI is composed from; see lock_ui.py's header for
# why the class is split this way and what that does and does not change.
# Every method here runs as a method OF LockUI -- `self` is the whole UI, and
# the attributes below are the ones lock_ui.py's __init__ creates.

import time
import terminalio
from adafruit_display_text import label
from adafruit_display_shapes.circle import Circle
from lock_config import C_GREY
from lock_config import C_GREEN
from lock_config import C_ON_ACCENT_DARK
from lock_config import C_ON_ACCENT_LIGHT
from lock_config import MODE_COLORS
from lock_config import ACCENT_COLORS_DARK
from lock_config import ACCENT_COLORS_LIGHT
from lock_config import clamp
from lock_config import STATUS_TRANSITION_S
from lock_config import lerp_color


class ThemeMixin:
    # =================== orientation ===================
    def set_screen_flipped(self, flipped):
        """Rotate the panel 180° from its native orientation so the box can
        be mounted upside-down and still read right-side-up. Width/height are
        unaffected (180° never swaps them, unlike 90/270), so no widget needs
        rebuilding -- only the touch coordinates need a matching correction,
        done separately in LockController._map (see is_flipped below -- read
        the live rotation here rather than trust a second, separately-tracked
        flag that could drift out of sync with it)."""
        try:
            self.display.rotation = (self._base_rotation + 180) % 360 if flipped else self._base_rotation
        except AttributeError:
            pass

    @property
    def is_flipped(self):
        """Whether the panel is CURRENTLY rotated 180° from its native
        orientation -- the single source of truth _map uses for its touch
        correction, read live off the display instead of a second copy of
        the flag (manager report: touch stayed un-flipped while the screen
        visibly was, i.e. something let LockController.settings.
        screen_flipped and the display's actual rotation disagree; reading
        the display's own rotation directly makes that class of drift
        impossible, whatever was causing it)."""
        try:
            return self.display.rotation != self._base_rotation
        except AttributeError:
            return False

    # =================== theme ===================
    def set_theme(self, mode_idx, accent_idx):
        mode_idx = 0 if mode_idx not in (0, 1) else mode_idx
        # Per-mode accent tuple (see lock_config.py's contrast-audit comment)
        # -- light mode's swatches are a separately darkened/more-saturated
        # variant of the same hue, tuned for text contrast against the light
        # bg/surface; dark mode is unchanged from before. Both tuples are the
        # same length by construction, so bounds-checking against either is
        # equivalent.
        accent_set = ACCENT_COLORS_LIGHT if mode_idx == 1 else ACCENT_COLORS_DARK
        accent_idx = clamp(accent_idx, 0, len(accent_set) - 1)
        self._mode_idx = mode_idx
        self._accent_idx = accent_idx
        bg, surface, fg, dim = MODE_COLORS[mode_idx]
        accent = accent_set[accent_idx]
        on_accent = C_ON_ACCENT_LIGHT if mode_idx == 1 else C_ON_ACCENT_DARK
        self._fg_color = fg
        self._dim_color = dim
        self._accent_color = accent

        for tile in self._bg_tiles:
            tile.pixel_shader[0] = bg
        for obj, attr in self._surface_widgets:
            setattr(obj, attr, surface)
        for obj, attr in self._fg_widgets:
            setattr(obj, attr, fg)
        for obj, attr in self._dim_widgets:
            setattr(obj, attr, dim)
        for obj, attr in self._accent_widgets:
            setattr(obj, attr, accent)

        # indexed-palette widgets (bitmaps), not plain .fill/.color attrs
        self.hand_pal[1] = fg
        self.hand_pal[2] = accent
        self.gtip_pal[0] = fg
        self.button.fill = accent
        # Button label color used to be a fixed build-time constant (near-
        # black) -- fine while every accent fill was dark-mode's light/pastel
        # set, but light mode's fills are now deliberately darker/more
        # saturated (see the contrast audit above), so this must follow mode
        # like every other themed attribute.
        self.btn_label.color = on_accent

        # The clock-ring gauge and override-ring dots repaint their fill
        # color only when their filled-count changes (see _set_gauge/
        # _set_ovr_ring's `if k != self._gauge_k` guards) -- cheap for the
        # common per-frame case, but that means a theme/accent change alone
        # (same k, new accent) would leave already-lit dots showing the old
        # color until the count next crosses a segment boundary. Invalidating
        # the cached k here forces the next call to actually repaint,
        # matching how _gauge_k/_ovr_ring_k are already seeded to -1 (an
        # impossible k) to force a first paint.
        self._gauge_k = -1
        self._ovr_ring_k = -1

    # =================== color-transition engine ===================
    # Duration/curve come from the motion-and-animation skill's tables, never
    # an invented value: STATUS_TRANSITION_S (lock_config.py) = 200ms sits in
    # the "Dropdowns, cards, sheet reveals | 150-250ms" band -- the status
    # bar and clock-view readouts are card-like state surfaces changing on an
    # occasional (session-level) event, not a rapidly-retriggered control --
    # eased with the "Entering/exiting" ease-out-cubic curve. Called from
    # LockController.update() every frame, same tier as step_motion's
    # button-move spring / animate_call_alert, so it never runs ahead of a
    # touch read.
    #
    # Uses lock_config.lerp_color for the actual channel math (its docstring
    # points at a continuous digital-clock "breathing" highlight as the
    # motivating use case; that specific effect is deliberately NOT built --
    # see the implementation evidence doc for why a perpetual ambient pulse
    # on a screen the user stares at for the whole countdown fails the
    # motion-and-animation skill's frequency/restraint gate, unlike the
    # occasional, purposeful state transitions below).
    def _start_color_transition(self, obj, attr, to_color):
        frm = getattr(obj, attr)
        if frm == to_color:
            return
        # Drop any in-flight transition already targeting this same attr so a
        # fast retrigger (e.g. idle -> closed -> running in quick succession)
        # restarts cleanly from the current on-screen color instead of
        # stacking two competing lerps on one widget.
        self._color_transitions = [t for t in self._color_transitions
                                    if not (t[0] is obj and t[1] == attr)]
        self._color_transitions.append([obj, attr, frm, to_color, time.monotonic()])

    def step_color_transitions(self):
        if not self._color_transitions:
            return
        now = time.monotonic()
        still_running = []
        for obj, attr, frm, to, start in self._color_transitions:
            t = (now - start) / STATUS_TRANSITION_S
            if t >= 1.0:
                setattr(obj, attr, to)
            else:
                it = 1.0 - t
                eased = 1.0 - it * it * it       # ease-out cubic
                setattr(obj, attr, lerp_color(frm, to, eased))
                still_running.append([obj, attr, frm, to, start])
        self._color_transitions = still_running

    # ----- corner status glyphs: BLE dot (left) + battery text (right) -----
    def _add_corner_indicators(self, group, W, y):
        dot = Circle(14, y, 4, fill=C_GREY)
        group.append(dot)
        self._corner_ble_dots.append(dot)
        lbl = label.Label(terminalio.FONT, text="--", color=C_GREY)
        lbl.anchor_point = (1.0, 0.5)
        lbl.anchored_position = (W - 10, y)
        group.append(lbl)
        self._dim_widgets.append((lbl, 'color'))
        self._corner_bat_labels.append(lbl)

    def update_corner_battery(self, r):
        if not r.available:
            txt = "--"
        elif r.charging:
            txt = "CHG"
        else:
            txt = "{}%".format(clamp(r.percent, 0, 100))
        for lbl in self._corner_bat_labels:
            lbl.text = txt

    def update_corner_ble(self, connected):
        color = C_GREEN if connected else C_GREY
        for dot in self._corner_ble_dots:
            dot.fill = color
