# lock_controller.py -- the timer state machine and gesture handling.
import gc
from lock_config import (
    MAX_SECONDS, MAX_HOURS, SWIPE_MIN_PX, DEFAULT_SECONDS,
    SWAP_XY, INVERT_X, INVERT_Y, CLOCK_FPS, SERVO_HOLD_S, OVERRIDE_PRESSES,
    OVERRIDE_TIMEOUT, DONE_ANIM_S, MIN_STEP, RELEASE_FRAMES,
    SERVO_ANGLE_MIN, SERVO_ANGLE_MAX, fmt_hm, fix, C_GREY,
    OVR_MIN, OVR_MAX, SLEEP_OPTIONS, BLE_CALL_ALERT_S, CALL_ALERT_BLINK_HZ,
    HOLD_REPEAT_DELAY, HOLD_REPEAT_START, HOLD_REPEAT_MIN, HOLD_REPEAT_RAMP,
    STATUS_TAP_COOLDOWN_S, BUILTIN_TOPICS, BLE_LABEL_MAX_COUNT,
    BLE_LABEL_NAME_MAX_LEN, ACCENT_COLORS, TAG_HOLD_S,
)
from lock_battery import Battery
from lock_servo import Servo
from lock_settings import Settings
from lock_log import SessionLog

COMPLETED = "completed"
OVERRIDDEN = "overridden"

# ordered top-level views; horizontal swipe moves between them
VIEWS = ("clock", "control", "battery", "settings")
# Reachable while state == "running" (see _handle_release's horizontal-swipe
# branch) -- control/settings are blocked while actually locked, but battery
# should still be checkable without waiting for the countdown to finish.
LOCKED_VIEWS = ("clock", "battery")


