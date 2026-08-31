# lock_controller_ble.py -- everything the phone can read or write over BLE, and the JSON it is carried in.
#
# One of the mixins LockController is composed from; see lock_controller.py's
# header for why the class is split this way. Every method here runs as a
# method OF LockController -- `self` is the whole controller, and the
# attributes are the ones its __init__ creates.

from lock_config import BUILTIN_TOPICS
import lock_protocol
from lock_topic_confirm import find_topic
from lock_controller_const import OVERRIDDEN


class BleMixin:
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

    def set_ble_connected(self, connected):
        """Called once per loop from code.py -- updates the on-screen corner
        dot only when the connection state actually flips."""
        if connected != self._ble_connected:
            self._ble_connected = connected
            self.ui.update_corner_ble(connected)

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
        if "ovrt" in updates:
            # decode_settings returns this in TENTHS (the unit it travels and
            # is stored in); Settings.override_timeout is in seconds, so the
            # one conversion in the inbound direction happens here.
            st.override_timeout = updates["ovrt"] / 10.0
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
