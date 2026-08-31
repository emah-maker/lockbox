# lock_settings.py -- user settings persisted in NVM so they survive a reboot
# without needing a host-writable filesystem. NVM byte 0 is reserved for the
# brownout retry counter (see safemode.py); settings live at _BASE onward,
# guarded by a magic byte so uninitialised NVM falls back to the defaults.
import microcontroller

from lock_config import (
    OVERRIDE_PRESSES, INACTIVITY_S, BL_LEVEL, BLE_ALLOW_REMOTE_UNLOCK,
    BLE_UNLOCK_ON_CALL, OVR_MIN, OVR_MAX, OVR_STEP, SLEEP_OPTIONS,
    BRIGHT_OPTIONS, DEFAULT_MODE_IDX, DEFAULT_ACCENT_IDX, ACCENT_COLORS,
    SCREEN_FLIPPED_DEFAULT, SERVO_LOCK_ANGLE, SERVO_UNLOCK_ANGLE,
    SERVO_ANGLE_MIN, SERVO_ANGLE_MAX, NVM_SETTINGS_BASE, NVM_SETTINGS_LEN,
    OVERRIDE_TIMEOUT, OVR_TIMEOUT_MIN_TENTHS, OVR_TIMEOUT_MAX_TENTHS,
    OVR_TIMEOUT_STEP_TENTHS, SERVO_ANGLE_STEP,
    clamp,
)

_MAGIC = 0x64        # bump when the NVM layout changes (forces defaults once);
                     # bumped from 0x63 to 0x64 to add override_timeout at
                     # _BASE+13 -- same reasoning as every bump below: a box
                     # flashed before this change would read whatever stray
                     # byte happens to sit at that never-before-written offset
                     # as a bogus timeout.
                     # 0x62->0x63 added lock_angle/unlock_angle
                     # at new offsets (_BASE+11/_BASE+12) -- same reasoning as
                     # the 0x61->0x62 bump below: a box flashed before this
                     # change would otherwise read whatever stray byte happens
                     # to sit at those never-before-written offsets as a
                     # bogus servo angle.
                     # 0x61->0x62 was for screen_flipped (_BASE+10); 0x60->
                     # 0x61 was for the override_presses high byte (OVR_MAX
                     # raised from 255 to 500 -- a single NVM byte can't hold
                     # that, see Settings.save/_load) so a box flashed before
                     # that change doesn't read a stray erased byte as a
                     # garbage high byte and reconstruct a bogus override
                     # count
_BASE = NVM_SETTINGS_BASE   # see lock_config.py's NVM region map
# Highest _BASE+N this module writes, so the region map's budget can be
# checked against what is actually used. Raise it when adding a field, and if
# it would reach NVM_SETTINGS_LEN, raise that (and lock_log's _MAGIC) too --
# tests/test_lock_log_queue.py fails on the host if this region grows into
# lock_log's.
_MAX_FIELD_OFF = 13
# lock_angle/unlock_angle are stored as (angle + 90) so the -90..90 range
# fits an unsigned NVM byte (0..180) without needing signed-byte handling.
_ANGLE_BYTE_OFFSET = 90
# override_timeout is stored (and transmitted) in TENTHS of a second so one
# unsigned NVM byte covers the whole 0.3-10.0s range exactly -- see
# OVR_TIMEOUT_MIN_TENTHS in lock_config.py for why tenths and not seconds.
_TENTHS = 10.0


def _step_in(options, value, direction):
    try:
        i = options.index(value)
    except ValueError:
        i = 0
    i = clamp(i + (1 if direction > 0 else -1), 0, len(options) - 1)
    return options[i]


def _step_clamped(value, direction, step, lo, hi):
    return clamp(value + (step if direction > 0 else -step), lo, hi)


