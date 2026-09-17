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


# --- 7. A brightness byte the box cannot come back from --------------------
#
# Two fields in _load() are read defensively -- override_presses falls back
# to its default when the reconstructed value is out of range, and
# override_timeout is clamped -- both with comments saying why: a
# never-before-written offset can hold anything, and the magic byte is only
# as good as the last time someone remembered to bump it.
#
# bright_pct was read raw. It is the one field where a bad byte is not
# recoverable at the box: bright_level() returns pct/100, code.py feeds that
# to Backlight.set_level every frame, and 0 blanks the panel -- while
# Backlight._on stays True, so the screen is never considered "off" and
# backlight.on() does nothing. The box keeps running, keeps taking touches
# and keeps counting down; the user just cannot see any of it, including
# the settings row that would fix it. Only a BLE push from the app can
# recover it, and that path already snaps this value (decode_settings).
from lock_power import Backlight  # noqa: E402 -- pure, only imports lock_config


class _Panel:
    """Just enough display for Backlight: a settable brightness."""
    brightness = 1.0


# The mechanism that makes 0 unrecoverable rather than merely dark. Not the
# bug -- the reason the bug has no floor.
_panel = _Panel()
_bl = Backlight(_panel)
_bl.set_level(0.0)
check("(7) a zero level blanks the panel but leaves it 'on'",
      _panel.brightness == 0.0 and _bl.is_on)
_bl.on()
check("(7) so backlight.on() cannot bring it back", _panel.brightness == 0.0)

s = fresh()
s.bright_pct = 70
s.save()
_nvm._buf[BASE + 4] = 0            # the byte an unwritten/corrupt region holds
loaded = lock_settings.Settings()
check("(7) a zero brightness byte does not survive the load",
      loaded.bright_pct != 0, repr(loaded.bright_pct))
check("(7) and cannot blank the panel",
      loaded.bright_level() > 0.0, repr(loaded.bright_level()))

# Every byte value, not just 0: the point is that nothing an unwritten
# offset can hold produces a setting the box cannot be driven from.
_bad = []
for _b in range(256):
    _nvm._buf[BASE + 4] = _b
    _st = lock_settings.Settings()
    if _st.bright_pct not in lock_config.BRIGHT_OPTIONS:
        _bad.append((_b, _st.bright_pct))
check("(7) every possible brightness byte loads as a real BRIGHT_OPTIONS member",
      not _bad, repr(_bad[:6]))

# Being an exact member is the requirement, not merely being non-zero:
# _step_in does options.index(value), so a value that is merely in range
# resets the on-box stepper to the first option on the next swipe instead
# of stepping from where it was. Same reason decode_settings snaps the BLE
# path (see snap_to_option's docstring).
_nvm._buf[BASE + 4] = 42
_st = lock_settings.Settings()
_before = _st.bright_pct
_st.adjust(3, +1)
check("(7) an off-option byte still steps UP from where it landed",
      _st.bright_pct > _before, "{} -> {}".format(_before, _st.bright_pct))

# ...and a value this build legitimately saved is left exactly alone.
s = fresh()
for _opt in lock_config.BRIGHT_OPTIONS:
    s.bright_pct = _opt
    s.save()
    check("(7) a saved brightness of {} round-trips unchanged".format(_opt),
          lock_settings.Settings().bright_pct == _opt)

# --- 8. The doors must agree ----------------------------------------------
#
# Section 7 fixed brightness. Four more fields were still read raw, and the
# trigger for all of them is the one section 7 describes: a stale or
# uninitialised NVM region whose byte 0 happens to equal _MAGIC makes
# _load() trust the whole block behind it. The magic guards a LAYOUT, not a
# value -- it catches only the case where someone remembered to bump it.
#
# What "defended" has to mean here is not this file's opinion. It is
# lock_protocol.decode_settings: every one of these fields already has a
# validation rule for the BLE door, because a phone can send anything. The
# two doors must agree. A number the radio would refuse to apply as-is must
# not be applied just because it arrived from flash instead -- flash is, if
# anything, the less trustworthy of the two, since nothing on the far side
# of it is guaranteed to be a current build of this firmware.
import json                                  # noqa: E402
from lock_protocol import decode_settings    # noqa: E402 -- pure, no hardware


def _via_ble(key, value):
    """What decode_settings makes of `value` arriving over the radio -- the
    rule each check below asserts the NVM path now matches, read from the
    real codec rather than restated here where the two could drift."""
    return decode_settings(json.dumps({key: value}))[key]


def _seeded():
    """A zeroed region with this build's magic and defaults written into
    it, so a single poked byte below is read behind a VALID magic -- which
    is the whole failure mode: the guard passes and the rest of the block
    is trusted."""
    st = fresh()
    st.save()
    return st