def _parse_hex_color(s):
    """'#rrggbb' (app/src/stats/customLabels.ts's LABEL_SWATCHES format,
    leading '#' optional, case-insensitive) -> a fix()-applied int, the same
    encoding every other color in lock_config.py already uses as a displayio
    fill. Falls back to C_GREY on anything malformed, same "don't crash the
    run loop on garbage BLE input" philosophy as apply_ble_labels_json's
    other fields."""
    try:
        h = str(s).lstrip("#")
        if len(h) != 6:
            return C_GREY
        return fix(int(h, 16))
    except (ValueError, TypeError):
        return C_GREY


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
        self._picker_page = 0
        self._picking_from = "idle"  # "idle" or "closed" -- which state to
                                      # cancel back to from the tag picker
                                      # (see go_picking / _handle_release's
                                      # "picking" branch swipe-up handling)
        self._session_topic = None  # topic tagged to the session in progress
                                     # (set by go_running's topic= argument)
        # hold-to-confirm on a tag-picker row (see _start_tag_hold/
        # _update_tag_hold) -- _tp_hold_row is the row index currently being
        # held, or None; there is exactly one touch point on this device, so
        # at most one row can be mid-hold at a time.
        self._tp_hold_row = None
        self._tp_hold_start = 0.0
        # hold-to-confirm on SKIP (see _start_tag_hold/_update_tag_skip_hold)
        # -- an accidental tap here used to start an untagged session
        # immediately, same problem the row hold above already fixes.
        # Shares _tp_hold_start's timer since only one hold (a row or SKIP)
        # can ever be active on this single-touch device.
        self._tp_skip_holding = False
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
        invert_x = INVERT_X != self.settings.screen_flipped
        invert_y = INVERT_Y != self.settings.screen_flipped
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
        self._picking_from = self.state   # "idle" or "closed" -- see the
                                           # swipe-up cancel handling below,
                                           # which must return to whichever
                                           # one was actually true rather than
                                           # assume idle (closed means the lid
                                           # sensor already latched the servo;
                                           # cancelling must not lose that).
        self.state = "picking"
        self._picker_page = 0
        self.ui.show_tag_picker(self._picker_page_topics(0))

    def go_running(self, now, topic=None):
        if self.set_seconds <= 0:
            return
        self.ui.hide_tag_picker()   # no-op if the picker was never shown
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
                                 self.wall_time(now))
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
        self.log.record(planned_s, actual_s, completed, self.wall_time(self._now))

    # ----- pre-session tag picker helpers -----
    def _all_topics(self):
        return list(BUILTIN_TOPICS) + self._synced_labels

    def _picker_page_count(self):
        n = len(self._all_topics())
        return max(1, (n + 5) // 6)   # 6 rows per page

    def _picker_page_topics(self, page):
        all_t = self._all_topics()
        start = page * 6
        return all_t[start:start + 6]

    def apply_ble_labels_json(self, text):
        """Best-effort custom-label sync from the app (app/src/ble/protocol.ts's
        cmdSetLabels) -- feeds the on-box pre-session tag picker only. Compact
        keys ("i"/"n"/"c") to save BLE payload bytes; malformed input just
        leaves the previous list in place rather than crashing the run loop."""
        try:
            import json
            d = json.loads(text)
        except (ValueError, ImportError):
            return
        if not isinstance(d, list):
            return
        labels = []
        for item in d[:BLE_LABEL_MAX_COUNT]:
            if not isinstance(item, dict):
                continue
            lid = str(item.get("i", ""))[:40]
            name = str(item.get("n", ""))[:BLE_LABEL_NAME_MAX_LEN]
            color = _parse_hex_color(item.get("c", ""))
            if lid and name:
                labels.append((lid, name, color))
        self._synced_labels = labels

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
        self.set_seconds = max(0, min(MAX_SECONDS, h * 3600 + m * 60 + s))
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
        return '{{"st":"{}","rem":{},"set":{},"bat":{},"tp":"{}","fw":"1.0"}}'.format(
            self.state, rem, int(self.set_seconds), self._battery_pct(now), topic)

    def ble_history_json(self):
        return self.log.to_json()

    def ble_settings_json(self):
        st = self.settings
        return ('{{"ovr":{},"auto":{},"sleep":{},"bright":{},"unlk":{},"ucal":{},'
                 '"thm":{},"acc":{},"flip":{},"langle":{},"uangle":{}}}').format(
            st.override_presses, 1 if st.auto_open else 0, st.sleep_s,
            st.bright_pct, 1 if st.allow_remote_unlock else 0,
            1 if st.unlock_on_call else 0, st.theme_mode, st.accent_idx,
            1 if st.screen_flipped else 0, st.lock_angle, st.unlock_angle)

    def apply_ble_command(self, cmd, now):
        # opcodes: "start:<seconds>", "dur:<seconds>" (live duration preview --
        # see below), "lock", "unlock" (unlock gated by
        # self.settings.allow_remote_unlock, toggled from the app's Settings
        # screen -- see apply_ble_settings_json / lock_ble._drain_inbound),
        # "historyAck:<seq>" (app has durably stored a drained `history`
        # batch -- see lock_log.SessionLog.ack and
        # docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
        # §3.2; reuses this characteristic instead of adding a new BLE UUID)
        op = cmd.split(":", 1)
        name = op[0]
        if name == "start":
            if len(op) == 2:
                try:
                    secs = int(op[1])
                except ValueError:
                    return
                self.set_seconds = max(0, min(MAX_SECONDS, secs))
                self.ui.set_clock(self.set_seconds)
            if self.state in ("idle", "closed"):
                self.go_running(now)
        elif name == "dur":
            # Live duration preview from the app's H/M stepper (DashboardScreen)
            # -- deliberately does NOT start the countdown (that's still only
            # "start" via the Lock button/press_lock). Ignored while running:
            # the on-screen clock digits are already owned by the countdown
            # tick (see update()'s set_clock_text), not this preview.
            if len(op) != 2:
                return
            try:
                secs = int(op[1])
            except ValueError:
                return
            self.set_seconds = max(0, min(MAX_SECONDS, secs))
            if self.state != "running":
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
            if len(op) == 2:
                try:
                    seq = int(op[1])
                except ValueError:
                    return
                self.log.ack(seq)

    def apply_ble_settings_json(self, text):
        try:
            import json
            d = json.loads(text)
        except (ValueError, ImportError):
            return
        st = self.settings
        # Each field below is validated independently (its own try/except on
        # the int() conversion) so one malformed field (e.g. a string or null
        # where a number is expected) can't raise and skip st.save() for the
        # rest of a payload's already-applied changes -- previously an
        # unconvertible "sleep" alone could silently drop ovr/bright/etc.
        # edits from the same BLE write.
        if "ovr" in d:
            # Clamp to [OVR_MIN, OVR_MAX] -- a BLE write now carries whatever
            # the app's slider or its custom-number entry sent, not a value
            # pre-snapped to a fixed option list, so this is the only thing
            # standing between a malformed/out-of-range payload and a stored
            # value the box's single NVM byte can't actually hold.
            try:
                st.override_presses = max(OVR_MIN, min(OVR_MAX, int(d["ovr"])))
            except (ValueError, TypeError):
                pass
        if "auto" in d:
            st.auto_open = bool(d["auto"])
        if "sleep" in d:
            # Clamp to the SLEEP_OPTIONS range (10-60s) the on-box UI itself
            # enforces -- same pattern as ovr/bright, so a malformed/
            # out-of-range payload can't set an effectively-0 or
            # multi-minute-oversized sleep timeout on the live in-RAM value
            # code.py's sleep-timeout check reads immediately.
            try:
                st.sleep_s = max(min(SLEEP_OPTIONS), min(max(SLEEP_OPTIONS), int(d["sleep"])))
            except (ValueError, TypeError):
                pass
        if "bright" in d:
            try:
                st.bright_pct = max(0, min(100, int(d["bright"])))
            except (ValueError, TypeError):
                pass
        if "unlk" in d:
            st.allow_remote_unlock = bool(d["unlk"])
        if "ucal" in d:
            st.unlock_on_call = bool(d["ucal"])
        if "thm" in d:
            try:
                st.theme_mode = max(0, min(1, int(d["thm"])))
            except (ValueError, TypeError):
                pass
        if "acc" in d:
            # Was hardcoded to 5 (the old 6-accent set's last index) -- this
            # silently clamped the two new accents (teal=6, indigo=7) down to
            # rose the moment they were added. len(ACCENT_COLORS) tracks
            # whatever the current accent count actually is instead of a
            # second number that has to be remembered and kept in sync.
            try:
                st.accent_idx = max(0, min(len(ACCENT_COLORS) - 1, int(d["acc"])))
            except (ValueError, TypeError):
                pass
        if "flip" in d:
            st.screen_flipped = bool(d["flip"])
        if "langle" in d:
            # Clamp to [SERVO_ANGLE_MIN, SERVO_ANGLE_MAX] -- the servo's real
            # range (lock_servo.Servo._write_angle already clamps here too,
            # but this keeps the persisted/reported value honest rather than
            # relying on that as the only backstop). Same per-field
            # try/except pattern as ovr/sleep/bright above.
            try:
                st.lock_angle = max(SERVO_ANGLE_MIN, min(SERVO_ANGLE_MAX, int(d["langle"])))
            except (ValueError, TypeError):
                pass
        if "uangle" in d:
            try:
                st.unlock_angle = max(SERVO_ANGLE_MIN, min(SERVO_ANGLE_MAX, int(d["uangle"])))
            except (ValueError, TypeError):
                pass
        if "thm" in d or "acc" in d:
            self.ui.set_theme(st.theme_mode, st.accent_idx)
        if "flip" in d:
            self.ui.set_screen_flipped(st.screen_flipped)
        st.save()
        if self.view == "settings":
            self.ui.update_settings(st)

    def set_wall_time(self, epoch, now):
        self._wall_epoch0 = int(epoch)
        self._wall_mono0 = now

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
            if self._pending_log is None:
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
                if self.state == "picking":
                    self._start_tag_hold(pt, now)
            self._last = pt
            self._was_down = True
            if self._editing:
                self._update_hold(now)
            elif self.state == "picking":
                self._update_tag_picker_touch(now)
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
        if abs(dy) >= SWIPE_MIN_PX and abs(dy) > abs(dx):
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

    # ----- pre-session tag picker: hold-to-confirm on a row or SKIP -----
    def _start_tag_hold(self, pt, now):
        """Touch-down on the tag picker (see process()): arms a hold if the
        point landed on a topic row (green fill, _update_tag_hold) or SKIP
        (grey fill, _update_tag_skip_hold) -- both need a TAG_HOLD_S press
        now, so an accidental tap can't start a session, tagged or untagged,
        any more than it could before. MORE stays a plain single tap (it
        only pages the list, nothing to accidentally commit). A touch that
        starts here can still turn into a swipe-up-cancel if it moves
        enough -- see _update_tag_picker_touch, which arbitrates."""
        x, y = pt
        nav = self.ui.tag_picker_nav_at(x, y)
        if nav == 'skip':
            self._tp_skip_holding = True
            self._tp_hold_start = now
            self.ui.start_tag_picker_skip_hold()
            return
        if nav is not None:
            return  # 'more' -- still a plain single tap
        row = self.ui.tag_picker_row_at(y)
        if row is None:
            return
        self._tp_hold_row = row
        self._tp_hold_start = now
        self.ui.start_tag_picker_hold(row)

    # Minimum |dy| before a held touch is even considered a swipe-cancel
    # candidate -- a finger held still on a row still reads a pixel or two
    # of jitter frame to frame, and without this floor that alone would flip
    # _update_tag_picker_touch's dominance test, clear the in-progress row
    # hold, and (since _start_tag_hold only re-arms on a fresh touch-down)
    # permanently drop a hold the user never meant to let go of. SWIPE_MIN_PX
    # itself is still what actually commits the cancel (_update_tag_swipe);
    # this is only the "is this even a candidate drag yet" gate.
    _TP_SWIPE_JITTER_GUARD_PX = 4

    def _update_tag_picker_touch(self, now):
        """Per-frame touch-poll dispatch while state == 'picking' (see
        process()). A touch can start on a topic row (arming _start_tag_
        hold's green fill) and then turn into a vertical drag -- the moment
        the drag is vertical-dominant, upward, and past the small jitter
        guard above, the swipe-up-cancel gesture takes priority: any in-
        progress row hold is cleared so a green fill and the red cancel bar
        are never both showing for the same touch. Same dx-vs-dy dominance
        test _drag_direction uses elsewhere in this file, applied here
        instead of there since the tag picker has its own release handling
        (_handle_release's "picking" branch)."""
        x, y = self._last
        dx = x - self._start[0]
        dy = y - self._start[1]
        if abs(dy) >= self._TP_SWIPE_JITTER_GUARD_PX and abs(dy) > abs(dx) and dy < 0:
            if self._tp_hold_row is not None:
                self.ui.cancel_tag_picker_hold()
                self._tp_hold_row = None
            if self._tp_skip_holding:
                self.ui.cancel_tag_picker_skip_hold()
                self._tp_skip_holding = False
            self._update_tag_swipe(now, dy)
        else:
            self.ui.clear_tag_picker_swipe()  # e.g. the drag reversed back down
            self._update_tag_hold(now)

    def _update_tag_swipe(self, now, dy):
        """Live swipe-up-cancel progress: `progress` tracks how far the
        current drag has traveled toward SWIPE_MIN_PX (the same threshold
        _handle_release's release-time fallback and every other swipe in
        this file already uses), growing LockUI's red bar every frame
        instead of waiting for release and playing a scripted animation.
        Reaching 1.0 commits the cancel immediately -- mirrors
        _update_tag_hold's green fill auto-committing at TAG_HOLD_S rather
        than waiting for release."""
        progress = min(1.0, abs(dy) / SWIPE_MIN_PX)
        if progress >= 1.0:
            self.ui.clear_tag_picker_swipe()
            self._commit_tag_picker_cancel(now)
        else:
            self.ui.step_tag_picker_swipe_progress(progress)

    def _commit_tag_picker_cancel(self, now):
        """Backs out of the pre-session tag picker with no session started
        -- shared by the live swipe-up-cancel commit (_update_tag_swipe) and
        _handle_release's release-time fallback below (which should rarely
        fire: by release time, self.state would already have left "picking"
        if the live drag ever reached the threshold first)."""
        self.ui.hide_tag_picker()
        if self._picking_from == "closed":
            self.go_closed(now)
        else:
            self.go_idle()

    def _update_tag_hold(self, now):
        """Continuous-touch polling tick for the armed hold (same loop tier
        as _update_hold's settings auto-repeat, but a single discrete
        threshold -- TAG_HOLD_S -- rather than a repeating step). Canceled
        only if the finger drifts onto a DIFFERENT valid row -- landing in
        the dead zone between rows, or past the first/last row's outer edge
        (no row above row 0 or below the last row to catch a stray reading),
        no longer cancels. It used to: comparing against None (this touch
        matches no row at all) as well as an actual different row meant the
        last row -- the one with open dead zone below it and nothing to
        drift onto instead -- lost its hold on any small downward jitter,
        while the interior rows had a neighbor to land back on. Reaching the
        threshold commits immediately, without waiting for release --
        go_running() changes self.state away from "picking", so process()'s
        `elif self.state == "picking"` guard naturally stops calling this
        again for the rest of the same touch. Dispatches to
        _update_tag_skip_hold instead when SKIP (not a row) is what's
        armed."""
        if self._tp_skip_holding:
            self._update_tag_skip_hold(now)
            return
        if self._tp_hold_row is None:
            return
        current_row = self.ui.tag_picker_row_at(self._last[1])
        if current_row is not None and current_row != self._tp_hold_row:
            self.ui.cancel_tag_picker_hold()
            self._tp_hold_row = None
            return
        progress = (now - self._tp_hold_start) / TAG_HOLD_S
        if progress >= 1.0:
            topic = self.ui.tag_picker_topic_for_row(self._tp_hold_row)
            self._tp_hold_row = None
            self.ui.cancel_tag_picker_hold()  # clear the fill before hide_tag_picker swaps the view away
            self.go_running(now, topic=topic)
        else:
            self.ui.step_tag_picker_hold(self._tp_hold_row, progress)

    def _update_tag_skip_hold(self, now):
        """SKIP's hold-to-confirm tick, mirroring _update_tag_hold: canceled
        only when the touch lands on a different valid nav target (MORE) --
        landing in the dead zone between SKIP and MORE, or outside the nav
        row's y-band entirely, is forgiven the same way a row hold forgives
        drifting into the dead zone between rows. Reaching the threshold
        starts an untagged session immediately, without waiting for
        release."""
        nav = self.ui.tag_picker_nav_at(*self._last)
        if nav is not None and nav != 'skip':
            self.ui.cancel_tag_picker_skip_hold()
            self._tp_skip_holding = False
            return
        progress = (now - self._tp_hold_start) / TAG_HOLD_S
        if progress >= 1.0:
            self._tp_skip_holding = False
            self.ui.cancel_tag_picker_skip_hold()
            self.go_running(now, topic=None)
        else:
            self.ui.step_tag_picker_skip_hold(progress)

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

        # Pre-session tag picker (see go_picking): tap a row to start tagged,
        # tap/swipe the SKIP or MORE control to start untagged or page
        # through synced labels (see LockUI's tag_picker_nav_at -- explicit
        # arrow+label controls, not swipe-only). Handled here, before the
        # generic horizontal-swipe view-switch below, since the picker
        # occupies the control view's screen without being one of the
        # top-level VIEWS.
        if self.state == "picking":
            # Any release while still in "picking" means neither the row's
            # hold nor the swipe-up-cancel bar ever reached its threshold --
            # both auto-commit from process()'s per-frame tick
            # (_update_tag_hold/_update_tag_swipe) the instant they fill,
            # which moves self.state off "picking" before release is even
            # detected. Clear whatever partial fill is showing so a plain
            # tap (or a swipe/SKIP/MORE that happened to start on a row)
            # doesn't leave a stale widget for the next time this picker is
            # shown.
            if self._tp_hold_row is not None:
                self.ui.cancel_tag_picker_hold()
                self._tp_hold_row = None
            if self._tp_skip_holding:
                self.ui.cancel_tag_picker_skip_hold()
                self._tp_skip_holding = False
            self.ui.clear_tag_picker_swipe()
            if abs(dy) >= SWIPE_MIN_PX and abs(dy) > abs(dx):
                # Swipe up = cancel: back out to whichever screen was active
                # before LOCK was tapped, with no session started at all --
                # distinct from SKIP/swipe-left, which still starts an
                # untagged session. This was previously a dead end: entering
                # the picker (even by accident) forced starting SOME session.
                # Fallback only -- the live tick above already commits at
                # this same threshold before release is normally reached.
                if dy < 0:
                    self._commit_tag_picker_cancel(self._now)
                return
            if abs(dx) >= SWIPE_MIN_PX and abs(dx) > abs(dy):
                right = (dx < 0) if INVERT_X else (dx > 0)
                if right:
                    self._picker_page = (self._picker_page + 1) % self._picker_page_count()
                    self.ui.show_tag_picker(self._picker_page_topics(self._picker_page))
                else:
                    self.go_running(self._now, topic=None)
                return
            if abs(dx) < SWIPE_MIN_PX and abs(dy) < SWIPE_MIN_PX:
                nav = self.ui.tag_picker_nav_at(*self._start)
                if nav == 'more':
                    self._picker_page = (self._picker_page + 1) % self._picker_page_count()
                    self.ui.show_tag_picker(self._picker_page_topics(self._picker_page))
                # else (a row, or SKIP): a plain tap no longer starts a
                # session by itself -- both are hold-to-confirm now (see
                # _start_tag_hold/_update_tag_hold/_update_tag_skip_hold
                # above), and any in-progress hold was already cleared
                # above.
            return

        # Horizontal swipe -> switch views. INVERT_X is on, so a physical
        # swipe-right corresponds to a negative mapped dx. While actually
        # locked (state == "running"), only clock and battery are reachable
        # (LOCKED_VIEWS) -- control/settings stay blocked until go_done
        # returns to "control". clock and battery aren't adjacent in the
        # full VIEWS order (control sits between them), so this swipes
        # within LOCKED_VIEWS's own order instead of VIEWS's while running.
        if abs(dx) >= SWIPE_MIN_PX and abs(dx) > abs(dy):
            right = (dx < 0) if INVERT_X else (dx > 0)
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
                self.go_picking(self._now)   # tag picker first, then the countdown actually starts
            elif self.state == "done":
                self.go_idle()               # reset after finishing -> re-arms sensor
            # running: no on-screen cancel -- override button only
        elif abs(dy) >= SWIPE_MIN_PX and abs(dy) >= abs(dx):
            # vertical swipe over a unit column sets the lock time (idle or
            # closed). Two-way split (hours/minutes only) -- seconds were
            # dropped from the box's own editing UI, see LockUI's guide_h/
            # guide_m and adjust()'s comment.
            if self.state in ("idle", "closed") and self._start[1] < self.ui.BTN_Y:
                unit = 0 if self._start[0] < self.ui.W // 2 else 1
                self.adjust(unit, 1 if dy < 0 else -1)
