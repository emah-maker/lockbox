// reconcileQueue.ts -- serializes an async reconcile so two of them can never
// interleave, and coalesces everything that piles up behind the one in flight
// down to the most recent call.
//
// Exists for the app's two "cancel everything, then reschedule from the
// current state" reconcilers -- goals/goalNotifications.ts's
// syncGoalNotifications and schedule/sessionReminders.ts's
// syncSessionReminders. Both are fired un-debounced from their store's write
// path (useGoalsStore/useScheduleStore's `persist`), so every single goal or
// plan edit starts one, and each run is a long chain of awaited native calls:
// getAllScheduledNotificationsAsync, N cancels, channel setup, a permission
// request that can sit on an OS dialog indefinitely, then N schedules.
//
// Without this, a second edit landing mid-run produced two interleaved
// cancel-then-reschedule passes over the same OS notification set, and
// whichever one's schedule batch happened to finish last won. That is not
// necessarily the newer one -- so turning a goal's reminder off while the
// first-run permission dialog was still up could end with the reminder you
// just disabled scheduled and staying scheduled, until some unrelated edit
// reconciled again. The state is the OS's, shared and global; only one pass
// may be walking it at a time.
//
// Coalescing to the LATEST call (rather than queueing every call) is correct
// here rather than merely cheaper: each run rebuilds the whole notification
// set from the state it was handed, so an intermediate state that has already
// been superseded has nothing to contribute -- running it would only put the
// OS through a set the user has already moved on from. Callers coalesced
// together all resolve with the result of the run that actually happened,
// which is what makes syncSessionReminders' return value (the plan ids the
// device genuinely holds) still describe reality for every one of them.

export function serializeLatest<A extends unknown[], R>(
  run: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  let running = false;
  // The args of the single queued call, if any. A newer call overwrites this
  // rather than joining a queue -- see the coalescing note above.
  let pendingArgs: A | null = null;
  // Handed back to every caller that arrived while a run was in flight, so
  // they all settle together on whatever the queued run produces.
  let pendingPromise: Promise<R> | null = null;
  let settlePending: ((result: Promise<R>) => void) | null = null;

  const start = async (args: A): Promise<R> => {
    running = true;
    try {
      return await run(...args);
    } finally {
      running = false;
      if (pendingArgs) {
        const nextArgs = pendingArgs;
        const settle = settlePending!;
        pendingArgs = null;
        pendingPromise = null;
        settlePending = null;
        // No await between clearing `running` and re-entering start(), so
        // nothing can slip in and start a third concurrent run here.
        settle(start(nextArgs));
      }
    }
  };

  return (...args: A): Promise<R> => {
    if (!running) return start(args);
    pendingArgs = args;
    if (!pendingPromise) {
      pendingPromise = new Promise<R>((resolve, reject) => {
        settlePending = (result) => result.then(resolve, reject);
      });
    }
    return pendingPromise;
  };
}
