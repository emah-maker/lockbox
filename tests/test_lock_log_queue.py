"""Host tests for the NVM-backed session queue in Box-code/lib/lock_log.py.

lock_log.py was rewritten from a CSV/SD-card session log into a bounded,
NVM-persisted binary queue (see its header comment and
docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
Sec3.1/3.2). SessionLog.__init__ touches microcontroller.nvm at import time
via the `microcontroller` module (no board/pwmio/etc. -- lock_log.py itself
imports nothing else CircuitPython-only), so that single module is stubbed
here with a mutable bytearray standing in for real NVM, following this repo's
existing convention (see test_lock_controller_swipe.py) of stubbing only
what's needed for import/construction to succeed rather than reimplementing
hardware. No SD card, RTC, or BLE involved -- record()/backfill_epoch()/
mark_sent()/ack()/to_json() are all pure logic over that byte buffer.

Run: python tests/test_lock_log_queue.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib"))

_microcontroller = types.ModuleType("microcontroller")
_microcontroller.nvm = None  # each test sets this explicitly before use
sys.modules["microcontroller"] = _microcontroller

from lock_config import (
    LOG_MAX_PENDING, NVM_SETTINGS_BASE, NVM_SETTINGS_LEN, NVM_LOG_BASE,
)
from lock_log import SessionLog, _BASE, _MAGIC, _ENTRY_SIZE, _EPOCH_NONE

# lock_settings.py is imported only for this region check. It pulls in more of
# lock_config than lock_log does, but nothing CircuitPython-only beyond the
# `microcontroller` stub already installed above.
import lock_settings

_passed = 0
_failed = 0


def check(name, cond):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS", name)
    else:
        _failed += 1
        print("FAIL", name)


def new_nvm(size=4096):
    """Fresh, all-zero NVM: byte at _BASE is 0, never equal to _MAGIC, so
    every SessionLog() constructed over it starts with an empty queue --
    same as a box that has never written this region."""
    buf = bytearray(size)
    _microcontroller.nvm = buf
    return buf


def entries_of(log):
    """(planned_s, actual_s, completed, epoch) for every pending entry, in
    queue order -- to_json()'s own fields, but as a Python tuple so tests
    don't have to string-match JSON."""
    return [e[:4] for e in log._pending]


# ===================================================================
# record() / to_json() -- basic shape and wire format
# ===================================================================
new_nvm()
log = SessionLog()
check("fresh queue has_pending is False", log.has_pending is False)
check("fresh queue to_json is empty array", log.to_json() == "[]")

log.record(300, 300, True, 1000)
check("has_pending True after one record", log.has_pending is True)
check("to_json shape for one completed entry",
      log.to_json() == '[{"p":300,"a":300,"c":1,"t":1000}]')

log.record(600, 550, False, 2000)
check("to_json appends second entry in order",
      log.to_json() == '[{"p":300,"a":300,"c":1,"t":1000},'
                        '{"p":600,"a":550,"c":0,"t":2000}]')
check("completed normalizes truthy/falsy to 1/0",
      entries_of(log) == [(300, 300, 1, 1000), (600, 550, 0, 2000)])

# ===================================================================
# binary layout: byte order and per-field offsets within one 9-byte
# record (planned_s:2B + actual_s:2B + completed:1B + epoch:4B, all BE)
# ===================================================================
new_nvm()
log = SessionLog()
log.record(0x012C, 0x0226, True, 0x12345678)  # 300, 550, completed, epoch
off = _BASE + 2
nvm = _microcontroller.nvm
check("magic byte written", nvm[_BASE] == _MAGIC)
check("count byte written", nvm[_BASE + 1] == 1)
check("planned_s big-endian", nvm[off] == 0x01 and nvm[off + 1] == 0x2C)
check("actual_s big-endian", nvm[off + 2] == 0x02 and nvm[off + 3] == 0x26)
check("completed byte", nvm[off + 4] == 1)
check("epoch big-endian 32-bit",
      (nvm[off + 5], nvm[off + 6], nvm[off + 7], nvm[off + 8]) ==
      (0x12, 0x34, 0x56, 0x78))

