// trend.ts -- last-N-days focus totals for the Stats screen's trend bar
// chart. Pure/no deps, unit-testable like stats.ts and comparisons.ts.
import { dayKey, groupByDay, LoggedSession } from './sessionHistory';

export interface DayTotal {
  key: string; // Y-M-D
  label: string; // single weekday initial, e.g. "M"
  focusS: number;
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Oldest-to-newest focus totals for the last `days` calendar days
 * (including today). Uses local-date arithmetic (not raw ms subtraction) so
 * it lands on the right calendar day across a DST transition. */
export function lastNDays(sessions: LoggedSession[], days = 7, nowMs = Date.now()): DayTotal[] {
  const byDay = groupByDay(sessions);
  const now = new Date(nowMs);
  const out: DayTotal[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d.getTime());
    const focusS = (byDay.get(key) ?? []).reduce((sum, s) => sum + s.actualS, 0);
    out.push({ key, label: WEEKDAY_INITIALS[d.getDay()], focusS });
  }
  return out;
}
