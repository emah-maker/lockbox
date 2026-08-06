# lock_ui.py -- builds the displayio scenes and exposes display helpers.
# Two views: "control" (set/start/stop) and "clock" (countdown dial).
import math
import displayio
import terminalio
import bitmaptools
from adafruit_display_text import label
from adafruit_display_shapes.roundrect import RoundRect
from adafruit_display_shapes.rect import Rect
from adafruit_display_shapes.circle import Circle

from lock_config import (
    C_BG, C_SURFACE, C_WHITE, C_BLACK, C_GREY, C_GREEN, C_RED, C_AMBER, fmt_hms,
)


def _bg_tile(w, h, color):
    bmp = displayio.Bitmap(w, h, 1)
    pal = displayio.Palette(1)
    pal[0] = color
    return displayio.TileGrid(bmp, pixel_shader=pal)


class LockUI:
    def __init__(self, display):
        self.display = display
        self.W = W = display.width
        self.H = H = display.height

        self._build_control(W, H)

        # clock view has several swappable appearances (swipe up/down)
        self.clock_styles = ["analog", "digital", "ring"]
        self.clock_style_idx = 0
        self.clock_groups = []
        self._build_clock_analog(W, H)
        self._build_clock_digital(W, H)
        self._build_clock_ring(W, H)
        self._build_battery(W, H)
        self._build_call_alert(W, H)
        self._build_override(W, H)
        self._build_settings(W, H)
        self._build_setting_detail(W, H)

        self.view = "control"
        display.root_group = self.control_group

    # =================== control view ===================
    def _build_control(self, W, H):
        group = displayio.Group()
        self.control_group = group

        group.append(_bg_tile(W, H, C_BG))

        # flashing border for the done animation
        self.border = Rect(0, 0, W, H, fill=None, outline=C_GREEN, stroke=5)
        self.border.hidden = True
        group.append(self.border)

        # status bar (on/off indicator)
        self.STATUS_Y = 8
        self.STATUS_H = 38
        self.status_bar = RoundRect(8, self.STATUS_Y, W - 16, self.STATUS_H, 8,
                                    fill=C_GREEN)
        group.append(self.status_bar)
        self.status_lbl = label.Label(terminalio.FONT, text="UNLOCKED",
                                      color=C_BLACK, scale=2)
        self.status_lbl.anchor_point = (0.5, 0.5)
        self.status_lbl.anchored_position = (W // 2, self.STATUS_Y + self.STATUS_H // 2)
        group.append(self.status_lbl)

        self.title = label.Label(terminalio.FONT, text="LOCK TIMER", color=C_GREY)
        self.title.anchor_point = (0.5, 0.5)
        self.title.anchored_position = (W // 2, 64)
        group.append(self.title)

        self.clock = label.Label(terminalio.FONT, text="0:00:00", color=C_WHITE,
                                 scale=3)
        self.clock.anchor_point = (0.5, 0.5)
        self.clock.anchored_position = (W // 2, 150)
        group.append(self.clock)

        # column guides: swipe over H / M / S to change that unit
        self.guide_h = label.Label(terminalio.FONT, text="H", color=C_GREY, scale=2)
        self.guide_m = label.Label(terminalio.FONT, text="M", color=C_GREY, scale=2)
        self.guide_s = label.Label(terminalio.FONT, text="S", color=C_GREY, scale=2)
        for g, gx in ((self.guide_h, W // 6), (self.guide_m, W // 2),
                      (self.guide_s, W - W // 6)):
            g.anchor_point = (0.5, 0.5)
            g.anchored_position = (gx, 186)
            group.append(g)

        self.hint = label.Label(terminalio.FONT, text="swipe up/down on H M S",
                                color=C_GREY)
        self.hint.anchor_point = (0.5, 0.5)
        self.hint.anchored_position = (W // 2, 212)
        group.append(self.hint)

        # always-visible navigation hint
        self.nav_hint = label.Label(terminalio.FONT, text="<- styles   battery ->",
                                    color=C_GREY)
        self.nav_hint.anchor_point = (0.5, 0.5)
        self.nav_hint.anchored_position = (W // 2, 230)
        group.append(self.nav_hint)

        # big animated message for the done state
        self.big_msg = label.Label(terminalio.FONT, text="UNLOCKED", color=C_GREEN,
                                   scale=2)
        self.big_msg.anchor_point = (0.5, 0.5)
        self.big_msg.anchored_position = (W // 2, 150)
        self.big_msg.hidden = True
        group.append(self.big_msg)

        # start/stop button
        self.BTN_W = 130
        self.BTN_H = 56
        self.BTN_X = (W - self.BTN_W) // 2
        self.BTN_Y = H - self.BTN_H - 24
        self.button = RoundRect(self.BTN_X, self.BTN_Y, self.BTN_W, self.BTN_H, 12,
                                fill=C_GREEN, outline=C_WHITE, stroke=2)
        group.append(self.button)
        self.btn_label = label.Label(terminalio.FONT, text="LOCK", color=C_WHITE,
                                     scale=2)
        self.btn_label.anchor_point = (0.5, 0.5)
        self.btn_label.anchored_position = (W // 2, self.BTN_Y + self.BTN_H // 2)
        group.append(self.btn_label)

    # =================== clock view (multiple styles) ===================
    # Swipe up/down on the clock screen cycles these appearances.
    def _clock_hints(self, group, W):
        h1 = label.Label(terminalio.FONT, text="swipe right = timer", color=C_GREY)
        h1.anchor_point = (0.5, 0.5)
        h1.anchored_position = (W // 2, 298)
        group.append(h1)
        h2 = label.Label(terminalio.FONT, text="up/down = style", color=C_GREY)
        h2.anchor_point = (0.5, 0.5)
        h2.anchored_position = (W // 2, 314)
        group.append(h2)

    # ----- style 1: analog clock (dark face, mint hands) -----
    def _build_clock_analog(self, W, H):
        group = displayio.Group()
        self.clock_groups.append(group)
        group.append(_bg_tile(W, H, C_BG))

        ttl = label.Label(terminalio.FONT, text="ANALOG", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)

        self.ring_cx = W // 2
        self.ring_cy = 148
        self.ring_r = 74
        group.append(Circle(self.ring_cx, self.ring_cy, self.ring_r,
                            fill=C_SURFACE, outline=C_WHITE, stroke=3))

        # hour tick marks (bigger dots at 12 / 3 / 6 / 9)
        for i in range(12):
            theta = 2 * math.pi * i / 12
            tr = self.ring_r - 9
            tx = self.ring_cx + int(tr * math.sin(theta))
            ty = self.ring_cy - int(tr * math.cos(theta))
            rad = 3 if i % 3 == 0 else 1
            group.append(Circle(tx, ty, rad, fill=C_WHITE))

        # hands drawn into a persistent bitmap (no per-frame allocation)
        d = 2 * self.ring_r + 1
        self.hand_cx = self.ring_r
        self.hand_cy = self.ring_r
        self.hand_bmp = displayio.Bitmap(d, d, 3)
        self.hand_pal = displayio.Palette(3)
        self.hand_pal[0] = 0x000000
        self.hand_pal.make_transparent(0)
        self.hand_pal[1] = C_WHITE
        self.hand_pal[2] = C_GREEN
        group.append(displayio.TileGrid(
            self.hand_bmp, pixel_shader=self.hand_pal,
            x=self.ring_cx - self.ring_r, y=self.ring_cy - self.ring_r))
        group.append(Circle(self.ring_cx, self.ring_cy, 4, fill=C_WHITE))

        self.an_time = label.Label(terminalio.FONT, text="0:00:00",
                                   color=C_WHITE, scale=2)
        self.an_time.anchor_point = (0.5, 0.5)
        self.an_time.anchored_position = (self.ring_cx, 248)
        group.append(self.an_time)

        self.an_state = label.Label(terminalio.FONT, text="", color=C_GREY)
        self.an_state.anchor_point = (0.5, 0.5)
        self.an_state.anchored_position = (W // 2, 274)
        group.append(self.an_state)

        self._clock_hints(group, W)
        self._set_hands(0)

    # ----- style 2: digital clock (dark card, big LCD readout) -----
    def _build_clock_digital(self, W, H):
        group = displayio.Group()
        self.clock_groups.append(group)
        group.append(_bg_tile(W, H, C_BG))

        ttl = label.Label(terminalio.FONT, text="DIGITAL", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)

        fh = 70
        group.append(RoundRect(12, 150 - fh // 2, W - 24, fh, 8,
                               fill=C_SURFACE, outline=C_GREY, stroke=2))

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

        self._clock_hints(group, W)

    # ----- style 3: arch gauge (dark, thick two-colour progress ring) -----
    def _build_clock_ring(self, W, H):
        group = displayio.Group()
        self.clock_groups.append(group)
        group.append(_bg_tile(W, H, C_BG))

        ttl = label.Label(terminalio.FONT, text="GAUGE", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)

        # A 270-degree arch (open at the bottom) built from overlapping dots so
        # the band is thick and each segment can be recoloured cheaply to show
        # elapsed (amber) vs remaining (green).
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
            dot = Circle(x, y, 7, fill=C_GREEN)
            self.gauge_dots.append(dot)
            group.append(dot)
        self._gauge_k = -1

        # leading tip that glides to the exact elapsed angle (smooth motion)
        self.gtip_size = 12
        gtip_bmp = displayio.Bitmap(self.gtip_size, self.gtip_size, 1)
        gtip_pal = displayio.Palette(1)
        gtip_pal[0] = C_WHITE
        self.gauge_tip = displayio.TileGrid(gtip_bmp, pixel_shader=gtip_pal)
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

        self._clock_hints(group, W)
        self._set_gauge(0.0)

    def _set_gauge(self, frac_elapsed):
        frac = max(0.0, min(1.0, frac_elapsed))
        # recolour the two-tone band only when a whole segment flips (cheap)
        k = int(round(frac * self.gauge_n))
        if k != self._gauge_k:
            self._gauge_k = k
            for i, dot in enumerate(self.gauge_dots):
                dot.fill = C_AMBER if i < k else C_GREEN
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

    # ----- view switching -----
    def show_view(self, view):
        self.view = view
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
        txt = fmt_hms(remaining)
        statetext = {"running": "LOCKED",
                     "done": "UNLOCKED",
                     "idle": "not started"}.get(state, "")
        active = C_RED if state == "running" else None
        style = self.clock_styles[self.clock_style_idx]
        if style == "analog":
            self.an_time.text = txt
            self._set_hands(remaining)
            self.an_time.color = active or C_WHITE
            self.an_state.text = statetext
        elif style == "digital":
            self.dig_time.text = txt
            self.dig_time.color = active or C_WHITE
            self.dig_state.text = statetext
        else:  # arch gauge
            self.rg_time.text = txt
            frac = 0.0 if total <= 0 else 1.0 - (remaining / total)
            self._set_gauge(frac)
            self.rg_time.color = active or C_WHITE
            self.rg_state.text = statetext

    # =================== battery view ===================
    def _build_battery(self, W, H):
        group = displayio.Group()
        self.battery_group = group
        group.append(_bg_tile(W, H, C_BG))

        ttl = label.Label(terminalio.FONT, text="BATTERY", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)

        # battery icon: body outline + terminal nub, with a variable fill bar
        self.bat_x = 36
        self.bat_y = 70
        self.bat_w = W - 72
        self.bat_h = 60
        group.append(RoundRect(self.bat_x, self.bat_y, self.bat_w, self.bat_h, 6,
                               outline=C_WHITE, stroke=3))
        nub_h = 24
        group.append(Rect(self.bat_x + self.bat_w,
                          self.bat_y + (self.bat_h - nub_h) // 2, 6, nub_h,
                          fill=C_WHITE))

        # fill lives in its own group so it can be redrawn at a new width
        self.bat_pad = 6
        self.bat_fill_x = self.bat_x + self.bat_pad
        self.bat_fill_y = self.bat_y + self.bat_pad
        self.bat_fill_h = self.bat_h - 2 * self.bat_pad
        self.bat_fill_max = self.bat_w - 2 * self.bat_pad
        self.bat_fill_group = displayio.Group()
        group.append(self.bat_fill_group)

        self.bat_pct = label.Label(terminalio.FONT, text="--%", color=C_WHITE,
                                   scale=3)
        self.bat_pct.anchor_point = (0.5, 0.5)
        self.bat_pct.anchored_position = (W // 2, self.bat_y + self.bat_h + 44)
        group.append(self.bat_pct)

        self.bat_volts = label.Label(terminalio.FONT, text="-.-- V", color=C_GREY,
                                     scale=2)
        self.bat_volts.anchor_point = (0.5, 0.5)
        self.bat_volts.anchored_position = (W // 2, self.bat_y + self.bat_h + 84)
        group.append(self.bat_volts)

        self.bat_chg = label.Label(terminalio.FONT, text="", color=C_AMBER, scale=2)
        self.bat_chg.anchor_point = (0.5, 0.5)
        self.bat_chg.anchored_position = (W // 2, self.bat_y + self.bat_h + 120)
        group.append(self.bat_chg)

        self.bat_watts = label.Label(terminalio.FONT, text="", color=C_GREY)
        self.bat_watts.anchor_point = (0.5, 0.5)
        self.bat_watts.anchored_position = (W // 2, self.bat_y + self.bat_h + 150)
        group.append(self.bat_watts)

        self.bat_diag = label.Label(terminalio.FONT, text="", color=C_GREY)
        self.bat_diag.anchor_point = (0.5, 0.5)
        self.bat_diag.anchored_position = (W // 2, self.bat_y + self.bat_h + 174)
        group.append(self.bat_diag)

        hint = label.Label(terminalio.FONT, text="<- timer    settings ->",
                           color=C_GREY)
        hint.anchor_point = (0.5, 0.5)
        hint.anchored_position = (W // 2, 316)
        group.append(hint)

    def update_battery_view(self, r):
        if not r.available:
            self.bat_pct.text = "N/A"
            self.bat_volts.text = "no gauge"
            self.bat_chg.text = ""
            self.bat_watts.text = ""
            self.bat_diag.text = "MAX17048 @0x36 not found"
            return
        self.bat_volts.text = "{:.2f} V".format(r.volts)
        self.bat_diag.text = "raw {}".format(r.raw)
        while len(self.bat_fill_group):
            self.bat_fill_group.pop()
        if r.charging:
            # A voltage-only gauge can't know the true level while charging, so
            # don't fake a %: show "CHG" and leave the bar empty.
            self.bat_pct.text = "CHG"
            self.bat_chg.text = "Charging"
            self.bat_chg.color = C_GREEN
            self.bat_watts.text = "-- W"
        else:
            pct = max(0, min(100, r.percent))
            self.bat_pct.text = "{}%".format(pct)
            self.bat_chg.text = "On battery"
            self.bat_chg.color = C_AMBER
            self.bat_watts.text = "~{:.1f} W (est)".format(r.watts)
            if pct >= 50:
                col = C_GREEN
            elif pct >= 20:
                col = C_AMBER
            else:
                col = C_RED
            w = max(1, int(self.bat_fill_max * pct / 100))
            self.bat_fill_group.append(Rect(self.bat_fill_x, self.bat_fill_y, w,
                                            self.bat_fill_h, fill=col))

    # =================== override counter overlay ===================
    def _build_override(self, W, H):
        group = displayio.Group()
        self.override_group = group
        group.append(_bg_tile(W, H, C_BG))

        ttl = label.Label(terminalio.FONT, text="OVERRIDE", color=C_AMBER, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 70)
        group.append(ttl)

        self.ov_count = label.Label(terminalio.FONT, text="0/0", color=C_WHITE,
                                    scale=4)
        self.ov_count.anchor_point = (0.5, 0.5)
        self.ov_count.anchored_position = (W // 2, 160)
        group.append(self.ov_count)

        hint = label.Label(terminalio.FONT, text="keep pressing to unlock",
                           color=C_GREY)
        hint.anchor_point = (0.5, 0.5)
        hint.anchored_position = (W // 2, 240)
        group.append(hint)

    def show_override(self, count, total):
        self.ov_count.text = "{}/{}".format(count, total)
        self.display.root_group = self.override_group

    def hide_override(self):
        # restore whatever top-level view was active before the overlay
        self.show_view(self.view)

    # =================== incoming-call notification overlay ===================
    # Driven over BLE by the companion app: while the box is locked, a
    # greenlisted/important call makes the box "alert-through" (screen lights up
    # with the caller) without opening the latch. Auto-dismisses on a timer.
    def _build_call_alert(self, W, H):
        group = displayio.Group()
        self.call_group = group
        group.append(_bg_tile(W, H, C_BG))
        group.append(Rect(0, 0, W, H, fill=None, outline=C_AMBER, stroke=6))

        bell = label.Label(terminalio.FONT, text="((  ))", color=C_AMBER, scale=2)
        bell.anchor_point = (0.5, 0.5)
        bell.anchored_position = (W // 2, 70)
        group.append(bell)

        ttl = label.Label(terminalio.FONT, text="INCOMING CALL", color=C_WHITE,
                          scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 130)
        group.append(ttl)

        self.call_who = label.Label(terminalio.FONT, text="", color=C_GREEN,
                                    scale=3)
        self.call_who.anchor_point = (0.5, 0.5)
        self.call_who.anchored_position = (W // 2, 190)
        group.append(self.call_who)

        hint = label.Label(terminalio.FONT, text="box stays locked",
                           color=C_GREY)
        hint.anchor_point = (0.5, 0.5)
        hint.anchored_position = (W // 2, 260)
        group.append(hint)

    def show_call_alert(self, who):
        self.call_who.text = (who or "Call")[:16]
        self.display.root_group = self.call_group

    def hide_call_alert(self):
        self.show_view(self.view)      # restore whatever view was active

    # =================== settings view ===================
    def _build_settings(self, W, H):
        group = displayio.Group()
        self.settings_group = group
        group.append(_bg_tile(W, H, C_BG))

        ttl = label.Label(terminalio.FONT, text="SETTINGS", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)

        self.set_rows_y = (70, 113, 156, 199, 242)
        names = ("Override", "Auto-open", "Sleep", "Bright", "Unlock")
        self.set_vals = []
        for i, name in enumerate(names):
            y = self.set_rows_y[i]
            nlbl = label.Label(terminalio.FONT, text=name, color=C_WHITE, scale=2)
            nlbl.anchor_point = (0.0, 0.5)
            nlbl.anchored_position = (14, y)
            group.append(nlbl)
            vlbl = label.Label(terminalio.FONT, text="", color=C_AMBER, scale=2)
            vlbl.anchor_point = (1.0, 0.5)
            vlbl.anchored_position = (W - 14, y)
            group.append(vlbl)
            self.set_vals.append(vlbl)

        h1 = label.Label(terminalio.FONT, text="tap a row to change", color=C_GREY)
        h1.anchor_point = (0.5, 0.5)
        h1.anchored_position = (W // 2, 300)
        group.append(h1)

    def update_settings(self, s):
        self.set_vals[0].text = str(s.override_presses)
        self.set_vals[1].text = "ON" if s.auto_open else "OFF"
        self.set_vals[2].text = "{}s".format(s.sleep_s)
        self.set_vals[3].text = "{}%".format(s.bright_pct)
        self.set_vals[4].text = "ON" if s.allow_remote_unlock else "OFF"

    def settings_row_at(self, y):
        for i, ry in enumerate(self.set_rows_y):
            if abs(y - ry) <= 22:
                return i
        return -1

    # ----- per-setting detail page ([-]/[+] buttons or swipe up/down) -----
    _SET_NAMES = ("Override", "Auto-open", "Sleep", "Bright", "Unlock")

    def _fmt_setting(self, idx, s):
        if idx == 0:
            return str(s.override_presses)
        if idx == 1:
            return "ON" if s.auto_open else "OFF"
        if idx == 2:
            return "{}s".format(s.sleep_s)
        if idx == 3:
            return "{}%".format(s.bright_pct)
        return "ON" if s.allow_remote_unlock else "OFF"

    def _build_setting_detail(self, W, H):
        group = displayio.Group()
        self.setting_detail_group = group
        group.append(_bg_tile(W, H, C_BG))
        self.sd_name = label.Label(terminalio.FONT, text="", color=C_GREY, scale=2)
        self.sd_name.anchor_point = (0.5, 0.5)
        self.sd_name.anchored_position = (W // 2, 60)
        group.append(self.sd_name)
        self.sd_value = label.Label(terminalio.FONT, text="", color=C_AMBER,
                                    scale=4)
        self.sd_value.anchor_point = (0.5, 0.5)
        self.sd_value.anchored_position = (W // 2, 130)
        group.append(self.sd_value)

        # on-screen [-] and [+] buttons
        self.sd_btn_w = 56
        self.sd_btn_h = 56
        self.sd_btn_y = 196
        self.sd_minus_x = 18
        self.sd_plus_x = W - 18 - self.sd_btn_w
        group.append(RoundRect(self.sd_minus_x, self.sd_btn_y, self.sd_btn_w,
                               self.sd_btn_h, 10, fill=C_RED, outline=C_WHITE,
                               stroke=2))
        ml = label.Label(terminalio.FONT, text="-", color=C_WHITE, scale=3)
        ml.anchor_point = (0.5, 0.5)
        ml.anchored_position = (self.sd_minus_x + self.sd_btn_w // 2,
                                self.sd_btn_y + self.sd_btn_h // 2)
        group.append(ml)
        group.append(RoundRect(self.sd_plus_x, self.sd_btn_y, self.sd_btn_w,
                               self.sd_btn_h, 10, fill=C_GREEN, outline=C_WHITE,
                               stroke=2))
        pl = label.Label(terminalio.FONT, text="+", color=C_WHITE, scale=3)
        pl.anchor_point = (0.5, 0.5)
        pl.anchored_position = (self.sd_plus_x + self.sd_btn_w // 2,
                                self.sd_btn_y + self.sd_btn_h // 2)
        group.append(pl)

        h2 = label.Label(terminalio.FONT, text="swipe left = back", color=C_GREY)
        h2.anchor_point = (0.5, 0.5)
        h2.anchored_position = (W // 2, 300)
        group.append(h2)

    def show_setting_detail(self, idx, s):
        self.sd_name.text = self._SET_NAMES[idx]
        self.sd_value.text = self._fmt_setting(idx, s)
        self.display.root_group = self.setting_detail_group

    def update_setting_detail(self, idx, s):
        self.sd_value.text = self._fmt_setting(idx, s)

    def in_setting_minus(self, x, y):
        return (self.sd_minus_x <= x <= self.sd_minus_x + self.sd_btn_w and
                self.sd_btn_y <= y <= self.sd_btn_y + self.sd_btn_h)

    def in_setting_plus(self, x, y):
        return (self.sd_plus_x <= x <= self.sd_plus_x + self.sd_btn_w and
                self.sd_btn_y <= y <= self.sd_btn_y + self.sd_btn_h)

    # =================== hit testing ===================
    def in_button(self, x, y):
        return (self.BTN_X <= x <= self.BTN_X + self.BTN_W and
                self.BTN_Y <= y <= self.BTN_Y + self.BTN_H)

    def in_status(self, x, y):
        return (8 <= x <= self.W - 8 and
                self.STATUS_Y <= y <= self.STATUS_Y + self.STATUS_H)

    # =================== control setters ===================
    def set_status(self, text, color):
        self.status_lbl.text = text
        self.status_bar.fill = color

    def set_button(self, text, color):
        self.btn_label.text = text
        self.button.fill = color

    def set_clock(self, secs):
        self.clock.text = fmt_hms(secs)

    def set_clock_text(self, text):
        self.clock.text = text

    def _idle_widgets(self, visible):
        for w in (self.title, self.guide_h, self.guide_m, self.guide_s, self.hint):
            w.hidden = not visible

    # =================== whole-screen states ===================
    def _show_button(self, visible):
        self.button.hidden = not visible
        self.btn_label.hidden = not visible

    def show_idle(self, secs):
        self.clock.hidden = False
        self.clock.color = C_WHITE
        self.set_clock(secs)
        self.big_msg.hidden = True
        self.border.hidden = True
        self._idle_widgets(True)
        self.set_status("UNLOCKED", C_GREEN)
        self.set_button("LOCK", C_GREEN)
        self._show_button(True)

    def show_running(self):
        self.clock.hidden = False
        self.clock.color = C_WHITE
        self.big_msg.hidden = True
        self.border.hidden = True
        self._idle_widgets(False)
        self.set_status("LOCKED", C_RED)
        self._show_button(False)          # no on-screen cancel; override only

    def show_closed(self):
        # lid closed but not yet timed: pick a time, then tap LOCK to start
        self.clock.hidden = False
        self.clock.color = C_WHITE
        self.big_msg.hidden = True
        self.border.hidden = True
        self._idle_widgets(True)          # show H/M/S guides so time is selectable
        self.set_status("CLOSED", C_AMBER)
        self.set_button("LOCK", C_GREEN)
        self._show_button(True)

    def show_done(self, auto_open=True):
        self.clock.hidden = True
        self.big_msg.hidden = False
        self.set_status("UNLOCKED", C_GREEN)
        if auto_open:
            self._show_button(False)           # no button; auto-dismisses after 2s
        else:
            self.set_button("OPEN", C_GREEN)   # manual open: tap to release servo
            self._show_button(True)

    def animate_done(self, on):
        self.big_msg.hidden = not on
        self.border.hidden = not on
