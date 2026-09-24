# lock_controller_states.py -- the box state machine: every go_* transition, and the log flush that follows one.
#
# One of the mixins LockController is composed from; see lock_controller.py's
# header for why the class is split this way. Every method here runs as a
# method OF LockController -- `self` is the whole controller, and the
# attributes are the ones its __init__ creates.

from lock_controller_const import COMPLETED


class StateMixin:
    # ----- state transitions -----
    def go_idle(self):
        self._flush_pending_log()
        self._clear_override()
        self.state = "idle"
        self.release_lock()
        self.ui.show_idle(self.set_seconds)

    def go_picking(self, now):
        """Pre-session tag picker (best-effort custom-label sync -- see
        apply_ble_labels_json): shown before the countdown actually starts,
        from the LOCK tap in idle/closed, so the chosen topic can ride along
        in the session's log entry. See _handle_release's "picking" branch
        for the tap/swipe handling on this screen."""
        self._picking_from = self.state   # "idle" or "closed" -- see
                                           # _apply_tag_picker_result's Cancel
                                           # handling below, which must return
                                           # to whichever one was actually true
                                           # rather than assume idle (closed
                                           # means the lid sensor already
                                           # latched the servo; cancelling
                                           # must not lose that).
        self.state = "picking"
        self.tag_picker.show(0)

    def go_confirming(self, now, name):
        """Pre-session CONFIRM/CHANGE screen (see lock_topic_confirm.py):
        shown INSTEAD of go_picking's tag picker when the LOCK-button branch
        in _handle_release finds self._pending_app_topic still resolves to
        a real topic. CONFIRM starts the session with that topic as-is;
        CHANGE falls through to the tag picker to pick something else --
        see _apply_topic_confirm_result.

        Sets self._picking_from exactly like go_picking does (same "idle" or
        "closed" -- which state to return to) even though this screen has no
        swipe-cancel gesture of its own: CHANGE's fallthrough to the picker
        still needs it, and _apply_topic_confirm_result's Change branch
        restores self.state to this BEFORE calling go_picking, so
        go_picking's own `self._picking_from = self.state` line doesn't
        instead capture "confirming"."""
        self._picking_from = self.state
        self.state = "confirming"
        self.topic_confirm.show(name)

    def go_running(self, now, topic=None):
        # Chokepoint for leaving either pre-session screen (tag picker or
        # topic-confirm) -- done here, at the very top, UNCONDITIONALLY,
        # even ahead of the set_seconds<=0 guard below (that guard should
        # never actually fire in practice; MIN_SECONDS floors set_seconds
        # everywhere it's settable -- but if it somehow did, this still
        # can't leave a pending topic stuck live or a pre-session screen
        # stuck on screen). One chokepoint covers both the direct CONFIRM
        # path and the CONFIRM -> CHANGE -> pick-something-else path (which
        # re-enters here via the tag picker's own Select result) -- neither
        # needs its own separate cleanup call.
        self._pending_app_topic = None
        self.ui.hide_tag_picker()      # no-op if the picker was never shown
        self.ui.hide_topic_confirm()   # no-op if the confirm screen was never shown
        if self.set_seconds <= 0:
            return
        self.state = "running"
        self._override = 0
        self.deadline = now + self.set_seconds
        self._session_topic = topic
        self.engage_lock()
        self.ui.show_running()
        # While actually locked, the clock view (analog/digital/ring/elapsed
        # -- its own styles, still reachable via the vertical swipe) is the
        # only screen available; the control/battery/settings views are
        # blocked in _handle_release's horizontal-swipe branch below until
        # go_done returns to "control". Force onto it now rather than
        # leaving whatever view (always "control" -- LOCK is only reachable
        # from there) was showing when LOCK was tapped.
        self.set_view("clock")

    def go_closed(self, now):
        # lid closed (sensor): servo latches; user picks a time then taps LOCK.
        # No countdown yet -- that begins when LOCK is pressed (go_running).
        self._flush_pending_log()
        self._clear_override()
        self.state = "closed"
        self.engage_lock()
        self.ui.show_closed()
        self.ui.set_clock(self.set_seconds)
        if self.view != "control":
            self.set_view("control")

    def go_done(self, now, outcome=COMPLETED, force_open=False):
        # Only a countdown that actually ran is a session -- go_done can also
        # be reached from "closed" (override/remote-unlock before LOCK was
        # ever pressed), which has no elapsed time worth logging.
        opens_now = self.settings.auto_open or force_open
        if self.state == "running":
            lock_start = self.deadline - self.set_seconds
            if opens_now:
                actual_s = max(0.0, now - lock_start)
                self.log.record(self.set_seconds, actual_s, outcome == COMPLETED,
                                 self.wall_time(now), now)
            else:
                # Box stays shut until OPEN is tapped (or override forces it
                # from that holding state -- see press_override) -- the
                # session isn't over yet, so don't log a truncated actual_s
                # at timer-expiry. Recorded once actually opened, using total
                # elapsed time from lock start to that moment (see
                # _flush_pending_log).
                self._pending_log = (self.set_seconds, lock_start,
                                      outcome == COMPLETED)
        self._clear_override()
        self.state = "done"
        self.done_start = now
        self._done_force_open = force_open
        if opens_now:
            self.release_lock()          # auto-open (or forced): servo releases now
        else:
            # Stay shut: re-drive the latch and hold it, with no relax, until
            # OPEN is tapped. Two lines, not one -- _servo_relax_at = None
            # alone silently also turned OFF update()'s servo.reassert(),
            # which is gated on that same attribute, in the single state
            # where the PWM keeps running long enough for a CPU-frequency
            # change to shift it (see update()'s servo block and
            # lock_servo.reassert). _servo_hold says "keep driving" without
            # claiming a relax deadline; engage_lock above clears it, so it
            # has to be set after, not before.
            self.engage_lock()
            self._servo_relax_at = None
            self._servo_hold = True
        self.ui.show_done(opens_now)
        if self.view != "control":  # return to control so the unlock anim shows
            self.set_view("control")

    def _flush_pending_log(self):
        """Records a deferred auto-open-off session the moment the box is
        actually opened (go_idle -- OPEN tap or override, see press_override)
        or defensively on any other exit from the "done, not yet opened"
        holding state (go_closed), so a session's data is never silently
        dropped even on an unusual path out of that state."""
        if self._pending_log is None:
            return
        planned_s, lock_start, completed = self._pending_log
        self._pending_log = None
        actual_s = max(0.0, self._now - lock_start)
        self.log.record(planned_s, actual_s, completed, self.wall_time(self._now), self._now)
