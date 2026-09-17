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
from adafruit_display_shapes.rect import Rect
from adafruit_display_shapes.circle import Circle
from lock_config import (
    C_BG, C_WHITE, C_GREY, C_GREEN, C_RED, C_AMBER, C_ALERT_RED, C_ALERT_AMBER, clamp,
    OVR_POP_OFFSET_PX,
)
from lock_ui_common import _bg_tile
from lock_ui_kit import (
    build_screen_title, build_card, build_track_bg, build_nav_left,
    build_nav_right, build_hint, build_card_row_text, build_card_value,
)
from lock_ui_widgets import bar_fill_width


class PanelsMixin:
    # =================== battery view ===================
    def _build_battery(self, W, H):
        group = displayio.Group()
        self.battery_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = build_screen_title(W, "BATTERY")
        group.append(ttl)
        self._dim_widgets.append((ttl, 'color'))

        self.bat_pct = label.Label(terminalio.FONT, text="--%", color=C_WHITE,
                                   scale=3)
        self.bat_pct.anchor_point = (0.5, 0.5)
        self.bat_pct.anchored_position = (W // 2, 66)
        group.append(self.bat_pct)
        self._fg_widgets.append((self.bat_pct, 'color'))

        # Charging indicator: kept as a text label rather than recoloring
        # the track fill (spec's "your call" -- see update_battery_view).
        # A voltage-only gauge can't know the true % while charging, so the
        # track has nothing true to fill either way; a plain green label is
        # the one signal that IS true, and it is the exact "CHG"/"Charging"
        # information the old glyph-based view already showed, just moved
        # off the glyph.
        self.bat_chg = label.Label(terminalio.FONT, text="", color=C_GREEN, scale=2)
        self.bat_chg.anchor_point = (0.5, 0.5)
        self.bat_chg.anchored_position = (W // 2, 92)
        group.append(self.bat_chg)

        # ----- charge track -----
        # Replaces the old glyph (RoundRect outline + terminal-nub Rect +
        # fill Rect -- 3 shapes, hard square fill corners inside a rounded
        # outline) with the shared language's own track: one theme-fixed
        # groove (build_track_bg, see its docstring for why it is never
        # registered) plus one rebuilt accent Rect on top -- 2 shapes, and
        # the same visual vocabulary as the settings detail page's progress
        # track (lock_ui_widgets.build_detail_track_bg/_fill).
        # DELIBERATELY raw width-proportional and UN-EASED, same as the
        # override timeout bar in this file -- see lock_ui.py's color-
        # transition-engine comment: this bar's width IS the literal
        # percent remaining, so easing it would show a percent for a few
        # frames that is not the true one.
        self.bat_track_x = 16
        self.bat_track_y = 118
        self.bat_track_w = 140
        self.bat_track_h = 14
        _bat_track_bg = build_track_bg(self.bat_track_x, self.bat_track_y,
                                       self.bat_track_w, self.bat_track_h)
        group.append(_bat_track_bg)
        self.bat_fill_group = displayio.Group()
        group.append(self.bat_fill_group)
        self._bat_bar_last_key = None  # see update_battery_view

        # ----- two data rows -----
        # The old "3.87 V" and "~0.4 W (est)" were floating centred labels
        # with no card/border of their own (the "orphaned" readout the spec
        # calls out); these are now two proper card rows, name left / value
        # right, in the same language as every settings row.
        row1_top = 154
        row2_top = 202
        card1 = build_card(row1_top, 42)
        group.append(card1)
        self._surface_widgets.append((card1, 'fill'))
        # The unit lives in the DESC line, not beside the number. "Voltage"
        # is 7 glyphs (84px from CARD_TEXT_X, ending x=96) and the value is
        # right-anchored at x=156, so "3.87" (4 glyphs, 48px, starting x=108)
        # clears it by 12px but "3.87V" (5 glyphs, starting x=96) would touch
        # it exactly. The Power row below can afford its inline "W" because
        # "Power" is only 5 glyphs and leaves 36px of slack. Rather than let
        # one row silently lose its unit to fit, the desc carries it -- that
        # line has 24 glyphs of budget and is already there.
        n1, d1 = build_card_row_text(row1_top, "Voltage", "volts, live reading")
        group.append(n1)
        self._fg_widgets.append((n1, 'color'))
        group.append(d1)
        self._dim_widgets.append((d1, 'color'))
        self.bat_volts = build_card_value(row1_top)
        group.append(self.bat_volts)
        self._accent_widgets.append((self.bat_volts, 'color'))

        card2 = build_card(row2_top, 42)
        group.append(card2)
        self._surface_widgets.append((card2, 'fill'))
        n2, d2 = build_card_row_text(row2_top, "Power", "estimated draw")
        group.append(n2)
        self._fg_widgets.append((n2, 'color'))
        group.append(d2)
        self._dim_widgets.append((d2, 'color'))
        self.bat_watts = build_card_value(row2_top)
        group.append(self.bat_watts)
        self._accent_widgets.append((self.bat_watts, 'color'))

        # Chevron nav pair, replacing the ASCII "<- timer    settings ->".
        nav_l_chev, nav_l_lbl = build_nav_left("timer")
        group.append(nav_l_chev)
        self._dim_widgets.append((nav_l_chev, 'fill'))
        group.append(nav_l_lbl)
        self._dim_widgets.append((nav_l_lbl, 'color'))
        nav_r_lbl, nav_r_chev = build_nav_right(W, "settings")
        group.append(nav_r_lbl)
        self._dim_widgets.append((nav_r_lbl, 'color'))
        group.append(nav_r_chev)
        self._dim_widgets.append((nav_r_chev, 'fill'))
        # Bottom view-position dots (ThemeMixin._add_view_dots) -- the battery
        # screen is one of the top-level VIEWS, so it carries the same row as
        # control/clock/settings. The override and call-alert screens below in
        # this file deliberately do NOT: neither is in VIEWS (both are
        # overlays that take over whichever view is showing), so a position
        # indicator on them would point at a screen the user is not on.
        self._add_view_dots(group, W)

    def update_battery_view(self, r):
        if not r.available:
            self.bat_pct.text = "N/A"
            self.bat_chg.text = ""
            self.bat_volts.text = "N/A"
            self.bat_watts.text = "N/A"
            key = None
        elif r.charging:
            # A voltage-only gauge can't know the true level while
            # charging, so don't fake a %: show "CHG" and leave the track
            # empty. The voltage card row keeps showing its real reading
            # regardless -- that number is genuine even while charging.
            self.bat_pct.text = "CHG"
            self.bat_chg.text = "Charging"
            self.bat_volts.text = "{:.2f}".format(r.volts)
            self.bat_watts.text = "N/A"
            key = None
        else:
            pct = clamp(r.percent, 0, 100)
            self.bat_pct.text = "{}%".format(pct)
            # No "On battery" label here (manager request) -- the percent
            # readout above already implies it whenever bat_chg isn't
            # showing "Charging", so the extra line was redundant.
            self.bat_chg.text = ""
            self.bat_volts.text = "{:.2f}".format(r.volts)
            self.bat_watts.text = "{:.1f}W".format(r.watts)
            if pct >= 50:
                col = C_GREEN
            elif pct >= 20:
                col = C_AMBER
            else:
                col = C_RED
            w = bar_fill_width(self.bat_track_w, pct / 100.0, min_w=1)
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
            self.bat_fill_group.append(Rect(self.bat_track_x, self.bat_track_y, w,
                                            self.bat_track_h, fill=col))

    # =================== override counter overlay ===================
    def _build_override(self, W, H):
        group = displayio.Group()
        self.override_group = group
        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        ttl = build_screen_title(W, "OVERRIDE")
        # Amber, and deliberately registered in NO theme registry (not
        # _dim_widgets, not anywhere else) -- this overlay only ever shows
        # up mid force-unlock, so amber here IS the caution signal itself,
        # not chrome that should track the user's dim/fg theme choice. Do
        # not "fix" this to build_screen_title's default dim color later;
        # that would quietly remove the one screen where amber means
        # something rather than decorates.
        ttl.color = C_AMBER
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

        # ----- auto-reset countdown bar -----
        # A missed press previously reset the counter silently at
        # OVERRIDE_TIMEOUT with no on-screen warning; this bar depletes in
        # real time (driven by update_override_timeout each frame) and
        # changes color as the deadline nears, same idiom as the battery bar.
        # Positioned below the ring's bottom edge (ovr_ring_cy + ovr_ring_r =
        # 145 + 72 = 217), not at a value chosen independently of it -- this
        # row (and the hint below) used to sit inside the ring's circle,
        # overlapping it.
        self.ov_bar_x = W // 2 - 70
        self.ov_bar_y = 264
        self.ov_bar_w = 140
        self.ov_bar_h = 14
        # Groove via the shared language's own track background instead of
        # a bare outlined Rect -- build_track_bg's docstring (lock_ui_kit.py)
        # is explicit that it is INTENTIONALLY THEME-FIXED and must never be
        # registered in a theme bucket, which also matches this bar's own
        # constraint below: its width is the literal remaining fraction, not
        # a themed decoration.
        _ov_bar_bg = build_track_bg(self.ov_bar_x, self.ov_bar_y, self.ov_bar_w,
                                    self.ov_bar_h)
        group.append(_ov_bar_bg)
        self.ov_bar_fill_group = displayio.Group()
        group.append(self.ov_bar_fill_group)
        # last (w, color) actually drawn -- see update_override_timeout, which
        # only touches the group when this changes instead of on every frame
        self._ov_bar_last_key = None

        # One consolidated hint, replacing the old two ("keep pressing to
        # unlock" + "resets if you stop") -- they were the same message in
        # two lines (what to do, and what happens if you don't), and the
        # depleting bar right above already shows the "or it resets" half
        # visually. Kept at y=296, the lower of the two old positions, since
        # the bar (264..278) needs the room the old y=248 hint used to sit
        # in.
        hint = build_hint(W, "keep pressing or it resets", 296)
        group.append(hint)
        self._dim_widgets.append((hint, 'color'))

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
        self._set_root(self.override_group)

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

    def _set_root(self, group):
        """The one place display.root_group is assigned (bar show_call_alert).

        Always records `group` as the intended screen, and applies it only
        when the call-alert overlay is not on top. Every overlay entry point
        used to assign root_group directly, each one individually
        correct-looking and collectively wrong: an override counter, a tag
        picker, a topic-confirm or a settings-detail page raised during an
        incoming-call alert erased that alert mid-flash, defeating the one
        screen this firmware calls insistent by design.

        The restore had the mirror-image hole. hide_call_alert re-derived a
        screen from self.view, but overlays are not views -- so an overlay
        that was up when the alert arrived got wiped 20 seconds later while
        the controller was still routing touches to it. From "closed" that
        left state == "picking" with an invisible tag picker swallowing every
        touch, which reads on the box as a dead screen.

        Recording intent unconditionally is what makes both halves one idea:
        whatever the box last decided to show is what comes back, overlay or
        view, no second "screen is stale" flag to reconcile later.
        """
        self._pending_root = group
        if self._call_alert_active:
            return
        self.display.root_group = group

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
        # Restore the INTENDED screen, not a view re-derived from self.view.
        # An overlay that was up when the alert arrived (or was raised during
        # it) is not a view, and re-deriving one used to wipe it while the
        # controller still routed touches there. _pending_root is only None
        # if an alert somehow preceded the constructor's own first paint.
        if self._pending_root is not None:
            self._set_root(self._pending_root)
        else:
            self.show_view(self.view)