class Settings:
    def __init__(self):
        self.override_presses = OVERRIDE_PRESSES
        self.auto_open = True
        self.sleep_s = INACTIVITY_S
        self.bright_pct = int(BL_LEVEL * 100)
        # Remote unlock from the phone app -- OFF by default (see
        # BLE_ALLOW_REMOTE_UNLOCK). The phone that would send "unlock" is a
        # companion device (a second phone/tablet), not the one locked inside
        # the box, so this is a real one-tap escape hatch if left on. The
        # Settings screen can turn it on for setups that want that trade-off.
        self.allow_remote_unlock = BLE_ALLOW_REMOTE_UNLOCK
        # Unlock when called -- OFF by default (see BLE_UNLOCK_ON_CALL). A
        # separate opt-in from allow_remote_unlock: this one is triggered by an
        # incoming call rather than a deliberate tap on a companion device, so
        # conflating the two fields would let one opt-in silently enable both
        # early-release paths.
        self.unlock_on_call = BLE_UNLOCK_ON_CALL
        # Theme sync from the app's Settings > Appearance (see
        # app/src/theme/theme.ts THEME_MODES / ACCENT_KEYS for the index
        # order this mirrors) -- pushed down over the `settings` BLE
        # characteristic, applied via LockUI.set_theme.
        self.theme_mode = DEFAULT_MODE_IDX
        self.accent_idx = DEFAULT_ACCENT_IDX
        # Mounts the box upside-down while keeping the on-screen content
        # right-side-up -- toggled from the app's Settings screen, applied
        # via LockUI.set_screen_flipped and LockController._map (touch).
        self.screen_flipped = SCREEN_FLIPPED_DEFAULT
        # Servo lock/unlock angles -- app-adjustable (phone Settings screen),
        # applied via LockController.engage_lock/release_lock instead of the
        # fixed SERVO_LOCK_ANGLE/SERVO_UNLOCK_ANGLE constants. Defaulting to
        # those same constants keeps behavior unchanged until a user edits
        # them. Pushed/pulled over BLE as "langle"/"uangle" (see
        # LockController.ble_settings_json/apply_ble_settings_json) -- that
        # exact key contract is shared with the phone app, do not rename.
        self.lock_angle = SERVO_LOCK_ANGLE
        self.unlock_angle = SERVO_UNLOCK_ANGLE
        # How long the override press counter survives without a press before
        # resetting to zero (seconds, float). App-adjustable from the phone's
        # Settings screen like the servo angles above, and app-only for the
        # same reason: the box's own settings list is a fixed six rows whose
        # layout can't be checked off-device. Pushed/pulled over BLE as
        # "ovrt" IN TENTHS (see LockController.ble_settings_json /
        # apply_ble_settings_json) -- that exact key and unit are shared with
        # the phone app, do not rename or rescale.
        self.override_timeout = OVERRIDE_TIMEOUT
        self._load()

    def _load(self):
        try:
            nvm = microcontroller.nvm
            if nvm is not None and nvm[_BASE] == _MAGIC:
                # override_presses is 2 bytes (low, high) since OVR_MAX=500
                # no longer fits one byte -- see save() below.
                self.override_presses = nvm[_BASE + 1] | (nvm[_BASE + 9] << 8)
                self.auto_open = bool(nvm[_BASE + 2])
                self.sleep_s = nvm[_BASE + 3]
                self.bright_pct = nvm[_BASE + 4]
                self.allow_remote_unlock = bool(nvm[_BASE + 5])
                self.unlock_on_call = bool(nvm[_BASE + 6])
                self.theme_mode = nvm[_BASE + 7]
                self.accent_idx = nvm[_BASE + 8]
                self.screen_flipped = bool(nvm[_BASE + 10])
                self.lock_angle = nvm[_BASE + 11] - _ANGLE_BYTE_OFFSET
                self.unlock_angle = nvm[_BASE + 12] - _ANGLE_BYTE_OFFSET
                # Clamped on the way OUT as well as in: this byte is the
                # newest field, so it is the one most likely to be read from
                # a box whose NVM was written by a build that never set it.
                self.override_timeout = clamp(
                    nvm[_BASE + 13], OVR_TIMEOUT_MIN_TENTHS, OVR_TIMEOUT_MAX_TENTHS
                ) / _TENTHS
        except Exception:
            pass

    def _pack(self):
        """The whole settings region as a bytes-like, laid out EXACTLY as
        _load() reads it back. Offsets are positional here rather than
        written as `_BASE + n`, so read this against _load() index by index
        when adding a field -- one transposed offset silently corrupts a
        user's settings with no error anywhere.

          0  magic          4  bright_pct        9  override high byte
          1  ovr low byte   5  allow_remote     10  screen_flipped
          2  auto_open      6  unlock_on_call   11  lock_angle   (+90)
          3  sleep_s        7  theme_mode       12  unlock_angle (+90)
                           8  accent_idx       13  override_timeout (tenths)
        """
        # 2-byte little-endian split -- OVR_MAX=500 exceeds a single byte's
        # 0-255 range. Low byte kept at offset 1 so this stayed a
        # value-format-only change rather than a layout shift of every other
        # field; high byte appended at offset 9 rather than reordering.
        ovr = clamp(int(self.override_presses), OVR_MIN, OVR_MAX)
        lock_angle = clamp(int(self.lock_angle), SERVO_ANGLE_MIN, SERVO_ANGLE_MAX)
        unlock_angle = clamp(int(self.unlock_angle), SERVO_ANGLE_MIN, SERVO_ANGLE_MAX)
        buf = bytearray(_MAX_FIELD_OFF + 1)
        buf[0] = _MAGIC
        buf[1] = ovr & 0xFF
        buf[2] = 1 if self.auto_open else 0
        buf[3] = clamp(int(self.sleep_s), 0, 255)
        buf[4] = clamp(int(self.bright_pct), 0, 100)
        buf[5] = 1 if self.allow_remote_unlock else 0
        buf[6] = 1 if self.unlock_on_call else 0
        buf[7] = clamp(int(self.theme_mode), 0, 1)
        buf[8] = clamp(int(self.accent_idx), 0, len(ACCENT_COLORS) - 1)
        buf[9] = (ovr >> 8) & 0xFF
        buf[10] = 1 if self.screen_flipped else 0
        buf[11] = lock_angle + _ANGLE_BYTE_OFFSET
        buf[12] = unlock_angle + _ANGLE_BYTE_OFFSET
        buf[13] = clamp(int(round(self.override_timeout * _TENTHS)),
                        OVR_TIMEOUT_MIN_TENTHS, OVR_TIMEOUT_MAX_TENTHS)
        return buf

    def save(self):
        """ONE region write, and none at all when nothing changed.

        REPORTED FROM HARDWARE, and the reason this is not fourteen byte
        assignments any more: "the add and subtract buttons take a long time
        to press - long cooldown". This used to do

            nvm[_BASE] = _MAGIC
            nvm[_BASE + 1] = ...      # x14, one statement per field

        and on CircuitPython every single-byte assignment to
        microcontroller.nvm is a read-modify-ERASE-write of the NVM
        partition. Flash erase is measured in tens of milliseconds, so one
        settings-detail button release cost ~14 erase cycles back to back --
        several hundred milliseconds of a blocked run loop, during which
        touch is not sampled at all. That is the "cooldown": not a debounce,
        not a repeat delay, just flash.

        The debounce-to-release design is unchanged and still correct (see
        adjust()'s comment -- a hold-repeat calls adjust 10+ times/second and
        must not write flash per step). What changed is that one save is now
        one erase cycle, via a single slice assignment.

        And usually zero: a release that changed nothing -- a stray tap, a
        value already at its clamp limit, or just entering and leaving the
        detail page -- previously still paid the full cost. Comparing against
        what is already stored costs one read and skips the write entirely,
        which also spares the flash's finite erase budget.

        DO NOT "simplify" this back to per-field assignment."""
        try:
            nvm = microcontroller.nvm
            if nvm is None:
                return
            buf = self._pack()
            end = _BASE + len(buf)
            # Skip an unchanged region entirely -- see the docstring. Wrapped
            # separately from the write below so a board whose nvm does not
            # support slice READS still falls through to writing rather than
            # silently never saving again.
            try:
                if bytes(nvm[_BASE:end]) == bytes(buf):
                    return
            except Exception:
                pass
            try:
                nvm[_BASE:end] = buf
            except (TypeError, AttributeError, ValueError):
                # Explicit fallback, NOT a reliance on the outer catch: if
                # this build's nvm rejects slice assignment we still have to
                # persist, and letting it fall out to `except Exception: pass`
                # would turn "slower saves" into "settings never save",
                # which is far worse than the latency this method exists to
                # fix. Byte-wise is the old behaviour, cost and all.
                for i in range(len(buf)):
                    nvm[_BASE + i] = buf[i]
        except Exception:
            pass

    def bright_level(self):
        return self.bright_pct / 100.0

    def toggle_auto(self):
        # Auto-open is a boolean -- the settings list toggles it in place
        self.auto_open = not self.auto_open
        self.save()

    # ----- called by the settings UI: swipe up/down / +/- (with hold-to-
    # repeat) on a detail page -- does NOT save(); a hold-repeat can call this
    # 10+ times/second, so the caller (lock_controller._update_hold) only
    # updates the live in-RAM value here and debounces the actual NVM write to
    # once per release (lock_controller._handle_release) -----
    def adjust(self, idx, direction):
        # swipe up/down: direction +1 = up/increase, -1 = down/decrease (clamped)
        if idx == 0:
            self.override_presses = _step_clamped(self.override_presses, direction, OVR_STEP, OVR_MIN, OVR_MAX)
        elif idx == 1:
            self.auto_open = direction > 0
        elif idx == 2:
            self.sleep_s = _step_in(SLEEP_OPTIONS, self.sleep_s, direction)
        elif idx == 3:
            self.bright_pct = _step_in(BRIGHT_OPTIONS, self.bright_pct, direction)
        elif idx == 4:
            self.allow_remote_unlock = direction > 0
        elif idx == 5:
            self.unlock_on_call = direction > 0
        # ----- page 2 of the on-box settings list (indices 6..11) -----
        # One FLAT index space continuing page 1's 0..5, deliberately: it is
        # what lets LockController._edit_idx and the existing per-setting
        # detail page serve both pages with no notion of which page a row
        # came from. Do not renumber -- lock_controller_ble.py's live-refresh
        # path indexes the detail page by the same number.
        #
        # These six were previously app-only, and lock_settings.py's own
        # comments said why: "the box's own settings list is a fixed six rows
        # whose layout can't be checked off-device." Both halves of that are
        # now false -- there is a second page, and tests/preview/ renders the
        # layout on a host -- so the reason to withhold them is gone.
        elif idx == 6:
            # Two options, so direction IS the value rather than a step.
            self.theme_mode = 1 if direction > 0 else 0
        elif idx == 7:
            self.accent_idx = clamp(self.accent_idx + (1 if direction > 0 else -1),
                                    0, len(ACCENT_COLORS) - 1)
        elif idx == 8:
            self.screen_flipped = direction > 0
        elif idx == 9:
            # Stepped in TENTHS, the unit this is stored and transmitted in
            # (see OVR_TIMEOUT_MIN_TENTHS's comment), then converted back
            # once. Stepping the float directly would accumulate binary
            # rounding error across a hold-repeat and land on values that do
            # not round-trip through the single NVM byte.
            tenths = _step_clamped(int(round(self.override_timeout * _TENTHS)),
                                   direction, OVR_TIMEOUT_STEP_TENTHS,
                                   OVR_TIMEOUT_MIN_TENTHS, OVR_TIMEOUT_MAX_TENTHS)
            self.override_timeout = tenths / _TENTHS
        elif idx == 10:
            self.lock_angle = _step_clamped(self.lock_angle, direction, SERVO_ANGLE_STEP,
                                            SERVO_ANGLE_MIN, SERVO_ANGLE_MAX)
        elif idx == 11:
            self.unlock_angle = _step_clamped(self.unlock_angle, direction, SERVO_ANGLE_STEP,
                                              SERVO_ANGLE_MIN, SERVO_ANGLE_MAX)