# ===================================================================
# range limits: NVM fields clamp on persistence (_write16/_write32), but
# the in-RAM entry just recorded is NOT clamped until it round-trips
# through NVM -- record() itself stores the raw int (see record()'s
# docstring-adjacent code, no clamp call before self._pending.append).
# ===================================================================
new_nvm()
log = SessionLog()
log.record(-5, 70000, True, -1)          # planned_s negative, actual_s > u16
check("unclamped value visible before reload (planned_s)",
      entries_of(log)[0][0] == -5)
check("unclamped value visible before reload (actual_s)",
      entries_of(log)[0][1] == 70000)

reloaded = SessionLog()                   # fresh instance, same NVM buffer
check("planned_s clamps to 0 on persistence round-trip",
      entries_of(reloaded)[0][0] == 0)
check("actual_s clamps to 0xFFFF on persistence round-trip",
      entries_of(reloaded)[0][1] == 0xFFFF)
check("epoch=-1 (never-synced sentinel) survives round-trip as -1",
      entries_of(reloaded)[0][3] == -1)

# ===================================================================
# backfill_epoch(): fills epoch only for entries recorded with epoch=None
# (mono remembered), skips already-synced entries and in-flight ones
# ===================================================================
new_nvm()
log = SessionLog()
log.record(100, 100, True, None, now=50.0)     # unsynced, mono=50.0
log.record(200, 200, True, 9999)               # already synced -- untouched
log.mark_sent()                                # both entries now "in flight"
log.record(300, 300, True, None, now=60.0)     # unsynced, recorded AFTER mark_sent

check("entry recorded with real epoch reads back before backfill",
      entries_of(log)[1][3] == 9999)
check("entry recorded with no epoch reads -1 before backfill",
      entries_of(log)[0][3] == -1)

log.backfill_epoch(lambda mono: 1_700_000_000 + int(mono))

check("in-flight unsynced entry (idx 0) NOT backfilled (already sent)",
      entries_of(log)[0][3] == -1)
check("already-synced entry (idx 1) untouched by backfill",
      entries_of(log)[1][3] == 9999)
check("not-yet-sent unsynced entry (idx 2) IS backfilled",
      entries_of(log)[2][3] == 1_700_000_060)

# a second backfill call with a different mapping must be a no-op for
# entries that already got a real epoch (mono was cleared on backfill)
log.backfill_epoch(lambda mono: 1)
check("re-running backfill_epoch does not re-touch an already-filled entry",
      entries_of(log)[2][3] == 1_700_000_060)

# ===================================================================
# mark_sent() / ack(): batch-based clearing, mismatched acks ignored
# ===================================================================
new_nvm()
log = SessionLog()
log.record(1, 1, True, 1)
log.record(2, 2, True, 2)
seq = log.mark_sent()
check("mark_sent returns current pending length", seq == 2)

log.ack(0)
check("ack(0) is a no-op (guarded, can't ack zero entries)",
      len(entries_of(log)) == 2)
log.ack(-1)
check("ack(negative) is a no-op", len(entries_of(log)) == 2)
log.ack(3)
check("ack(seq) that doesn't match sent_seq is ignored", len(entries_of(log)) == 2)
log.ack(1)
check("ack(seq) smaller than sent_seq is also ignored (must match exactly)",
      len(entries_of(log)) == 2)

# a session finishes while the batch of 2 is in flight, then the app acks
# the ORIGINAL batch -- only the acked prefix clears, the new one survives
log.record(3, 3, True, 3)
check("new record during in-flight batch appended, not lost", len(entries_of(log)) == 3)
log.ack(2)
check("matching ack clears exactly the acked prefix",
      entries_of(log) == [(3, 3, 1, 3)])
check("ack resets the in-flight bookkeeping (remaining entry is not in-flight)",
      log._sent_batch == 0 and log._sent_live == 0)

# acking something never sent (sent_seq is 0, nothing marked)
log.ack(1)
check("ack when nothing was marked sent is ignored (no batch to match)",
      entries_of(log) == [(3, 3, 1, 3)])

