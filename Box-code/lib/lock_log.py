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
                      # counter, bytes 8-16 = settings) for that region to
                      # grow, per the reservation convention lock_settings.py
                      # documents for its own _BASE.
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

    def record(self, planned_s, actual_s, completed, epoch):
        """epoch is the wall-clock second the session ended, or None if the
        box's clock has never been synced by a phone (see LockController.
        wall_time)."""
        entry = (int(planned_s), int(actual_s), 1 if completed else 0,
                 int(epoch) if epoch is not None else -1)
        self._pending.append(entry)
        if len(self._pending) > LOG_MAX_PENDING:
            self._pending.pop(0)
            # The entry being dropped for being too old was, by definition,
            # part of (or older than) any in-flight batch -- keep sent_seq
            # from ever exceeding the new length so ack() can't under-clear.
            self._sent_seq = max(0, self._sent_seq - 1)
        self._save()

    @property
    def has_pending(self):
        return bool(self._pending)

    def to_json(self):
        parts = [
            '{{"p":{},"a":{},"c":{},"t":{}}}'.format(*e) for e in self._pending
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
                entries.append((planned_s, actual_s, completed, epoch))
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
            # cap) -- persist only as many of the OLDEST entries as fit
            # rather than writing past the end.
            to_save = self._pending[:fit] if fit < len(self._pending) else self._pending
            nvm[_BASE] = _MAGIC
            nvm[_BASE + 1] = len(to_save)
            for i, (planned_s, actual_s, completed, epoch) in enumerate(to_save):
                off = _BASE + 2 + i * _ENTRY_SIZE
                _write16(nvm, off, planned_s)
                _write16(nvm, off + 2, actual_s)
                nvm[off + 4] = 1 if completed else 0
                epoch_v = _EPOCH_NONE if epoch is None or epoch < 0 else epoch
                _write32(nvm, off + 5, epoch_v)
        except Exception:
            pass
