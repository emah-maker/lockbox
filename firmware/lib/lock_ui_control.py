# lock_ui_control.py -- the main control view: building its widgets, touch handling, and drag motion.
#
# One of the view mixins LockUI is composed from; see lock_ui.py's header for
# why the class is split this way and what that does and does not change.
# Every method here runs as a method OF LockUI -- `self` is the whole UI, and
# the attributes below are the ones lock_ui.py's __init__ creates.

import displayio
import terminalio
from adafruit_display_text import label
from adafruit_display_shapes.roundrect import RoundRect
from lock_config import (
    C_BG, C_SURFACE, C_WHITE, C_BLACK, C_GREY, C_GREEN, C_ON_ACCENT_DARK, RADIUS_CARD,
    RADIUS_BTN_LG, SPRING_STIFFNESS, SPRING_DAMPING, SPRING_MASS, PRESS_DEPTH_PX,
    DONE_MSG_Y, DONE_BTN_CENTER_Y,
)
from lock_motion import Spring
from lock_ui_common import _bg_tile, _clamp_offset
from lock_ui_kit import build_nav_left, build_nav_right


class ControlMixin:
    # =================== control view ===================
    def _build_control(self, W, H):
        group = displayio.Group()
        self.control_group = group

        _tile = _bg_tile(W, H, C_BG)
        group.append(_tile)
        self._bg_tiles.append(_tile)

        # status bar (on/off indicator) -- fill is set per-state by
        # set_status (LOCKED/CLOSED/UNLOCKED), never themed
        self.STATUS_Y = 8
        self.STATUS_H = 38
        self.status_bar = RoundRect(8, self.STATUS_Y, W - 16, self.STATUS_H,
                                    RADIUS_CARD, fill=C_GREEN)
        group.append(self.status_bar)
        # Press-feedback ring for the status bar (see on_touch_down) --
        # appended here, between the bar and its label, so the label is
        # GUARANTEED to paint on top of the ring's stroke every frame
        # (displayio paints append order back-to-front). Previously this ring
        # was built in a separate block at the very end of _build_control,
        # after every other control-view widget including this label -- on
        # top of it for the ring's entire visible lifetime, which is the most
        # likely source of the reported "status text disappears" glitch even
        # though the ring's own fill=None should leave the interior
        # transparent. Moving it here removes that risk without touching the
        # tap-to-toggle interaction model at all (still shown/hidden only).
        self.status_press_ring = RoundRect(6, self.STATUS_Y - 2, W - 12,
                                           self.STATUS_H + 4, 9,
                                           fill=None, outline=C_WHITE, stroke=3)
        self.status_press_ring.hidden = True
        group.append(self.status_press_ring)
        # Fixed rest position, captured once at build time -- see
        # on_touch_down's comment on why this must NOT be a live `.y` read.
        self._status_ring_rest_y = self.status_press_ring.y
        self.status_lbl = label.Label(terminalio.FONT, text="UNLOCKED",
                                      color=C_BLACK, scale=2)
        self.status_lbl.anchor_point = (0.5, 0.5)
        self.status_lbl.anchored_position = (W // 2, self.STATUS_Y + self.STATUS_H // 2)
        group.append(self.status_lbl)
        self._status_lbl_rest_pos = self.status_lbl.anchored_position

        # y=53, not the old 55 -- this screen has no title (build_screen_title
        # is what the clock/battery/settings screens put at HEADER_Y's shared
        # line), so the corner glyphs have nothing of their own to sit next
        # to. Pulling them right up against the status bar's bottom edge
        # (46) instead of floating 9px below it reads them as that bar's own
        # caption row -- the header's second line -- rather than three
        # unrelated fragments dropped in the gap above the clock card. Still
        # clear of the status press ring's own bottom edge (STATUS_Y - 2 +
        # STATUS_H + 4 = 48) by a full pixel, so a status-bar press never
        # visibly touches this row.
        self._add_corner_indicators(group, W, y=53)

        # Small override-press-count indicator -- not a sentence explaining
        # what override is (that was the clutter just cut above), just the
        # configured number itself, in the empty center of the BLE-dot/
        # battery-% row so it doesn't cost this screen a new row. "x" (ASCII),
        # not "x" unicode multiplication sign -- terminalio.FONT's glyph set
        # isn't guaranteed to cover non-ASCII. Kept live via update_settings,
        # the same call every settings-change path already makes. Same y as
        # the corner indicators just above (53, not the old 55) -- these
        # three pieces are meant to read as one row, so they share one line.
        self.ov_count_hint = label.Label(terminalio.FONT, text="", color=C_GREY)
        self.ov_count_hint.anchor_point = (0.5, 0.5)
        self.ov_count_hint.anchored_position = (W // 2, 53)
        group.append(self.ov_count_hint)
        self._dim_widgets.append((self.ov_count_hint, 'color'))

        # No "LOCK TIMER" title here anymore -- purely decorative label with
        # no function of its own; the clock and button already say what this
        # screen is for. Cut for the same minimalism pass as the hint lines
        # below.
        # scale=4, not 3: now that this label only ever shows H:MM (fmt_hm,
        # see set_clock/set_clock_text) instead of H:MM:SS, its widest text
        # ("9:59", 4 chars) at scale=4 is 4*6*4 = 96px -- narrower than the
        # old "9:59:59" (7 chars) was even at scale=3 (126px), so there's
        # room to size it up.
        # Moved up from 150 (with the guides/hint/nav_hint below it also
        # shifted up by the same 30px) to open up the tight gap that used to
        # sit between nav_hint and the LOCK/OPEN button, and give the whole
        # screen more even vertical rhythm instead of a big gap above the
        # clock and a cramped cluster below it.
        # Surface card behind the clock, matching the digital/elapsed
        # clock-view styles (RADIUS_CARD, C_SURFACE fill, C_GREY outline) --
        # every OTHER clock face on this device sits in one of these; this
        # was the one screen where the digits floated on bare background
        # with no card, an inconsistency once the other views had it.
        # Smaller (fh=60, not 70) and un-hilited to fit this screen's
        # tighter gap to the H/M guides right below without touching them.
        _clk_fh = 60
        self._clk_bg = RoundRect(12, 120 - _clk_fh // 2, W - 24, _clk_fh, RADIUS_CARD,
                                 fill=C_SURFACE, outline=C_GREY, stroke=2)
        group.append(self._clk_bg)
        self._surface_widgets.append((self._clk_bg, 'fill'))
        self._dim_widgets.append((self._clk_bg, 'outline'))

        self.clock = label.Label(terminalio.FONT, text="0:00", color=C_WHITE,
                                 scale=4)
        self.clock.anchor_point = (0.5, 0.5)
        self.clock.anchored_position = (W // 2, 120)
        group.append(self.clock)
        # Was never in a theme registry -- only recolored by the
        # show_idle/show_running/show_closed calls below, so switching to
        # light mode while sitting on this screen left these digits white
        # (invisible) on the new light background until the next state
        # change happened to call one of those. Registering it here means
        # set_theme keeps it correct immediately, regardless of state.
        self._fg_widgets.append((self.clock, 'color'))

        # column guides: swipe over H / M to change that unit. Seconds were
        # dropped from the box's own editing UI (still shown live in the
        # running countdown -- see LockController.update's fmt_hms(left)) --
        # a two-way split reads clearer at this width than the old 3-way one.
        # x-positions are derived from the clock label's own geometry (scale
        # 4 -> 24px/glyph, "H:MM" is 4 glyphs wide, centered on W//2), not
        # independently chosen quarter-points -- H centers over the hour
        # digit itself, M centers over the two-digit minutes group, so each
        # guide sits directly above the column it actually adjusts.
        _clock_char_w = 6 * 4
        _clock_left = W // 2 - 2 * _clock_char_w  # left edge of "H:MM"'s 4 glyphs
        _hour_digit_cx = _clock_left + _clock_char_w // 2
        _minutes_cx = _clock_left + 2 * _clock_char_w + _clock_char_w
        # scale=1, not the old 2 -- these are labels for the columns they
        # select, not a second readout competing with the clock card above
        # them for attention, so they take the kit's secondary-caption
        # weight (build_hint / the nav row below are both scale 1, dim)
        # instead of the card-value scale that made two bare letters read as
        # stray glyphs floating under the card.
        # y=186, not the old 168: was the gap the manager flagged -- a large
        # dead band between this row and the nav caption at 205 (only 37px
        # apart from a fixed y=168, all of it empty). The clock's surface
        # card (fh=60, centered on the clock's own y=120) bottom edge is at
        # 150, so 186 still clears it (now a deliberate ~30px breathing gap
        # under the card, not a stray leftover one just above the nav row)
        # while closing the nav gap to a real 19px -- both this screen's
        # gaps to its neighbours are now close to the same size instead of
        # one being twice the other.
        self.guide_h = label.Label(terminalio.FONT, text="H", color=C_GREY)
        self.guide_m = label.Label(terminalio.FONT, text="M", color=C_GREY)
        for g, gx in ((self.guide_h, _hour_digit_cx), (self.guide_m, _minutes_cx)):
            g.anchor_point = (0.5, 0.5)
            g.anchored_position = (gx, 186)
            group.append(g)
            self._dim_widgets.append((g, 'color'))

        # No separate "swipe up/down on H M" caption either -- the H/M
        # letters now sit precisely on their own digit columns, which is
        # itself the instruction; a redundant sentence restating it in the
        # same grey, same size, right below was exactly the kind of "every
        # element has equal weight" clutter that made this screen feel busy.
        # Real chevron affordances (lock_ui_kit.build_nav_left/right) in
        # place of the old ASCII "<- clock   battery ->" caption -- the same
        # replacement the clock and battery screens already made (see
        # ClockMixin._clock_footer / PanelsMixin._build_battery), so "there
        # is a screen that way" looks identical everywhere on the box.
        # "clock", not "styles" -- "styles" assumes the reader already knows
        # the clock view has multiple appearances; "clock" names the actual
        # destination screen.
        # y=205, explicitly NOT the kit's own NAV_Y=306 -- this is the one
        # screen where the footer nav row can't live at the shared y: the
        # LOCK/OPEN button occupies the bottom of this screen (BTN_Y = H -
        # BTN_H - 24 = 240), and 306 would sit on top of it. 205 is this
        # screen's own pre-existing nav row, kept exactly where it was so
        # only the caption's rendering changes, not its position. No
        # `self.` attribute for either piece -- nothing else on this screen
        # reads them back, same as the clock/battery footers.
        nav_l_chev, nav_l_lbl = build_nav_left("clock", y=205)
        group.append(nav_l_chev)
        self._dim_widgets.append((nav_l_chev, 'fill'))
        group.append(nav_l_lbl)
        self._dim_widgets.append((nav_l_lbl, 'color'))
        nav_r_lbl, nav_r_chev = build_nav_right(W, "battery", y=205)
        group.append(nav_r_lbl)
        self._dim_widgets.append((nav_r_lbl, 'color'))
        group.append(nav_r_chev)
        self._dim_widgets.append((nav_r_chev, 'fill'))
        # Bottom view-position dots (ThemeMixin._add_view_dots). This screen's
        # chevrons sit at y=205 because the LOCK/OPEN button owns the bottom,
        # but the dots stay at the shared VIEW_DOTS_Y=312 like every other
        # screen's -- an indicator that moved between screens would be worse
        # than none, and 312 is clear of the button (BTN_Y=240 + BTN_H=56 ends
        # at 296). It also stays clear in the done state, where the button
        # springs UP to DONE_BTN_CENTER_Y rather than down.
        self._add_view_dots(group, W)
        # Reverted the third caption line added here (an override-discovery
        # hint) -- three stacked grey hint lines plus a title all reading at
        # the same visual weight made this screen feel cluttered rather than
        # more helpful. Cutting text instead of adding more of it.

        # big animated message for the done state -- fixed "success" color
        # Moved up from the old y=150 to DONE_MSG_Y (lock_config.py) -- the
        # button now springs up into the vertical center of this screen on
        # unlock (see below), which is exactly where this message used to
        # sit; this clears that space for the button instead of overlapping.
        self.big_msg = label.Label(terminalio.FONT, text="UNLOCKED", color=C_GREEN,
                                   scale=2)
        self.big_msg.anchor_point = (0.5, 0.5)
        self.big_msg.anchored_position = (W // 2, DONE_MSG_Y)
        self.big_msg.hidden = True
        group.append(self.big_msg)
        self._done_msg_base = self.big_msg.anchored_position

        # start/stop button -- fill follows the app's accent (see set_theme);
        # it never carries lock-status meaning (always the "primary action"
        # color regardless of state), which is why it's the one live element
        # accent is allowed to touch
        self.BTN_W = 130
        self.BTN_H = 56
        self.BTN_X = (W - self.BTN_W) // 2
        self.BTN_Y = H - self.BTN_H - 24
        # outline was a fixed fg C_WHITE (near-black in light mode) stroke on
        # top of an already-saturated accent fill -- a saturated fill AND a
        # heavy contrasting stroke together made this the loudest thing on
        # the box (manager report). The fill is correct and load-bearing (it
        # IS the primary-action signal), so only the outline changes: it now
        # tracks _accent_widgets instead of _fg_widgets, so set_theme paints
        # it the same accent as the fill, and set_button (lock_ui_states.py)
        # keeps the two in lockstep on every state change. Same precedent as
        # an ON switch's track outline (lock_ui_widgets.build_switch_track's
        # docstring) -- matching the outline to the fill exactly makes the
        # stroke vanish on this display's no-anti-aliasing renderer, so the
        # button reads as one solid accent pill instead of a pill wearing a
        # separate white collar. C_GREEN here is the same construction-time
        # placeholder every other themed fill/outline in this module uses.
        self.button = RoundRect(self.BTN_X, self.BTN_Y, self.BTN_W, self.BTN_H,
                                RADIUS_BTN_LG, fill=C_GREEN, outline=C_GREEN, stroke=2)
        group.append(self.button)
        self._accent_widgets.append((self.button, 'outline'))
        # Press-feedback ring for the button (see on_touch_down/on_touch_up)
        # -- appended between the button and its label for the same z-order
        # reason as status_press_ring above: the label must always paint on
        # top of the ring's stroke. A plain outline drawn OVER the button,
        # shown/hidden only, never touching the button's own `.fill` -- that
        # color is actively managed by set_button as the state machine
        # transitions, and a ring that only toggles .hidden can never race
        # with or clobber a legitimate state-color change on release.
        # RoundRect, not Rect -- a sharp-cornered outline drawn 3px outside a
        # rounded button read as a mismatched box around it (manager-reported
        # visual bug). radius = RADIUS_BTN_LG + 3 is the concentric offset: a
        # rounded rect's corner is a quarter-circle of radius r centered
        # 3px in from each edge, so pushing the outline out by the same 3px
        # the ring is already offset by grows that same corner's radius by
        # exactly 3, keeping the ring and the button's edge genuinely
        # parallel instead of visually not matching. status_press_ring above
        # already gets this right (RoundRect, not Rect) -- this was the one
        # remaining plain-Rect press ring in the file.
        self.button_press_ring = RoundRect(self.BTN_X - 3, self.BTN_Y - 3,
                                           self.BTN_W + 6, self.BTN_H + 6,
                                           RADIUS_BTN_LG + 3,
                                           fill=None, outline=C_WHITE, stroke=3)
        self.button_press_ring.hidden = True
        group.append(self.button_press_ring)
        # color is a placeholder -- set_theme() (called once every widget is
        # built, see __init__'s tail) immediately overwrites this per mode.
        self.btn_label = label.Label(terminalio.FONT, text="LOCK", color=C_ON_ACCENT_DARK,
                                     scale=2)
        self.btn_label.anchor_point = (0.5, 0.5)
        self.btn_label.anchored_position = (W // 2, self.BTN_Y + self.BTN_H // 2)
        group.append(self.btn_label)
        self._btn_label_rest_pos = self.btn_label.anchored_position
        # Unlock animation, take 2 (manager rejected the ring reveal outright):
        # the OPEN button itself springs from its normal bottom rest position
        # up to the screen's center on unlock, using the SAME Spring physics
        # already used for _done_pop/_ovr_pop/press-depth above -- not a new
        # motion primitive, per this project's "extend the existing spring
        # pattern, don't fork a new one" convention. _btn_move.value IS the
        # button's live top-left y (not an offset added to a fixed base, like
        # the other two springs) so a single spring drives both the button
        # and its label with no separate bookkeeping. Starts settled at rest.
        self._btn_move = Spring(SPRING_STIFFNESS, SPRING_DAMPING, SPRING_MASS)
        self._btn_move.displace(self.BTN_Y, self.BTN_Y)
        self._done_btn_top_y = DONE_BTN_CENTER_Y - self.BTN_H // 2

    # ----- touch-down/up feedback (control view only) -----
    # Every tap/swipe on this device is resolved on RELEASE, in
    # LockController._handle_release, so a finger landing on the button
    # (visible only in the done state -- see show_idle/show_closed/show_done)
    # or status bar previously got zero visual acknowledgement until the
    # whole gesture completed -- these two calls (wired from
    # LockController.process, purely additively) are the fix. The ring
    # visibility is gated by the press spring settling (see step_motion), not
    # a flat show/hide, so the sink-in and spring-back are both visible --
    # they only ever move .y/.anchored_position, never a widget's .fill/
    # .color, so this can't race with a legitimate state-color change (direct
    # or via the color-transition engine above).
    def on_touch_down(self, x, y):
        if self.view != "control":
            return
        # Bases below are FIXED for the duration of a single press, captured
        # once at THIS press's touch-down -- never re-read mid-press. A rapid
        # re-tap (or a chattering touch controller re-firing this before the
        # previous press-depth spring had settled back to 0) used to capture
        # whatever offset position the widget was CURRENTLY at as the new
        # "base" -- since step_motion always adds the spring's offset on top
        # of that base, every such re-tap baked in the previous frame's
        # residual offset, and the button/status text visibly walked away
        # from its true position a little further with each rapid tap
        # (reported as the on-screen text "shaking all over the screen"
        # under repeated pressing). _begin_press's own _finish_press() call
        # below resets any such residual offset before this capture happens,
        # so reading a "live" value here is safe and gives the same
        # single-true-rest-point guarantee as the old always-BTN_Y constant.
        #
        # The button (unlike the status bar) no longer has one universal
        # rest y -- it can legitimately be at the bottom (LOCK/idle), sprung
        # to the screen's center (done, see _btn_move below), or momentarily
        # mid-flight between the two -- so its press-dip base is captured
        # live at press-time instead of the old build-time BTN_Y constant.
        # The independent _btn_move spring keeps driving the button's actual
        # rest position in the background regardless of this press, so it
        # simply resumes control on the next frame after release.
        if self.in_button(x, y) and not self.button.hidden:
            btn_y = self.button.y
            self._begin_press(self.button_press_ring, (
                (self.button_press_ring, 'y', btn_y - 3),
                (self.button, 'y', btn_y),
                (self.btn_label, 'label', (self._btn_label_rest_pos[0],
                                            btn_y + self.BTN_H // 2)),
            ))
        elif self.in_status(x, y):
            self._begin_press(self.status_press_ring, (
                (self.status_press_ring, 'y', self._status_ring_rest_y),
                (self.status_bar, 'y', self.STATUS_Y),
                (self.status_lbl, 'label', self._status_lbl_rest_pos),
            ))

    def on_touch_up(self):
        if self._press_targets:
            self._press_spring.to(0.0)

    def _begin_press(self, ring, targets):
        self._finish_press()   # snap any in-flight press back to rest first,
                                # so a fast re-tap elsewhere can't leave the
                                # previous widget stuck off its base position
        self._press_ring = ring
        self._press_ring.hidden = False
        self._press_targets = targets
        self._press_spring.displace(0.0, PRESS_DEPTH_PX)

    def _finish_press(self):
        for obj, kind, base in self._press_targets:
            if kind == 'y':
                obj.y = base
            else:
                obj.anchored_position = base
        if self._press_ring is not None:
            self._press_ring.hidden = True
        self._press_targets = ()
        self._press_ring = None

    # ----- per-frame motion step -- called from LockController.update() every
    # run-loop iteration (~50Hz while awake), same tier as
    # step_color_transitions. Cheap when idle: each block below is a no-op
    # once its spring has settled, so a session with no active press/pop
    # costs a handful of float comparisons per frame, nothing more.
    def step_motion(self, dt):
        # This whole method is purely cosmetic (press-feedback dips, success/
        # override pops) -- nothing here should ever be able to take down the
        # run loop that also drives the servo/timer/touch, but an uncaught
        # exception here previously did exactly that (observed on device).
        # lock_motion.Spring now guards its own math against going non-finite,
        # which was the identified cause; this try/except is the last-resort
        # backstop for anything else in this per-frame hot path, since the
        # cost of a skipped animation frame is invisible but the cost of a
        # crashed lock/timer is not. Press state is reset to a known-good
        # rest position on failure rather than left mid-animation.
        try:
            self._step_motion(dt)
        except Exception:
            self._finish_press()

    def _step_motion(self, dt):
        # Position-tween engine (lock_ui_settings.SettingsMixin.
        # step_pos_tweens, lock_ui.py's _pos_tweens comment) -- driven from
        # here rather than a new call in LockController.update() so it
        # inherits step_motion's try/except backstop above for free, same
        # reasoning as every other per-frame motion block in this method.
        self.step_pos_tweens()

        if self._press_targets:
            offset = _clamp_offset(self._press_spring.step(dt))
            for obj, kind, base in self._press_targets:
                if kind == 'y':
                    obj.y = base + int(round(offset))
                else:
                    bx, by = base
                    obj.anchored_position = (bx, by + int(round(offset)))
            if self._press_spring.settled and self._press_spring.target == 0.0:
                self._finish_press()

        if not self.big_msg.hidden and not self._done_pop.settled:
            v = _clamp_offset(self._done_pop.step(dt))
            bx, by = self._done_msg_base
            self.big_msg.anchored_position = (bx, by + int(round(v)))

        if not self._ovr_pop.settled:
            v = _clamp_offset(self._ovr_pop.step(dt))
            bx, by = self._ovr_count_base
            self.ov_count.anchored_position = (bx, by + int(round(v)))

        # Unlock animation, take 2: the OPEN button springing to/from the
        # screen's center. Runs unconditionally whenever not settled, same
        # gating style as _done_pop/_ovr_pop above -- cheap once settled (one
        # float comparison), and this is exactly the fix for the reported
        # touch-freeze: a single small widget's .y changing, never a
        # full-screen redraw, and it never blocks -- see show_done/
        # _reset_button_position for what starts/stops it.
        # Deliberately deferred to the press-dip above while the button is
        # actively being pressed (self._press_ring is self.button_press_ring)
        # -- both blocks would otherwise fight over self.button.y on the same
        # frame. Resumes the instant the press ends (_finish_press clears
        # _press_ring), since the spring itself keeps advancing regardless.
        if not self._btn_move.settled and self._press_ring is not self.button_press_ring:
            y = int(round(self._btn_move.step(dt)))
            self.button.y = y
            self.button_press_ring.y = y - 3
            bx, _ = self._btn_label_rest_pos
            self.btn_label.anchored_position = (bx, y + self.BTN_H // 2)