# ===================================================================
# clear(): unconditional drop, independent of ack's batch bookkeeping
# ===================================================================
log.record(4, 4, False, 4)
log.mark_sent()
log.clear()
check("clear() empties the queue regardless of in-flight state",
      log.has_pending is False and log._sent_batch == 0 and log._sent_live == 0)

# ===================================================================
# queue-full / wraparound: the highest-value case -- NVM is small and
# this is where silent data loss would hide. record() caps at
# LOG_MAX_PENDING, evicting the OLDEST entry (pop(0)) on overflow.
# ===================================================================
new_nvm()
log = SessionLog()
for i in range(LOG_MAX_PENDING + 5):
    log.record(i, i, True, i)
check("queue never grows past LOG_MAX_PENDING",
      len(entries_of(log)) == LOG_MAX_PENDING)
check("oldest entries are the ones evicted (FIFO), newest 200 survive",
      entries_of(log)[0][0] == 5 and entries_of(log)[-1][0] == LOG_MAX_PENDING + 4)

# sent_seq bookkeeping across an overflow eviction while a batch is in flight
new_nvm()
log = SessionLog()
for i in range(LOG_MAX_PENDING):
    log.record(i, i, True, i)
sent = log.mark_sent()
check("full queue marked sent in one batch", sent == LOG_MAX_PENDING)
log.record(9999, 9999, True, 9999)   # one more session finishes -> overflow
check("overflow still caps the queue at LOG_MAX_PENDING",
      len(entries_of(log)) == LOG_MAX_PENDING)
check("overflow lowers the still-here count, not the batch's identity",
      log._sent_batch == LOG_MAX_PENDING and log._sent_live == LOG_MAX_PENDING - 1)
# The app durably stored the ORIGINAL batch of LOG_MAX_PENDING entries and
# acks with that size. That ack must still be honoured: the batch identity is
# what it echoes back, and it has no idea the box evicted one meanwhile.
# Before this was fixed, record()'s eviction also decremented the expected
# size, so this legitimate ack no longer matched, was silently dropped, and
# the entire queue was resent on the next connection for nothing.
log.ack(LOG_MAX_PENDING)
check("ack sized to the ORIGINAL sent batch is honoured after an intervening overflow",
      len(entries_of(log)) == 1)
check("only the surviving members of the acked batch are cleared -- the "
      "post-overflow session is NOT eaten",
      entries_of(log) == [(9999, 9999, 1, 9999)])
check("honouring the ack resets the in-flight bookkeeping",
      log._sent_batch == 0 and log._sent_live == 0)

# The whole in-flight batch evicted before its ack arrives: nothing of it is
# left to clear, but the ack must still be accepted and must not touch the
# newer entries that replaced it.
new_nvm()
log = SessionLog()
for i in range(3):
    log.record(i, i, True, i)
log.mark_sent()
for i in range(LOG_MAX_PENDING + 3):
    log.record(1000 + i, 1000 + i, True, 1000 + i)
check("entire in-flight batch aged out of the queue", log._sent_live == 0)
before = entries_of(log)
log.ack(3)
check("ack for a fully-evicted batch clears nothing and eats nothing",
      entries_of(log) == before)
check("ack for a fully-evicted batch still resets the in-flight bookkeeping",
      log._sent_batch == 0 and log._sent_live == 0)

# ===================================================================
# persistence across a simulated reboot: a fresh SessionLog constructed
# over the SAME backing bytearray must see the prior session's data
# ===================================================================
new_nvm()
log = SessionLog()
log.record(111, 111, True, 5000)
log.record(222, 222, False, 6000)
reboot = SessionLog()
check("reboot: entry count survives", len(entries_of(reboot)) == 2)
check("reboot: field values survive round-trip",
      entries_of(reboot) == [(111, 111, 1, 5000), (222, 222, 0, 6000)])
check("reboot: in-RAM-only in-flight bookkeeping resets (nothing is in flight after a reboot)",
      reboot._sent_batch == 0 and reboot._sent_live == 0)

