# lock_log.py -- queue of sessions finished while no phone was connected to
# see them live (see useStore.ts's handleHistory comment for the live path,
# which never touches this queue at all). The phone app is still the durable,
# long-term store (app/src/stats/sessionHistory.ts) -- this only has to
# survive the gap between "a session finished" and "a phone next connected".
#
# Two correctness gaps from the original RAM-only, clear-on-notify design
# were hardened per
# docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md §3.1/§3.2
# (surfaced while designing force-quit-resilient logging -- the box's queue
# wasn't actually a lossless backstop yet):
#   1. RAM-only, wiped by a reboot/brownout. Now persisted to NVM, following
#      lock_settings.py's exact magic-byte-guarded layout convention (see
#      _MAGIC/_BASE below) rather than inventing a new one.
#   2. Cleared as soon as the `history` characteristic was *notified*, with
#      no delivery guarantee -- a missed/dropped notify meant the box had
#      already discarded its only copy. Now cleared only once the app acks
#      (see mark_sent()/ack(), called from lock_ble.py instead of the old
#      unconditional clear()).
#
# Bounded so a box that never sees a phone again can't grow memory (or NVM)
# without limit -- if that ever happens the oldest unsynced session is the
# one worth losing least. See LOG_MAX_PENDING in lock_config.py.
import microcontroller

from lock_config import LOG_MAX_PENDING, NVM_LOG_BASE, clamp

_MAGIC = 0x81        # bump if this NVM layout changes (forces an empty queue
                      # once, same convention as lock_settings.py's _MAGIC)
_BASE = NVM_LOG_BASE  # start of the persisted queue. Derived from
                      # lock_config.py's NVM region map rather than hardcoded,
                      # so growing lock_settings.py's reservation moves this
                      # with it instead of the two regions silently colliding
                      # -- see that map's comment for the byte-by-byte layout
                      # and what to bump when the settings region grows.
_ENTRY_SIZE = 9       # planned_s:2B + actual_s:2B + completed:1B + epoch:4B
_EPOCH_NONE = 0xFFFFFFFF  # NVM sentinel for "never time-synced" (epoch=-1 in
                          # the in-RAM tuple) -- a real epoch won't reach this
                          # value until the year ~2106.


def _write16(nvm, off, v):
    v = clamp(int(v), 0, 0xFFFF)
    nvm[off] = (v >> 8) & 0xFF
    nvm[off + 1] = v & 0xFF


def _read16(nvm, off):
    return (nvm[off] << 8) | nvm[off + 1]


def _write32(nvm, off, v):
    v = clamp(int(v), 0, 0xFFFFFFFF)
    nvm[off] = (v >> 24) & 0xFF
    nvm[off + 1] = (v >> 16) & 0xFF
    nvm[off + 2] = (v >> 8) & 0xFF
    nvm[off + 3] = v & 0xFF


def _read32(nvm, off):
    return (nvm[off] << 24) | (nvm[off + 1] << 16) | (nvm[off + 2] << 8) | nvm[off + 3]


