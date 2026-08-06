# lock_controller.py -- the timer state machine and gesture handling.
from lock_config import (
    MAX_SECONDS, MAX_HOURS, SEC_STEP, SWIPE_MIN_PX, ANIM_HZ, DEFAULT_SECONDS,
    SWAP_XY, INVERT_X, INVERT_Y, CLOCK_FPS, SERVO_HOLD_S, OVERRIDE_PRESSES,
    OVERRIDE_TIMEOUT, DONE_ANIM_S, MIN_STEP, RELEASE_FRAMES,
    SERVO_LOCK_ANGLE, SERVO_UNLOCK_ANGLE, fmt_hms,
    OVR_MIN, OVR_MAX, BLE_CALL_ALERT_S,
)
from lock_battery import Battery
from lock_servo import Servo
from lock_settings import Settings

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
        self._editing = False
        self._edit_idx = 0
        self._servo_relax_at = None
        self._servo_locked = False
        self._override = 0
        self._override_at = 0.0
        # BLE companion state
        self._call_alert_until = None    # monotonic deadline for the call overlay
        self._wall_epoch0 = None         # epoch pushed by the phone (time_sync)
        self._wall_mono0 = None          # monotonic at the moment of that push
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
            self._refresh_battery_view(self._now)
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
            else:
                on = int((now - self.done_start) * ANIM_HZ * 2) % 2 == 0
                if on != self._anim_on:    # only redraw when the blink flips
                    self._anim_on = on
                    self.ui.animate_done(on)

        # Skip the (relatively expensive) clock-view redraw while a finger is
        # down so touch sampling stays responsive -- the hands resume the moment
        # the gesture ends. This keeps swipes snappy in the analog style.
        if self.view == "clock" and not self._was_down:
            self._refresh_clock_view(now)
        elif self.view == "battery":
            self._refresh_battery_view(now)

        if self._override and (now - self._override_at) > OVERRIDE_TIMEOUT:
            self._clear_override()

        if self._servo_relax_at is not None:
            self.servo.reassert()          # keep a clean 50Hz through the move
            if now >= self._servo_relax_at:
                self.servo.relax()
                self._servo_relax_at = None

        # auto-dismiss an incoming-call notification after its timeout
        if self._call_alert_until is not None and now >= self._call_alert_until:
            self._call_alert_until = None
            self.ui.hide_call_alert()
        return just_done

    def _remaining_total(self, now):
        if self.state == "running":
            return max(0.0, self.deadline - now), self.set_seconds
        if self.state == "done":
            return 0.0, self.set_seconds
        return self.set_seconds, self.set_seconds

    def _refresh_battery_view(self, now):
        bkey = int(now)                 # update about once per second
        if bkey != self._last_bkey:
            self._last_bkey = bkey
            self.ui.update_battery_view(self.battery.read(now))

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

    def ble_settings_json(self):
        st = self.settings
        return '{{"ovr":{},"auto":{},"sleep":{},"bright":{}}}'.format(
            st.override_presses, 1 if st.auto_open else 0, st.sleep_s,
            st.bright_pct)

    def apply_ble_command(self, cmd, now, allow_unlock):
        # opcodes: "start:<seconds>", "lock", "unlock" (unlock gated by policy)
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
            # a new remote early-release path: OFF by default; alert-through only
            if allow_unlock and self.state in ("running", "closed"):
                self.go_done(now, OVERRIDDEN)

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
        # important-call alert-through: only meaningful while the box is locked;
        # shows an on-screen notification, never opens the latch.
        if self.state not in ("running", "closed"):
            return
        self._call_alert_until = now + BLE_CALL_ALERT_S
        self.ui.show_call_alert(label)

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
