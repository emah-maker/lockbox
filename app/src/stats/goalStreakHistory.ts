// goalStreakHistory.ts -- goalStreak.ts's sibling for everything beyond a
// single "current streak" number: the best/longest streak a goal has ever
// had, a per-window hit/miss history over an arbitrary date range (so the
// calendar can render it), and a day-level "which goals were met/missed/
// not-due" lookup for one specific day. Split out rather than grown inside
// goalStreak.ts itself so that file stays under this project's 500-line
// guideline -- the same reasoning GoalRow.tsx's own header gives for its
// split out of GoalsSection.tsx.
//
// Pure/no-RN-deps, `nowMs`/`fromMs`/`toMs`/`date` always parameters, same
// testability convention as goalStreak.ts and goalProgress.ts. Reuses (never
// re-derives) goalStreak.ts's own windowTotals/isWindowMet/matchesGoalTopic
// -- a second copy of "does this window count as met" would only need to
// drift once for a goal's calendar dots to disagree with its Stats-screen
// streak number.
import type { Goal } from '../goals/goals';
import { goalWindow, isGoalDueOn, GoalWindow } from '../goals/goalProgress';
import type { LoggedSession } from './sessionHistory';
import type { CustomLabel } from './customLabels';
import { windowTotals, isWindowMet, dueWindowsBackwards } from './goalStreak';

// Same cap and same reasoning as goalStreak.ts's own MAX_STREAK_WINDOWS --
// kept as an independent constant (not imported) because this one bounds a
// walk that also has to inspect EVERY window along the way (not just stop at
// the first miss), so it's worth being able to tune the two independently if
// a future profiling pass ever finds a reason to.
const MAX_BEST_STREAK_WINDOWS = 60;

// Same fix, same reasoning, as goalStreak.ts's own MAX_STREAK_CALENDAR_STEPS:
// a day-restricted daily goal skips most calendar days as off days, so
// counting every STEP of the walk (off days included) against
// MAX_BEST_STREAK_WINDOWS truncated a goal due only one day a week after
// ~60 calendar days (~8-9 due days) instead of the intended 60 due windows.
const MAX_BEST_STREAK_CALENDAR_STEPS = MAX_BEST_STREAK_WINDOWS * 7;

/**
 * The longest run of consecutive met (and due) windows this goal has EVER
 * had, looking back up to MAX_BEST_STREAK_WINDOWS windows from `nowMs` --
 * the same bounded-walk safety cap computeGoalStreak uses, and for the same
 * reason (a years-old goal can't turn this into an unbounded loop). Unlike
 * computeGoalStreak, which stops at the first missed CLOSED window because
 * it only cares about the run touching `nowMs`, this walks the entire
 * lookback window, resetting its running count on every closed miss and
 * remembering the highest count it ever saw -- so a goal that broke a
 * 10-day streak yesterday and started a fresh 1-day streak today still
 * reports a best of 10, not 1.
 *
 * Off days (Goal.daysOfWeek) are skipped exactly like computeGoalStreak
 * skips them: they neither extend nor reset the running count. The
 * in-progress current window (the one containing `nowMs`) follows the same
 * leniency too -- an unmet, still-open window doesn't reset the running
 * count, since it isn't a miss yet.
 *
 * Returns 0 for an archived goal (no history worth showing for a tombstone,
 * same as computeGoalStreak) or one that has never met a single window.
 */
export function computeBestGoalStreak(
  goal: Goal,
  sessions: LoggedSession[],
  nowMs: number,
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): number {
  if (goal.archived) return 0;
  let best = 0;
  let current = 0;
  // Same backward walk computeGoalStreak makes, with this file's own two
  // caps -- see goalStreak.ts's dueWindowsBackwards, and the constants above
  // for why the caps stay independent.
  for (const { met, isCurrentWindow } of dueWindowsBackwards(goal, sessions, nowMs, labels, excludedTopicKeys, {
    maxCalendarSteps: MAX_BEST_STREAK_CALENDAR_STEPS,
    maxWindows: MAX_BEST_STREAK_WINDOWS,
  })) {
    if (met) {
      current += 1;
      if (current > best) best = current;
    } else if (!isCurrentWindow) {
      current = 0; // a closed miss ends THIS run, but the walk keeps going
    }
    // An unmet CURRENT window falls through without extending OR resetting
    // the running count, same leniency as computeGoalStreak's own comment.
  }
  return best;
}

export interface GoalWindowHistoryEntry {
  startMs: number;
  endMs: number;
  /** False for an off-day window (Goal.daysOfWeek) -- `met` is always false
   * on such an entry too, but callers must check `dueOn` first: an off day
   * is "not due", never a miss, same rule computeGoalStreak's own doc
   * comment documents for the current-streak walk. */
  dueOn: boolean;
  met: boolean;
}

