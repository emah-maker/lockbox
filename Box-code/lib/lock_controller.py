# lock_controller.py -- the timer state machine and gesture handling.
import gc
from lock_config import (
    MAX_SECONDS, MAX_HOURS, MIN_SECONDS, SWIPE_MIN_PX, DEFAULT_SECONDS,
    SWAP_XY, INVERT_X, INVERT_Y, CLOCK_FPS, SERVO_HOLD_S, OVERRIDE_PRESSES,
    OVERRIDE_TIMEOUT, DONE_ANIM_S, MIN_STEP, RELEASE_FRAMES,
    fmt_hm,
    BLE_CALL_ALERT_S, CALL_ALERT_BLINK_HZ,
    HOLD_REPEAT_DELAY, HOLD_REPEAT_START, HOLD_REPEAT_MIN, HOLD_REPEAT_RAMP,
    STATUS_TAP_COOLDOWN_S, BUILTIN_TOPICS,
)
import lock_protocol
from lock_battery import Battery
from lock_servo import Servo
from lock_settings import Settings
from lock_log import SessionLog
from lock_tag_picker import TagPicker, Select, Cancel
from lock_topic_confirm import TopicConfirm, Confirm, Change, find_topic

COMPLETED = "completed"
OVERRIDDEN = "overridden"

# ordered top-level views; horizontal swipe moves between them
VIEWS = ("clock", "control", "battery", "settings")
# Reachable while state == "running" (see _handle_release's horizontal-swipe
# branch) -- control/settings are blocked while actually locked, but battery
# should still be checkable without waiting for the countdown to finish.
LOCKED_VIEWS = ("clock", "battery")


