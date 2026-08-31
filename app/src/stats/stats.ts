// stats.ts -- pure focus-stat helpers (no RN/BLE deps, so they are unit-testable
// under plain node/jest). The box keeps no long-term aggregate of its own (see
// Box-code/lib/lock_log.py -- a small RAM-only queue, not a stats store): the
// app is the durable copy, so these aggregates are computed here, client-side,
// from the local session log (sessionHistory.ts) instead of read over BLE.
import { CustomLabel, filterCountedSessions } from './customLabels';

export interface SessionRecord {
  plannedS: number;
  actualS: number;
  outcome: 'completed' | 'overridden';
  /** Optional here (unlike LoggedSession, where it's already optional) only
   * because aggregate's own pre-existing tests construct bare
   * {plannedS,actualS,outcome} records with no topic at all -- adding it as
   * required would break every one of those literals for no benefit, since
   * an absent topic already means "untagged, always counts" either way. Every
   * real caller passes a LoggedSession, which has a real (if often
   * undefined) topic. */
  topic?: string;
}

export interface Stats {
  n: number; // sessions
  foc: number; // total focus seconds
  done: number; // completed sessions
  str: number; // current streak (consecutive completed, most recent first)
  lng: number; // longest session seconds
}

/** Aggregate raw session records the same way the firmware does. Newest-last
 * order; streak = trailing consecutive completed sessions.
 *
 * `labels` (default `[]`, i.e. "nothing is excluded") is threaded through
 * customLabels.ts's filterCountedSessions before any of the math below runs,
 * so a session tagged with an `excludeFromTotals` label contributes to
 * neither `foc`, `done`, `str`, nor `lng` -- while staying exactly as present
 * in the caller's own session list/history views, which never call through
 * this filter. Omitting `labels` entirely (every pre-existing caller and
 * test) reproduces the old unfiltered behavior byte-for-byte, since an empty
 * catalog excludes nothing.
 *
 * `excludedTopicKeys` (default `[]`) is filterCountedSessions' other
 * exclusion list -- a session tagged with one of the six built-in topics
 * (topics.ts's TopicKey) the user has excluded is dropped from this same
 * math the identical way an excluded custom label's session is. Same
 * backward-compatible default/rationale as `labels`. */
export function aggregate(records: SessionRecord[], labels: CustomLabel[] = [], excludedTopicKeys: string[] = []): Stats {
  const counted = filterCountedSessions(records, labels, excludedTopicKeys);
  let n = 0;
  let foc = 0;
  let done = 0;
  let lng = 0;
  let str = 0;
  let streakOpen = true;
  for (let i = counted.length - 1; i >= 0; i--) {
    const r = counted[i];
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

// Mirrors Box-code/lib/lock_config.py MAX_HOURS/MAX_SECONDS. The firmware
// clamps to this on its own (lock_controller.apply_ble_command), but the app
// clamps too so a picker button never labels itself with a duration longer
// than what will actually run. The cap is 9h55m, not a clean 9h -- MAX_SECONDS
// is intentionally not just MAX_LOCK_HOURS * 3600.
export const MAX_LOCK_HOURS = 9;
export const MAX_LOCK_SECONDS = MAX_LOCK_HOURS * 3600 + 55 * 60;
// Mirrors Box-code/lib/lock_config.py MIN_STEP*60 (MIN_SECONDS) -- the
// smallest step the H/M picker can express, so a duration can never be
// floored down to an unusable 0h00m on either side of the BLE link.
export const MIN_LOCK_SECONDS = 5 * 60;

/** Combine an H/MM duration-picker selection into seconds for startLock(). */
export function clampLockSeconds(hours: number, minutes: number): number {
  const total = Math.max(0, Math.floor(hours)) * 3600 + Math.max(0, Math.floor(minutes)) * 60;
  return Math.max(MIN_LOCK_SECONDS, Math.min(MAX_LOCK_SECONDS, total));
}

/** The inverse of clampLockSeconds: split a duration back into the H/M pair
 * the picker wheels display, snapped to `minuteStep`.
 *
 * The naive `floor(s/3600)` + `round(s%3600/60/step)*step` this replaces
 * (DashboardScreen's box-sync effect) has a carry bug: any remainder that
 * rounds up to a full hour yields `minutes: 60`, which is not a value the
 * minute wheel has (it stops at 55). The wheel's `indexOf(60)` then missed,
 * fell back to index 0, and displayed "0h 00m" for a pick that
 * clampLockSeconds would turn into a full extra hour -- the wheels showing
 * one duration while a different one gets pushed to the box. 7150s (1h59m10s)
 * is the shortest real example: it must read 2h 00m, not 1h 00m.
 *
 * Hours are clamped to MAX_LOCK_HOURS so the carry can't push the hour wheel
 * past its own last index either. */
export function splitLockSeconds(
  seconds: number,
  minuteStep: number,
): { hours: number; minutes: number } {
  const total = Math.max(0, Math.min(MAX_LOCK_SECONDS, Math.floor(seconds)));
  let hours = Math.floor(total / 3600);
  let minutes = Math.round((total % 3600) / 60 / minuteStep) * minuteStep;
  if (minutes >= 60) {
    hours += 1;
    minutes = 0;
  }
  if (hours > MAX_LOCK_HOURS) {
    hours = MAX_LOCK_HOURS;
    minutes = Math.floor(((MAX_LOCK_SECONDS % 3600) / 60) / minuteStep) * minuteStep;
  }
  return { hours, minutes };
}