# a mono-only (unsynced) entry does NOT survive a reboot as backfillable --
# record()'s own docstring: monotonic references don't carry across boots
new_nvm()
log = SessionLog()
log.record(1, 1, True, None, now=42.0)
reboot2 = SessionLog()
check("reboot: unsynced entry reloads as still-unsynced (epoch -1)",
      entries_of(reboot2)[0][3] == -1)
reboot2.backfill_epoch(lambda mono: 1)
check("reboot: reloaded unsynced entry can never be backfilled (mono lost)",
      entries_of(reboot2)[0][3] == -1)

# ===================================================================
# NVM smaller than the full queue needs: only the newest entries that
# physically fit are persisted -- older ones are truly, permanently lost
# (not just RAM-lost), unlike the in-RAM LOG_MAX_PENDING cap above.
# ===================================================================
fit = 3
small_size = _BASE + 2 + fit * _ENTRY_SIZE
new_nvm(small_size)
log = SessionLog()
for i in range(5):
    log.record(i, i, True, i)
check("RAM still holds all 5 (below LOG_MAX_PENDING)", len(entries_of(log)) == 5)
reboot3 = SessionLog()
check("NVM too small: only the newest `fit` entries persisted",
      entries_of(reboot3) == [(2, 2, 1, 2), (3, 3, 1, 3), (4, 4, 1, 4)])
check("NVM too small: the 2 oldest are permanently gone, not just RAM-evicted",
      len(entries_of(reboot3)) == fit)

# ===================================================================
# NVM region far too small even for the header (magic + count byte):
# must not crash, and record() must still work as a RAM-only queue
# ===================================================================
new_nvm(5)  # smaller than _BASE (24) -- can't even hold the magic byte
log = SessionLog()
try:
    log.record(1, 1, True, 1)
    ok = True
except Exception:
    ok = False
check("undersized NVM: record() does not raise", ok)
check("undersized NVM: entry still tracked in RAM", len(entries_of(log)) == 1)

# ===================================================================
# NVM unsupported (None) on this build -- pure-RAM fallback, no crash
# ===================================================================
_microcontroller.nvm = None
log = SessionLog()
check("nvm=None: constructs with empty queue", log.has_pending is False)
try:
    log.record(1, 1, True, 1)
    ok = True
except Exception:
    ok = False
check("nvm=None: record() does not raise", ok)
check("nvm=None: entry still tracked in RAM", len(entries_of(log)) == 1)

# ===================================================================
# magic-byte guard: a stale/foreign/corrupt region (or a bumped layout
# version) is discarded rather than misread
# ===================================================================
new_nvm()
log = SessionLog()
log.record(7, 7, True, 7)
_microcontroller.nvm[_BASE] = 0x00  # corrupt/old magic
reboot4 = SessionLog()
check("wrong magic byte -> queue treated as empty, not misparsed",
      reboot4.has_pending is False)

# a stored count exceeding what the buffer can physically hold must not
# crash -- the load loop bails out once the next record would run past
# the end of the buffer
new_nvm(_BASE + 2 + 2 * _ENTRY_SIZE)  # room for exactly 2 records
log = SessionLog()
log.record(1, 1, True, 1)
log.record(2, 2, True, 2)
_microcontroller.nvm[_BASE + 1] = 200  # lie: claim 200 records are present
reboot5 = SessionLog()
check("oversized stored count stops at the physical end of the buffer, no crash",
      len(entries_of(reboot5)) == 2)


# ===================================================================
# NVM region map: nothing on the device enforces who owns which byte,
# so two regions that overlap corrupt each other silently. These are
# the tripwire -- adding a settings field that grows past its
# reservation fails here, on the host, instead of on a board.
# ===================================================================
check("lock_log's base is derived from the region map, not hardcoded",
      _BASE == NVM_LOG_BASE)
check("lock_settings' base is derived from the region map, not hardcoded",
      lock_settings._BASE == NVM_SETTINGS_BASE)
check("the settings region starts after the brownout counter at byte 0",
      NVM_SETTINGS_BASE > 0)
check("every settings field lands inside the settings region's reservation",
      lock_settings._BASE + lock_settings._MAX_FIELD_OFF
      < NVM_SETTINGS_BASE + NVM_SETTINGS_LEN)
