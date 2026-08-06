// stats.ts -- pure focus-stat helpers (no RN/BLE deps, so they are unit-testable
// under plain node/jest). The box computes the aggregates on-device (see
// Box-code/lib/lock_log.py compute_stats); these mirror that shape for display
// and for the day the app pulls the full session history over BLE.
import type { Stats } from '../ble/protocol';

export interface SessionRecord {
  plannedS: number;
  actualS: number;
  outcome: 'completed' | 'overridden';
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
  return { avail: 1, n, foc, done, str, lng };
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
