# lock_controller_gestures.py -- touch: taps, the override counter, drag direction, holds, and what a release means.
#
# One of the mixins LockController is composed from; see lock_controller.py's
# header for why the class is split this way. Every method here runs as a
# method OF LockController -- `self` is the whole controller, and the
# attributes are the ones its __init__ creates.

import gc
from lock_config import (
    SWIPE_MIN_PX, OVERRIDE_TIMEOUT, RELEASE_FRAMES, HOLD_REPEAT_DELAY, HOLD_REPEAT_START,
    HOLD_REPEAT_MIN, HOLD_REPEAT_RAMP, STATUS_TAP_COOLDOWN_S,
)
from lock_tag_picker import Select
from lock_tag_picker import Cancel
from lock_topic_confirm import Confirm
from lock_topic_confirm import Change
from lock_topic_confirm import find_topic
from lock_controller_const import LOCKED_VIEWS, OVERRIDDEN, VIEWS


class GestureMixin:
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
