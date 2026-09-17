# lock_ble.py -- BLE GATT peripheral: the box side of the companion app.
#
# Exposes a custom "PhoneBox" service the phone app connects to so it can read
# live status, sync the wall clock, mirror settings, and push an "important
# call" alert that the box renders as an on-screen notification.
#
# Design rules honored here:
#  * Best-effort. adafruit_ble / _bleio may be missing from the CP build (RFC
#    risk #1). Every BLE import and the whole service-class build are guarded;
#    if anything is unavailable BLE is simply disabled and the seven core timer
#    functions run unchanged.
#  * Non-blocking. service() is called once per run loop AFTER touch + update
#    (see code.py). It never blocks and never runs inside a touch/servo
#    interaction, so the documented run-loop ordering is preserved.
#  * State-machine reuse. Inbound commands map onto existing controller
#    transitions (go_running / go_closed / release). No new lock mechanism.
#  * Rate-limited remote unlock. Off by default (see lock_config.py
#    BLE_ALLOW_REMOTE_UNLOCK) and opt-in from the app's Settings screen --
#    the phone that would send it is a companion device, not the one locked
#    inside the box, so leaving this on would make cheating one tap away.
#    The physical press-count override remains the always-available
#    emergency path regardless of this setting. Calls default to
#    alert-through (screen notification), never auto-open.
#
# Payload formats are shared verbatim with app/src/ble/protocol.ts -- keep them
# in lockstep with the UUIDs in lock_config.py.
#
# `history` push/ack (docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
# §3.2): a BLE notify has no delivery guarantee, so _push_outbound no longer
# clears ctrl.log as soon as it writes the characteristic -- it calls
# ctrl.log.mark_sent() instead, and the queue is only cleared once the app
# acks via the `command` characteristic's "historyAck:<seq>" opcode (see
# LockController.apply_ble_command -> lock_log.SessionLog.ack). A fresh
# connection always forces a resend of whatever is still pending, in case the
# previous connection dropped before the app ever saw the original notify.

try:
    from adafruit_ble import BLERadio
    from adafruit_ble.advertising.standard import ProvideServicesAdvertisement
    from adafruit_ble.services import Service
    from adafruit_ble.characteristics import Characteristic
    from adafruit_ble.characteristics.string import StringCharacteristic
    from adafruit_ble.uuid import VendorUUID
    _BLE_IMPORTED = True
except ImportError:
    _BLE_IMPORTED = False

import lock_protocol
from lock_config import (
    BLE_ENABLED, BLE_NAME, BLE_ADV_INTERVAL, BLE_ADV_WHEN_LOCKED,
    BLE_ADV_REASSERT_S, BLE_CMD_MIN_INTERVAL,
    BLE_SERVICE_UUID, BLE_UUID_STATUS, BLE_UUID_HISTORY, BLE_UUID_COMMAND,
    BLE_UUID_SETTINGS, BLE_UUID_TIME, BLE_UUID_ALERT, BLE_UUID_LABELS,
    BLE_UUID_PENDING_TOPIC,
)

_LOCKED_STATES = ("running", "closed")

# Marker the box writes back into `pending_topic` for a value it has already
# handed to the controller -- see _drain_inbound's consume-and-clear.
#
# `command` solves the same "is this a resend or a stale read" problem by
# clearing itself to '' (see its comment there), which pending_topic cannot
# copy: '' is a REAL payload here, the app withdrawing a pick. So the marker
# has to be a value the app can never send. app/src/ble/protocol.ts's
# cmdSetPendingTopic writes `topicId ?? ''`, and a topic id is a slug (see
# BUILTIN_TOPICS and customLabels.ts's base36 ids), so a lone NUL is
# unreachable from the app by construction. It never crosses the link
# either -- the characteristic is WRITE-only, so nothing can read it back.
_TOPIC_CONSUMED = "\x00"


