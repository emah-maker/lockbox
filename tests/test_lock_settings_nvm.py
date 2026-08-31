"""Host checks on how Settings persists itself to NVM.

Why this file exists. Settings.save() used to perform fourteen separate
`nvm[_BASE + n] = value` assignments. On CircuitPython each single-byte
assignment to microcontroller.nvm is a read-modify-ERASE-write of the NVM
partition, and flash erase is tens of milliseconds -- so one settings-detail
button release cost ~14 erase cycles back to back, several hundred
milliseconds of blocked run loop during which touch is not sampled at all.
It was reported from hardware as "the add and subtract buttons take a long
time to press - long cooldown".

The fix is one region write, and none at all when nothing changed. Neither
property is visible in the values that come back out -- a byte-wise save
round-trips exactly as correctly as a slice save -- so a correctness test
alone would not notice the regression. These assertions COUNT the write
operations, which is the only way the performance property can be pinned
against a future "simplification" back to per-field assignment.

Run: python tests/test_lock_settings_nvm.py
"""
import os
import sys
import types

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(REPO, "Box-code", "lib")
sys.path.insert(0, LIB)

_passed = 0
_failed = 0


def check(name, ok, detail=""):
    global _passed, _failed
    if ok:
        _passed += 1
        print("PASS " + name)
    else:
        _failed += 1
        print("FAIL " + name + ((" -- " + detail) if detail else ""))


class CountingNvm:
    """Stand-in for microcontroller.nvm that behaves like the real
    ByteArray for reads/writes AND records how many distinct write
    operations were performed -- a slice assignment counts as one, a
    single-byte assignment counts as one each, which is exactly the
    distinction that matters on flash."""

    def __init__(self, size=64):
        self._buf = bytearray(size)
        self.writes = 0
        self.bytes_written = 0
        self.allow_slice_write = True

    def __getitem__(self, key):
        return self._buf[key]

    def __setitem__(self, key, value):
        if isinstance(key, slice):
            if not self.allow_slice_write:
                # Model a build whose nvm rejects slice assignment, so the
                # explicit byte-wise fallback in save() gets exercised.
                raise TypeError("slice assignment not supported")
            self._buf[key] = value
            self.writes += 1
            self.bytes_written += len(value)
        else:
            self._buf[key] = value
            self.writes += 1
            self.bytes_written += 1

    def __len__(self):
        return len(self._buf)


_nvm = CountingNvm()
_mc = types.ModuleType("microcontroller")
_mc.nvm = _nvm
sys.modules.setdefault("microcontroller", _mc)

import lock_config  # noqa: E402 -- after the stub above, deliberately
import lock_settings  # noqa: E402

BASE = lock_settings._BASE
END = BASE + lock_settings._MAX_FIELD_OFF + 1
REGION = lock_settings._MAX_FIELD_OFF + 1


def fresh():
    """A Settings built against a zeroed NVM, so __init__'s own _load()
    finds no magic byte and falls back to the compiled-in defaults."""
    _nvm._buf = bytearray(len(_nvm._buf))
    _nvm.writes = 0
    _nvm.bytes_written = 0
    _nvm.allow_slice_write = True
    return lock_settings.Settings()


# --- 1. One write per save, not fourteen -----------------------------------
s = fresh()
s.override_presses = 300
_nvm.writes = 0
s.save()
check("(1) a save that changes something performs exactly ONE nvm write",
      _nvm.writes == 1, "performed {}".format(_nvm.writes))
check("(1) that one write covers the whole settings region",
      _nvm.bytes_written == REGION,
      "wrote {} bytes, region is {}".format(_nvm.bytes_written, REGION))

# --- 2. Zero writes when nothing changed -----------------------------------
_nvm.writes = 0
s.save()
check("(2) an unchanged save performs ZERO nvm writes",
      _nvm.writes == 0, "performed {}".format(_nvm.writes))
_nvm.writes = 0
s.save()
s.save()
s.save()
check("(2) repeated unchanged saves stay at zero writes",
      _nvm.writes == 0, "performed {}".format(_nvm.writes))

# A release that lands on a clamp limit is the real-world case: the user
# holds + at the maximum, adjust() clamps to the same value, and the old
# save paid a full erase cycle for a no-op.
s.override_presses = lock_settings.OVR_MAX
s.save()
_nvm.writes = 0
s.override_presses = lock_settings.OVR_MAX   # clamped to the same value
s.save()
check("(2) a save at an unchanged clamp limit writes nothing",
      _nvm.writes == 0, "performed {}".format(_nvm.writes))

# --- 3. Every field round-trips through the new layout ---------------------
# The performance fix rewrote the byte packing, so this is the guard that it
# still agrees with _load() offset for offset. A transposed offset would be
# silent: settings would simply come back wrong on the next boot.
s = fresh()
s.override_presses = 305          # exercises the 2-byte low/high split
s.auto_open = False
s.sleep_s = 30
s.bright_pct = 70
s.allow_remote_unlock = True
s.unlock_on_call = True
s.theme_mode = 1
s.accent_idx = 3
s.screen_flipped = True
s.lock_angle = -45                # exercises the +90 byte offset
s.unlock_angle = 90
s.override_timeout = 2.5          # exercises the tenths encoding
s.save()

