// stats.ts -- pure focus-stat helpers (no RN/BLE deps, so they are unit-testable
// under plain node/jest). The box keeps no long-term aggregate of its own (see
// Box-code/lib/lock_log.py -- a small RAM-only queue, not a stats store): the
// app is the durable copy, so these aggregates are computed here, client-side,
// from the local session log (sessionHistory.ts) instead of read over BLE.
export interface SessionRecord {
  plannedS: number;
  actualS: number;
  outcome: 'completed' | 'overridden';
}

export interface Stats {
  n: number; // sessions
  foc: number; // total focus seconds
  done: number; // completed sessions
  str: number; // current streak (consecutive completed, most recent first)
  lng: number; // longest session seconds
}

/** Aggregate raw session records the same way the firmware does. Newest-last
 * order; streak = trailing consecutive completed sessions. */
export function aggregate(records: SessionRecord[]): Stats {
  let n = 0;
  let foc = 0;
  let done = 0;
  let lng = 0;
  let str = 0;
  let streakOpen = true;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    n += 1;
    foc += r.actualS;
    if (r.actualS > lng) lng = r.actualS;
    if (r.outcome === 'completed') {
      done += 1;
      if (streakOpen) str += 1;
    } else {
      streakOpen = false;
    }
  }
  return { n, foc, done, str, lng };
}

/** Whole-minute-rounded "Xh Ym" / "Ym" duration, matching the box's _fmt_dur. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${String(mm).padStart(2, '0')}m` : `${m}m`;
}

/** Completion rate as a 0..100 integer percent (0 when no sessions). */
export function completionRate(st: Stats): number {
  if (!st.n) return 0;
  return Math.round((st.done / st.n) * 100);
}
