# lock_ui.py -- builds the displayio scenes and exposes display helpers.
# Two views: "control" (set/start/stop) and "clock" (countdown dial).
import math
import time
import displayio
import terminalio
import bitmaptools
from adafruit_display_text import label
from adafruit_display_shapes.roundrect import RoundRect
from adafruit_display_shapes.rect import Rect
from adafruit_display_shapes.circle import Circle
from adafruit_display_shapes.triangle import Triangle

from lock_config import (
    C_BG, C_SURFACE, C_SURFACE_HILITE, C_WHITE, C_BLACK, C_GREY, C_GREEN, C_RED, C_AMBER,
    C_ON_ACCENT_DARK, C_ON_ACCENT_LIGHT,
    C_ALERT_RED, C_ALERT_AMBER,
    MODE_COLORS, ACCENT_COLORS_DARK, ACCENT_COLORS_LIGHT, DEFAULT_MODE_IDX, DEFAULT_ACCENT_IDX, fmt_hms, fmt_hm, clamp,
    RADIUS_CARD, RADIUS_BTN_SM, RADIUS_BTN_LG, STATUS_TRANSITION_S, lerp_color,
    SPRING_STIFFNESS, SPRING_DAMPING, SPRING_MASS, PRESS_DEPTH_PX,
    DONE_POP_OFFSET_PX, OVR_POP_OFFSET_PX, DONE_MSG_Y, DONE_BTN_CENTER_Y,
    NATIVE_ROTATION,
)
from lock_motion import Spring


def _bg_tile(w, h, color):
    bmp = displayio.Bitmap(w, h, 1)
    pal = displayio.Palette(1)
    pal[0] = color
    return displayio.TileGrid(bmp, pixel_shader=pal)


# Hard ceiling on any spring-driven position offset actually applied to a
# widget, in _step_motion below -- independent of whatever is or isn't wrong
# further upstream in lock_motion.Spring's math. The largest INTENDED
# amplitude among the three springs that use this (press-depth 3px, override
# pop 8px, done-message pop 16px -- lock_config.py) is 16px; this leaves
# room for a legitimate slight spring overshoot past its target without ever
# letting a widget visibly fly across the screen, regardless of the cause.
_MAX_MOTION_OFFSET_PX = 40


def _clamp_offset(v):
    if v > _MAX_MOTION_OFFSET_PX:
        return _MAX_MOTION_OFFSET_PX
    if v < -_MAX_MOTION_OFFSET_PX:
        return -_MAX_MOTION_OFFSET_PX
    return v