class LockController:
    def __init__(self, ui, touch, i2c=None):
        self.ui = ui
        self.touch = touch
        self.state = "idle"
        self.set_seconds = DEFAULT_SECONDS
        self.deadline = 0.0
        self.done_start = 0.0
        self._was_down = False
        self._start = None
        self._last = None
        self._miss = 0
        self._now = 0.0
        self.view = "control"
        self._last_fkey = None
        self._last_bkey = None
        self.battery = Battery(i2c)
        self.servo = Servo()
        self.settings = Settings()
        self.ui.set_theme(self.settings.theme_mode, self.settings.accent_idx)
        # LockUI._base_rotation is NATIVE_ROTATION, a hardcoded constant
        # (lock_config.py) -- no runtime recovery step is needed here before
        # applying the persisted flip.
        self.ui.set_screen_flipped(self.settings.screen_flipped)
        # Previously only ever called on navigating to the settings view --
        # left the control view's small override-count indicator blank from
        # boot until the user happened to visit Settings first.
        self.ui.update_settings(self.settings)
        self.log = SessionLog()
        self._editing = False
        self._edit_idx = 0
        self._servo_relax_at = None
        self._servo_locked = False
        self._done_force_open = False    # set by go_done(force_open=True) --
                                          # an unlock that must take physical
                                          # effect regardless of Settings.auto_open
        self._override = 0
        self._override_at = 0.0
        # last time the status-bar tap-to-toggle actually fired go_idle()/
        # go_closed() -- see STATUS_TAP_COOLDOWN_S in lock_config.py. Seeded
        # negative so the very first real tap of a session is never blocked.
        self._last_status_toggle_at = -STATUS_TAP_COOLDOWN_S
        # settings detail-page [-]/[+] and swipe press-and-hold auto-repeat
        self._hold_dir = 0
        self._hold_next_at = 0.0
        self._hold_interval = 0.0
        # BLE companion state
        self._call_alert_until = None    # monotonic deadline for the call overlay
        self._call_alert_started = 0.0   # monotonic start, for the flash phase
        self._call_anim_on = None        # forces the first flash frame to draw
        self._call_event = False         # set by notify_call; consumed by code.py to wake the screen
        self._wall_epoch0 = None         # epoch pushed by the phone (time_sync)
        self._wall_mono0 = None          # monotonic at the moment of that push
        self._ble_connected = False      # drives the control/clock corner dot
        self._last_frame_t = None        # for step_motion's dt -- see update()
        # ----- pre-session tag picker + custom-label sync (best-effort) -----
        self._synced_labels = []   # [(id, name, color), ...] most recently
                                    # pushed by the app over BLE_UUID_LABELS --
                                    # see apply_ble_labels_json. `color` is a
                                    # fix()-applied int, same encoding as every
                                    # other color in lock_config.py, used for
                                    # this label's dot on the tag-picker row
                                    # (LockUI.show_tag_picker). The app still
                                    # separately resolves its own display/color
                                    # from its own customLabels list using the
                                    # id we echo back (ble_status_json's "tp"
                                    # field) -- this copy only drives the box's
                                    # own on-screen picker.
        # Owns the picker's own touch/hold/swipe state -- see
        # lock_tag_picker.TagPicker.on_touch, which go_picking/process/
        # _handle_release below drive with a single method call each.
        self.tag_picker = TagPicker(self.ui, self._all_topics)
        self._picking_from = "idle"  # "idle" or "closed" -- which state to
                                      # cancel back to from the tag picker
                                      # (see go_picking / _apply_tag_picker_
                                      # result's Cancel handling)
        self._session_topic = None  # topic tagged to the session in progress
                                     # (set by go_running's topic= argument)
        # ----- pre-session topic confirm (app-pushed pending topic) -----
        # Owns the confirm/change screen's own touch state -- see
        # lock_topic_confirm.TopicConfirm.on_touch, mirroring how
        # self.tag_picker above owns the picker's.
        self.topic_confirm = TopicConfirm(self.ui)
        self._pending_app_topic = None  # topic id most recently pushed over
                                         # BLE_UUID_PENDING_TOPIC and still
                                         # validated against self._all_topics()
                                         # -- None means nothing pending, an
                                         # unknown/stale id, OR already
                                         # consumed by a session start (see
                                         # apply_ble_pending_topic /
                                         # go_running). LOCK falls straight
                                         # through to the tag picker whenever
                                         # this is None -- the explicit
                                         # no-regression requirement.
        # ----- deferred logging for auto-open-off sessions -----
        # When Settings.auto_open is False, the box stays shut at timer
        # expiry (see go_done) until OPEN is tapped or override forces it --
        # logging actual_s at expiry would record a truncated duration for a
        # box that's still holding the phone. (planned_s, lock_start_at,
        # completed) once a "running" session ends without auto-open, flushed
        # by _flush_pending_log the moment the box is actually opened.
        self._pending_log = None
        self.go_idle()

    # ----- view switching -----
    def set_view(self, view):
        self.view = view
        if self._editing:
            # A settings edit can be interrupted here (e.g. a BLE "lock"/
            # "start" command forcing this view switch) instead of ending via
            # _handle_release's own exit gesture -- save() now so the debounce
            # in Settings.adjust doesn't silently drop the in-RAM value this
            # edit was mid-way through applying.
            self.settings.save()
        self._editing = False
        self._hold_dir = 0             # a view switch can't happen mid-hold, but be safe
        self._last_fkey = None        # force a clock-view refresh
        self._last_bkey = None        # force a battery-view refresh
        # LockUI.show_view itself declines to touch the live root_group while
        # the call-alert overlay is up (self.ui._call_alert_active), so this
        # can't stomp an in-progress "insistent by design" call notification --
        # see LockUI.show_view/show_call_alert/hide_call_alert.
        self.ui.show_view(view)
        if view == "clock":
            self._refresh_clock_view(self._now)
        elif view == "battery":
            self._refresh_battery(self._now)
        elif view == "settings":
            self.ui.update_settings(self.settings)

    # ----- lock hardware hooks (wire a relay/solenoid here later) -----
    def engage_lock(self):
        self.servo.move(self.settings.lock_angle)
        self._servo_locked = True
        self._servo_relax_at = self._now + SERVO_HOLD_S

    def release_lock(self):
        self.servo.move(self.settings.unlock_angle)
        self._servo_locked = False
        self._servo_relax_at = self._now + SERVO_HOLD_S

    # ----- coordinate mapping -----
    def _map(self, p):
        x, y = p
        if SWAP_XY:
            x, y = y, x
        # screen_flipped rotates the rendered content 180° (LockUI.
        # set_screen_flipped) without touching the touch chip's raw axes, so
        # a 180° flip has to invert both axes on top of whatever INVERT_X/
        # INVERT_Y calibration this panel already needed -- XOR (`!=` on
        # bools), not OR/replace, so toggling the setting still flips
        # correctly regardless of the base calibration.
        #
        # Reads self.ui.is_flipped (the display's own live rotation state),
        # not self.settings.screen_flipped, even though the two are supposed
        # to always agree -- manager report: on real hardware, touch stayed
        # mapped as if unflipped even while the screen was visibly flipped,
        # meaning those two had gone out of sync (root cause not pinned down
        # from source alone). Deriving the touch correction from the same
        # live value that actually drives the visual rotation makes that
        # disagreement structurally impossible from here on, regardless of
        # what was causing it.
        flipped = self.ui.is_flipped
        invert_x = INVERT_X != flipped
        invert_y = INVERT_Y != flipped
        if invert_x:
            x = self.ui.W - x
        if invert_y:
            y = self.ui.H - y
        return x, y

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
            self.engage_lock()           # stay shut: re-assert the lock and
            self._servo_relax_at = None  # hold it (no relax) until OPEN is tapped
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

    # ----- pre-session tag picker helpers -----
    def _all_topics(self):
        return list(BUILTIN_TOPICS) + self._synced_labels

    def apply_ble_labels_json(self, text):
        """Best-effort custom-label sync from the app (app/src/ble/protocol.ts's
        cmdSetLabels) -- feeds the on-box pre-session tag picker only. See
        lock_protocol.decode_labels for the parsing/validation; malformed
        input just leaves the previous list in place rather than crashing
        the run loop."""
        labels = lock_protocol.decode_labels(text)
        if labels is not None:
            self._synced_labels = labels

    def apply_ble_pending_topic(self, text):
        """Best-effort pre-session topic push from the app (see
        lock_config.BLE_UUID_PENDING_TOPIC) -- feeds the LOCK-button branch
        in _handle_release only. See lock_protocol.decode_pending_topic for
        the parsing (no validation there by design).

        Validated against self._all_topics() HERE, via lock_topic_confirm.
        find_topic, rather than in decode_pending_topic -- this same lookup
        has to run a SECOND time, at LOCK-press time (_handle_release),
        since a custom label can be deleted/renamed on the app side between
        this push and that later press; keeping both call sites next to the
        state they actually check (self._synced_labels via _all_topics)
        instead of teaching the wire-format module about topics at all.
        An unknown id stores None here -- identical to nothing pending, so
        the no-regression requirement (LOCK falls straight through to the
        picker) holds without a separate "do I have a real pending topic"
        flag anywhere."""
        topic_id = lock_protocol.decode_pending_topic(text)
        self._pending_app_topic = topic_id if find_topic(self._all_topics(), topic_id) else None

    def adjust(self, unit, direction):
        # Box editing is Hours + Minutes only (unit 0/1) -- seconds were
        # dropped from the on-screen swipe-to-set UI (see LockUI's
        # guide_h/guide_m) and from the home screen's display (fmt_hm), but
        # any existing sub-minute remainder (e.g. from a BLE "dur"/"start"
        # push) is preserved untouched rather than zeroed -- it still counts
        # toward the actual countdown length, it just never shows on this
        # screen.
        h = self.set_seconds // 3600
        m = (self.set_seconds % 3600) // 60
        s = self.set_seconds % 60
        if unit == 0:
            h += direction
        else:
            m += direction * MIN_STEP
        h = max(0, min(MAX_HOURS, h))
        m = max(0, min(59, m))
        if h == 0 and m == 0:
            # Decrementing to 0h00m would arm an unusable timer -- land on
            # the smallest real step instead (MIN_SECONDS floor, see
            # lock_config.py).
            m = MIN_STEP
        self.set_seconds = max(MIN_SECONDS, min(MAX_SECONDS, h * 3600 + m * 60 + s))
        self.ui.set_clock(self.set_seconds)

    # ----- per-frame updates; returns True if it just finished -----
    def update(self, now):
        self._now = now
        just_done = False
        # Step any in-flight status-bar / clock-active-color eases (see
        # LockUI.step_color_transitions) -- same per-frame tier as the
        # done/call-alert blink below, so it runs after touch is read and
        # never delays gesture sampling.
        self.ui.step_color_transitions()
        # Same tier for the position-spring motion (press-depth, success/
        # override pop -- see LockUI.step_motion). dt is clamped so a long
        # pause (waking from sleep, a GC pause) can't feed a spring one huge
        # step and make it visibly snap instead of ease.
        if self._last_frame_t is None:
            dt = 0.0
        else:
            dt = max(0.0, min(0.1, now - self._last_frame_t))
        self._last_frame_t = now
        self.ui.step_motion(dt)
        if self.state == "running":
            left = self.deadline - now
            if left <= 0:
                self.go_done(now)
                just_done = True
            else:
                # Home screen shows H:MM only -- fmt_hm does its own
                # ceiling-to-minute, unlike fmt_hms's callers which ceiling
                # to the next second themselves (see fmt_hm's docstring).
                self.ui.set_clock_text(fmt_hm(left))
        elif self.state == "done":
            if (self.settings.auto_open or self._done_force_open) \
                    and now - self.done_start >= DONE_ANIM_S:
                self.go_idle()             # auto-dismiss the unlock animation
            # No per-frame driving needed here anymore: the unlock animation
            # is now the OPEN button springing to the screen's center (see
            # LockUI.show_done/_step_motion), which rides the same
            # unconditional step_motion(dt) call above as _done_pop/_ovr_pop
            # -- one less special case in this state machine, and it already
            # gets the same "keep the run loop responsive" treatment those
            # springs get (cheap no-op once settled, never blocks touch).

        # Skip the (relatively expensive) clock-view redraw while a finger is
        # down so touch sampling stays responsive -- the hands resume the moment
        # the gesture ends. This keeps swipes snappy in the analog style.
        if self.view == "clock" and not self._was_down:
            self._refresh_clock_view(now)

        # Battery is read at most once per second regardless of the active
        # view -- the control/clock corner glyph needs it live everywhere,
        # and the dedicated battery view (when active) reuses the same read
        # instead of hitting the shared I2C bus twice a second.
        self._refresh_battery(now)

        if self._override:
            remaining = OVERRIDE_TIMEOUT - (now - self._override_at)
            if remaining <= 0:
                self._clear_override()
            else:
                self.ui.update_override_timeout(remaining, OVERRIDE_TIMEOUT)

        if self._servo_relax_at is not None:
            self.servo.reassert()          # keep a clean 50Hz through the move
            if now >= self._servo_relax_at:
                self.servo.relax()
                self._servo_relax_at = None

        # incoming-call notification: flash while showing, auto-dismiss after
        # its timeout. Insistent by design -- a static banner is easy to miss.
        if self._call_alert_until is not None:
            if now >= self._call_alert_until:
                self._call_alert_until = None
                self._call_anim_on = None
                self.ui.hide_call_alert()
            elif not self._was_down:       # skip the flash redraw while a finger is down
                on = int((now - self._call_alert_started) * CALL_ALERT_BLINK_HZ * 2) % 2 == 0
                if on != self._call_anim_on:   # only redraw when the flash flips
                    self._call_anim_on = on
                    self.ui.animate_call_alert(on)
        return just_done

    def _remaining_total(self, now):
        if self.state == "running":
            return max(0.0, self.deadline - now), self.set_seconds
        if self.state == "done":
            return 0.0, self.set_seconds
        return self.set_seconds, self.set_seconds

    def _refresh_battery(self, now):
        bkey = int(now)                 # update about once per second
        if bkey != self._last_bkey:
            self._last_bkey = bkey
            r = self.battery.read(now)
            self.ui.update_corner_battery(r)
            if self.view == "battery":
                self.ui.update_battery_view(r)

    def set_ble_connected(self, connected):
        """Called once per loop from code.py -- updates the on-screen corner
        dot only when the connection state actually flips."""
        if connected != self._ble_connected:
            self._ble_connected = connected
            self.ui.update_corner_ble(connected)

    def _refresh_clock_view(self, now):
        rem, tot = self._remaining_total(now)
        # While counting down, refresh at CLOCK_FPS so the second hand and the
        # gauge tip move smoothly; otherwise it is static so refresh per second.
        if self.state == "running":
            fkey = int(now * CLOCK_FPS)
        else:
            fkey = int(rem)
        if fkey != self._last_fkey:
            self._last_fkey = fkey
            self.ui.update_clock_view(rem, tot, self.state)

    # ----- BLE companion hooks (called by lock_ble.PhoneBoxBLE.service) -----
    def _battery_pct(self, now):
        try:
            r = self.battery.read(now)
            return r.percent if r.available else -1
        except Exception:
            return -1

    def ble_status_json(self, now):
        rem = int(max(0.0, self.deadline - now)) if self.state == "running" else 0
        # "tp": the picked topic's id (built-in or synced-custom -- see
        # _all_topics), only while a tagged session is actually running. Only
        # the id crosses the wire (never a user-typed name) -- the app
        # resolves display name/color itself from its own topics/customLabels
        # tables. NOT YET read by the app: protocol.ts's Status interface and
        # parseStatus need a `tp` field added to consume this (see
        # lock_config.py's BLE_UUID_LABELS comment for the sibling app-side
        # gap). The box's own offline history queue (lock_log.py, synced via
        # BLE_UUID_HISTORY) does NOT carry this -- its NVM entry layout is a
        # fixed 9 bytes with no room for a topic id, and widening it is a
        # separate NVM-migration task, intentionally not attempted here.
        topic = self._session_topic if self.state == "running" and self._session_topic else ""
        return lock_protocol.encode_status(
            self.state, rem, int(self.set_seconds), self._battery_pct(now), topic)

    def ble_history_json(self):
        return self.log.to_json()

    def ble_settings_json(self):
        return lock_protocol.encode_settings(self.settings)

    def apply_ble_command(self, cmd, now):
        # opcodes: "start:<seconds>", "dur:<seconds>" (live duration preview --
        # see below), "lock", "unlock" (unlock gated by
        # self.settings.allow_remote_unlock, toggled from the app's Settings
        # screen -- see apply_ble_settings_json / lock_ble._drain_inbound),
        # "historyAck:<seq>" (app has durably stored a drained `history`
        # batch -- see lock_log.SessionLog.ack and
        # docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
        # §3.2; reuses this characteristic instead of adding a new BLE UUID).
        # See lock_protocol.decode_command for the opcode parsing/clamping;
        # decode_command doesn't know about self.state, so it's decoded
        # unconditionally up front and this method switches on the result.
        decoded = lock_protocol.decode_command(cmd)
        if decoded is None:
            return
        name = decoded.name
        if name == "start":
            # Guard the whole op on state, not just go_running below -- a
            # "start" arriving while already running/done must not touch
            # set_seconds at all (go_done's lock_start = self.deadline -
            # self.set_seconds would otherwise be computed against a value
            # that changed mid-session, corrupting the logged duration and
            # the countdown ring's remaining/total fraction).
            if self.state in ("idle", "closed"):
                if decoded.seconds is not None:
                    self.set_seconds = decoded.seconds
                    self.ui.set_clock(self.set_seconds)
                self.go_running(now)
        elif name == "dur":
            # Live duration preview from the app's H/M stepper (DashboardScreen)
            # -- deliberately does NOT start the countdown (that's still only
            # "start" via the Lock button/press_lock). Ignored while running:
            # the on-screen clock digits are already owned by the countdown
            # tick (see update()'s set_clock_text), not this preview -- and
            # the underlying set_seconds must be left alone too, not just the
            # display, since go_done() reads it back out to compute
            # lock_start for the session log.
            if self.state == "running":
                return
            self.set_seconds = decoded.seconds
            self.ui.set_clock(self.set_seconds)
        elif name == "lock":
            if self.state in ("idle", "done"):
                self.go_closed(now)
        elif name == "unlock":
            # a remote early-release path: OFF by default (see lock_config.
            # BLE_ALLOW_REMOTE_UNLOCK), toggleable on in Settings
            if self.settings.allow_remote_unlock and self.state in ("running", "closed"):
                self.go_done(now, OVERRIDDEN)
        elif name == "historyAck":
            self.log.ack(decoded.seq)

    def apply_ble_settings_json(self, text):
        # See lock_protocol.decode_settings for the JSON parse + per-field
        # validation/clamping/snapping. None means the payload wasn't even
        # parseable JSON -- leave everything untouched (no save, no
        # refresh), same as the original single early return. Otherwise
        # `updates` holds only the keys that were present AND valid (one
        # malformed field can't skip applying/saving the rest of an
        # otherwise valid payload).
        updates = lock_protocol.decode_settings(text)
        if updates is None:
            return
        st = self.settings
        if "ovr" in updates:
            st.override_presses = updates["ovr"]
        if "auto" in updates:
            st.auto_open = updates["auto"]
        if "sleep" in updates:
            st.sleep_s = updates["sleep"]
        if "bright" in updates:
            st.bright_pct = updates["bright"]
        if "unlk" in updates:
            st.allow_remote_unlock = updates["unlk"]
        if "ucal" in updates:
            st.unlock_on_call = updates["ucal"]
        if "thm" in updates:
            st.theme_mode = updates["thm"]
        if "acc" in updates:
            st.accent_idx = updates["acc"]
        if "flip" in updates:
            st.screen_flipped = updates["flip"]
        if "langle" in updates:
            st.lock_angle = updates["langle"]
        if "uangle" in updates:
            st.unlock_angle = updates["uangle"]
        if "thm" in updates or "acc" in updates:
            self.ui.set_theme(st.theme_mode, st.accent_idx)
            # set_theme only repaints registered widgets -- the clock view's
            # time labels/gauge/override-ring live outside that registry (see
            # LockUI.set_theme's own cache-invalidation) and are otherwise
            # only repainted by _refresh_clock_view when fkey changes, which
            # it won't while idle/done/closed with nothing else moving. Force
            # one now, same as cycle_clock_style does, so a live theme/accent
            # push doesn't leave stale colors up until something else changes.
            self._last_fkey = None
            self._refresh_clock_view(self._now)
        if "flip" in updates:
            self.ui.set_screen_flipped(st.screen_flipped)
        st.save()
        if self.view == "settings":
            # self.view stays "settings" for both the row list AND the
            # per-item detail sub-screen (_editing tracks which one, not
            # self.view) -- refresh whichever is actually on screen, or a
            # BLE settings push while the detail page is open would leave
            # its big on-screen value stale relative to the just-changed
            # Settings object.
            if self._editing:
                self.ui.update_setting_detail(self._edit_idx, st)
            else:
                self.ui.update_settings(st)

    def set_wall_time(self, epoch, now):
        # A non-positive value can't be a real "now" -- reject it rather than
        # letting a malformed/garbage BLE time_sync write silently become the
        # reference every subsequent logged session's epoch is computed from
        # (see wall_time below and SessionLog.record's epoch param) until a
        # good sync eventually arrives.
        epoch = int(epoch)
        if epoch <= 0:
            return
        self._wall_epoch0 = epoch
        self._wall_mono0 = now
        # Retroactively fill in the epoch for any sessions logged earlier
        # this boot session before a sync was available (see
        # SessionLog.backfill_epoch) -- self.wall_time now reflects the sync
        # just established above.
        self.log.backfill_epoch(self.wall_time)

    def wall_time(self, now):
        """Best-known wall-clock epoch, or None until the phone has synced."""
        if self._wall_epoch0 is None:
            return None
        return self._wall_epoch0 + (now - self._wall_mono0)

    def notify_call(self, label, now):
        # Incoming-call handling: only meaningful while the box is locked. Default
        # is alert-through (on-screen notification, latch stays shut). If the
        # opt-in "unlock when called" setting is on, release the lock instead --
        # see Settings.unlock_on_call for why this is a separate, off-by-default
        # setting from allow_remote_unlock.
        # Either branch must set _call_event so code.py wakes the backlight --
        # a call that arrives while the screen is asleep must still be seen.
        if self.state not in ("running", "closed"):
            return
        self._call_event = True
        if self.settings.unlock_on_call:
            # force_open=True: an incoming call means nobody is standing at the
            # box to tap OPEN, so this must physically release the servo even
            # if the user separately prefers auto_open=False at normal timer
            # expiry (see go_done) -- the two settings are otherwise unrelated.
            self.go_done(now, OVERRIDDEN, force_open=True)
        else:
            self._call_alert_until = now + BLE_CALL_ALERT_S
            self._call_alert_started = now
            self._call_anim_on = None    # forces the first flash frame to draw
            self.ui.show_call_alert(label)

    def consume_call_event(self):
        """True at most once per incoming call -- code.py wakes the backlight
        on it, since notify_call's UI update (overlay or unlock animation) is
        otherwise invisible on a sleeping screen."""
        v = self._call_event
        self._call_event = False
        return v

    @property
    def call_alert_active(self):
        """True while the incoming-call overlay is showing -- code.py checks
        this to hold the backlight on for the full alert, not just the initial
        wake, so an important call can't go dark mid-notification."""
        return self._call_alert_until is not None

    def reset_gesture(self):
        """Drop any in-progress touch (used when waking the screen)."""
        self._was_down = False
        self._start = None
        self._last = None
        self._miss = 0

    # ----- physical buttons -----
    def press_lock(self, now):
        """Sensor button (lid closed): latch the servo and show the CLOSED setup
        screen (pick a time, then tap the timer area to start -- no visible
        button). Only acts from idle -- ignored while closed/running/done, so
        a still-held sensor won't re-latch after unlock."""
        if self.state == "idle":
            self.go_closed(now)

    def press_override(self):
        """Button 2: count presses while locked (with on-screen counter);
        force-unlock at the limit. Also usable from the post-timeout "done,
        not yet opened" holding state (auto_open off -- see go_done), since
        the box is still physically shut there and override stays the
        always-available emergency path; NOT usable once the box is actually
        open (auto_open on, or already forced open) -- nothing left to
        override."""
        if self.state == "done":
            # Whether there's still something to override in "done" is
            # whether the box is still physically shut, not whether a
            # deferred log entry exists -- _pending_log is only ever set
            # when go_done() was entered from "running", so it's None both
            # when the box is genuinely already open AND when go_done() was
            # entered from "closed" (e.g. an override/remote-unlock before
            # LOCK was ever pressed) with auto_open off, which leaves the box
            # locked. _servo_locked reflects the real physical state either way.
            if not self._servo_locked:
                return
        elif self.state not in ("running", "closed"):
            return
        self._override += 1
        self._override_at = self._now
        target = self.settings.override_presses
        if self._override >= target:
            self._clear_override()
            if self.state == "done":
                self.go_idle()   # force-open the holding state; flushes the deferred log
            else:
                self.go_done(self._now, OVERRIDDEN)  # unlock -> done; sensor ignored until RESET
        else:
            self.ui.show_override(self._override, target)
            # each press resets the timeout, so the countdown bar restarts full
            self.ui.update_override_timeout(OVERRIDE_TIMEOUT, OVERRIDE_TIMEOUT)
            # Defensive: override_presses can be configured as high as
            # OVR_MAX (255), so a real "keep pressing to unlock" sequence is
            # a long, uninterrupted burst of small allocations (the count
            # label, before the max_glyphs pre-sizing in LockUI -- see its
            # comment). A press is a discrete, human-paced button edge, not a
            # 50Hz frame, so an occasional GC pause here is not felt as
            # touch/servo jank the way one in the run loop's hot path would
            # be; done every 5th press, not every press, since gc.collect()
            # itself isn't free.
            if self._override % 5 == 0:
                gc.collect()

    def _clear_override(self):
        # reset the counter and drop the on-screen overlay if it is showing
        if self._override:
            self._override = 0
            self.ui.hide_override()

    # ----- process a touch frame; returns True if a finger is down -----
    def process(self, points, now):
        self._now = now
        if len(points) > 0:
            # a real touch: reset the dropout counter and track the point
            self._miss = 0
            pt = self._map(points[0])
            if not self._was_down:
                self._start = pt
                # Suppress the press-dip too while the status-bar toggle is
                # still cooling down (STATUS_TAP_COOLDOWN_S) -- on_touch_down
                # is purely cosmetic (LockUI.on_touch_down) but a chattering
                # touch there would otherwise keep restarting the press-depth
                # spring even though _handle_release now skips the actual
                # go_idle()/go_closed() call, still reading as a bounce.
                in_cooldown = (self.ui.in_status(*pt) and
                               self._now - self._last_status_toggle_at < STATUS_TAP_COOLDOWN_S)
                if not in_cooldown:
                    self.ui.on_touch_down(*pt)   # cosmetic only -- see LockUI.on_touch_down
            self._last = pt
            self._was_down = True
            if self._editing:
                self._update_hold(now)
            elif self.state == "picking":
                # TagPicker.on_touch infers "fresh touch-down" from its own
                # _active flag, so a single call here both arms (on the first
                # frame) and ticks (every frame) -- see its docstring for why
                # that same-call double-duty matters.
                result = self.tag_picker.on_touch(pt, now, released=False)
                self._apply_tag_picker_result(result, now)
            elif self.state == "confirming":
                # Same same-call-arms-and-ticks contract as the "picking"
                # branch above -- see lock_topic_confirm.TopicConfirm.on_touch.
                result = self.topic_confirm.on_touch(pt, now, released=False)
                self._apply_topic_confirm_result(result, now)
        elif self._was_down:
            # The AXS5106L occasionally drops a frame mid-touch; require a few
            # consecutive empty reads before treating it as a real release so
            # taps/swipes don't get chopped up (keeps the UI responsive).
            self._miss += 1
            if self._miss >= RELEASE_FRAMES:
                if self._start and self._last:
                    self._handle_release()
                self.ui.on_touch_up()        # cosmetic only -- see LockUI.on_touch_up
                self._start = None
                self._last = None
                self._was_down = False
                self._hold_dir = 0
        return self._was_down

    # Lower threshold to STAY in a hold direction than the one required to
    # first ENTER it (SWIPE_MIN_PX) -- _drag_direction recomputes direction
    # from scratch every frame from the cumulative drag, so with a single
    # threshold, dy sitting right at the boundary (a real, easy thing to do
    # while deliberately holding a drag still) flaps direction between 0 and
    # +-1 on a pixel or two of touch-sensor noise, each flap firing an extra
    # unintended adjust() step and resetting the repeat ramp back to
    # HOLD_REPEAT_START/HOLD_REPEAT_DELAY. Same class of bug
    # lock_tag_picker.TagPicker._SWIPE_JITTER_GUARD_PX exists for.
    _HOLD_DRAG_RELEASE_PX = 20

    def _drag_direction(self):
        """Which adjust direction (if any) the current touch corresponds to
        on the settings detail page: over [+]/[-] by position, or a sustained
        vertical drag past SWIPE_MIN_PX measured from the ORIGINAL press
        point, so holding the drag still counts even once the finger stops
        moving further away."""
        x, y = self._last
        if self.ui.in_setting_plus(x, y):
            return 1
        if self.ui.in_setting_minus(x, y):
            return -1
        dx = x - self._start[0]
        dy = y - self._start[1]
        threshold = SWIPE_MIN_PX
        if self._hold_dir != 0 and (dy < 0) == (self._hold_dir > 0):
            threshold = self._HOLD_DRAG_RELEASE_PX
        if abs(dy) >= threshold and abs(dy) > abs(dx):
            return 1 if dy < 0 else -1
        return 0

    def _update_hold(self, now):
        """Detail page [-]/[+] and swipe hold-to-repeat: a tap (or the instant
        a swipe crosses its threshold) applies one step immediately; holding
        past HOLD_REPEAT_DELAY starts auto-repeat, ramping faster over time.
        Moving off the button / back under the swipe threshold cancels the
        repeat -- release-time handling in _handle_release only needs to deal
        with the horizontal "swipe left/right = back" exit gesture."""
        direction = self._drag_direction()
        if direction != self._hold_dir:
            self._hold_dir = direction
            if direction != 0:
                self.settings.adjust(self._edit_idx, direction)
                self.ui.update_setting_detail(self._edit_idx, self.settings)
                self._hold_next_at = now + HOLD_REPEAT_DELAY
                self._hold_interval = HOLD_REPEAT_START
        elif direction != 0 and now >= self._hold_next_at:
            self.settings.adjust(self._edit_idx, direction)
            self.ui.update_setting_detail(self._edit_idx, self.settings)
            self._hold_interval = max(HOLD_REPEAT_MIN,
                                       self._hold_interval * HOLD_REPEAT_RAMP)
            self._hold_next_at = now + self._hold_interval

    # ----- pre-session tag picker: apply a TagPicker.on_touch result -----
    def _apply_tag_picker_result(self, result, now):
        """Reacts to whatever lock_tag_picker.TagPicker.on_touch just
        returned -- called after every on_touch call, from both process()
        (mid-touch) and _handle_release (on release). Select/Cancel/Page are
        the only real outcomes; None means nothing further to do (the
        picker already handled its own live UI feedback internally)."""
        if isinstance(result, Select):
            self.go_running(now, topic=result.topic)   # already hides the picker
        elif isinstance(result, Cancel):
            self.ui.hide_tag_picker()
            if self._picking_from == "closed":
                self.go_closed(now)
            else:
                self.go_idle()
        # Page: the picker already redrew itself with show_tag_picker; nothing else to do.

    # ----- pre-session topic confirm: apply a TopicConfirm.on_touch result -----
    def _apply_topic_confirm_result(self, result, now):
        """Reacts to whatever lock_topic_confirm.TopicConfirm.on_touch just
        returned -- called after every on_touch call, from both process()
        (mid-touch) and _handle_release (on release), mirroring
        _apply_tag_picker_result above. Confirm/Change are the only real
        outcomes; None means nothing further to do (the screen already
        handled its own live press-highlight feedback internally)."""
        if isinstance(result, Confirm):
            self.go_running(now, topic=self._pending_app_topic)   # already hides the confirm screen
        elif isinstance(result, Change):
            # Subtle, and load-bearing: restore self.state to whatever
            # go_confirming actually captured into self._picking_from
            # BEFORE calling go_picking below. go_picking's own first line
            # is `self._picking_from = self.state` -- if self.state were
            # still "confirming" (what it is right up to this point) when
            # that runs, it would capture "confirming" instead of "idle"/
            # "closed", and the picker's own swipe-up-cancel would then try
            # to return to a "confirming" state that no longer has a screen
            # of its own (see _apply_tag_picker_result's Cancel handling).
            self.state = self._picking_from
            self.go_picking(now)

    def _handle_release(self):
        dx = self._last[0] - self._start[0]
        dy = self._last[1] - self._start[1]

        # Per-setting detail page: a tap or hold on [-]/[+], or a held swipe,
        # was already applied live in _update_hold as the finger went down
        # and stayed down -- so nothing further to do here except persist the
        # value once (debounced to this release, not every repeat tick --
        # see Settings.adjust) and the horizontal "swipe left/right = back"
        # exit gesture.
        if self._editing:
            self._hold_dir = 0
            self.settings.save()
            if abs(dx) >= SWIPE_MIN_PX and abs(dx) > abs(dy):
                self._editing = False
                self.ui.show_view("settings")
                self.ui.update_settings(self.settings)
            return

        # Pre-session tag picker (see go_picking): hold a row or SKIP to
        # start tagged/untagged, tap/swipe MORE to page through synced
        # labels, swipe up to cancel (see lock_tag_picker.TagPicker.on_touch
        # for the full gesture arbitration). Handled here, before the
        # generic horizontal-swipe view-switch below, since the picker
        # occupies the control view's screen without being one of the
        # top-level VIEWS.
        if self.state == "picking":
            result = self.tag_picker.on_touch(self._last, self._now, released=True)
            self._apply_tag_picker_result(result, self._now)
            return

        # Pre-session topic confirm (see go_confirming): tap CONFIRM to
        # start with the app-pushed topic as-is, tap CHANGE to fall through
        # to the tag picker above instead. Handled here for the same reason
        # "picking" is above it -- this screen also occupies the control
        # view's screen real estate without being one of the top-level
        # VIEWS.
        if self.state == "confirming":
            result = self.topic_confirm.on_touch(self._last, self._now, released=True)
            self._apply_topic_confirm_result(result, self._now)
            return

        # Horizontal swipe -> switch views. self._start/self._last are
        # already-mapped screen points (process() sets them from _map()'s
        # return value), so dx is a screen-space delta that has already had
        # INVERT_X XORed with is_flipped applied once, by _map -- same
        # coordinate space in_status()/settings_row_at()/etc. hit-test
        # against, and the same reason plain `dy < 0` (no re-XOR) is correct
        # below for the clock-style swipe. Re-applying the INVERT_X/is_flipped
        # XOR here on top of that (as a previous fix did, chasing a manager
        # report that swipe was still reversed after the tap/position fix)
        # double-corrects: algebraically it cancels back down to the sign of
        # the raw, pre-_map dx, so the outcome tracked the physical touch
        # axis instead of the screen and only matched reality for whichever
        # single (INVERT_X, is_flipped) combination it happened to be tuned
        # against. While actually locked (state == "running"), only clock and
        # battery are reachable (LOCKED_VIEWS) -- control/settings stay
        # blocked until go_done returns to "control". clock and battery
        # aren't adjacent in the full VIEWS order (control sits between
        # them), so this swipes within LOCKED_VIEWS's own order instead of
        # VIEWS's while running.
        if abs(dx) >= SWIPE_MIN_PX and abs(dx) > abs(dy):
            right = dx > 0
            if self.state == "running":
                if self.view in LOCKED_VIEWS:
                    idx = LOCKED_VIEWS.index(self.view)
                    if right and idx < len(LOCKED_VIEWS) - 1:
                        self.set_view(LOCKED_VIEWS[idx + 1])
                    elif not right and idx > 0:
                        self.set_view(LOCKED_VIEWS[idx - 1])
            else:
                idx = VIEWS.index(self.view)
                if right and idx < len(VIEWS) - 1:
                    self.set_view(VIEWS[idx + 1])
                elif not right and idx > 0:
                    self.set_view(VIEWS[idx - 1])
            return

        # Clock view: a vertical swipe cycles the clock appearance.
        if self.view == "clock":
            if abs(dy) >= SWIPE_MIN_PX and abs(dy) > abs(dx):
                self.ui.cycle_clock_style(1 if dy < 0 else -1)
                self._last_fkey = None          # force the new style to repaint
                self._refresh_clock_view(self._now)
            return

        # Settings list: tap a row to open its detail page. Auto-open is the
        # one row that toggles in place on the list itself (no detail page
        # needed for a single boolean); R Unlock / C Unlock are also booleans
        # but go through the detail page like the numeric rows, adjusted via
        # Settings.adjust(idx, direction>0/<0) same as a swipe up/down.
        if self.view == "settings":
            if abs(dx) < SWIPE_MIN_PX and abs(dy) < SWIPE_MIN_PX:
                row = self.ui.settings_row_at(self._start[1])
                if row == 1:                       # Auto-open: toggle in place
                    self.settings.toggle_auto()
                    self.ui.update_settings(self.settings)
                elif row >= 0:
                    self._edit_idx = row
                    self._editing = True
                    self.ui.show_setting_detail(row, self.settings)
            return

        # Everything below only applies on the control view.
        if self.view != "control":
            return

        # Tap the status bar to toggle the lid: CLOSED -> open, UNLOCKED -> lock.
        # Gated by STATUS_TAP_COOLDOWN_S so a chattering/bouncing touch read
        # right after a real toggle can't re-fire go_idle()/go_closed() and
        # restart the press-depth spring -- see lock_config.py's comment.
        # The state-matching `return`s are unconditional (matching the
        # pre-cooldown behavior) so a tap on the status bar is never
        # misread as hitting the LOCK/OPEN button below; only the actual
        # go_idle()/go_closed() call is skipped while still cooling down.
        if self.ui.in_status(*self._start) and self.ui.in_status(*self._last):
            cooled_down = (self._now - self._last_status_toggle_at) >= STATUS_TAP_COOLDOWN_S
            if self.state == "closed":
                if cooled_down:
                    self._last_status_toggle_at = self._now
                    self.go_idle()            # open (release the servo)
                return
            if self.state in ("idle", "done"):
                if cooled_down:
                    self._last_status_toggle_at = self._now
                    self.go_closed(self._now)  # lock: close the servo, show setup
                return

        # Button press is checked FIRST so finger wobble on a tap is not
        # misread as a swipe (the button is taller than SWIPE_MIN_PX).
        if self.ui.in_button(*self._start) and self.ui.in_button(*self._last):
            if self.state in ("idle", "closed"):
                # Re-validate self._pending_app_topic against _all_topics()
                # HERE, at press time -- not just once, at receipt time in
                # apply_ble_pending_topic -- so a custom label deleted or
                # renamed between the app's push and this LOCK press falls
                # back safely to the picker instead of showing a confirm
                # screen for a topic that no longer exists. Not found (or
                # nothing was ever pending) -> the picker, UNCHANGED from
                # before this feature existed -- the explicit no-regression
                # requirement.
                found = find_topic(self._all_topics(), self._pending_app_topic)
                if found is not None:
                    name, _color = found
                    self.go_confirming(self._now, name)
                else:
                    self.go_picking(self._now)   # tag picker first, then the countdown actually starts
            elif self.state == "done":
                self.go_idle()               # reset after finishing -> re-arms sensor
            # running: no on-screen cancel -- override button only
        elif abs(dy) >= SWIPE_MIN_PX and abs(dy) > abs(dx):
            # vertical swipe over a unit column sets the lock time (idle or
            # closed). Two-way split (hours/minutes only) -- seconds were
            # dropped from the box's own editing UI, see LockUI's guide_h/
            # guide_m and adjust()'s comment.
            if self.state in ("idle", "closed") and self._start[1] < self.ui.BTN_Y:
                unit = 0 if self._start[0] < self.ui.W // 2 else 1
                self.adjust(unit, 1 if dy < 0 else -1)