// Bounds goalWindowHistory's forward walk the same way MAX_STREAK_WINDOWS
// bounds computeGoalStreak's backward one -- but this walk is driven by a
// caller-supplied [fromMs, toMs) range rather than an unbounded backward
// search, so a badly-formed range (toMs far in the future, or fromMs far in
// the past) can't turn a calendar-month request into an effectively
// unbounded loop. 400 comfortably covers a full year of DAILY windows (365,
// the densest case -- weekly/monthly ranges of the same wall-clock span
// produce far fewer windows) plus headroom for a caller that asks for
// slightly more than exactly a year.
const MAX_HISTORY_WINDOWS = 400;

/**
 * Per-window hit/miss/not-due entries for `goal` covering every window that
 * overlaps `[fromMs, toMs)`, oldest first -- the calendar's own source for
 * "was this goal met the week/month/day containing this cell". Each entry's
 * `met` is computed the same way computeGoalStreak's own isWindowMet is
 * (focus time AND, if the goal has one, session-count target), and `dueOn`
 * follows goalProgress.ts's isGoalDueOn -- an off-day window is reported as
 * `dueOn: false, met: false`, which callers must read as "not due", never as
 * a miss (same contract goalProgress.ts's own GoalProgressResult.dueToday
 * and computeGoalStreak's off-day skip both already document).
 *
 * Walks FORWARD from the window containing `fromMs`, stepping to
 * `goalWindow(period, cursorMs).endMs` each time -- that endMs IS the start
 * of the very next window (goalWindow.endMs's own contract: "a session that
 * starts exactly at endMs belongs to the next window"), so this never
 * re-derives period-length arithmetic of its own the way a naive
 * "+1 day"/"+7 days"/"+1 month" stepper would have to, and it stays correct
 * across a DST transition or a short/long calendar month for free, the exact
 * same way goalWindow's own daily/weekly/monthlyWindow already are.
 *
 * Returns `[]` for an archived goal (nothing to show for a tombstone, same
 * as computeGoalStreak/computeBestGoalStreak) or a backwards/empty range.
 */
export function goalWindowHistory(
  goal: Goal,
  sessions: LoggedSession[],
  fromMs: number,
  toMs: number,
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): GoalWindowHistoryEntry[] {
  if (goal.archived || toMs <= fromMs) return [];
  const out: GoalWindowHistoryEntry[] = [];
  let cursorMs = fromMs;
  for (let i = 0; i < MAX_HISTORY_WINDOWS && cursorMs < toMs; i++) {
    const window: GoalWindow = goalWindow(goal.period, cursorMs);
    const dueOn = isGoalDueOn(goal, window.startMs);
    const met = dueOn && isWindowMet(goal, windowTotals(goal, sessions, window, labels, excludedTopicKeys));
    out.push({ startMs: window.startMs, endMs: window.endMs, dueOn, met });
    cursorMs = window.endMs; // endMs IS the next window's startMs -- see doc comment
  }
  return out;
}

export interface GoalDayStatus {
  goalId: string;
  /** False for a day-restricted daily goal's off day -- `met` is always
   * false alongside it, and callers must render this as "not due", never as
   * a miss (see goalWindowHistory's own comment for the identical rule). */
  dueOn: boolean;
  met: boolean;
}

/**
 * For every non-archived goal in `goals`, whether the window (daily/weekly/
 * monthly, per that goal's own period) containing `date` was met -- the
 * calendar's day-cell-level counterpart to goalWindowHistory above (one day,
 * every goal, rather than one goal, every day in a range). Deliberately
 * takes whatever `goals` the caller passes rather than reading
 * useGoalsStore/settings itself: CalendarScreen.tsx decides which goals are
 * "visible" (the user's per-device streak-visibility picker, see
 * useSettingsStore.ts's calendarStreakGoalIds) and passes only that already-
 * filtered list in, so this function never has to know that preference
 * exists at all -- the same "dumb, given the inputs" contract
 * screens/calendar/monthGrid.ts's own goalsMetOnDay follows for the
 * existing single "any goal met" ring.
 *
 * A weekly/monthly goal reports the SAME status on every day of that week/
 * month (goalWindow derives a window purely from the calendar day/week/
 * month containing whatever ms it's given), matching goalsMetOnDay's own
 * documented behavior for the exact same reason.
 */
export function goalDayStatuses(
  goals: Goal[],
  sessions: LoggedSession[],
  date: Date,
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): GoalDayStatus[] {
  const nowMs = date.getTime();
  return goals
    .filter((g) => !g.archived)
    .map((goal) => {
      const dueOn = isGoalDueOn(goal, nowMs);
      if (!dueOn) return { goalId: goal.id, dueOn: false, met: false };
      const window = goalWindow(goal.period, nowMs);
      const met = isWindowMet(goal, windowTotals(goal, sessions, window, labels, excludedTopicKeys));
      return { goalId: goal.id, dueOn: true, met };
    });
}
