# lock_log.py -- RAM-only queue of sessions finished since the app last
# synced. No SD card, no NVM: the phone app is the durable store (see
# app/src/stats/sessionHistory.ts), so the box only has to remember the gap
# between "a session finished" and "a phone was connected to hear about it".
# A session that finishes while the app is already connected is picked up
# live from the status characteristic instead (see useStore.ts) and never
# touches this queue at all.
#
# Bounded so a box that never sees a phone again can't grow memory without
# limit -- if that ever happens the oldest unsynced session is the one worth
# losing least (see _MAX_PENDING).
_MAX_PENDING = 40  # generous for typical daily use between phone connections


class SessionLog:
    def __init__(self):
        self._pending = []

    def record(self, planned_s, actual_s, completed, epoch):
        """epoch is the wall-clock second the session ended, or None if the
        box's clock has never been synced by a phone (see LockController.
        wall_time)."""
        entry = (int(planned_s), int(actual_s), 1 if completed else 0,
                 int(epoch) if epoch is not None else -1)
        self._pending.append(entry)
        if len(self._pending) > _MAX_PENDING:
            self._pending.pop(0)

    @property
    def has_pending(self):
        return bool(self._pending)

    def to_json(self):
        parts = [
            '{{"p":{},"a":{},"c":{},"t":{}}}'.format(*e) for e in self._pending
        ]
        return '[' + ','.join(parts) + ']'

    def clear(self):
        self._pending = []