def _build_service_cls():
    """Build the custom Service class inside a guard so an unexpected
    adafruit_ble API shape disables BLE instead of crashing import/boot."""
    class PhoneBoxService(Service):
        uuid = VendorUUID(BLE_SERVICE_UUID)
        # box -> app
        status = StringCharacteristic(
            uuid=VendorUUID(BLE_UUID_STATUS),
            properties=Characteristic.READ | Characteristic.NOTIFY)
        history = StringCharacteristic(
            uuid=VendorUUID(BLE_UUID_HISTORY),
            properties=Characteristic.READ | Characteristic.NOTIFY)
        # app -> box (settings is round-trip)
        command = StringCharacteristic(
            uuid=VendorUUID(BLE_UUID_COMMAND),
            properties=Characteristic.WRITE | Characteristic.WRITE_NO_RESPONSE)
        settings = StringCharacteristic(
            uuid=VendorUUID(BLE_UUID_SETTINGS),
            properties=Characteristic.READ | Characteristic.WRITE)
        time_sync = StringCharacteristic(
            uuid=VendorUUID(BLE_UUID_TIME),
            properties=Characteristic.WRITE | Characteristic.WRITE_NO_RESPONSE)
        alert = StringCharacteristic(
            uuid=VendorUUID(BLE_UUID_ALERT),
            properties=Characteristic.WRITE | Characteristic.WRITE_NO_RESPONSE)
        # Custom-label sync (best-effort) -- see lock_config.BLE_UUID_LABELS
        # and LockController.apply_ble_labels_json.
        labels = StringCharacteristic(
            uuid=VendorUUID(BLE_UUID_LABELS),
            properties=Characteristic.WRITE | Characteristic.WRITE_NO_RESPONSE)
        # Pre-session topic pick (best-effort) -- see
        # lock_config.BLE_UUID_PENDING_TOPIC and
        # LockController.apply_ble_pending_topic. Its own characteristic
        # rather than a `command` opcode, same rate-limit-avoidance reason
        # `labels` already has one -- see that constant's comment.
        pending_topic = StringCharacteristic(
            uuid=VendorUUID(BLE_UUID_PENDING_TOPIC),
            properties=Characteristic.WRITE | Characteristic.WRITE_NO_RESPONSE)

    return PhoneBoxService


