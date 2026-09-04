// monthGrid.ts -- pure month-grid + summary math for CalendarScreen, split
// out (per this project's 500-line file guideline) from CalendarScreen.tsx
// itself. Everything here is dependency-free besides sessionHistory.ts's
// dayKey/LoggedSession and goalProgress.ts's computeGoalProgress -- no RN,
// no theme, no store -- so it's unit-testable the same way
// stats/sessionHistory.ts and goals/goalProgress.ts are.
import { dayKey, LoggedSession } from '../../stats/sessionHistory';
import { computeGoalProgress, GoalProgressResult, isGoalDueOn } from '../../goals/goalProgress';
import type { Goal } from '../../goals/goals';
import type { CustomLabel } from '../../stats/customLabels';
import { heatmapLevel } from '../../stats/trend';
import type { HeatLevel } from '../../theme/dayHeat';

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** One month's grid, Sunday-first (see goalProgress.ts's weeklyWindow comment
 * for why this app's one existing first-day-of-week convention is Sunday):
 * `null` cells pad the leading/trailing partial weeks so the grid always
 * lands on a whole number of 7-day rows. */
export function buildGrid(monthStart: Date): (Date | null)[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = monthStart.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Consecutive days with at least one logged session, walking backward from
 * today. If today has no session yet, today doesn't break the streak (it
 * just doesn't extend it yet either) -- the walk starts from yesterday
 * instead, so a streak built over the last N days keeps reading as N right
 * up until the point the user actually lets a full day pass with nothing
 * logged. Deliberately independent of whichever month the grid is currently
 * showing (paging to a past month to check a day's sessions shouldn't make
 * the streak jump around) -- callers needing "this month's streak-so-far"
 * would need a different function; nothing in this feature asks for that. */
export function computeStreak(byDay: Map<string, LoggedSession[]>, nowMs: number = Date.now()): number {
  let cursor = new Date(nowMs);
  if (!byDay.has(dayKey(nowMs))) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  let count = 0;
  while (byDay.has(dayKey(cursor.getTime()))) {
    count++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return count;
}

export interface MonthSummary {
  totalFocusS: number;
  bestDayKey: string | null;
  bestDayFocusS: number;
  /** Current streak as of `nowMs` -- see computeStreak's comment; not scoped
   * to the displayed month. */
  streakDays: number;
}

/** Totals + best day across exactly the (non-null) cells of `grid`, plus the
 * user's current streak. `grid` (not a raw month range) is the input so this
 * always agrees with whatever buildGrid actually rendered, including its
 * leading/trailing null padding. */
export function computeMonthSummary(
  grid: (Date | null)[],
  byDay: Map<string, LoggedSession[]>,
  nowMs: number = Date.now(),
): MonthSummary {
  let totalFocusS = 0;
  let bestDayKey: string | null = null;
  let bestDayFocusS = 0;
  for (const date of grid) {
    if (!date) continue;
    const key = dayKey(date.getTime());
    const sessions = byDay.get(key);
    if (!sessions || sessions.length === 0) continue;
    const focusS = sessions.reduce((sum, s) => sum + s.actualS, 0);
    totalFocusS += focusS;
    if (focusS > bestDayFocusS) {
      bestDayFocusS = focusS;
      bestDayKey = key;
    }
  }
  return { totalFocusS, bestDayKey, bestDayFocusS, streakDays: computeStreak(byDay, nowMs) };
}

/**
 * The active goals satisfied by, AND actually due on, the window (daily,
 * weekly, or monthly, per each goal's own period -- goals.ts's GoalPeriod)
 * that contains `date`. Reuses goalProgress.ts's computeGoalProgress and
 * isGoalDueOn verbatim rather than re-summing sessions or re-deriving
 * weekday scheduling here -- goalWindow (used internally by
 * computeGoalProgress) derives a window purely from the calendar day/week/
 * month *containing* whatever ms it's given, so passing this day's own
 * timestamp computes progress for the window this day falls in, not
 * "today"'s. A weekly/monthly goal met this way is reported on every day of
 * that week/month, not just the day it was actually completed on -- the
 * whole window earned it, and CalendarScreen's day cells/sheet both read it
 * as "this day's goal status", not "the day the goal finished".
 *
 * The isGoalDueOn filter matters only for a day-restricted daily goal
 * (Goal.daysOfWeek): computeGoalProgress still sums/compares that goal's
 * focus time normally even on an off day (goalProgress.ts's own doc comment
 * on GoalProgressResult.dueToday), so without this second filter a day that
 * happens to clear the target would show a goal-met ring even on a day the
 * goal was never scheduled for. Every other goal shape (no daysOfWeek, or a
 * weekly/monthly period) has isGoalDueOn always return true, so this filter
 * is a no-op for them -- existing callers/tests for those shapes are
 * unaffected.
 *
 * `labels`/`excludedTopicKeys` (both default `[]`) are forwarded straight to
 * computeGoalProgress, same as every other computeGoalProgress call site in
 * the app (stats/customLabels.ts) -- an excludeFromTotals-tagged session, or
 * one tagged with an excluded built-in topic, doesn't count toward whether a
 * goal was met on this day.
 */
export function goalsMetOnDay(
  goals: Goal[],
  sessions: LoggedSession[],
  date: Date,
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): GoalProgressResult[] {
  const nowMs = date.getTime();
  const goalsById = new Map(goals.map((g) => [g.id, g]));
  return computeGoalProgress(goals, sessions, nowMs, labels, excludedTopicKeys)
    .filter((r) => r.met)
    .filter((r) => {
      const goal = goalsById.get(r.goalId);
      return goal ? isGoalDueOn(goal, nowMs) : true;
    });
}

/**
 * Discrete 0-4 heat level for every day in `grid`, keyed by dayKey. Routes
 * through stats/trend.ts's exported `heatmapLevel` rather than re-deriving a
 * second bucketing scheme -- see that function's doc comment: this calendar
 * used to compute its own *continuous* alpha (0.25 + 0.75*ratio) against an
 * all-time global max, which is incompatible with a legend (a legend needs
 * nameable discrete steps, not an unbounded gradient). Adopting the discrete
 * model here is what makes HeatLegend.tsx possible at all.
 *
 * `max` is deliberately the busiest day within `grid` itself, not an
 * all-time-global max the way DayCell's old `maxFocus` prop (computed in
 * CalendarScreen.tsx) was. A legend that reads "this is the month's busiest
 * day" should mean the busiest day actually on screen -- paging to a quiet
 * month shouldn't leave every cell looking washed-out relative to some other
 * month's record day the user isn't looking at right now.
 */
export function monthHeatLevels(
  grid: (Date | null)[],
  byDay: Map<string, LoggedSession[]>,
): Map<string, HeatLevel> {
  const focusByKey = new Map<string, number>();
  let max = 0;
  for (const date of grid) {
    if (!date) continue;
    const key = dayKey(date.getTime());
    const sessions = byDay.get(key);
    const focusS = sessions ? sessions.reduce((sum, s) => sum + s.actualS, 0) : 0;
    focusByKey.set(key, focusS);
    if (focusS > max) max = focusS;
  }
  const levels = new Map<string, HeatLevel>();
  // Guard an empty/all-zero month: heatmapLevel divides by `max`, so feed it
  // 1 instead of 0 (matches trend.ts's lastNDaysHeatmap's own Math.max(1, ...)
  // guard) -- every day is focusS <= 0 in that case anyway, so heatmapLevel
  // short-circuits to 0 before the ratio is ever computed.
  const safeMax = max || 1;
  for (const [key, focusS] of focusByKey) {
    levels.set(key, heatmapLevel(focusS, safeMax));
  }
  return levels;
}

export interface StreakRun {
  startIndex: number;
  endIndex: number;
  length: number;
}

/**
 * Maximal runs of consecutive on-screen days with logged focus time, as
 * `grid` index ranges -- answers "which visible cells should be drawn as one
 * connected chain", a different question from computeStreak's "how many
 * days in a row, walking back from today, regardless of which month is
 * displayed". A month can show several such runs (or none); computeStreak
 * only ever tracks the single current one.
 *
 * `grid` index adjacency is treated as calendar-day adjacency without a
 * separate date check: buildGrid's `null` padding only ever appears in the
 * leading/trailing partial weeks, never mid-month, so any two adjacent
 * non-null indices are necessarily adjacent calendar days. A `null` cell
 * (i.e. crossing out of the displayed month) always breaks a run, same as a
 * logged-day gap does.
 *
 * Returns runs of every length, including length-1 -- the "is this worth
 * drawing as a chain" threshold is a display decision, not a math one, left
 * to the caller (CalendarScreen.tsx only shows a flame badge at length >= 3,
 * per the manager brief).
 */
export function computeStreakRuns(
  grid: (Date | null)[],
  byDay: Map<string, LoggedSession[]>,
): StreakRun[] {
  const runs: StreakRun[] = [];
  let runStart: number | null = null;

  const flush = (endIndex: number) => {
    if (runStart === null) return;
    runs.push({ startIndex: runStart, endIndex, length: endIndex - runStart + 1 });
    runStart = null;
  };

  grid.forEach((date, i) => {
    const focusS = date
      ? (byDay.get(dayKey(date.getTime())) ?? []).reduce((sum, s) => sum + s.actualS, 0)
      : 0;
    const active = !!date && focusS > 0;
    if (active) {
      if (runStart === null) runStart = i;
    } else {
      flush(i - 1);
    }
  });
  flush(grid.length - 1);

  return runs;
}

/** Number of columns in the grid buildGrid/computeStreakRuns produce (see
 * this file's header + CalendarScreen.tsx's own "7-per-row" comment) --
 * shared by streakConnectorForIndex below so it doesn't hardcode the same
 * literal a second place. */
const GRID_COLUMNS = 7;

/**
 * Whether grid index `i` should draw a left/right streak connector bar
 * (DayCell.tsx's `streakEdge` prop), given the maximal run (computeStreakRuns)
 * it belongs to.
 *
 * A run is a range of grid INDICES, which is calendar-day-adjacent (see
 * computeStreakRuns's own comment) but NOT necessarily visually adjacent:
 * CalendarScreen.tsx renders the grid 7-per-row with `flexWrap`, so index i
 * and i+1 sit side by side on screen only within the same row (i.e. i is not
 * the row's last column). When a run crosses a week-row boundary -- e.g. a
 * run covering Sat (index 6) through the following Sun (index 7) -- index 6
 * and index 7 are consecutive indices but Sat is the RIGHTMOST cell of row 1
 * and Sun is the LEFTMOST cell of row 2, nowhere near each other on screen.
 * Drawing Sat's right-pointing connector or Sun's left-pointing connector in
 * that case draws a bar reaching toward a cell that isn't actually there
 * (off the edge of the row), which reads as the streak visibly breaking mid-
 * chain even though the underlying run is still intact. This function is
 * what the naive `{ left: i > run.startIndex, right: i < run.endIndex }`
 * (this bug's original form) was missing: a connector on a given side also
 * requires that side's on-screen NEIGHBOR to exist, i.e. `i` isn't already at
 * that row edge.
 */
export function streakConnectorForIndex(
  streakRuns: StreakRun[],
  i: number,
): { left: boolean; right: boolean } {
  const run = streakRuns.find((r) => i >= r.startIndex && i <= r.endIndex);
  if (!run) return { left: false, right: false };
  const col = i % GRID_COLUMNS;
  return {
    left: i > run.startIndex && col > 0,
    right: i < run.endIndex && col < GRID_COLUMNS - 1,
  };
}

/**
 * The effective set of goal ids whose streaks CalendarScreen.tsx's month
 * grid should draw a dot for, given the user's stored preference
 * (useSettingsStore's `calendarStreakGoalIds`) and the CURRENT live goal
 * list. Two jobs in one function, both load-bearing:
 *
 * 1. Resolves the `null` sentinel -- "never customized" -- to every active
 *    goal's id. That is this feature's chosen default (see this feature's
 *    own design notes): a brand-new install shows every active goal's
 *    streak immediately, the same "on by default, no setup required"
 *    posture the existing goal-met ring (goalsMetOnDay above) already has,
 *    rather than shipping a calendar that silently shows nothing until the
 *    user finds a settings sheet. A user who deliberately picks a SUBSET
 *    (including the empty set, "show none") stores a real array instead,
 *    which this function then returns verbatim-minus-stale-ids rather than
 *    re-expanding back to "all".
 * 2. Filters a stored (non-null) preference array against `goals` live,
 *    every call -- never trusting the stored ids alone. A goal that has
 *    since been deleted or archived must not linger in the effective set
 *    just because its id is still sitting in an old preference array
 *    (useSettingsStore.ts deliberately does not prune that array itself --
 *    see its own field comment); this is the one place that filter actually
 *    happens, on every render, the same "never cache a goal's own fields
 *    elsewhere" discipline goalProgress.ts's own callers already follow for
 *    ringGoalId.
 */
export function resolveCalendarStreakGoalIds(goals: Goal[], pref: string[] | null): string[] {
  const activeIds = goals.filter((g) => !g.archived).map((g) => g.id);
  if (pref === null) return activeIds;
  const activeSet = new Set(activeIds);
  return pref.filter((id) => activeSet.has(id));
}