r = lock_settings.Settings()       # re-reads the same fake NVM
check("(3) override_presses round-trips across its 2-byte split",
      r.override_presses == 305, repr(r.override_presses))
check("(3) auto_open round-trips", r.auto_open is False, repr(r.auto_open))
check("(3) sleep_s round-trips", r.sleep_s == 30, repr(r.sleep_s))
check("(3) bright_pct round-trips", r.bright_pct == 70, repr(r.bright_pct))
check("(3) allow_remote_unlock round-trips",
      r.allow_remote_unlock is True, repr(r.allow_remote_unlock))
check("(3) unlock_on_call round-trips",
      r.unlock_on_call is True, repr(r.unlock_on_call))
check("(3) theme_mode round-trips", r.theme_mode == 1, repr(r.theme_mode))
check("(3) accent_idx round-trips", r.accent_idx == 3, repr(r.accent_idx))
check("(3) screen_flipped round-trips",
      r.screen_flipped is True, repr(r.screen_flipped))
check("(3) lock_angle round-trips as a negative angle",
      r.lock_angle == -45, repr(r.lock_angle))
check("(3) unlock_angle round-trips at its maximum",
      r.unlock_angle == 90, repr(r.unlock_angle))
check("(3) override_timeout round-trips through tenths",
      abs(r.override_timeout - 2.5) < 1e-9, repr(r.override_timeout))

# --- 4. The magic byte still gates the load -------------------------------
check("(4) save writes the magic byte at _BASE",
      _nvm[BASE] == lock_settings._MAGIC,
      "got {:#x}".format(_nvm[BASE]))
_nvm._buf[BASE] = 0x00            # simulate a box flashed before this layout
d = lock_settings.Settings()
check("(4) a missing magic byte falls back to defaults, not stored bytes",
      d.override_presses == lock_settings.OVERRIDE_PRESSES,
      repr(d.override_presses))

# --- 4b. A stored override target the box cannot honour -------------------
# The magic byte guards a whole layout, not a single field, so it only helps
# when the layout actually changed. The high byte of override_presses sits at
# _BASE+9, and a stray 0xFF there reconstructs a target in the tens of
# thousands. That failure is silent in the worst way: the override overlay
# still appears and still counts up on every press, it simply counts toward a
# limit no hand will ever reach -- an emergency unlock that looks alive and is
# not. Out of range must fall back to the compiled-in default.
s = fresh()
s.override_presses = 25
s.save()
_nvm._buf[BASE + 9] = 0xFF        # stray high byte under a valid magic
g = lock_settings.Settings()
check("(4b) a garbage high byte falls back to the default target",
      g.override_presses == lock_settings.OVERRIDE_PRESSES,
      repr(g.override_presses))
check("(4b) and the fallback is a target a person can actually press to",
      lock_config.OVR_MIN <= g.override_presses <= lock_config.OVR_MAX,
      repr(g.override_presses))

s = fresh()
s.override_presses = 25
s.save()
_nvm._buf[BASE + 1] = 0x00        # low byte zeroed -> target 0
_nvm._buf[BASE + 9] = 0x00
z = lock_settings.Settings()
check("(4b) a zero target falls back rather than unlocking on one press",
      z.override_presses == lock_settings.OVERRIDE_PRESSES,
      repr(z.override_presses))

# A legitimately stored value must still survive -- the clamp is a guard on
# corruption, not a cap that quietly discards the user's own setting.
s = fresh()
s.override_presses = 300          # in range, needs both bytes
s.save()
ok = lock_settings.Settings()
check("(4b) an in-range 2-byte target still round-trips untouched",
      ok.override_presses == 300, repr(ok.override_presses))

# --- 5. The region stays inside its NVM budget ----------------------------
# lock_log.py owns everything from NVM_LOG_BASE up. If the packed region ever
# reached into it, the two would silently corrupt each other -- the region
# map in lock_config.py says nothing on the device enforces this.
check("(5) the packed region fits NVM_SETTINGS_LEN",
      REGION <= lock_settings.NVM_SETTINGS_LEN,
      "region {} vs budget {}".format(REGION, lock_settings.NVM_SETTINGS_LEN))
check("(5) the packed region ends before lock_log's base",
      END <= lock_config.NVM_LOG_BASE,
      "ends at {}, log base {}".format(END, lock_config.NVM_LOG_BASE))

# --- 6. Byte-wise fallback still persists on a build without slice writes --
# The fallback matters more than it looks: without an explicit except path it
# would fall out to save()'s outer `except Exception: pass`, turning "slower
# saves" into "settings never save again", which is far worse than the
# latency the slice write exists to fix.
s = fresh()
_nvm.allow_slice_write = False
s.bright_pct = 10
_nvm.writes = 0
s.save()
check("(6) a build without slice assignment still writes every byte",
      _nvm.writes == REGION,
      "performed {} writes, expected {}".format(_nvm.writes, REGION))
back = lock_settings.Settings()
check("(6) and the values still round-trip via the fallback",
      back.bright_pct == 10, repr(back.bright_pct))

print("")
print("{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
