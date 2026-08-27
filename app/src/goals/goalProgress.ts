// goalProgress.ts -- pure progress computation for a goal over its current
// daily/weekly window, shared semantics for both the RN app and the
// dashboard (see this feature's contract, §3). Only a type import from
// stats/sessionHistory (LoggedSession) -- no value import from it -- so
// this module never pulls in that file's AsyncStorage-backed
// loadSessions/appendSessions machinery, and so it can't accidentally reuse
// (and thus depend on keeping in sync with) a helper that file changes for
// its own reasons.
//
// `nowMs` is always a parameter, never read from Date.now() internally --
// same convention as stats/trend.ts's lastNDays/lastNDaysHeatmap and
// sessionHistory.ts's applyTopicUpdate, so a test can pin "now" to an exact
// instant and assert an exact window boundary instead of racing the clock.
import type { Goal, GoalPeriod } from './goals';
import type { LoggedSession } from '../stats/sessionHistory';

export interface GoalWindow {
  /** Inclusive start of the window, epoch ms, local time. */
  startMs: number;
  /** Exclusive end of the window, epoch ms, local time -- a session that
   * starts exactly at `endMs` belongs to the *next* window, not this one. */
  endMs: number;
}

/**
 * The current daily window: the local calendar day containing `nowMs`,
 * from local midnight (inclusive) to the next local midnight (exclusive).
 * This is the same local-day convention as sessionHistory.ts's dayKey and
 * trend.ts's lastNDays (both key/bucket by `new Date(ms).getFullYear()/
 * getMonth()/getDate()`) -- deliberately re-derived here with the `Date`
 * constructor rather than imported, since dayKey itself is a value export
 * and this module is restricted to a type-only import of sessionHistory.ts
 * (see header comment).
 */
function dailyWindow(nowMs: number): GoalWindow {
  const d = new Date(nowMs);
  const startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const endMs = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { startMs, endMs };
}

/**
 * The current weekly window: the local calendar week containing `nowMs`,
 * Sunday-start.
 *
 * First-day-of-week finding: this app has exactly one existing convention,
 * and it's Sunday-start. CalendarScreen.tsx's buildGrid computes
 * `firstWeekday = monthStart.getDay()` (JS Date: 0 = Sunday) and pads that
 * many leading blank cells before day 1 -- i.e. its grid's first column is
 * Sunday. website/js/focusStats.js's buildMonthGrid is an explicit
 * byte-for-byte port of that same function ("Sun-first month grid ...
 * mirrors CalendarScreen.tsx's buildGrid"). Both also use
 * WEEKDAY_LABELS/WEEKDAY_INITIALS = ['S','M','T','W','T','F','S'], i.e.
 * Sunday first. There is no Monday-start code anywhere in either app/ or
 * website/js/ to match instead, so this uses Sunday-start, matching that
 * existing convention rather than the contract prompt's Monday-start
 * default assumption.
 */
function weeklyWindow(nowMs: number): GoalWindow {
  const d = new Date(nowMs);
  const dayOfWeek = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeek).getTime();
  const endMs = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeek + 7).getTime();
  return { startMs, endMs };
}

/** The current window (daily or weekly) containing `nowMs`, per the local
 * calendar conventions documented on dailyWindow/weeklyWindow above.
 * Exported on its own so a caller (e.g. a future "goal detail" screen
 * wanting to show the window's actual date range) doesn't need to
 * reimplement it. */
export function goalWindow(period: GoalPeriod, nowMs: number): GoalWindow {
  return period === 'daily' ? dailyWindow(nowMs) : weeklyWindow(nowMs);
}

/** Whether `session` counts toward `goal`, per the contract's matching
 * rule: `goal.topic === null` counts every session regardless of topic
 * (including an untagged one); otherwise the session's raw `topic` string
 * must equal the goal's `topic` string exactly. Deliberately a raw string
 * compare, not a resolveTopic()-style lookup -- a goal aimed at a
 * since-deleted custom label id (stats/customLabels.ts) must keep matching
 * sessions tagged with that same id, the same reasoning Goal.topic's own
 * comment in goals.ts gives. */
function matchesGoalTopic(goal: Goal, session: LoggedSession): boolean {
  return goal.topic === null || session.topic === goal.topic;
}

export interface GoalProgressResult {
  goalId: string;
  period: GoalPeriod;
  targetS: number;
  focusS: number;
  /** max(0, targetS - focusS) -- never negative, unlike ratio below. */
  remainingS: number;
  /** focusS / targetS, deliberately NOT clamped to 1 -- exceeding a goal
   * should read as "180% of target", not cap out at "100% of target" and
   * hide how far over it actually went. */
  ratio: number;
  met: boolean;
}

/**
 * Progress for every non-archived goal, over each goal's own current
 * daily/weekly window (per goalWindow above), summing `actualS` of every
 * session in `sessions` that falls in that window (by `startedAt`, half-open
 * `[windowStart, windowEnd)` -- a session starting exactly at a window's end
 * belongs to the next window, never both) and matches the goal's topic
 * (matchesGoalTopic above). Archived goals are excluded entirely, per the
 * contract -- a tombstoned goal has no progress to show anywhere.
 *
 * Order of the result follows the order of `goals` (minus archived ones) --
 * this function doesn't re-sort, so a caller that wants a particular
 * display order controls it by the order it passes in.
 */
export function computeGoalProgress(goals: Goal[], sessions: LoggedSession[], nowMs: number): GoalProgressResult[] {
  return goals
    .filter((g) => !g.archived)
    .map((goal) => {
      const { startMs, endMs } = goalWindow(goal.period, nowMs);
      let focusS = 0;
      for (const s of sessions) {
        if (s.startedAt < startMs || s.startedAt >= endMs) continue;
        if (!matchesGoalTopic(goal, s)) continue;
        focusS += s.actualS;
      }
      return {
        goalId: goal.id,
        period: goal.period,
        targetS: goal.targetS,
        focusS,
        remainingS: Math.max(0, goal.targetS - focusS),
        ratio: focusS / goal.targetS,
        met: focusS >= goal.targetS,
      };
    });
}