class PhoneBoxBLE:
    def __init__(self):
        self.enabled = False
        self._radio = None
        self._svc = None
        self._adv = None
        self._advertising = False
        self._last_adv_start = 0.0
        self._last_push = 0.0
        self._last_cmd_at = 0.0
        self._last_alert = ""
        self._last_time = ""
        self._last_settings = ""
        self._last_labels = ""
        self._last_pending_topic = ""   # mirrors whatever the box last put
                                         # IN the pending_topic characteristic,
                                         # which after the first write is
                                         # always _TOPIC_CONSUMED -- "" only
                                         # until then, matching the value a
                                         # freshly-built service starts with,
                                         # so boot costs no spurious apply.
                                         # See _drain_inbound's last block.
        self._last_drain_slow = 0.0
        self._last_history = None  # None (not "") so the very first push
                                    # after boot always writes, same as after
                                    # a reconnect -- see _on_connected below.
        self._was_connected = False
        if not (BLE_ENABLED and _BLE_IMPORTED):
            return
        try:
            svc_cls = _build_service_cls()
            self._radio = BLERadio()
            self._radio.name = BLE_NAME
            self._svc = svc_cls()
            self._adv = ProvideServicesAdvertisement(self._svc)
            self.enabled = True
        except Exception:
            # unsupported build / radio busy: disable quietly, timer unaffected
            self.enabled = False

    @property
    def connected(self):
        """True while a phone is actively connected -- surfaced on-screen as
        the control/clock views' corner dot (see LockUI.update_corner_ble).

        Guarded for exactly the reason service() below is guarded, and this
        is the more important of the two: code.py reads this property
        OUTSIDE service(), on the line after it (`ctrl.set_ble_connected(
        ble.connected)`), so the radio error service() is written to
        survive used to escape into the run loop anyway one line later.
        code.py now wraps its loop body too, but a property whose whole job
        is to answer a yes/no question should not be the thing that needs
        catching -- an unreachable radio is not an error here, it is the
        answer "no". Unknown reads as False: a stale-on dot is a worse lie
        than a stale-off one, since the dot is what tells the user whether
        the phone's Open button can possibly work."""
        if not (self.enabled and self._radio is not None):
            return False
        try:
            return bool(self._radio.connected)
        except Exception:
            return False

    # ----- advertising policy -----
    def _want_advertise(self, ctrl, awake):
        if not self.enabled or self._radio.connected:
            return False
        if awake:
            return True
        return BLE_ADV_WHEN_LOCKED and ctrl.state in _LOCKED_STATES

    def _set_advertising(self, on, now=0.0):
        # Re-assert periodically even when `on` matches the cached flag
        # already -- see BLE_ADV_REASSERT_S's comment for why the cached
        # flag alone isn't trustworthy evidence the radio is actually still
        # transmitting. `now=0.0` default keeps the `connected` branch's
        # `_set_advertising(False)` call (which never needs re-asserting --
        # stopping is idempotent either way) from having to pass a real
        # timestamp it doesn't have handy.
        due_for_reassert = (on and self._advertising
                            and now - self._last_adv_start >= BLE_ADV_REASSERT_S)
        if on == self._advertising and not due_for_reassert:
            return
        try:
            if on:
                self._radio.start_advertising(self._adv,
                                              interval=BLE_ADV_INTERVAL)
                self._last_adv_start = now
            else:
                self._radio.stop_advertising()
            self._advertising = on
        except Exception:
            self._advertising = False

    # ----- main per-loop entry point -----
    def service(self, ctrl, now, awake):
        if not self.enabled:
            return
        try:
            connected = self._radio.connected
            if connected and not self._was_connected:
                self._on_connected()
            self._was_connected = connected
            if connected:
                self._set_advertising(False)
                self._drain_inbound(ctrl, now)
                self._push_outbound(ctrl, now)
            else:
                self._set_advertising(self._want_advertise(ctrl, awake), now)
        except Exception:
            # never let a radio hiccup break the run loop
            pass

    def _on_connected(self):
        # A brand-new connection may be the *first* chance the app has had to
        # see history the box already tried (and failed) to hand off on a
        # previous, dropped connection -- ctrl.log itself hasn't forgotten
        # anything unacked (see SessionLog.ack), but this object's own
        # last-sent cache would otherwise suppress a resend of unchanged
        # content. Resetting it forces _push_outbound to write the `history`
        # characteristic again on this connection regardless.
        self._last_history = None
        # Same reasoning, opposite direction: `alert` is inbound, and its
        # "<nonce>|<label>" payload exists so a repeat call re-fires through
        # the equality dedup in _drain_inbound. But the characteristic keeps
        # its last written value across a disconnect while _last_alert was
        # only ever seeded in __init__, so that dedup spanned CONNECTIONS --
        # and an alert has no retry anywhere behind it. The app's write
        # succeeds, its CallMonitor marks the call alerted, and the box just
        # never lights up. That made the worst case the normal one: iOS
        # terminates the app and restores it via CoreBluetooth, so "the
        # first call after a restore" is the ordinary path, and an app whose
        # nonce restarted from the same number each process wrote a
        # byte-identical payload every launch. The app now seeds that nonce
        # from the wall clock; this covers the case no app-side seed can --
        # a phone whose clock moved backwards.
        #
        # Deliberately only `alert`, not _last_time/_last_settings/
        # _last_labels: those three carry declarative state, where
        # re-applying an unchanged value is a no-op worth skipping. This one
        # carries an event, where skipping it is the whole failure.
        self._last_alert = ""

    def _push_outbound(self, ctrl, now):
        # refresh readable/notify characteristics about once per second
        if now - self._last_push < 1.0:
            return
        self._last_push = now
        self._svc.status = ctrl.ble_status_json(now)
        settings_json = ctrl.ble_settings_json()
        if settings_json != self._last_settings:
            self._svc.settings = settings_json
            self._last_settings = settings_json
        if ctrl.log.has_pending:
            text = ctrl.ble_history_json()
            if text != self._last_history:
                self._svc.history = text
                self._last_history = text
                # Cleared only once the app acks this exact batch (see
                # LockController.apply_ble_command "historyAck" ->
                # lock_log.SessionLog.ack) -- a notify has no delivery
                # guarantee, so clearing here unconditionally (the previous
                # behavior) could lose the box's only copy if the app missed
                # it. mark_sent() remembers how many entries this batch
                # covers so a later ack can be validated against it.
                ctrl.log.mark_sent()

    def _drain_inbound(self, ctrl, now):
        # `command` is polled every single loop iteration (~50Hz) --
        # deliberately, since this is the "Open"/"Close" remote-action path
        # and should feel as instant as a physical button. The other four
        # characteristics (alert/time_sync/settings/labels) change rarely
        # (an incoming call, an occasional settings/label edit, one clock
        # sync) but were ALSO being read every single iteration -- five
        # characteristic reads a frame, every frame, for the whole time a
        # phone is connected. Each is a real _bleio round-trip, not free, and
        # this runs unconditionally regardless of which screen is showing
        # (see code.py: ble.service() runs after touch/update every loop
        # pass) -- reported as "buttons feel laggy" on the settings and lock
        # screens alike, i.e. the whole run loop slowing down, not a
        # per-screen bug. Rate-limited to 5x/sec (still far faster than a
        # human notices these particular things change) instead of 50x/sec.
        cmd = self._svc.command
        if cmd:
            # Clear the characteristic the moment we've read it, rather than
            # deduping on "did the string change from last time" -- a GATT
            # characteristic holds its last-written value indefinitely until
            # overwritten, so an equality-based dedup can't tell "the app
            # hasn't written anything new" apart from "the app genuinely sent
            # this exact command again" (e.g. "lock" twice in a row is a
            # legitimate resend, not a stale read). Clearing it back to ""
            # makes a later identical write observably new again -- the same
            # problem the `alert` characteristic solves with a nonce prefix,
            # solved here instead by the box consuming its own value, which
            # this characteristic (unlike `alert`, which is app-authored data
            # the box only reads) can do since it already writes back to its
            # own service elsewhere (e.g. `status`/`settings` below).
            self._svc.command = ""
            # The rate limit is charged to the OPCODE, not to the
            # characteristic. BLE_CMD_MIN_INTERVAL is there to bound the
            # remote-unlock path (read its comment: "commands that change
            # the latch"), but it used to gate every write to `command`
            # alike -- and a command that lost that race was consumed two
            # lines up and then silently discarded. No queue, no retry, no
            # error, and the GATT write itself succeeded, so the app had
            # every reason to think it had landed.
            #
            # That made ordinary use unreliable: the Home screen's duration
            # wheels write "dur:<n>" on every value change with no app-side
            # throttle, so a drag keeps the window permanently full, and
            # tapping Close within a second of letting go did nothing at
            # all. Same for "historyAck", which acknowledges a queue the box
            # is trying to hand off -- losing it makes the box resend that
            # batch indefinitely -- and for an unrecognized opcode, which
            # decodes to None and does nothing but could still starve a real
            # "lock". None of those three moves the servo, so none of them
            # is what the limit was protecting against.
            latch = lock_protocol.is_latch_command(cmd)
            if not latch or now - self._last_cmd_at >= BLE_CMD_MIN_INTERVAL:
                if latch:
                    self._last_cmd_at = now
                ctrl.apply_ble_command(cmd, now)

        if now - self._last_drain_slow < 0.2:
            return
        self._last_drain_slow = now

        alert = self._svc.alert
        if alert and alert != self._last_alert:
            self._last_alert = alert
            # payload is "<nonce>|<label>" so repeat calls re-fire
            label = alert.split("|", 1)[-1] if "|" in alert else alert
            ctrl.notify_call(label, now)

        tsync = self._svc.time_sync
        if tsync and tsync != self._last_time:
            self._last_time = tsync
            try:
                ctrl.set_wall_time(int(tsync), now)
            except (ValueError, TypeError):
                pass

        sett = self._svc.settings
        if sett and sett != self._last_settings:
            self._last_settings = sett
            ctrl.apply_ble_settings_json(sett)

        labels = self._svc.labels
        if labels and labels != self._last_labels:
            self._last_labels = labels
            ctrl.apply_ble_labels_json(labels)

        # DEDUP GOTCHA: do not copy the truthiness-gated `if x and x !=
        # self._last_x:` pattern the four blocks above use. That leading
        # truthiness check is only correct for characteristics where ''
        # means "never written" -- for pending_topic, '' is a REAL payload
        # (the app explicitly clearing a previously-picked topic), so
        # gating on truthiness would make a clear indistinguishable from
        # "nothing new to read" and it would never be observed.
        #
        # CONSUMED, not just compared. Caching the last value read was not
        # enough on its own: the box drops its own copy of the pick when the
        # session starts (lock_controller_states.go_running sets
        # _pending_app_topic = None) while the characteristic keeps holding
        # the id indefinitely, so the two disagreed the moment a session
        # began. Picking the SAME tag again then wrote the value already
        # sitting there, the cache said "no change", and the pick never
        # reached the controller at all -- LOCK fell through to the plain
        # picker as though nothing had been chosen. Picking a different tag
        # worked, so the feature failed on a rule that looks like randomness.
        #
        # Overwriting the characteristic with _TOPIC_CONSUMED the moment the
        # value is handed over makes any later write observably new again,
        # identical or not -- the same consume-and-clear `command` does
        # above, with a marker instead of '' for the reason given at that
        # constant. Both the cache and the characteristic move together, so
        # a re-read before the app writes again stays a no-op: the box must
        # not re-apply a pick the session already consumed, or a reconnect
        # would resurrect last session's tag (the app clears its own copy on
        # a fresh run for exactly this reason -- see useStore's handleStatus).
        pending_topic = self._svc.pending_topic
        if pending_topic != self._last_pending_topic:
            self._last_pending_topic = _TOPIC_CONSUMED
            self._svc.pending_topic = _TOPIC_CONSUMED
            ctrl.apply_ble_pending_topic(pending_topic)
