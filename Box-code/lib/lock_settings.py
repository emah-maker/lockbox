# lock_settings.py -- user settings persisted in NVM so they survive a reboot
# without needing a host-writable filesystem. NVM byte 0 is reserved for the
# brownout retry counter (see safemode.py); settings live at _BASE onward,
# guarded by a magic byte so uninitialised NVM falls back to the defaults.
import microcontroller

from lock_config import (
    OVERRIDE_PRESSES, INACTIVITY_S, BL_LEVEL, BLE_ALLOW_REMOTE_UNLOCK,
    OVR_MIN, OVR_MAX, OVR_STEP, SLEEP_OPTIONS, BRIGHT_OPTIONS,
)

_MAGIC = 0x5E        # bump when the NVM layout changes (forces defaults once);
                     # bumped to add the allow_remote_unlock byte so a box
                     # flashed before this feature doesn't read a stray
                     # erased byte in that slot as a real saved value
_BASE = 8            # NVM offset for settings (byte 0 = brownout counter)


def _step_in(options, value, direction):
    try:
        i = options.index(value)
    except ValueError:
        i = 0
    i = max(0, min(len(options) - 1, i + (1 if direction > 0 else -1)))
    return options[i]


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
        self._load()

    def _load(self):
        try:
            nvm = microcontroller.nvm
            if nvm is not None and nvm[_BASE] == _MAGIC:
                self.override_presses = nvm[_BASE + 1]
                self.auto_open = bool(nvm[_BASE + 2])
                self.sleep_s = nvm[_BASE + 3]
                self.bright_pct = nvm[_BASE + 4]
                self.allow_remote_unlock = bool(nvm[_BASE + 5])
        except Exception:
            pass

    def save(self):
        try:
            nvm = microcontroller.nvm
            if nvm is None:
                return
            nvm[_BASE] = _MAGIC
            nvm[_BASE + 1] = max(1, min(255, int(self.override_presses)))
            nvm[_BASE + 2] = 1 if self.auto_open else 0
            nvm[_BASE + 3] = max(0, min(255, int(self.sleep_s)))
            nvm[_BASE + 4] = max(0, min(100, int(self.bright_pct)))
            nvm[_BASE + 5] = 1 if self.allow_remote_unlock else 0
        except Exception:
            pass

    def bright_level(self):
        return self.bright_pct / 100.0

    def toggle_auto(self):
        # Auto-open is a boolean -- the settings list toggles it in place
        self.auto_open = not self.auto_open
        self.save()

    # ----- called by the settings UI: swipe up/down / +/- on a detail page -----
    def adjust(self, idx, direction):
        # swipe up/down: direction +1 = up/increase, -1 = down/decrease (clamped)
        if idx == 0:
            v = self.override_presses + OVR_STEP * direction
            self.override_presses = max(OVR_MIN, min(OVR_MAX, v))
        elif idx == 1:
            self.auto_open = direction > 0
        elif idx == 2:
            self.sleep_s = _step_in(SLEEP_OPTIONS, self.sleep_s, direction)
        elif idx == 3:
            self.bright_pct = _step_in(BRIGHT_OPTIONS, self.bright_pct, direction)
        elif idx == 4:
            self.allow_remote_unlock = direction > 0
        self.save()

    def toggle_remote_unlock(self):
        self.allow_remote_unlock = not self.allow_remote_unlock
        self.save()
