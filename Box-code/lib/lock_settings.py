# lock_settings.py -- user settings persisted in NVM so they survive a reboot
# without needing a host-writable filesystem. NVM byte 0 is reserved for the
# brownout retry counter (see safemode.py); settings live at _BASE onward,
# guarded by a magic byte so uninitialised NVM falls back to the defaults.
import microcontroller

from lock_config import (
    OVERRIDE_PRESSES, INACTIVITY_S, BL_LEVEL, BLE_ALLOW_REMOTE_UNLOCK,
    BLE_UNLOCK_ON_CALL, OVR_MIN, OVR_MAX, OVR_STEP, SLEEP_OPTIONS,
    BRIGHT_OPTIONS, DEFAULT_MODE_IDX, DEFAULT_ACCENT_IDX, ACCENT_COLORS,
    SCREEN_FLIPPED_DEFAULT,
)

_MAGIC = 0x62        # bump when the NVM layout changes (forces defaults once);
                     # bumped from 0x61 to 0x62 to add screen_flipped at a new
                     # offset (_BASE+10) -- same reasoning as the 0x60->0x61
                     # bump below: a box flashed before this change would
                     # otherwise read whatever stray byte happens to sit at
                     # that never-before-written offset as a bogus flip flag.
                     # 0x60->0x61 was for the override_presses high byte
                     # (OVR_MAX raised from 255 to 500 -- a single NVM byte
                     # can't hold that, see Settings.save/_load) so a box
                     # flashed before this change doesn't read a stray erased
                     # byte as a garbage high byte and reconstruct a bogus
                     # override count
_BASE = 8            # NVM offset for settings (byte 0 = brownout counter)


def _step_in(options, value, direction):
    try:
        i = options.index(value)
    except ValueError:
        i = 0
    i = max(0, min(len(options) - 1, i + (1 if direction > 0 else -1)))
    return options[i]


def _step_clamped(value, direction, step, lo, hi):
    return max(lo, min(hi, value + (step if direction > 0 else -step)))


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
        except Exception:
            pass

    def save(self):
        try:
            nvm = microcontroller.nvm
            if nvm is None:
                return
            nvm[_BASE] = _MAGIC
            # 2-byte little-endian split -- OVR_MAX=500 exceeds a single
            # byte's 0-255 range. Low byte kept at the original offset
            # (_BASE+1) so this stays a value-format-only change, not a
            # layout shift of every other field; high byte appended at a
            # new offset (_BASE+9) rather than reordering the existing ones.
            ovr = max(1, min(OVR_MAX, int(self.override_presses)))
            nvm[_BASE + 1] = ovr & 0xFF
            nvm[_BASE + 9] = (ovr >> 8) & 0xFF
            nvm[_BASE + 2] = 1 if self.auto_open else 0
            nvm[_BASE + 3] = max(0, min(255, int(self.sleep_s)))
            nvm[_BASE + 4] = max(0, min(100, int(self.bright_pct)))
            nvm[_BASE + 5] = 1 if self.allow_remote_unlock else 0
            nvm[_BASE + 6] = 1 if self.unlock_on_call else 0
            nvm[_BASE + 7] = max(0, min(1, int(self.theme_mode)))
            nvm[_BASE + 8] = max(0, min(len(ACCENT_COLORS) - 1, int(self.accent_idx)))
            nvm[_BASE + 10] = 1 if self.screen_flipped else 0
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

    def toggle_remote_unlock(self):
        # "R Unlock" on the box's own Settings screen, "Remote unlock" in the
        # phone app -- same field (allow_remote_unlock), same NVM byte. ON
        # lets the app's Open/Close controls actually release the box early
        # (BLE command "unlock", gated in lock_controller.apply_ble_command);
        # OFF makes the box ignore that command and only alert-through
        # (screen notification) on an incoming call, same as always. Off by
        # default: see BLE_ALLOW_REMOTE_UNLOCK in lock_config.py for why.
        self.allow_remote_unlock = not self.allow_remote_unlock
        self.save()
