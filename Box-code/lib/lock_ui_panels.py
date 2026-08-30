# lock_ui_panels.py -- the battery page, the override-progress overlay, and the incoming-call alert.
#
# One of the view mixins LockUI is composed from; see lock_ui.py's header for
# why the class is split this way and what that does and does not change.
# Every method here runs as a method OF LockUI -- `self` is the whole UI, and
# the attributes below are the ones lock_ui.py's __init__ creates.

import math
import displayio
import terminalio
from adafruit_display_text import label
from adafruit_display_shapes.roundrect import RoundRect
from adafruit_display_shapes.rect import Rect
from adafruit_display_shapes.circle import Circle
from lock_config import C_BG
from lock_config import C_WHITE
from lock_config import C_GREY
from lock_config import C_GREEN
from lock_config import C_RED
from lock_config import C_AMBER
from lock_config import C_ALERT_RED
from lock_config import C_ALERT_AMBER
from lock_config import clamp
from lock_config import OVR_POP_OFFSET_PX
from lock_ui_common import _bg_tile


class PanelsMixin:
    # =================== battery view ===================
    def _build_battery(self, W, H):
        group = displayio.Group()
        self.battery_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = label.Label(terminalio.FONT, text="BATTERY", color=C_GREY, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))

        # battery icon: body outline + terminal nub, with a variable fill bar
        self.bat_x = 36
        self.bat_y = 70
        self.bat_w = W - 72
        self.bat_h = 60
        _bat_outline = RoundRect(self.bat_x, self.bat_y, self.bat_w, self.bat_h, 6,
                                 outline=C_WHITE, stroke=3)
        group.append(_bat_outline)
        self._fg_widgets.append((_bat_outline, 'outline'))
        nub_h = 24
        _bat_nub = Rect(self.bat_x + self.bat_w,
                       self.bat_y + (self.bat_h - nub_h) // 2, 6, nub_h,
                       fill=C_WHITE)
        group.append(_bat_nub)
        self._fg_widgets.append((_bat_nub, 'fill'))

        # fill lives in its own group so it can be redrawn at a new width
        self.bat_pad = 6
        self.bat_fill_x = self.bat_x + self.bat_pad
        self.bat_fill_y = self.bat_y + self.bat_pad
        self.bat_fill_h = self.bat_h - 2 * self.bat_pad
        self.bat_fill_max = self.bat_w - 2 * self.bat_pad
        self.bat_fill_group = displayio.Group()
        group.append(self.bat_fill_group)
        self._bat_bar_last_key = None  # see update_battery_view

        self.bat_pct = label.Label(terminalio.FONT, text="--%", color=C_WHITE,
                                   scale=3)
        self.bat_pct.anchor_point = (0.5, 0.5)
        self.bat_pct.anchored_position = (W // 2, self.bat_y + self.bat_h + 44)
        group.append(self.bat_pct)
        self._fg_widgets.append((self.bat_pct, 'color'))

        self.bat_volts = label.Label(terminalio.FONT, text="-.-- V", color=C_GREY,
                                     scale=2)
        self.bat_volts.anchor_point = (0.5, 0.5)
        self.bat_volts.anchored_position = (W // 2, self.bat_y + self.bat_h + 84)
        group.append(self.bat_volts)
        self._dim_widgets.append((self.bat_volts, 'color'))

        self.bat_chg = label.Label(terminalio.FONT, text="", color=C_AMBER, scale=2)
        self.bat_chg.anchor_point = (0.5, 0.5)
        self.bat_chg.anchored_position = (W // 2, self.bat_y + self.bat_h + 120)
        group.append(self.bat_chg)

        self.bat_watts = label.Label(terminalio.FONT, text="", color=C_GREY)
        self.bat_watts.anchor_point = (0.5, 0.5)
        self.bat_watts.anchored_position = (W // 2, self.bat_y + self.bat_h + 150)
        group.append(self.bat_watts)
        self._dim_widgets.append((self.bat_watts, 'color'))

        hint = label.Label(terminalio.FONT, text="<- timer    settings ->",
                           color=C_GREY)
        hint.anchor_point = (0.5, 0.5)
        hint.anchored_position = (W // 2, 316)
        group.append(hint)
        self._dim_widgets.append((hint, 'color'))

    def update_battery_view(self, r):
        if not r.available:
            self.bat_pct.text = "N/A"
            self.bat_volts.text = "no gauge"
            self.bat_chg.text = ""
            self.bat_watts.text = ""
            key = None
        else:
            self.bat_volts.text = "{:.2f} V".format(r.volts)
            if r.charging:
                # A voltage-only gauge can't know the true level while
                # charging, so don't fake a %: show "CHG" and leave the bar
                # empty.
                self.bat_pct.text = "CHG"
                self.bat_chg.text = "Charging"
                self.bat_chg.color = C_GREEN
                self.bat_watts.text = "-- W"
                key = None
            else:
                pct = clamp(r.percent, 0, 100)
                self.bat_pct.text = "{}%".format(pct)
                # No "On battery" label here (manager request) -- the percent
                # readout above already implies it whenever bat_chg isn't
                # showing "Charging", so the extra line was redundant.
                self.bat_chg.text = ""
                self.bat_watts.text = "~{:.1f} W (est)".format(r.watts)
                if pct >= 50:
                    col = C_GREEN
                elif pct >= 20:
                    col = C_AMBER
                else:
                    col = C_RED
                w = max(1, int(self.bat_fill_max * pct / 100))
                key = (w, col)
        # Only rebuild the fill Rect when it actually changed -- see the
        # identical fix (and the reason) in update_override_timeout above.
        # Falling through to this gate even in the "not available"/"charging"
        # cases (rather than returning early) matters too: without it, a fill
        # bar drawn while the gauge was available and discharging would never
        # get cleared if the gauge later drops out or starts charging while
        # the battery view stays open.
        if key == self._bat_bar_last_key:
            return
        self._bat_bar_last_key = key
        while len(self.bat_fill_group):
            self.bat_fill_group.pop()
        if key is not None:
            w, col = key
            self.bat_fill_group.append(Rect(self.bat_fill_x, self.bat_fill_y, w,
                                            self.bat_fill_h, fill=col))

    # =================== override counter overlay ===================
    def _build_override(self, W, H):
        group = displayio.Group()
        self.override_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = label.Label(terminalio.FONT, text="OVERRIDE", color=C_AMBER, scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 26)
        group.append(ttl)

        # Circular progress ring around the press counter -- same
        # dots-around-a-circle technique as the clock view's arch gauge
        # (_build_clock_ring/_set_gauge), recolored to the app's accent as
        # the count approaches target instead of amber/green (this ring IS
        # the override's own progress, not a lock/closed/unlocked STATE
        # color, so it's free to use accent like the LOCK/OPEN button).
        # Built and appended BEFORE ov_count so the count text always paints
        # on top of the ring, same z-order reasoning as the press rings in
        # _build_control.
        # r=72, not the original 86: at r=86 the ring's outermost dots (4px
        # radius) reached x = 86 +- 90 = -4 to 176 on this 172px-wide screen
        # -- off the edge on both sides. r=72 keeps the dots' full extent
        # within x = 10..162, a real ~10px margin inside the 172px screen.
        self.ovr_ring_cx = W // 2
        self.ovr_ring_cy = 145
        self.ovr_ring_r = 72
        self.ovr_ring_n = 40
        self.ovr_ring_dots = []
        for i in range(self.ovr_ring_n):
            theta = 2 * math.pi * i / self.ovr_ring_n
            x = self.ovr_ring_cx + int(self.ovr_ring_r * math.sin(theta))
            y = self.ovr_ring_cy - int(self.ovr_ring_r * math.cos(theta))
            dot = Circle(x, y, 4, fill=C_GREY)
            self.ovr_ring_dots.append(dot)
            group.append(dot)
        self._ovr_ring_k = -1

        # This label reassigns on every single override-button press
        # (show_override), and override_presses can be configured as high as
        # 255 (OVR_MAX), so a real "keep pressing to unlock" sequence is
        # a long, uninterrupted burst of small label-bitmap reallocations --
        # a likely contributor to the reported crash. This board's installed
        # adafruit_display_text.Label does NOT accept a `max_glyphs` kwarg to
        # pre-size and avoid that (confirmed on-device: it raised
        # `TypeError: unexpected keyword argument 'max_glyphs'` and halted
        # code.py with no UI) -- reverted. The periodic gc.collect() in
        # LockController.press_override is the mitigation actually in place.
        # scale=3, not 4: at scale=4 the widest text this ever shows
        # ("255/255", 7 chars, OVR_MAX's ceiling) is 4*6*7 = 168px --
        # nearly the full 172px screen width on its own, let alone fitting
        # inside the ring (whose usable inner width, after the ring's own
        # stroke, is well under that). scale=3 -> 126px, comfortable both
        # against the screen edge and inside the ring.
        self.ov_count = label.Label(terminalio.FONT, text="0/0", color=C_WHITE,
                                    scale=3)
        self.ov_count.anchor_point = (0.5, 0.5)
        self.ov_count.anchored_position = (W // 2, 145)
        group.append(self.ov_count)
        self._fg_widgets.append((self.ov_count, 'color'))
        self._ovr_count_base = self.ov_count.anchored_position

        # Positioned below the ring's bottom edge (ovr_ring_cy + ovr_ring_r =
        # 145 + 72 = 217), not at a value chosen independently of it -- this
        # row (and the bar/hint2 below) used to sit inside the ring's circle,
        # overlapping it.
        hint = label.Label(terminalio.FONT, text="keep pressing to unlock",
                           color=C_GREY)
        hint.anchor_point = (0.5, 0.5)
        hint.anchored_position = (W // 2, 248)
        group.append(hint)
        self._dim_widgets.append((hint, 'color'))

        # ----- auto-reset countdown bar -----
        # A missed press previously reset the counter silently at
        # OVERRIDE_TIMEOUT with no on-screen warning; this bar depletes in
        # real time (driven by update_override_timeout each frame) and
        # changes color as the deadline nears, same idiom as the battery bar.
        self.ov_bar_x = W // 2 - 70
        self.ov_bar_y = 264
        self.ov_bar_w = 140
        self.ov_bar_h = 14
        _ov_bar_bg = Rect(self.ov_bar_x, self.ov_bar_y, self.ov_bar_w,
                          self.ov_bar_h, fill=None, outline=C_GREY, stroke=2)
        group.append(_ov_bar_bg)
        self._dim_widgets.append((_ov_bar_bg, 'outline'))
        self.ov_bar_fill_group = displayio.Group()
        group.append(self.ov_bar_fill_group)
        # last (w, color) actually drawn -- see update_override_timeout, which
        # only touches the group when this changes instead of on every frame
        self._ov_bar_last_key = None

        hint2 = label.Label(terminalio.FONT, text="resets if you stop",
                            color=C_GREY)
        hint2.anchor_point = (0.5, 0.5)
        hint2.anchored_position = (W // 2, 296)
        group.append(hint2)
        self._dim_widgets.append((hint2, 'color'))

    def _set_ovr_ring(self, frac):
        # Same key-gated redraw idiom as _set_gauge/update_override_timeout
        # -- only touch a dot's .fill when the filled count actually changes,
        # not on every press-counter update.
        frac = clamp(frac, 0.0, 1.0)
        k = int(round(frac * self.ovr_ring_n))
        if k == self._ovr_ring_k:
            return
        self._ovr_ring_k = k
        for i, dot in enumerate(self.ovr_ring_dots):
            dot.fill = self._accent_color if i < k else C_GREY

    def show_override(self, count, total):
        self.ov_count.text = "{}/{}".format(count, total)
        self._set_ovr_ring(count / total if total else 0.0)
        # Tactile confirmation for the single most repetitive physical
        # interaction on the device (default 25 presses to force-unlock,
        # see OVERRIDE_PRESSES) -- each registered press bumps the count up
        # and springs it back to rest instead of a flat text swap.
        self._ovr_pop.displace(-OVR_POP_OFFSET_PX, 0.0)
        self.display.root_group = self.override_group

    def update_override_timeout(self, remaining, total):
        # remaining/total -> a depleting bar, green -> amber -> red as the
        # silent counter-reset gets close. Called every frame (~50Hz) while an
        # override is in progress -- LockController.update() drives this for
        # the whole OVERRIDE_TIMEOUT window on every press, not just once.
        # Rebuilding the Rect on every call (pop+allocate) regardless of
        # whether the on-screen bar actually changed churns the heap fast
        # enough at that rate to exhaust it during a sustained "keep pressing
        # to unlock" sequence and crash/reboot the board. Only touch the
        # group when the drawn (width, color) actually changes -- same fix
        # as update_battery_view below, which only needed it because it's
        # gated to ~1Hz already.
        frac = max(0.0, min(1.0, remaining / total)) if total else 0.0
        w = max(0, int((self.ov_bar_w - 4) * frac))
        col = None
        if w > 0:
            if frac > 0.5:
                col = C_GREEN
            elif frac > 0.2:
                col = C_AMBER
            else:
                col = C_RED
        key = (w, col)
        if key == self._ov_bar_last_key:
            return
        self._ov_bar_last_key = key
        while len(self.ov_bar_fill_group):
            self.ov_bar_fill_group.pop()
        if w > 0:
            self.ov_bar_fill_group.append(
                Rect(self.ov_bar_x + 2, self.ov_bar_y + 2, w, self.ov_bar_h - 4,
                     fill=col))

    def hide_override(self):
        # Reset the ring to empty so the next override sequence starts fresh
        # on screen instead of showing the previous attempt's fill level.
        self._ovr_ring_k = -1
        for dot in self.ovr_ring_dots:
            dot.fill = C_GREY
        # restore whatever top-level view was active before the overlay
        self.show_view(self.view)

    # =================== incoming-call notification overlay ===================
    # Driven over BLE by the companion app: while the box is locked, a
    # greenlisted/important call makes the box "alert-through" (screen lights up
    # with the caller) without opening the latch. Auto-dismisses on a timer.
    # Deliberately NOT themed (no registry entries here) -- an incoming-call
    # alarm should stay maximally visible regardless of the chosen mode/accent.
    def _build_call_alert(self, W, H):
        group = displayio.Group()
        self.call_group = group
        # Flashing background + border (see animate_call_alert) -- kept as
        # live refs so the alarm colors can be toggled every frame without
        # rebuilding the scene. Alternates a saturated alert red/amber (see
        # C_ALERT_RED/C_ALERT_AMBER -- brighter than the calmer C_RED/C_AMBER
        # used elsewhere) so it reads as urgent; text stays white so it
        # reads over either color.
        self.call_bg = _bg_tile(W, H, C_ALERT_RED)
        group.append(self.call_bg)
        self.call_border = Rect(0, 0, W, H, fill=None, outline=C_ALERT_AMBER, stroke=10)
        group.append(self.call_border)

        bell = label.Label(terminalio.FONT, text="((  ))", color=C_WHITE, scale=2)
        bell.anchor_point = (0.5, 0.5)
        bell.anchored_position = (W // 2, 70)
        group.append(bell)

        ttl = label.Label(terminalio.FONT, text="INCOMING CALL", color=C_WHITE,
                          scale=2)
        ttl.anchor_point = (0.5, 0.5)
        ttl.anchored_position = (W // 2, 130)
        group.append(ttl)

        self.call_who = label.Label(terminalio.FONT, text="", color=C_WHITE,
                                    scale=3)
        self.call_who.anchor_point = (0.5, 0.5)
        self.call_who.anchored_position = (W // 2, 190)
        group.append(self.call_who)

        hint = label.Label(terminalio.FONT, text="box stays locked",
                           color=C_WHITE)
        hint.anchor_point = (0.5, 0.5)
        hint.anchored_position = (W // 2, 260)
        group.append(hint)

    def show_call_alert(self, who):
        self._call_alert_active = True
        self.call_who.text = (who or "Call")[:16]
        self.call_bg.pixel_shader[0] = C_ALERT_RED
        self.call_border.outline = C_ALERT_AMBER
        self.display.root_group = self.call_group

    def animate_call_alert(self, on):
        # Swap which color is background vs. border each flash tick -- a
        # full-screen alternating alarm flash, not just a blinking accent.
        if on:
            self.call_bg.pixel_shader[0] = C_ALERT_RED
            self.call_border.outline = C_ALERT_AMBER
        else:
            self.call_bg.pixel_shader[0] = C_ALERT_AMBER
            self.call_border.outline = C_ALERT_RED

    def hide_call_alert(self):
        self._call_alert_active = False
        self.show_view(self.view)      # restore whatever view was active
