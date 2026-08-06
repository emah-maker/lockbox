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
#  * Focus contract. A remote unlock is gated OFF by default and rate-limited;
#    the physical press-count override stays the true emergency path. Calls
#    default to alert-through (screen notification), never auto-open.
#
# Payload formats are shared verbatim with app/src/ble/protocol.ts -- keep them
# in lockstep with the UUIDs in lock_config.py.
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
    BLE_CMD_MIN_INTERVAL, BLE_ALLOW_REMOTE_UNLOCK, BLE_CALL_ALERT_S,
    BLE_SERVICE_UUID, BLE_UUID_STATUS, BLE_UUID_COMMAND,
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
            if self._radio.connected:
                self._set_advertising(False)
                self._drain_inbound(ctrl, now)
                self._push_outbound(ctrl, now)
            else:
                self._set_advertising(self._want_advertise(ctrl, awake))
        except Exception:
            # never let a radio hiccup break the run loop
            pass

    def _push_outbound(self, ctrl, now):
        # refresh readable/notify characteristics about once per second
        if now - self._last_push < 1.0:
            return
        self._last_push = now
        self._svc.status = ctrl.ble_status_json(now)
        if not self._last_settings:
            self._svc.settings = ctrl.ble_settings_json()
            self._last_settings = self._svc.settings

    def _drain_inbound(self, ctrl, now):
        cmd = self._svc.command
        if cmd and cmd != self._last_command:
            self._last_command = cmd
            if now - self._last_cmd_at >= BLE_CMD_MIN_INTERVAL:
                self._last_cmd_at = now
                ctrl.apply_ble_command(cmd, now, BLE_ALLOW_REMOTE_UNLOCK)

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
