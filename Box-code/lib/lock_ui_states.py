# lock_ui_states.py -- what the control view shows in each box state -- idle, running, closed, done.
#
# One of the view mixins LockUI is composed from; see lock_ui.py's header for
# why the class is split this way and what that does and does not change.
# Every method here runs as a method OF LockUI -- `self` is the whole UI, and
# the attributes below are the ones lock_ui.py's __init__ creates.

from lock_config import C_GREEN, C_RED, C_AMBER, fmt_hm, DONE_POP_OFFSET_PX


class StateViewMixin:
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