# --- 8a. accent_idx -- the byte that is used as a SUBSCRIPT ---------------
#
# The only one of the four whose consequence is an exception rather than a
# wrong value: lock_ui_theme.set_theme does `accent_set[accent_idx]` against
# one of lock_config's two 8-entry per-mode tuples, and
# LockController.__init__ calls set_theme as its third statement. __init__
# runs at import time in code.py, BEFORE the `while True:` whose try/except
# catches every other fault in this firmware. An exception reached from
# there is not a degraded screen, it is a box that does not boot.
#
# WHAT THIS CHECK DOES AND DOES NOT PROVE, because the difference matters to
# anyone who later wonders why the value is guarded twice. set_theme clamps
# its own argument today, so the bad subscript is absorbed one layer in and
# the box does currently boot -- wearing somebody else's accent. This is
# still the check worth having. The stored index is wrong everywhere ELSE it
# is read regardless of set_theme (encode_settings ships it to the phone as
# "acc":255, which is not an index into the app's ACCENT_KEYS either), and
# set_theme's clamp is a guard two files away, inside a UI method whose own
# comments say nothing about holding the boot up. Defending the value where
# it enters means no future reader of accent_idx has to be the one that
# holds.
_seeded()
_bad = []
for _b in range(256):
    _nvm._buf[BASE + 8] = _b
    _idx = lock_settings.Settings().accent_idx
    try:
        lock_config.ACCENT_COLORS_DARK[_idx]     # the subscript set_theme does
        lock_config.ACCENT_COLORS_LIGHT[_idx]
    except (IndexError, TypeError):
        _bad.append((_b, _idx))
check("(8a) every possible accent byte loads an index set_theme can subscript",
      not _bad, repr(_bad[:6]))

_seeded()
_disagree = []
for _b in range(256):
    _nvm._buf[BASE + 8] = _b
    got = lock_settings.Settings().accent_idx
    want = _via_ble("acc", _b)
    if got != want:
        _disagree.append((_b, got, want))
check("(8a) and loads exactly what the radio would make of the same number",
      not _disagree, repr(_disagree[:6]))

s = _seeded()
_kept = []
for _i in range(len(lock_config.ACCENT_COLORS)):
    s.accent_idx = _i
    s.save()
    if lock_settings.Settings().accent_idx != _i:
        _kept.append(_i)
check("(8a) and a legitimately saved accent is left exactly alone",
      not _kept, repr(_kept))

# --- 8b. sleep_s -- the byte the detail page calls .index() on ------------
#
# Same shape as brightness in section 7, and the same fix, for the same
# reason: SLEEP_OPTIONS is a discrete option tuple, and two call sites look
# a stored value up IN it rather than merely comparing against it.
# lock_settings._step_in swallows the ValueError and silently restarts the
# on-box stepper from the first option; lock_ui_widgets.setting_fraction
# (the Sleep detail page's progress track, via _refresh_detail_track) does
# NOT, so opening that row throws instead of drawing. That one is caught by
# code.py's run-loop guard rather than killing the box, but the row stays
# unreachable for as long as the byte stays bad -- and the byte only gets
# better if the user can reach the row.
try:
    lock_config.SLEEP_OPTIONS.index(38)
    _raises = False
except ValueError:
    _raises = True
check("(8b) an off-option sleep value is not a SLEEP_OPTIONS index at all",
      _raises)

_seeded()
_bad = []
for _b in range(256):
    _nvm._buf[BASE + 3] = _b
    _st = lock_settings.Settings()
    if _st.sleep_s not in lock_config.SLEEP_OPTIONS:
        _bad.append((_b, _st.sleep_s))
check("(8b) every possible sleep byte loads as a real SLEEP_OPTIONS member",
      not _bad, repr(_bad[:6]))

_seeded()
_disagree = []
for _b in range(256):
    _nvm._buf[BASE + 3] = _b
    got = lock_settings.Settings().sleep_s
    want = _via_ble("sleep", _b)
    if got != want:
        _disagree.append((_b, got, want))
check("(8b) and loads exactly what the radio would make of the same number",
      not _disagree, repr(_disagree[:6]))

# Snapped and not merely range-checked, for section 7's reason: being an
# exact member is the requirement, so the next swipe steps FROM where the
# value landed instead of jumping back to the first option.
_seeded()
_nvm._buf[BASE + 3] = 38          # nearest member is 30, but 38 is not one
_st = lock_settings.Settings()
_before = _st.sleep_s
_st.adjust(2, +1)
check("(8b) an off-option byte still steps UP from where it landed",
      _st.sleep_s > _before, "{} -> {}".format(_before, _st.sleep_s))

