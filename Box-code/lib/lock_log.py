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

from lock_config import LOG_MAX_PENDING

_MAGIC = 0x81        # bump if this NVM layout changes (forces an empty queue
                      # once, same convention as lock_settings.py's _MAGIC)
_BASE = 24            # NVM offset for the persisted queue -- leaves a gap
                      # after lock_settings.py's region (byte 0 = brownout
                      # counter, bytes 8-20 = settings as of lock_settings.py's
                      # current _MAGIC=0x63 layout -- re-check this range
                      # whenever a field is added there) for that region to
                      # grow, per the reservation convention lock_settings.py
                      # documents for its own _BASE. Only 3 bytes (21-23) of
                      # headroom remain before the two regions would collide.
_ENTRY_SIZE = 9       # planned_s:2B + actual_s:2B + completed:1B + epoch:4B
_EPOCH_NONE = 0xFFFFFFFF  # NVM sentinel for "never time-synced" (epoch=-1 in
                          # the in-RAM tuple) -- a real epoch won't reach this
                          # value until the year ~2106.


def _write16(nvm, off, v):
    v = max(0, min(0xFFFF, int(v)))
    nvm[off] = (v >> 8) & 0xFF
    nvm[off + 1] = v & 0xFF


def _read16(nvm, off):
    return (nvm[off] << 8) | nvm[off + 1]


def _write32(nvm, off, v):
    v = max(0, min(0xFFFFFFFF, int(v)))
    nvm[off] = (v >> 24) & 0xFF
    nvm[off + 1] = (v >> 16) & 0xFF
    nvm[off + 2] = (v >> 8) & 0xFF
    nvm[off + 3] = v & 0xFF


def _read32(nvm, off):
    return (nvm[off] << 24) | (nvm[off + 1] << 16) | (nvm[off + 2] << 8) | nvm[off + 3]


class SessionLog:
    def __init__(self):
        self._pending = []
        # How many of the currently-pending entries (counted from the front
        # -- the queue is strictly FIFO/append-only) were included in the
        # most recently sent, still-unacked `history` push. 0 means nothing
        # is in flight. See mark_sent()/ack().
        self._sent_seq = 0
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
            # part of (or older than) any in-flight batch -- keep sent_seq
            # from ever exceeding the new length so ack() can't under-clear.
            self._sent_seq = max(0, self._sent_seq - 1)
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

        Also skips the first `self._sent_seq` entries -- these are already
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
            if i < self._sent_seq:
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
        self._sent_seq = len(self._pending)
        return self._sent_seq

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
        again next time."""
        if seq <= 0 or seq != self._sent_seq:
            return
        del self._pending[:seq]
        self._sent_seq = 0
        self._save()

    def clear(self):
        """Drop the queue unconditionally. Not used by the normal BLE sync
        path anymore (see ack()) -- kept for callers that genuinely want to
        discard pending history outright."""
        self._pending = []
        self._sent_seq = 0
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
            count = max(0, min(LOG_MAX_PENDING, count))
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

    def _save(self):
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
            nvm[_BASE] = _MAGIC
            nvm[_BASE + 1] = len(to_save)
            # Only the first 4 fields are persisted -- the 5th (mono, see
            # record()) is RAM-only backfill bookkeeping that a reboot would
            # invalidate anyway (monotonic time resets), so there is nothing
            # to clear here: it never reaches NVM in the first place.
            for i, entry in enumerate(to_save):
                planned_s, actual_s, completed, epoch = entry[:4]
                off = _BASE + 2 + i * _ENTRY_SIZE
                _write16(nvm, off, planned_s)
                _write16(nvm, off + 2, actual_s)
                nvm[off + 4] = 1 if completed else 0
                epoch_v = _EPOCH_NONE if epoch is None or epoch < 0 else epoch
                _write32(nvm, off + 5, epoch_v)
        except Exception:
            pass
