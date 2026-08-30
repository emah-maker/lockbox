# lock_controller.py -- the timer state machine and gesture handling.
from lock_config import (
    MAX_SECONDS, MAX_HOURS, MIN_SECONDS, DEFAULT_SECONDS, SWAP_XY, INVERT_X, INVERT_Y,
    CLOCK_FPS, SERVO_HOLD_S, OVERRIDE_TIMEOUT, DONE_ANIM_S, MIN_STEP, fmt_hm, clamp,
    BLE_CALL_ALERT_S, CALL_ALERT_BLINK_HZ, STATUS_TAP_COOLDOWN_S,
)
from lock_battery import Battery
from lock_servo import Servo
from lock_settings import Settings
from lock_log import SessionLog
from lock_tag_picker import TagPicker
from lock_topic_confirm import TopicConfirm
from lock_controller_const import COMPLETED, OVERRIDDEN, VIEWS, LOCKED_VIEWS
from lock_controller_states import StateMixin
from lock_controller_ble import BleMixin
from lock_controller_gestures import GestureMixin

# COMPOSED FROM MIXINS. LockController is one object with one set of
# attributes -- the ones __init__ below creates -- and every method still runs
# against that same `self`. At 1080 lines this class held the state machine,
# the whole BLE surface and every touch gesture interleaved; each mixin is one
# of those concerns, with its methods in the order they were already in.
#
# No mixin has an __init__ and none calls super(): they are namespaces for
# methods, resolved through the MRO at call time. That is the subset of
# multiple inheritance MicroPython implements, and it keeps "where does
# self._foo come from" a single answer (__init__ below).
#
# The constants moved to lock_controller_const.py and are re-exported above,
# so `from lock_controller import VIEWS` is unchanged for callers and tests.


class LockController(StateMixin, BleMixin, GestureMixin):
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
        h = clamp(h, 0, MAX_HOURS)
        m = clamp(m, 0, 59)
        if h == 0 and m == 0:
            # Decrementing to 0h00m would arm an unusable timer -- land on
            # the smallest real step instead (MIN_SECONDS floor, see
            # lock_config.py).
            m = MIN_STEP
        self.set_seconds = clamp(h * 3600 + m * 60 + s, MIN_SECONDS, MAX_SECONDS)
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

    def call_alert_active(self):
        """True while the incoming-call overlay is showing -- code.py checks
        this to hold the backlight on for the full alert, not just the initial
        wake, so an important call can't go dark mid-notification."""
        return self._call_alert_until is not None