# --- 8c. theme_mode -- two options, and a row that looks broken -----------
#
# MODE_COLORS has exactly two entries and set_theme subscripts it the same
# way it subscripts the accent tuple. The user-visible half is subtler:
# every reader of this field asks `== 1`, so a stored 255 READS as Dark --
# while lock_settings_nav's cycle-on-tap is `0 if s.theme_mode else 1`,
# which sees 255 as truthy and sets 0. Dark before the tap, Dark after it.
# The Theme row simply does nothing the first time it is pressed, which is
# indistinguishable from a dead touch target.
_seeded()
_bad = []
for _b in range(256):
    _nvm._buf[BASE + 7] = _b
    _m = lock_settings.Settings().theme_mode
    try:
        lock_config.MODE_COLORS[_m]              # the subscript set_theme does
        _ok = _m in (0, 1)
    except (IndexError, TypeError):
        _ok = False
    if not _ok:
        _bad.append((_b, _m))
check("(8c) every possible theme byte loads a mode set_theme can subscript",
      not _bad, repr(_bad[:6]))

_seeded()
_disagree = []
for _b in range(256):
    _nvm._buf[BASE + 7] = _b
    got = lock_settings.Settings().theme_mode
    want = _via_ble("thm", _b)
    if got != want:
        _disagree.append((_b, got, want))
check("(8c) and loads exactly what the radio would make of the same number",
      not _disagree, repr(_disagree[:6]))

_seeded()
_nvm._buf[BASE + 7] = 0xFF
_st = lock_settings.Settings()
# The two expressions the box actually runs, quoted rather than imported:
# lock_ui_widgets.fmt_setting(6, s) for the row's text, and
# lock_settings_nav's cycle-on-tap for what a press does to it.
_shown_before = "Light" if _st.theme_mode == 1 else "Dark"
_st.theme_mode = 0 if _st.theme_mode else 1
_shown_after = "Light" if _st.theme_mode == 1 else "Dark"
check("(8c) and the Theme row's first tap actually changes what it reads",
      _shown_before != _shown_after,
      "{} -> {}".format(_shown_before, _shown_after))

# --- 8d. lock_angle / unlock_angle -- found while fixing the three above --
#
# Not on the original list, and worth naming: these two are read as
# `nvm[...] - _ANGLE_BYTE_OFFSET`, so an unwritten 0xFF becomes 165 degrees
# against a servo whose real range is -90..90. _pack() clamps them on the
# way OUT and decode_settings clamps "langle"/"uangle" on the way in from
# the radio, so the load path was the one door of the three that did not.
#
# No crash: lock_servo.Servo._write_angle clamps before driving, and
# bar_fill_width pins the detail track's fraction to 1.0. What is left is a
# lie told consistently -- the Lock pos row reads 165, the app is told
# "langle":165 by encode_settings, and the servo quietly goes to 90. A
# number the box displays and transmits but does not obey is exactly what
# the clamp on the way out already exists to prevent.
_seeded()
_bad = []
for _b in range(256):
    _nvm._buf[BASE + 11] = _b
    _nvm._buf[BASE + 12] = _b
    _st = lock_settings.Settings()
    for _name, _a in (("lock", _st.lock_angle), ("unlock", _st.unlock_angle)):
        if not (lock_config.SERVO_ANGLE_MIN <= _a <= lock_config.SERVO_ANGLE_MAX):
            _bad.append((_b, _name, _a))
check("(8d) every possible angle byte loads an angle the servo can reach",
      not _bad, repr(_bad[:6]))

_seeded()
_disagree = []
for _b in range(256):
    _nvm._buf[BASE + 11] = _b
    _nvm._buf[BASE + 12] = _b
    _st = lock_settings.Settings()
    # The byte stores (angle + 90), so the equivalent number over the radio
    # is _b - _ANGLE_BYTE_OFFSET -- same value, different encoding.
    want = _via_ble("langle", _b - lock_settings._ANGLE_BYTE_OFFSET)
    if _st.lock_angle != want or _st.unlock_angle != want:
        _disagree.append((_b, _st.lock_angle, _st.unlock_angle, want))
check("(8d) and loads exactly what the radio would make of the same angle",
      not _disagree, repr(_disagree[:6]))

s = _seeded()
_kept = []
for _a in (lock_config.SERVO_ANGLE_MIN, -45, 0, 45, lock_config.SERVO_ANGLE_MAX):
    s.lock_angle = _a
    s.unlock_angle = _a
    s.save()
    r = lock_settings.Settings()
    if r.lock_angle != _a or r.unlock_angle != _a:
        _kept.append((_a, r.lock_angle, r.unlock_angle))
check("(8d) and a legitimately saved angle is left exactly alone",
      not _kept, repr(_kept))

print("")
print("{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