check("the settings region ends before the queue's magic byte begins",
      NVM_SETTINGS_BASE + NVM_SETTINGS_LEN <= NVM_LOG_BASE)

# _MAX_FIELD_OFF is only useful if it actually tracks the writes, so check it
# against what save() really touches rather than trusting the constant.
new_nvm()
_settings = lock_settings.Settings()
_settings.save()
_touched = [i for i, b in enumerate(_microcontroller.nvm) if b != 0]
check("settings.save() writes nothing below its own base",
      bool(_touched) and min(_touched) >= lock_settings._BASE)
check("settings.save() writes nothing past _MAX_FIELD_OFF (the constant is honest)",
      bool(_touched) and max(_touched) <= lock_settings._BASE + lock_settings._MAX_FIELD_OFF)
check("settings.save() therefore never reaches the queue's region",
      bool(_touched) and max(_touched) < NVM_LOG_BASE)


# ===================================================================
# clamp() hot-path exclusions. lock_config.clamp replaced this idiom
# at 21 sites, but six per-frame ones keep it inline on purpose: on
# CircuitPython a call is not free, and these run in the main loop,
# the 25fps countdown gauge, the ~50Hz override bar, and the three
# touch-hold steppers. The docstring says so, but a docstring does
# not fail a build, and "finish the migration" is an easy, plausible
# future tidy-up. This makes it fail here instead.
#
# Reads the source text rather than the imported objects because the
# thing being asserted IS the source form -- a converted call behaves
# identically, which is exactly why nothing else would catch it.
# ===================================================================
import glob
import re

_LIB = os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib")


def _lib_sources(prefix):
    """Every module in the prefix's family, e.g. lock_ui.py + lock_ui_*.py.

    Searched as a family rather than as one file because LockUI and
    LockController are each composed from per-concern mixins now, so a method
    lives in whichever of its class's modules owns that screen or concern.
    Which file it sits in is exactly what this assertion should NOT care
    about -- what it cares about is that the function, wherever it is, stays
    off the shared clamp().
    """
    return sorted(glob.glob(os.path.join(_LIB, prefix + ".py")) +
                  glob.glob(os.path.join(_LIB, prefix + "_*.py")))


def _body_of(prefix, name):
    """Source of one def, from its line to the next def at the same indent."""
    found = []
    for path in _lib_sources(prefix):
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        m = re.search("^([ \t]*)def %s\(" % re.escape(name), src, re.M)
        if not m:
            continue
        indent = m.group(1)
        rest = src[m.end():]
        nxt = re.search(r"^%sdef " % re.escape(indent), rest, re.M)
        found.append(rest[: nxt.start()] if nxt else rest)
    # Exactly one: none means the function was renamed or deleted and this
    # assertion has quietly stopped asserting anything; two means the mixins
    # define the same name twice, which shadows one of them (and which
    # tests/test_firmware_loads.py fails on directly).
    assert len(found) == 1, "expected exactly one def %s in %s*, found %d" % (name, prefix, len(found))
    return found[0]


for _prefix, _fn in (
    ("lock_controller", "update"),          # main run loop
    ("lock_ui", "_set_gauge"),              # countdown gauge, CLOCK_FPS=25
    ("lock_ui", "update_override_timeout"), # ~50Hz, "called every frame"
    ("lock_ui", "step_tag_picker_hold"),    # per-frame while a touch is held
    ("lock_ui", "step_tag_picker_skip_hold"),
    ("lock_ui", "step_tag_picker_swipe_progress"),
):
    check("%s stays clamp()-free (per-frame hot path)" % _fn,
          "clamp(" not in _body_of(_prefix, _fn))

# The flip side: the helper must actually be in use, or the six above are
# "exclusions" from nothing and this whole block is asserting a vacuum.
_converted = 0
for _prefix in ("lock_battery", "lock_controller", "lock_log", "lock_protocol",
                "lock_settings", "lock_ui"):
    for _path in _lib_sources(_prefix):
        with open(_path, encoding="utf-8") as _fh:
            _converted += _fh.read().count("clamp(")
check("the shared clamp() is genuinely adopted elsewhere (>=15 call sites)",
      _converted >= 15)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
