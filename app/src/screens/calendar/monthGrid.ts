// monthGrid.ts -- pure month-grid + summary math for CalendarScreen, split
// out (per this project's 500-line file guideline) from CalendarScreen.tsx
// itself. Everything here is dependency-free besides sessionHistory.ts's
// dayKey/LoggedSession and goalProgress.ts's computeGoalProgress -- no RN,
// no theme, no store -- so it's unit-testable the same way
// stats/sessionHistory.ts and goals/goalProgress.ts are.
import { dayKey, LoggedSession } from '../../stats/sessionHistory';
import { computeGoalProgress, GoalProgressResult, isGoalDueOn } from '../../goals/goalProgress';
import type { Goal } from '../../goals/goals';

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
 */
export function goalsMetOnDay(goals: Goal[], sessions: LoggedSession[], date: Date): GoalProgressResult[] {
  const nowMs = date.getTime();
  const goalsById = new Map(goals.map((g) => [g.id, g]));
  return computeGoalProgress(goals, sessions, nowMs)
    .filter((r) => r.met)
    .filter((r) => {
      const goal = goalsById.get(r.goalId);
      return goal ? isGoalDueOn(goal, nowMs) : true;
    });
}