class SessionLog:
    def __init__(self):
        self._pending = []
        # An in-flight `history` push is tracked as two numbers, because the
        # count the app will ack with and the count still sitting in the queue
        # stop agreeing the moment the cap evicts from the front:
        #   _sent_batch -- how many entries that push covered when it was
        #     sent. This is the number the app echoes back to ack(), so it is
        #     the batch's identity and must not be adjusted afterwards.
        #   _sent_live  -- how many of those entries are still at the front of
        #     _pending. Eviction lowers this; it is what ack() actually
        #     deletes.
        # Both 0 means nothing is in flight. See mark_sent()/ack().
        self._sent_batch = 0
        self._sent_live = 0
        self._load()

    def record(self, planned_s, actual_s, completed, epoch, now=None):
        """epoch is the wall-clock second the session ended, or None if the
        box's clock has never been synced by a phone (see LockController.
        wall_time). `now` (monotonic seconds) is remembered ONLY when epoch
        is None, so a later sync this same boot session can retroactively
        fill it in -- see backfill_epoch(). It's RAM-only (never written to
        NVM, see _save()/_load()): monotonic time resets on every reboot, so
        a reference from a previous boot session would be meaningless -- an
        entry that survives a reboot still unsynced simply stays that way
        (an accurate real-clock-less-hardware limitation, not a bug)."""
        entry = (int(planned_s), int(actual_s), 1 if completed else 0,
                 int(epoch) if epoch is not None else -1,
                 None if epoch is not None else now)
        self._pending.append(entry)
        if len(self._pending) > LOG_MAX_PENDING:
            self._pending.pop(0)
            # The entry being dropped for being too old was, by definition,
            # part of (or older than) any in-flight batch -- so one fewer of
            # that batch is still here for ack() to delete. Only _sent_live
            # moves: _sent_batch is the identity the app will ack with, and
            # decrementing that too (as this used to) meant a full queue
            # overflowing mid-flight made the app's legitimate ack no longer
            # match, so it was dropped and the whole batch was resent on the
            # next connection for no reason.
            self._sent_live = max(0, self._sent_live - 1)
        self._save()

    def backfill_epoch(self, epoch_for_mono):
        """Call once the box's wall clock is (re)synced (LockController.
        set_wall_time) to retroactively fill in the epoch for any pending
        entries that were recorded earlier this same boot session before a
        sync was available -- otherwise they'd ship to the app permanently
        stamped "never synced" even though the box now knows the real time.
        `epoch_for_mono(mono)` converts a remembered monotonic timestamp to
        a real epoch (LockController.wall_time, bound to the sync just
        established). Entries with no remembered `mono` (already synced at
        record time, or reloaded from NVM after a reboot -- see record())
        are left untouched.

        Also skips the first `self._sent_live` entries -- these are already
        in flight to the app (sent via mark_sent(), not yet ack()'d).
        lock_ble._push_outbound resends the `history` characteristic
        whenever to_json()'s text changes, so correcting one of these now
        would change its content and trigger a second notify for content the
        app may already be mid-processing from the first one. The app's own
        dedupe keys off a timestamp it derives from the entry itself
        (sessionHistory.ts), which is exactly the field this rewrites --
        so a resend with a different epoch there is not recognized as the
        same session and gets double-counted instead of deduped. Leaving an
        in-flight entry uncorrected (it simply ships as still-unsynced, same
        as it would have without this feature) is the safe fallback; only
        entries not yet sent get backfilled before their first transmission."""
        changed = False
        for i, entry in enumerate(self._pending):
            if i < self._sent_live:
                continue
            planned_s, actual_s, completed, epoch, mono = entry
            if epoch < 0 and mono is not None:
                self._pending[i] = (planned_s, actual_s, completed,
                                     int(epoch_for_mono(mono)), None)
                changed = True
        if changed:
            self._save()

    @property
    def has_pending(self):
        return bool(self._pending)

    def to_json(self):
        # Only the first 4 fields are wire format -- the 5th (mono, see
        # record()) is RAM-only backfill bookkeeping, never shipped to the app.
        parts = [
            '{{"p":{},"a":{},"c":{},"t":{}}}'.format(*e[:4]) for e in self._pending
        ]
        return '[' + ','.join(parts) + ']'

    def mark_sent(self):
        """Called by lock_ble._push_outbound right after writing the current
        to_json() batch to the `history` characteristic. Remembers how many
        entries (from the front) that batch covered, so a later ack can be
        validated against a specific, resendable batch instead of clearing
        blindly on every notify (the original, non-lossless behavior)."""
        self._sent_batch = len(self._pending)
        self._sent_live = self._sent_batch
        return self._sent_batch

    def ack(self, seq):
        """The app has durably stored a batch of `seq` entries (see
        app/src/ble/protocol.ts cmdHistoryAck / PhoneBoxClient.ackHistory,
        sent once useStore.ts's handleHistory has actually written the batch
        to sessionHistory.ts's AsyncStorage). Only clears if `seq` matches
        the batch most recently sent -- a stale/mismatched ack (e.g. from a
        connection that dropped and reconnected before the ack arrived) is
        ignored rather than risking a clear of entries the app never
        actually got; lock_ble.py resends the current queue on every new
        connection regardless, so an ignored ack just means the box tries
        again next time.

        Matched against _sent_batch (what was sent) but applied to _sent_live
        (what is still here): if the cap evicted from the front while this
        batch was in flight, those entries are already gone and deleting
        `seq` of them would eat into sessions the app has never seen."""
        if seq <= 0 or seq != self._sent_batch:
            return
        if self._sent_live:
            del self._pending[:self._sent_live]
        self._sent_batch = 0
        self._sent_live = 0
        self._save()

    def clear(self):
        """Drop the queue unconditionally. Not used by the normal BLE sync
        path anymore (see ack()) -- kept for callers that genuinely want to
        discard pending history outright."""
        self._pending = []
        self._sent_batch = 0
        self._sent_live = 0
        self._save()

    # ----- NVM persistence -- mirrors lock_settings.py's pattern exactly: a
    # magic byte guards against reading stray/erased bytes on a box that has
    # never written this region, or whose layout just changed. -----
    def _load(self):
        try:
            nvm = microcontroller.nvm
            if nvm is None or nvm[_BASE] != _MAGIC:
                return
            count = nvm[_BASE + 1]
            count = clamp(count, 0, LOG_MAX_PENDING)
            entries = []
            for i in range(count):
                off = _BASE + 2 + i * _ENTRY_SIZE
                if off + _ENTRY_SIZE > len(nvm):
                    break  # NVM region smaller than expected -- stop, don't crash
                planned_s = _read16(nvm, off)
                actual_s = _read16(nvm, off + 2)
                completed = nvm[off + 4]
                epoch_raw = _read32(nvm, off + 5)
                epoch = -1 if epoch_raw == _EPOCH_NONE else epoch_raw
                # mono=None -- a monotonic reference from a previous boot
                # session is meaningless after a reboot (see record()), so an
                # entry reloaded still-unsynced can never be backfilled.
                entries.append((planned_s, actual_s, completed, epoch, None))
            self._pending = entries
        except Exception:
            # Unsupported build / corrupt region -- start with an empty
            # queue rather than crashing boot; strictly no worse than the
            # previous RAM-only behavior.
            self._pending = []

    def _pack(self, to_save):
        """The whole queue region as a bytes-like, laid out EXACTLY as
        _load() reads it back: magic, count, then `count` 9-byte records of
        planned_s:2B + actual_s:2B + completed:1B + epoch:4B, big-endian.
        Read this against _load() field by field when changing the layout --
        one transposed offset silently misparses a user's session history
        with no error anywhere (same hazard, and the same convention, as
        lock_settings.Settings._pack).

        Built with the same _write16/_write32 helpers the per-field version
        used, on a plain bytearray rather than on nvm: they are where the
        range clamps live, so packing through them keeps a value that
        overflows its field clamping on the way out exactly as before
        instead of the byte order and the clamps drifting apart.

        Nothing past the last entry is included. _load() only reads `count`
        records, so bytes beyond that are already unreachable -- erasing
        them would cost the same flash to say nothing.
        """
        buf = bytearray(2 + len(to_save) * _ENTRY_SIZE)
        buf[0] = _MAGIC
        buf[1] = len(to_save)
        # Only the first 4 fields are persisted -- the 5th (mono, see
        # record()) is RAM-only backfill bookkeeping that a reboot would
        # invalidate anyway (monotonic time resets), so there is nothing
        # to clear here: it never reaches NVM in the first place.
        for i, entry in enumerate(to_save):
            planned_s, actual_s, completed, epoch = entry[:4]
            off = 2 + i * _ENTRY_SIZE
            _write16(buf, off, planned_s)
            _write16(buf, off + 2, actual_s)
            buf[off + 4] = 1 if completed else 0
            epoch_v = _EPOCH_NONE if epoch is None or epoch < 0 else epoch
            _write32(buf, off + 5, epoch_v)
        return buf

    def _save(self):
        """ONE region write, and none at all when nothing changed.

        This is lock_settings.Settings.save()'s lesson applied to the queue,
        and this module was the counter-example that docstring warns about.
        On CircuitPython every assignment to microcontroller.nvm -- one byte
        or one whole slice -- is a read-modify-ERASE-write of the NVM
        partition, ~85ms on this board (measured with PERF_DEBUG, see
        lock_controller._exit_editing). Written a field at a time this cost
        2 + 9*N erase cycles per save: 11 for a single queued session, 1802
        at the LOG_MAX_PENDING cap. The run loop samples no touch, steps no
        countdown and services no BLE while flash erases, so that was very
        nearly one frozen second per queued entry.

        Both callers are ones a user is watching. record() runs from
        go_done, i.e. the instant a timer expires and the box should be
        opening; backfill_epoch() runs the moment a phone connects and
        syncs the clock, which is also when the queue is at its longest,
        because a long queue is precisely what "no phone has connected in a
        while" produces.

        Erase cycles are finite as well as slow, and nine per entry per save
        spent them nine times faster than the data justified.

        And usually zero: comparing against what is already stored costs one
        read and skips the write entirely. ack() and clear() both save
        unconditionally, and both are routinely no-ops -- an ack whose batch
        already aged out of the queue deletes nothing, a clear() of an
        already-empty queue changes nothing -- so this is the common case on
        the BLE path, not a rare one.

        A slice write is also all-or-nothing, where the per-field version
        could write the count byte and then fail partway through the
        records, leaving a region whose header promises entries that were
        never written.

        DO NOT "simplify" this back to per-field assignment."""
        try:
            nvm = microcontroller.nvm
            if nvm is None:
                return
            fit = max(0, (len(nvm) - _BASE - 2) // _ENTRY_SIZE)
            # This board's NVM region may be smaller than LOG_MAX_PENDING
            # entries need (see LOG_MAX_PENDING's comment in lock_config.py:
            # confirm real on-device NVM size before relying on the full
            # cap) -- persist only as many of the NEWEST entries as fit
            # rather than writing past the end. _pending is oldest-first
            # (record() appends, the cap eviction above pops(0) the oldest),
            # so the newest entries are the tail -- [-fit:], not [:fit], to
            # match record()'s own "the oldest is the one worth losing least"
            # eviction policy instead of keeping stale old entries and
            # dropping ones that just happened. fit==0 needs its own branch:
            # list[-0:] is the whole list in Python, not empty.
            if fit >= len(self._pending):
                to_save = self._pending
            elif fit <= 0:
                to_save = []
            else:
                to_save = self._pending[-fit:]
            buf = self._pack(to_save)
            end = _BASE + len(buf)
            if end > len(nvm):
                # No room for even the 2-byte header -- a region this small
                # simply has no queue in it, and _load()'s own bounds check
                # already treats it that way. Returning here is not belt and
                # braces: an out-of-range SLICE assignment does not raise the
                # way the per-field version's out-of-range index did, it
                # clamps (and on a host bytearray, EXTENDS), so without this
                # the undersized case would start writing bytes that are not
                # ours instead of doing nothing.
                return
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
                # this build's nvm rejects slice assignment the queue still
                # has to persist, and letting it fall out to
                # `except Exception: pass` would turn "slower saves" into
                # "a reboot loses every unsynced session", which is the exact
                # failure this module was written to close. Byte-wise is the
                # old behaviour, cost and all.
                for i in range(len(buf)):
                    nvm[_BASE + i] = buf[i]
        except Exception:
            pass
