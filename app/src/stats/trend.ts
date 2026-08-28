// trend.ts -- last-N-days focus totals for the Stats screen's trend bar
// chart. Pure/no deps, unit-testable like stats.ts and comparisons.ts.
import { dayKey, filterByWindow, groupByDay, LoggedSession, TimeWindow } from './sessionHistory';

export interface DayTotal {
  key: string; // Y-M-D
  label: string; // single weekday initial, e.g. "M"
  focusS: number;
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export interface BestDay {
  key: string; // Y-M-D
  dateMs: number; // startedAt of the day's first session -- enough to format a real calendar date
  focusS: number;
}

/** The single calendar day with the most total focus time -- a real
 * personal-record fact for the Stats screen's "Fun facts" card, computed
 * from the same local session log as every other stat here, not invented.
 * Null on an empty/all-zero log.
 *
 * `window` defaults to 'all' (all logged history), which is what the Fun
 * facts card wants and what every pre-existing caller already relied on.
 * The Home ring passes a narrower window instead (see
 * screens/home/idleRingState.ts): with no daily goal set, "today vs. your
 * best day this week/month/year" is the baseline its arc fills against, and
 * which window that means is a user setting (useSettingsStore's
 * ringBaselineWindow). Filtering here rather than at each call site keeps
 * the day-bucketing math in one place. */
export function bestDay(
  sessions: LoggedSession[],
  window: TimeWindow = 'all',
  nowMs: number = Date.now(),
): BestDay | null {
  const byDay = groupByDay(window === 'all' ? sessions : filterByWindow(sessions, window, nowMs));
  let best: BestDay | null = null;
  for (const [key, daySessions] of byDay) {
    const focusS = daySessions.reduce((sum, s) => sum + s.actualS, 0);
    if (focusS > 0 && (!best || focusS > best.focusS)) {
      best = { key, dateMs: daySessions[0].startedAt, focusS };
    }
  }
  return best;
}

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

export interface HeatmapDay {
  key: string; // Y-M-D
  dateMs: number;
  focusS: number;
  level: 0 | 1 | 2 | 3 | 4; // intensity relative to the busiest day in the window, 0 = no focus
}

const HEATMAP_DAYS = 35; // 5 full weeks, GitHub-contributions-style grid

/** Bucket a day's focus time into 5 intensity levels relative to the busiest
 * day in whatever window the caller is drawing. Exported so the calendar's
 * month grid uses this exact scheme rather than a second, incompatible one:
 * ui/calendar/DayCell.tsx used to compute its own continuous alpha against
 * an all-time global max, which a heat legend can't describe (a legend needs
 * discrete, nameable steps). screens/calendar/monthGrid.ts's monthHeatLevels
 * now routes the calendar through here too. */
export function heatmapLevel(focusS: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (focusS <= 0) return 0;
  const ratio = focusS / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/** Last 5 calendar weeks (oldest to newest, including today), bucketed into
 * 5 intensity levels relative to the busiest day in that window -- a
 * broader "which days were productive" pattern than the 7-bar trend chart
 * above. Deliberately unwindowed (same choice as lastNDays/bestDay): a
 * day/week filter would shrink this to a handful of cells, which is a worse
 * view of the pattern than a fixed 5-week grid. */
export function lastNDaysHeatmap(sessions: LoggedSession[], nowMs = Date.now()): HeatmapDay[] {
  const byDay = groupByDay(sessions);
  const now = new Date(nowMs);
  const raw: { key: string; dateMs: number; focusS: number }[] = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d.getTime());
    const focusS = (byDay.get(key) ?? []).reduce((sum, s) => sum + s.actualS, 0);
    raw.push({ key, dateMs: d.getTime(), focusS });
  }
  const max = Math.max(1, ...raw.map((d) => d.focusS));
  return raw.map((d) => ({ ...d, level: heatmapLevel(d.focusS, max) }));
}