class LockUI:
    def __init__(self, display):
        self.display = display
        self.W = W = display.width
        self.H = H = display.height
        # Whether the call-alert overlay currently owns the display -- see
        # show_call_alert/hide_call_alert/show_view.
        self._call_alert_active = False
        # The display's native orientation -- NATIVE_ROTATION (lock_config.py)
        # is a hardcoded constant verified against this board's own
        # CircuitPython board.c, not a value read off display.rotation.
        # board.DISPLAY can be a supervisor-owned singleton that outlives a
        # soft reload, and -- per the 2026-08-25 manager report -- touch
        # mapping was still wrong even after a genuine full power-cycle test,
        # which means display.rotation at construction time is not a
        # trustworthy "was this actually native" signal even with a
        # run_reason-based fresh-boot check (a prior attempt at exactly that
        # heuristic is what this replaces). Trusting the known-correct
        # constant instead of trying to detect/recover it eliminates that
        # whole class of bug outright.
        self._base_rotation = NATIVE_ROTATION

        # ----- theme-tracking registries, populated by the _build_* calls
        # below (see set_theme). Bucketed by role, not by widget type, so
        # set_theme can walk them uniformly; the call_alert overlay is
        # deliberately never registered here -- an incoming-call alarm stays
        # full-intensity red/amber regardless of the chosen theme.
        self._bg_tiles = []            # TileGrid backgrounds (.pixel_shader[0])
        self._surface_widgets = []     # (obj, attr) tracking the "surface" color
        self._fg_widgets = []          # (obj, attr) tracking the "fg" (readable-on-bg) color
        self._dim_widgets = []         # (obj, attr) tracking the "dim" (secondary) color
        self._accent_widgets = []      # (obj, attr) tracking the chosen accent color --
        # settings values and the elapsed-clock time text, same accent the
        # LOCK/OPEN button and analog second hand already use, so a chosen
        # accent is actually visible there instead of every accent looking
        # identical on those two screens.
        # corner status glyphs (one pair per view that has them -- control +
        # the 3 clock styles) so battery/BLE state is glanceable without
        # swiping to the dedicated battery view. See update_corner_battery /
        # update_corner_ble.
        self._corner_ble_dots = []
        self._corner_bat_labels = []
        self._mode_idx = DEFAULT_MODE_IDX
        self._accent_idx = DEFAULT_ACCENT_IDX
        self._fg_color = C_WHITE
        self._dim_color = C_GREY
        self._accent_color = C_GREEN

        # ----- color-transition engine (see _start_color_transition /
        # step_color_transitions below) -- displayio has no alpha blending,
        # but a shape's .fill/.color setter is a cheap single-palette-entry
        # write with no bitmap reallocation (verified against
        # adafruit_display_shapes' RoundRect source), so lerping a widget's
        # RGB value across a handful of frames is a real, hardware-safe
        # motion technique distinct from an alpha cross-fade. Reserved for
        # "state indication" transitions (status bar, clock-view active
        # color) -- never for the override-timeout or battery bars, whose
        # width IS the literal remaining value; easing those would show a
        # number of seconds/percent that isn't the true one.
        self._color_transitions = []   # [obj, attr, from_color, to_color, start_time]
        self._an_active_target = None
        self._dig_active_target = None
        self._rg_active_target = None
        self._el_active_target = None

        # ----- position-spring motion (see lock_motion.Spring / step_motion
        # below) -- a complement to the color-transition engine above, not an
        # overlap: these move .y / .anchored_position, never .fill/.color, so
        # the two systems can never race on the same attribute.
        self._press_spring = Spring(SPRING_STIFFNESS, SPRING_DAMPING, SPRING_MASS)
        self._press_targets = ()   # ((obj, 'y'|'label', base), ...) currently offset
        self._press_ring = None
        self._done_pop = Spring(SPRING_STIFFNESS, SPRING_DAMPING, SPRING_MASS)
        self._ovr_pop = Spring(SPRING_STIFFNESS, SPRING_DAMPING, SPRING_MASS)

        self._build_control(W, H)

        # clock view has several swappable appearances (swipe up/down)
        self.clock_styles = ["analog", "digital", "ring", "elapsed"]
        self.clock_style_idx = 0
        self.clock_groups = []
        self._build_clock_analog(W, H)
        self._build_clock_digital(W, H)
        self._build_clock_ring(W, H)
        self._build_clock_elapsed(W, H)
        self._build_battery(W, H)
        self._build_call_alert(W, H)
        self._build_override(W, H)
        self._build_settings(W, H)
        self._build_setting_detail(W, H)
        self._build_tag_picker(W, H)
        self._build_topic_confirm(W, H)

        self.view = "control"
        display.root_group = self.control_group

        # apply the compiled-in default theme now that every widget above has
        # registered itself; LockController re-applies the persisted theme
        # (if different) right after this once Settings() has loaded.
        self.set_theme(DEFAULT_MODE_IDX, DEFAULT_ACCENT_IDX)

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

        self._add_corner_indicators(group, W, y=55)

        # Small override-press-count indicator -- not a sentence explaining
        # what override is (that was the clutter just cut above), just the
        # configured number itself, in the empty center of the BLE-dot/
        # battery-% row so it doesn't cost this screen a new row. "x" (ASCII),
        # not "x" unicode multiplication sign -- terminalio.FONT's glyph set
        # isn't guaranteed to cover non-ASCII. Kept live via update_settings,
        # the same call every settings-change path already makes.
        self.ov_count_hint = label.Label(terminalio.FONT, text="", color=C_GREY)
        self.ov_count_hint.anchor_point = (0.5, 0.5)
        self.ov_count_hint.anchored_position = (W // 2, 55)
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
        # y=168, not 156: the clock's surface card (fh=60, centered on the
        # clock's own y=120) bottom edge is at 150 -- 156 put these scale-2
        # labels (~16px tall, so spanning roughly 148-164) overlapping the
        # card's bottom edge. 168 clears it with real margin, still well
        # short of nav_hint at 205.
        self.guide_h = label.Label(terminalio.FONT, text="H", color=C_GREY, scale=2)
        self.guide_m = label.Label(terminalio.FONT, text="M", color=C_GREY, scale=2)
        for g, gx in ((self.guide_h, _hour_digit_cx), (self.guide_m, _minutes_cx)):
            g.anchor_point = (0.5, 0.5)
            g.anchored_position = (gx, 168)
            group.append(g)
            self._dim_widgets.append((g, 'color'))

        # No separate "swipe up/down on H M" caption either -- the H/M
        # letters now sit precisely on their own digit columns, which is
        # itself the instruction; a redundant sentence restating it in the
        # same grey, same size, right below was exactly the kind of "every
        # element has equal weight" clutter that made this screen feel busy.
        # always-visible navigation hint. "clock", not "styles" -- "styles"
        # assumes the reader already knows the clock view has multiple
        # appearances; "clock" names the actual destination screen.
        self.nav_hint = label.Label(terminalio.FONT, text="<- clock   battery ->",
                                    color=C_GREY)
        self.nav_hint.anchor_point = (0.5, 0.5)
        self.nav_hint.anchored_position = (W // 2, 205)
        group.append(self.nav_hint)
        self._dim_widgets.append((self.nav_hint, 'color'))
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
        self.button = RoundRect(self.BTN_X, self.BTN_Y, self.BTN_W, self.BTN_H,
                                RADIUS_BTN_LG, fill=C_GREEN, outline=C_WHITE, stroke=2)
        group.append(self.button)
        self._fg_widgets.append((self.button, 'outline'))
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
        self.set_vals[2].text = "{}s".format(s.sleep_s)
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
        "screen sleep timeout (sec)",
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
            return "{}s".format(s.sleep_s)
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

    # =================== hit testing ===================
    def in_button(self, x, y):
        # Reads the button's LIVE y, not the build-time BTN_Y constant --
        # the button now moves (see _btn_move/show_done), and a tap must hit
        # wherever it actually is on screen right now (rest, sprung to
        # center, or mid-flight between the two), not where it started.
        return (self.BTN_X <= x <= self.BTN_X + self.BTN_W and
                self.button.y <= y <= self.button.y + self.BTN_H)

    def in_status(self, x, y):
        return (8 <= x <= self.W - 8 and
                self.STATUS_Y <= y <= self.STATUS_Y + self.STATUS_H)

    # =================== control setters ===================
    def set_status(self, text, color):
        # Text swaps instantly (a glyph cross-fade isn't achievable without
        # alpha, and isn't desirable anyway -- the label IS the information,
        # not decoration). The card's fill eases via the color-transition
        # engine instead of snapping -- see step_color_transitions.
        self.status_lbl.text = text
        self._start_color_transition(self.status_bar, 'fill', color)

    def set_button(self, text, color):
        self.btn_label.text = text
        self.button.fill = color

    def set_clock(self, secs):
        # Home screen only -- no seconds (see fmt_hm's docstring); the clock
        # view's own styles still show full H:MM:SS via fmt_hms.
        self.clock.text = fmt_hm(secs)

    def set_clock_text(self, text):
        self.clock.text = text

    def _idle_widgets(self, visible):
        for w in (self.guide_h, self.guide_m):
            w.hidden = not visible

    # =================== whole-screen states ===================
    def _show_button(self, visible):
        self.button.hidden = not visible
        self.btn_label.hidden = not visible

    def show_idle(self, secs):
        self.clock.hidden = False
        self._clk_bg.hidden = False
        self.set_clock(secs)
        self.big_msg.hidden = True
        self._reset_button_position()
        self._idle_widgets(True)
        self.set_status("UNLOCKED", C_GREEN)
        # Visible LOCK button -- restores the on-screen affordance for
        # starting a lock; also resets the label away from "OPEN" (set by
        # show_done) since set_button is otherwise never called again here.
        self.set_button("LOCK", self._accent_color)
        self._show_button(True)

    def show_running(self):
        self.clock.hidden = False
        self._clk_bg.hidden = False
        self.big_msg.hidden = True
        self._reset_button_position()
        self._idle_widgets(False)
        self.set_status("LOCKED", C_RED)
        self._show_button(False)          # no on-screen cancel; override only

    def show_closed(self):
        # lid closed but not yet timed: pick a time, then tap LOCK to start
        self.clock.hidden = False
        self._clk_bg.hidden = False
        self.big_msg.hidden = True
        self._reset_button_position()
        self._idle_widgets(True)          # show H/M guides so time is selectable
        self.set_status("CLOSED", C_AMBER)
        self.set_button("LOCK", self._accent_color)
        self._show_button(True)

    def show_done(self, auto_open=True):
        self.clock.hidden = True
        self._clk_bg.hidden = True
        self.big_msg.hidden = False
        # The single highest-payoff moment on the device -- spring the
        # message up into place (unchanged from before), while the OPEN
        # button itself is now the primary unlock animation: it springs from
        # its normal bottom rest position up to the screen's center (see
        # _btn_move in _build_control / step_motion). Snap-then-target (not
        # just `.to`) so every unlock replays the move fresh from the true
        # bottom rest position, even if a previous done->idle transition
        # somehow left it mid-flight.
        self._done_pop.displace(DONE_POP_OFFSET_PX, 0.0)
        self._btn_move.displace(self.BTN_Y, self._done_btn_top_y)
        self.set_status("UNLOCKED", C_GREEN)
        # Shown regardless of auto_open: with auto_open on the servo already
        # released and this state self-dismisses after DONE_ANIM_S, but the
        # done-state tap region (LockController._handle_release) calls
        # go_idle() on tap either way, so the affordance stays visible.
        self.set_button("OPEN", self._accent_color)
        self._show_button(True)

    def _reset_button_position(self):
        # Called on every transition OUT of the done state (idle/running/
        # closed) so the button is back at its normal bottom rest position
        # for LOCK/normal use, never left mid-flight or centered. Snaps
        # immediately rather than springing back -- this is a state-entry
        # reset, not part of the unlock animation itself.
        #
        # BUG FIX: tapping OPEN to dismiss "done" is the ordinary, everyday
        # path into this method -- and the press-depth spring that tap just
        # started is still easing back to 0 (not yet settled) at the exact
        # moment _handle_release fires go_idle(), because release is
        # detected and acted on before the cosmetic press-dip has finished
        # animating. If that press is still in flight when this method
        # snaps the button back to BTN_Y, the very next _step_motion frame's
        # (still-active) press-dip block overwrites it right back to its
        # stale captured base -- wherever the button was CENTERED at when
        # the press began -- and once that dip settles, _finish_press()
        # leaves the button sitting at that stale centered position instead
        # of the bottom. This is the reported "button gets stuck in the
        # animation position" bug. Cancelling the in-flight press outright
        # (rather than letting it finish naturally) removes the stale base
        # before it can fight this reset.
        if self._press_ring is self.button_press_ring:
            self._press_targets = ()
            self._press_ring = None
            self.button_press_ring.hidden = True
            self._press_spring.value = 0.0
            self._press_spring.velocity = 0.0
            self._press_spring.target = 0.0
        self._btn_move.displace(self.BTN_Y, self.BTN_Y)
        self.button.y = self.BTN_Y
        self.button_press_ring.y = self.BTN_Y - 3
        bx, _ = self._btn_label_rest_pos
        self.btn_label.anchored_position = (bx, self.BTN_Y + self.BTN_H // 2)
