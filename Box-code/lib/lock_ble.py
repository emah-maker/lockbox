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
import time

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

from lock_config import (
    BLE_ENABLED, BLE_NAME, BLE_ADV_INTERVAL, BLE_ADV_WHEN_LOCKED,
    BLE_CMD_MIN_INTERVAL, BLE_CALL_ALERT_S,
    BLE_SERVICE_UUID, BLE_UUID_STATUS, BLE_UUID_HISTORY, BLE_UUID_COMMAND,
    BLE_UUID_SETTINGS, BLE_UUID_TIME, BLE_UUID_ALERT,
)

_FW = "1.0"
_LOCKED_STATES = ("running", "closed")


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

    return PhoneBoxService


class PhoneBoxBLE:
    def __init__(self):
        self.enabled = False
        self._radio = None
        self._svc = None
        self._adv = None
        self._advertising = False
        self._last_push = 0.0
        self._last_cmd_at = 0.0
        self._last_command = ""
        self._last_alert = ""
        self._last_time = ""
        self._last_settings = ""
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
        the control/clock views' corner dot (see LockUI.update_corner_ble)."""
        return bool(self.enabled and self._radio is not None and self._radio.connected)

    # ----- advertising policy -----
    def _want_advertise(self, ctrl, awake):
        if not self.enabled or self._radio.connected:
            return False
        if awake:
            return True
        return BLE_ADV_WHEN_LOCKED and ctrl.state in _LOCKED_STATES

    def _set_advertising(self, on):
        if on == self._advertising:
            return
        try:
            if on:
                self._radio.start_advertising(self._adv,
                                              interval=BLE_ADV_INTERVAL)
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
                self._set_advertising(self._want_advertise(ctrl, awake))
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
        cmd = self._svc.command
        if cmd and cmd != self._last_command:
            self._last_command = cmd
            if now - self._last_cmd_at >= BLE_CMD_MIN_INTERVAL:
                self._last_cmd_at = now
                ctrl.apply_ble_command(cmd, now)

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
