# lock_controller.py -- the timer state machine and gesture handling.
from lock_config import (
    MAX_SECONDS, MAX_HOURS, SEC_STEP, SWIPE_MIN_PX, ANIM_HZ, DEFAULT_SECONDS,
    SWAP_XY, INVERT_X, INVERT_Y, CLOCK_FPS, SERVO_HOLD_S, OVERRIDE_PRESSES,
    OVERRIDE_TIMEOUT, DONE_ANIM_S, MIN_STEP, RELEASE_FRAMES,
    SERVO_LOCK_ANGLE, SERVO_UNLOCK_ANGLE, fmt_hms,
    OVR_MIN, OVR_MAX, BLE_CALL_ALERT_S, CALL_ALERT_BLINK_HZ,
)
from lock_battery import Battery
from lock_servo import Servo
from lock_settings import Settings
from lock_log import SessionLog

COMPLETED = "completed"
OVERRIDDEN = "overridden"

# ordered top-level views; horizontal swipe moves between them
VIEWS = ("clock", "control", "battery", "settings")


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
        self._anim_on = None
        self.view = "control"
        self._last_fkey = None
        self._last_bkey = None
        self.battery = Battery(i2c)
        self.servo = Servo()
        self.settings = Settings()
        self.ui.set_theme(self.settings.theme_mode, self.settings.accent_idx)
        self.log = SessionLog()
        self._editing = False
        self._edit_idx = 0
        self._servo_relax_at = None
        self._servo_locked = False
        self._override = 0
        self._override_at = 0.0
        # BLE companion state
        self._call_alert_until = None    # monotonic deadline for the call overlay
        self._call_alert_started = 0.0   # monotonic start, for the flash phase
        self._call_anim_on = None        # forces the first flash frame to draw
        self._call_event = False         # set by notify_call; consumed by code.py to wake the screen
        self._wall_epoch0 = None         # epoch pushed by the phone (time_sync)
        self._wall_mono0 = None          # monotonic at the moment of that push
        self._ble_connected = False      # drives the control/clock corner dot
        self.go_idle()

    # ----- view switching -----
    def set_view(self, view):
        self.view = view
        self._editing = False
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
        self.servo.move(SERVO_LOCK_ANGLE)
        self._servo_locked = True
        self._servo_relax_at = self._now + SERVO_HOLD_S

    def release_lock(self):
        self.servo.move(SERVO_UNLOCK_ANGLE)
        self._servo_locked = False
        self._servo_relax_at = self._now + SERVO_HOLD_S

    # ----- coordinate mapping -----
    def _map(self, p):
        x, y = p
        if SWAP_XY:
            x, y = y, x
        if INVERT_X:
            x = self.ui.W - x
        if INVERT_Y:
            y = self.ui.H - y
        return x, y

    # ----- state transitions -----
    def go_idle(self):
        self._clear_override()
        self.state = "idle"
        self.release_lock()
        self.ui.show_idle(self.set_seconds)

    def go_running(self, now):
        if self.set_seconds <= 0:
            return
        self.state = "running"
        self._override = 0
        self.deadline = now + self.set_seconds
        self.engage_lock()
        self.ui.show_running()

    def go_closed(self, now):
        # lid closed (sensor): servo latches; user picks a time then taps LOCK.
        # No countdown yet -- that begins when LOCK is pressed (go_running).
        self._clear_override()
        self.state = "closed"
        self.engage_lock()
        self.ui.show_closed()
        self.ui.set_clock(self.set_seconds)
        if self.view != "control":
            self.set_view("control")

    def go_done(self, now, outcome=COMPLETED):
        # Only a countdown that actually ran is a session -- go_done can also
        # be reached from "closed" (override/remote-unlock before LOCK was
        # ever pressed), which has no elapsed time worth logging.
        if self.state == "running":
            actual_s = max(0.0, now - (self.deadline - self.set_seconds))
            self.log.record(self.set_seconds, actual_s, outcome == COMPLETED,
                             self.wall_time(now))
        self._clear_override()
        self.state = "done"
        self.done_start = now
        self._anim_on = None        # force the first animation frame to draw
        if self.settings.auto_open:
            self.release_lock()          # auto-open: servo releases now
        else:
            self.engage_lock()           # stay shut: re-assert the lock and
            self._servo_relax_at = None  # hold it (no relax) until OPEN is tapped
        self.ui.show_done(self.settings.auto_open)
        if self.view != "control":  # return to control so the unlock anim shows
            self.set_view("control")

    def adjust(self, unit, direction):
        h = self.set_seconds // 3600
        m = (self.set_seconds % 3600) // 60
        s = self.set_seconds % 60
        if unit == 0:
            h += direction
        elif unit == 1:
            m += direction * MIN_STEP
        else:
            s += direction * SEC_STEP
        h = max(0, min(MAX_HOURS, h))
        m = max(0, min(59, m))
        s = max(0, min(59, s))
        self.set_seconds = max(0, min(MAX_SECONDS, h * 3600 + m * 60 + s))
        self.ui.set_clock(self.set_seconds)

    # ----- per-frame updates; returns True if it just finished -----
    def update(self, now):
        self._now = now
        just_done = False
        if self.state == "running":
            left = self.deadline - now
            if left <= 0:
                self.go_done(now)
                just_done = True
            else:
                self.ui.set_clock_text(fmt_hms(left + 0.999))
        elif self.state == "done":
            if self.settings.auto_open and now - self.done_start >= DONE_ANIM_S:
                self.go_idle()             # auto-dismiss the unlock animation
            elif not self._was_down:       # skip the blink redraw while a finger is down
                on = int((now - self.done_start) * ANIM_HZ * 2) % 2 == 0
                if on != self._anim_on:    # only redraw when the blink flips
                    self._anim_on = on
                    self.ui.animate_done(on)

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

        if self._override and (now - self._override_at) > OVERRIDE_TIMEOUT:
            self._clear_override()

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
        return '{{"st":"{}","rem":{},"set":{},"bat":{},"fw":"1.0"}}'.format(
            self.state, rem, int(self.set_seconds), self._battery_pct(now))

    def ble_history_json(self):
        return self.log.to_json()

    def ble_settings_json(self):
        st = self.settings
        return '{{"ovr":{},"auto":{},"sleep":{},"bright":{},"unlk":{},"ucal":{},"thm":{},"acc":{}}}'.format(
            st.override_presses, 1 if st.auto_open else 0, st.sleep_s,
            st.bright_pct, 1 if st.allow_remote_unlock else 0,
            1 if st.unlock_on_call else 0, st.theme_mode, st.accent_idx)

    def apply_ble_command(self, cmd, now):
        # opcodes: "start:<seconds>", "lock", "unlock" (unlock gated by
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
        elif name == "lock":
            if self.state in ("idle", "done"):
                self.go_closed(now)
        elif name == "unlock":
            # a remote early-release path: ON by default (see lock_config.
            # BLE_ALLOW_REMOTE_UNLOCK), toggleable off in Settings
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
        if "ovr" in d:
            st.override_presses = max(OVR_MIN, min(OVR_MAX, int(d["ovr"])))
        if "auto" in d:
            st.auto_open = bool(d["auto"])
        if "sleep" in d:
            st.sleep_s = int(d["sleep"])
        if "bright" in d:
            st.bright_pct = max(0, min(100, int(d["bright"])))
        if "unlk" in d:
            st.allow_remote_unlock = bool(d["unlk"])
        if "ucal" in d:
            st.unlock_on_call = bool(d["ucal"])
        if "thm" in d:
            st.theme_mode = max(0, min(1, int(d["thm"])))
        if "acc" in d:
            st.accent_idx = max(0, min(4, int(d["acc"])))
        if "thm" in d or "acc" in d:
            self.ui.set_theme(st.theme_mode, st.accent_idx)
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
            self.go_done(now, OVERRIDDEN)
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
        screen (pick a time, then tap LOCK). Only acts from idle -- ignored while
        closed/running/done, so a still-held sensor won't re-latch after unlock."""
        if self.state == "idle":
            self.go_closed(now)

    def press_override(self):
        """Button 2: count presses while locked (with on-screen counter);
        force-unlock at the limit."""
        if self.state not in ("running", "closed"):
            return
        self._override += 1
        self._override_at = self._now
        target = self.settings.override_presses
        if self._override >= target:
            self._clear_override()
            self.go_done(self._now, OVERRIDDEN)  # unlock -> done; sensor ignored until RESET
        else:
            self.ui.show_override(self._override, target)

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
            self._last = pt
            self._was_down = True
        elif self._was_down:
            # The AXS5106L occasionally drops a frame mid-touch; require a few
            # consecutive empty reads before treating it as a real release so
            # taps/swipes don't get chopped up (keeps the UI responsive).
            self._miss += 1
            if self._miss >= RELEASE_FRAMES:
                if self._start and self._last:
                    self._handle_release()
                self._start = None
                self._last = None
                self._was_down = False
        return self._was_down

    def _handle_release(self):
        dx = self._last[0] - self._start[0]
        dy = self._last[1] - self._start[1]

        # Per-setting detail page: swipe up/down changes it; swipe left/right exits.
        if self._editing:
            tap = abs(dx) < SWIPE_MIN_PX and abs(dy) < SWIPE_MIN_PX
            if tap and self.ui.in_setting_plus(*self._start):
                self.settings.adjust(self._edit_idx, 1)
                self.ui.update_setting_detail(self._edit_idx, self.settings)
            elif tap and self.ui.in_setting_minus(*self._start):
                self.settings.adjust(self._edit_idx, -1)
                self.ui.update_setting_detail(self._edit_idx, self.settings)
            elif abs(dy) >= SWIPE_MIN_PX and abs(dy) > abs(dx):
                self.settings.adjust(self._edit_idx, 1 if dy < 0 else -1)
                self.ui.update_setting_detail(self._edit_idx, self.settings)
            elif abs(dx) >= SWIPE_MIN_PX and abs(dx) > abs(dy):
                self._editing = False
                self.ui.show_view("settings")
                self.ui.update_settings(self.settings)
            return

        # Horizontal swipe -> switch views. INVERT_X is on, so a physical
        # swipe-right corresponds to a negative mapped dx.
        if abs(dx) >= SWIPE_MIN_PX and abs(dx) > abs(dy):
            right = (dx < 0) if INVERT_X else (dx > 0)
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

        # Settings list: tap a row to open its detail page.
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
        if self.ui.in_status(*self._start) and self.ui.in_status(*self._last):
            if self.state == "closed":
                self.go_idle()            # open (release the servo)
                return
            if self.state in ("idle", "done"):
                self.go_closed(self._now)  # lock: close the servo, show setup
                return

        # Button press is checked FIRST so finger wobble on a tap is not
        # misread as a swipe (the button is taller than SWIPE_MIN_PX).
        if self.ui.in_button(*self._start) and self.ui.in_button(*self._last):
            if self.state in ("idle", "closed"):
                self.go_running(self._now)   # LOCK button starts the countdown
            elif self.state == "done":
                self.go_idle()               # reset after finishing -> re-arms sensor
            # running: no on-screen cancel -- override button only
        elif abs(dy) >= SWIPE_MIN_PX and abs(dy) >= abs(dx):
            # vertical swipe over a unit column sets the lock time (idle or closed)
            if self.state in ("idle", "closed") and self._start[1] < self.ui.BTN_Y:
                if self._start[0] < self.ui.W // 3:
                    unit = 0          # hours
                elif self._start[0] < 2 * self.ui.W // 3:
                    unit = 1          # minutes
                else:
                    unit = 2          # seconds
                self.adjust(unit, 1 if dy < 0 else -1)
