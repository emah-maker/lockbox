# lock_ui_clock.py -- the four interchangeable clock faces and the view switch between them.
#
# One of the view mixins LockUI is composed from; see lock_ui.py's header for
# why the class is split this way and what that does and does not change.
# Every method here runs as a method OF LockUI -- `self` is the whole UI, and
# the attributes below are the ones lock_ui.py's __init__ creates.

import math
import displayio
import terminalio
import bitmaptools
from adafruit_display_text import label
from adafruit_display_shapes.roundrect import RoundRect
from adafruit_display_shapes.rect import Rect
from adafruit_display_shapes.circle import Circle
from adafruit_display_shapes.triangle import Triangle
from lock_config import C_BG
from lock_config import C_SURFACE
from lock_config import C_SURFACE_HILITE
from lock_config import C_WHITE
from lock_config import C_GREY
from lock_config import C_GREEN
from lock_config import C_RED
from lock_config import C_AMBER
from lock_config import fmt_hms
from lock_config import RADIUS_CARD
from lock_ui_common import _bg_tile


class ClockMixin:
    # =================== clock view (multiple styles) ===================
    # Swipe up/down on the clock screen cycles these appearances.
    def _clock_hints(self, group, W):
        h1 = label.Label(terminalio.FONT, text="swipe right = timer", color=C_GREY)
        h1.anchor_point = (0.5, 0.5)
        h1.anchored_position = (W // 2, 298)
        group.append(h1)
        self._dim_widgets.append((h1, 'color'))
        h2 = label.Label(terminalio.FONT, text="up/down = style", color=C_GREY)
        h2.anchor_point = (0.5, 0.5)
        h2.anchored_position = (W // 2, 314)
        group.append(h2)
        self._dim_widgets.append((h2, 'color'))

    # ----- style 1: analog clock (dark face, mint hands) -----
    def _build_clock_analog(self, W, H):
        group = displayio.Group()
        self.clock_groups.append(group)
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = label.Label(terminalio.FONT, text="ANALOG", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))
        self._add_corner_indicators(group, W, y=26)

        self.ring_cx = W // 2
        self.ring_cy = 148
        self.ring_r = 74
        _ring_bg = Circle(self.ring_cx, self.ring_cy, self.ring_r,
                          fill=C_SURFACE, outline=C_WHITE, stroke=3)
        group.append(_ring_bg)
        self._surface_widgets.append((_ring_bg, 'fill'))
        self._fg_widgets.append((_ring_bg, 'outline'))

        # hour tick marks (bigger dots at 12 / 3 / 6 / 9)
        for i in range(12):
            theta = 2 * math.pi * i / 12
            tr = self.ring_r - 9
            tx = self.ring_cx + int(tr * math.sin(theta))
            ty = self.ring_cy - int(tr * math.cos(theta))
            rad = 3 if i % 3 == 0 else 1
            _tick = Circle(tx, ty, rad, fill=C_WHITE)
            group.append(_tick)
            self._fg_widgets.append((_tick, 'fill'))

        # hands drawn into a persistent bitmap (no per-frame allocation)
        d = 2 * self.ring_r + 1
        self.hand_cx = self.ring_r
        self.hand_cy = self.ring_r
        self.hand_bmp = displayio.Bitmap(d, d, 3)
        self.hand_pal = displayio.Palette(3)
        self.hand_pal[0] = 0x000000
        self.hand_pal.make_transparent(0)
        self.hand_pal[1] = C_WHITE          # hour/minute hands -- re-themed in set_theme
        self.hand_pal[2] = C_GREEN          # second hand -- follows accent, see set_theme
        group.append(displayio.TileGrid(
            self.hand_bmp, pixel_shader=self.hand_pal,
            x=self.ring_cx - self.ring_r, y=self.ring_cy - self.ring_r))
        _ctr_dot = Circle(self.ring_cx, self.ring_cy, 4, fill=C_WHITE)
        group.append(_ctr_dot)
        self._fg_widgets.append((_ctr_dot, 'fill'))

        self.an_time = label.Label(terminalio.FONT, text="0:00:00",
                                   color=C_WHITE, scale=2)
        self.an_time.anchor_point = (0.5, 0.5)
        self.an_time.anchored_position = (self.ring_cx, 248)
        group.append(self.an_time)

        self.an_state = label.Label(terminalio.FONT, text="", color=C_GREY)
        self.an_state.anchor_point = (0.5, 0.5)
        self.an_state.anchored_position = (W // 2, 274)
        group.append(self.an_state)
        self._dim_widgets.append((self.an_state, 'color'))

        self._clock_hints(group, W)
        self._set_hands(0)

    # ----- style 2: digital clock (dark card, big LCD readout) -----
    def _build_clock_digital(self, W, H):
        group = displayio.Group()
        self.clock_groups.append(group)
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = label.Label(terminalio.FONT, text="DIGITAL", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))
        self._add_corner_indicators(group, W, y=26)

        fh = 70
        _dig_bg = RoundRect(12, 150 - fh // 2, W - 24, fh, RADIUS_CARD,
                            fill=C_SURFACE, outline=C_GREY, stroke=2)
        group.append(_dig_bg)
        self._surface_widgets.append((_dig_bg, 'fill'))
        self._dim_widgets.append((_dig_bg, 'outline'))

        # A static "catching light" top edge -- the one surface card in this
        # UI that reads flat otherwise (the analog clock face already has a
        # bright full-perimeter outline). Fixed, not theme-tracked, same as
        # the call-alert overlay/status colors: a material cue, not a themed
        # surface color, and built once here rather than per-frame.
        _dig_hilite = Rect(14, 150 - fh // 2 + 2, W - 28, 2, fill=C_SURFACE_HILITE)
        group.append(_dig_hilite)

        self.dig_time = label.Label(terminalio.FONT, text="0:00:00",
                                    color=C_WHITE, scale=3)
        self.dig_time.anchor_point = (0.5, 0.5)
        self.dig_time.anchored_position = (W // 2, 150)
        group.append(self.dig_time)

        self.dig_state = label.Label(terminalio.FONT, text="", color=C_GREY,
                                     scale=2)
        self.dig_state.anchor_point = (0.5, 0.5)
        self.dig_state.anchored_position = (W // 2, 224)
        group.append(self.dig_state)
        self._dim_widgets.append((self.dig_state, 'color'))

        self._clock_hints(group, W)

    # ----- style 3: arch gauge (dark, thick two-colour progress ring) -----
    def _build_clock_ring(self, W, H):
        group = displayio.Group()
        self.clock_groups.append(group)
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = label.Label(terminalio.FONT, text="GAUGE", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))
        self._add_corner_indicators(group, W, y=26)

        # A 270-degree arch (open at the bottom) built from overlapping dots so
        # the band is thick and each segment can be recoloured cheaply to show
        # elapsed (accent) vs remaining (grey). Used to be a fixed amber/green
        # pairing, deliberately left out of theming as "a local progress
        # indicator, not the app-lock/closed/unlocked status language" -- the
        # manager has since asked for the opposite (match the theme colors),
        # so this now follows the same accent-if-progressed/grey-if-not
        # convention the override ring already uses (_set_ovr_ring below),
        # rather than inventing a different theming rule for this one gauge.
        self.gauge_cx = W // 2
        self.gauge_cy = 158
        self.gauge_r = 72
        self.gauge_n = 60
        self.gauge_start = -math.radians(135)    # start at the bottom-left
        self.gauge_span = math.radians(270)      # sweep up and over to bottom-right
        self.gauge_dots = []
        for i in range(self.gauge_n):
            theta = self.gauge_start + self.gauge_span * i / (self.gauge_n - 1)
            x = self.gauge_cx + int(self.gauge_r * math.sin(theta))
            y = self.gauge_cy - int(self.gauge_r * math.cos(theta))
            dot = Circle(x, y, 7, fill=C_GREY)
            self.gauge_dots.append(dot)
            group.append(dot)
        self._gauge_k = -1

        # leading tip that glides to the exact elapsed angle (smooth motion)
        self.gtip_size = 12
        gtip_bmp = displayio.Bitmap(self.gtip_size, self.gtip_size, 1)
        self.gtip_pal = displayio.Palette(1)
        self.gtip_pal[0] = C_WHITE
        self.gauge_tip = displayio.TileGrid(gtip_bmp, pixel_shader=self.gtip_pal)
        group.append(self.gauge_tip)

        self.rg_time = label.Label(terminalio.FONT, text="0:00:00",
                                   color=C_WHITE, scale=2)
        self.rg_time.anchor_point = (0.5, 0.5)
        self.rg_time.anchored_position = (self.gauge_cx, self.gauge_cy)
        group.append(self.rg_time)

        self.rg_state = label.Label(terminalio.FONT, text="", color=C_GREY)
        self.rg_state.anchor_point = (0.5, 0.5)
        self.rg_state.anchored_position = (W // 2, 250)
        group.append(self.rg_state)
        self._dim_widgets.append((self.rg_state, 'color'))

        self._clock_hints(group, W)
        self._set_gauge(0.0)

    def _set_gauge(self, frac_elapsed):
        frac = max(0.0, min(1.0, frac_elapsed))
        # recolour the two-tone band only when a whole segment flips (cheap)
        k = int(round(frac * self.gauge_n))
        if k != self._gauge_k:
            self._gauge_k = k
            for i, dot in enumerate(self.gauge_dots):
                dot.fill = self._accent_color if i < k else C_GREY
        # glide the tip marker to the exact angle every frame (smooth)
        theta = self.gauge_start + self.gauge_span * frac
        x = self.gauge_cx + int(self.gauge_r * math.sin(theta))
        y = self.gauge_cy - int(self.gauge_r * math.cos(theta))
        self.gauge_tip.x = x - self.gtip_size // 2
        self.gauge_tip.y = y - self.gtip_size // 2

    def _draw_hand(self, theta, length, ci, width):
        # draw a hand into the persistent bitmap as `width` parallel lines
        cx, cy = self.hand_cx, self.hand_cy
        x1 = cx + int(length * math.sin(theta))
        y1 = cy - int(length * math.cos(theta))
        px = math.cos(theta)            # perpendicular direction
        py = math.sin(theta)
        half = (width - 1) / 2.0
        i = -half
        while i <= half + 0.001:
            ox = int(round(px * i))
            oy = int(round(py * i))
            bitmaptools.draw_line(self.hand_bmp, cx + ox, cy + oy,
                                  x1 + ox, y1 + oy, ci)
            i += 1

    def _set_hands(self, remaining):
        self.hand_bmp.fill(0)                 # clear to transparent
        secs = max(0.0, float(remaining))
        h = int(secs // 3600) % 12
        m = int((secs % 3600) // 60)
        s = secs % 60.0                       # fractional -> smooth sweep
        min_f = m + s / 60.0
        hour_a = 2 * math.pi * ((h + min_f / 60.0) / 12.0)
        min_a = 2 * math.pi * (min_f / 60.0)
        sec_a = 2 * math.pi * (s / 60.0)
        self._draw_hand(hour_a, self.ring_r - 26, 1, 4)   # hour hand (white)
        self._draw_hand(min_a, self.ring_r - 10, 1, 4)    # minute hand (white)
        self._draw_hand(sec_a, self.ring_r - 4, 2, 2)     # second hand (accent)

    # ----- style 4: elapsed time (same card layout as digital, but counts up
    # from lock start instead of down to zero) -----
    def _build_clock_elapsed(self, W, H):
        # Deliberately NOT styled like _build_clock_digital (same card
        # shape, same grey outline, same layout, only the title text
        # differed) -- easy to misread at a glance, and this is the one
        # style that counts UP instead of down, which matters (mistaking
        # "elapsed" for "remaining" is a real, meaningful misread on a lock
        # timer). Fixed amber outline/title/arrow, not theme-tracked, same
        # "material cue, not a themed surface color" precedent as the
        # digital view's hilite and the call-alert overlay -- this should
        # look the same regardless of theme so it's always recognizable at
        # a glance, not just readable once you find the title text.
        group = displayio.Group()
        self.clock_groups.append(group)
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = label.Label(terminalio.FONT, text="ELAPSED", color=C_AMBER, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)
        self._add_corner_indicators(group, W, y=26)

        fh = 70
        _el_bg = RoundRect(12, 150 - fh // 2, W - 24, fh, RADIUS_CARD,
                           fill=C_SURFACE, outline=C_AMBER, stroke=3)
        group.append(_el_bg)
        self._surface_widgets.append((_el_bg, 'fill'))

        # Up-pointing arrow above the time -- an unambiguous "this counts UP"
        # cue that doesn't rely on noticing the outline color or reading the
        # title, same idea as the override ring's dots-fill direction.
        arrow_cx = W // 2
        arrow_top_y = 150 - fh // 2 - 14
        _el_arrow = Triangle(arrow_cx, arrow_top_y, arrow_cx - 7, arrow_top_y + 10,
                             arrow_cx + 7, arrow_top_y + 10, fill=C_AMBER)
        group.append(_el_arrow)

        self.el_time = label.Label(terminalio.FONT, text="0:00:00",
                                   color=C_WHITE, scale=3)
        self.el_time.anchor_point = (0.5, 0.5)
        self.el_time.anchored_position = (W // 2, 150)
        group.append(self.el_time)

        self.el_state = label.Label(terminalio.FONT, text="", color=C_AMBER,
                                    scale=2)
        self.el_state.anchor_point = (0.5, 0.5)
        self.el_state.anchored_position = (W // 2, 224)
        group.append(self.el_state)

        self._clock_hints(group, W)

    # ----- view switching -----
    def show_view(self, view):
        """Tracks which view is active either way, but while the call-alert
        overlay owns the display (self._call_alert_active, see
        show_call_alert/hide_call_alert) does NOT touch the live root_group --
        every caller (LockController.set_view, hide_override, hide_tag_picker,
        etc.) would otherwise unconditionally stomp the overlay out from under
        it (e.g. a countdown finishing, or an override timing out, mid-flash
        on an incoming call), silently defeating the "insistent by design"
        alert before its own timeout. hide_call_alert()'s show_view(self.view)
        restore then applies whatever the latest intended view turned out to
        be while it was masked."""
        self.view = view
        if self._call_alert_active:
            return
        if view == "clock":
            self.display.root_group = self.clock_groups[self.clock_style_idx]
        elif view == "battery":
            self.display.root_group = self.battery_group
        elif view == "settings":
            self.display.root_group = self.settings_group
        else:
            self.display.root_group = self.control_group

    def cycle_clock_style(self, direction):
        n = len(self.clock_groups)
        self.clock_style_idx = (self.clock_style_idx + direction) % n
        if self.view == "clock":
            self.display.root_group = self.clock_groups[self.clock_style_idx]

    def update_clock_view(self, remaining, total, state):
        # +0.999 ceiling before fmt_hms's own truncation -- see fmt_hm's
        # docstring in lock_config.py: fmt_hms's callers are documented to
        # apply this so the countdown never displays less time than is
        # actually left (e.g. 0.5s remaining truncating straight to "0:00:00"
        # would visually read as done a fraction of a second early).
        txt = fmt_hms(remaining + 0.999)
        statetext = {"running": "LOCKED",
                     "done": "UNLOCKED",
                     "idle": "not started"}.get(state, "")
        active = C_RED if state == "running" else None
        target = active or self._fg_color
        # The elapsed style's time text follows the accent (like the
        # LOCK/OPEN button and analog second hand) instead of the plain fg
        # color the other three clock styles use below -- otherwise every
        # accent choice looked identical on this one screen.
        elapsed_target = active or self._accent_color
        style = self.clock_styles[self.clock_style_idx]
        # Same state-indication color ease as set_status, applied per style.
        # Gated on the cached target (mirrors the "on != self._call_anim_on"
        # idiom used by the call-alert blink below) so a transition is
        # only started the moment the target actually flips, not re-started
        # every redraw tick while running at CLOCK_FPS.
        if style == "analog":
            self.an_time.text = txt
            self._set_hands(remaining)
            if target != self._an_active_target:
                self._an_active_target = target
                self._start_color_transition(self.an_time, 'color', target)
            self.an_state.text = statetext
        elif style == "digital":
            self.dig_time.text = txt
            if target != self._dig_active_target:
                self._dig_active_target = target
                self._start_color_transition(self.dig_time, 'color', target)
            self.dig_state.text = statetext
        elif style == "ring":  # arch gauge
            self.rg_time.text = txt
            frac = 0.0 if total <= 0 else 1.0 - (remaining / total)
            self._set_gauge(frac)
            if target != self._rg_active_target:
                self._rg_active_target = target
                self._start_color_transition(self.rg_time, 'color', target)
            self.rg_state.text = statetext
        else:  # elapsed -- counts up from lock start instead of down to zero;
            # `remaining`/`total` come from the same _remaining_total pair
            # every other style uses, so total - remaining is already 0 when
            # idle (nothing elapsed yet) and the full duration once done.
            elapsed = max(0.0, total - remaining)
            self.el_time.text = fmt_hms(elapsed)
            if elapsed_target != self._el_active_target:
                self._el_active_target = elapsed_target
                self._start_color_transition(self.el_time, 'color', elapsed_target)
            self.el_state.text = statetext
