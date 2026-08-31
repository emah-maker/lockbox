// goalProgress.ts -- pure progress computation for a goal over its current
// daily/weekly/monthly window, shared semantics for both the RN app and the
// dashboard (see this feature's contract, §3). Only a type import from
// stats/sessionHistory (LoggedSession) -- no value import from it -- so
// this module never pulls in that file's AsyncStorage-backed
// loadSessions/appendSessions machinery, and so it can't accidentally reuse
// (and thus depend on keeping in sync with) a helper that file changes for
// its own reasons. The one VALUE import below, stats/customLabels.ts's
// sessionCountsTowardTotals, doesn't reintroduce that risk -- that module
// itself only type-imports sessionHistory.ts (see its own header), so this
// file still never drags in the AsyncStorage-backed machinery either.
//
// `nowMs` is always a parameter, never read from Date.now() internally --
// same convention as stats/trend.ts's lastNDays/lastNDaysHeatmap and
// sessionHistory.ts's applyTopicUpdate, so a test can pin "now" to an exact
// instant and assert an exact window boundary instead of racing the clock.
//
// This module's window/progress math (dailyWindow/weeklyWindow/
// monthlyWindow, isGoalDueOn, computeGoalProgress) is hand-ported to
// website/js/goals.js (~line 496 on, starting at that file's own
// goalWindow) -- the two are checked against each other by a shared golden
// fixture, tests/fixtures/goalProgress.golden.json, asserted from both
// sides (this file's own goalProgress.golden.test.ts and the website
// twin's tests/website/goalProgress.golden.test.js). Changing ANY of the
// math here means regenerating that fixture (see its own header for the
// recipe) and checking website/js/goals.js still agrees -- the fixture is
// the one place drift between the two would actually get caught.
import type { Goal, GoalPeriod } from './goals';
import type { LoggedSession } from '../stats/sessionHistory';
import { CustomLabel, sessionCountsTowardTotals } from '../stats/customLabels';

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

/**
 * The current monthly window: the local calendar month containing `nowMs`,
 * from the 1st at local midnight (inclusive) to the 1st of the NEXT month at
 * local midnight (exclusive) -- whatever that month's actual length turns
 * out to be (28-31 days), same as goals.ts's MAX_MONTHLY_TARGET_S comment
 * notes. `new Date(y, m + 1, 1)` deliberately overflows `m` rather than
 * hand-computing "days in this month" -- the `Date` constructor already
 * normalizes month-index overflow into the correct next-year rollover for
 * December, the same way dailyWindow/weeklyWindow above lean on it for
 * day-index overflow.
 */
function monthlyWindow(nowMs: number): GoalWindow {
  const d = new Date(nowMs);
  const startMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const endMs = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { startMs, endMs };
}

/** The current window (daily/weekly/monthly) containing `nowMs`, per the
 * local calendar conventions documented on dailyWindow/weeklyWindow/
 * monthlyWindow above. Exported on its own so a caller (e.g. a future
 * "goal detail" screen wanting to show the window's actual date range)
 * doesn't need to reimplement it. */
export function goalWindow(period: GoalPeriod, nowMs: number): GoalWindow {
  if (period === 'daily') return dailyWindow(nowMs);
  if (period === 'weekly') return weeklyWindow(nowMs);
  return monthlyWindow(nowMs);
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

/**
 * Whether `goal`'s target actually applies to the calendar day containing
 * `nowMs` -- always `true` for `weekly`/`monthly` goals and for a `daily`
 * goal with no `daysOfWeek` restriction (`undefined`/`[]` both mean "every
 * day", per Goal.daysOfWeek's own comment in goals.ts). For a day-restricted
 * daily goal, `true` only when `nowMs`'s local weekday (0=Sun..6=Sat, same
 * `Date#getDay()` convention dailyWindow/weeklyWindow already use above) is
 * one of the goal's selected days.
 *
 * Exported so a caller can distinguish "this Mon/Wed/Fri goal has 0
 * progress because today is Tuesday and it was never due" from "...because
 * the user hasn't focused yet today" -- computeGoalProgress below folds
 * this into each result's own `dueToday` field rather than excluding
 * off-day goals from the array entirely, so a goal never disappears from a
 * progress list just because today happens to be one of its off days.
 */
export function isGoalDueOn(goal: Goal, nowMs: number): boolean {
  if (goal.period !== 'daily' || !goal.daysOfWeek || goal.daysOfWeek.length === 0) return true;
  return goal.daysOfWeek.includes(new Date(nowMs).getDay());
}

export interface GoalProgressResult {
  goalId: string;
  period: GoalPeriod;
  targetS: number;
  focusS: number;
  /** max(0, targetS - focusS) -- never negative, unlike ratio below. */
  remainingS: number;
  /** focusS / targetS, deliberately NOT clamped to 1 -- a bar/ring that
   * still has room to show "how far over" (GoalRow.tsx's barGeometry,
   * GoalRing.tsx's ratio prop) needs the raw, unbounded number, not one
   * that's already saturated at "100% of target". A PERCENTAGE LABEL is a
   * different contract, though -- see goalDisplayPercent below for the
   * clamped, display-safe counterpart every percent-showing surface in this
   * app actually renders instead of this field directly.
   *
   * Guarded against divide-by-zero: `goal.targetS` is bounded well away
   * from 0 by goals.ts's own MIN_TARGET_S for anything created on this
   * device, but this array is also fed by sanitizeRemoteGoals from another
   * device/the dashboard (see GoalRow.tsx's barGeometry comment) -- a 0 or
   * negative targetS there computes to 0 rather than NaN/Infinity. */
  ratio: number;
  /** True once BOTH targets are satisfied: focusS >= targetS, AND (if the
   * goal has one) sessionCount >= targetSessions. For a time-only goal
   * (Goal.targetSessions undefined -- the shape every goal had before that
   * field existed), this is exactly the old focusS >= targetS check, so a
   * caller written against the pre-extension contract sees no behavior
   * change. */
  met: boolean;
  /** Count of in-window, topic-matching sessions -- always present (0 when
   * none matched), the session-count counterpart to `focusS`'s seconds,
   * added so a caller can show "3 sessions today" even for a goal with no
   * `targetSessions` of its own. */
  sessionCount: number;
  /** Echoes Goal.targetSessions -- present only when the goal actually has
   * a session-count target (see that field's own comment in goals.ts); a
   * caller can use `targetSessions !== undefined` as the same
   * "is this a session-count goal too" check goals.ts's own code uses. */
  targetSessions?: number;
  /** sessionCount >= targetSessions -- present only alongside
   * `targetSessions` (both or neither), the session-count counterpart to
   * `met`'s seconds-only meaning. */
  sessionsMet?: boolean;
  /** False only for a day-restricted daily goal (Goal.daysOfWeek) on a
   * calendar day that isn't one of its selected weekdays -- see
   * isGoalDueOn above. Always true for weekly/monthly goals and for an
   * unrestricted daily one. A UI can use this to render "not scheduled
   * today" instead of a misleading 0%-unmet bar for a day the goal was
   * never meant to run on. */
  dueToday: boolean;
}

/**
 * The percentage a UI actually SHOWS for a goal's progress -- `ratio`
 * clamped to [0, 1] before the *100 and round, unlike `ratio` itself (see
 * that field's own comment for why it stays unclamped upstream).
 *
 * Root cause this fixes: three call sites (GoalRow.tsx's Manage-goals row,
 * GoalsProgressView.tsx's Goals-ring card, useHomeGoalRing.ts's Home Today
 * card) each used to compute their own `Math.round(ratio * 100)` straight
 * off the unclamped ratio, so a goal at 1740% of target rendered the literal
 * number "1741%" right next to a bar/ring that -- correctly -- has no more
 * room to draw past a single full lap (GoalRow.tsx's barGeometry already
 * saturates `fillPct` at 100 with a target-line marker; GoalRing.tsx already
 * clamps its arc the same way). The label and the visual disagreed because
 * only the visual side was ever clamped.
 *
 * The rule picked here: cap the number at 100 and let `met` (already true
 * whenever `ratio >= 1`) carry "you're over" via each surface's existing
 * "Goal met" copy, rather than inventing a second over-100 display like
 * "174%". That keeps every under-target reading byte-identical to today
 * (61% still prints as 61%) and makes the three surfaces agree with each
 * other AND with their own already-capped bar/ring by construction, since
 * they all now go through this one function instead of each re-deriving it.
 *
 * Also defensively clamps a non-finite input (a stray NaN/Infinity, e.g.
 * from a divide-by-zero elsewhere) to 0 rather than rendering "NaN%".
 */
export function goalDisplayPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/**
 * Progress for every non-archived goal, over each goal's own current
 * daily/weekly/monthly window (per goalWindow above), summing `actualS`
 * (and counting sessions, for `sessionCount`) of every session in
 * `sessions` that falls in that window (by `startedAt`, half-open
 * `[windowStart, windowEnd)` -- a session starting exactly at a window's end
 * belongs to the next window, never both) and matches the goal's topic
 * (matchesGoalTopic above). Archived goals are excluded entirely, per the
 * contract -- a tombstoned goal has no progress to show anywhere.
 *
 * A day-restricted daily goal (Goal.daysOfWeek) is NOT excluded on an
 * off-day the way an archived goal is -- its window is still just today, and
 * any matching sessions logged today still count toward `focusS`/
 * `sessionCount` (e.g. an unplanned extra session on an off day still shows
 * up). What changes on an off day is only the result's `dueToday: false`,
 * which a caller uses to render the day differently rather than to change
 * what's counted.
 *
 * Order of the result follows the order of `goals` (minus archived ones) --
 * this function doesn't re-sort, so a caller that wants a particular
 * display order controls it by the order it passes in.
 *
 * `labels` (default `[]`, i.e. nothing excluded) additionally requires
 * stats/customLabels.ts's sessionCountsTowardTotals to allow each session
 * before it contributes to `focusS`/`sessionCount` -- a session tagged with
 * an `excludeFromTotals` label never advances a goal's progress, even a goal
 * explicitly aimed at that exact label id (matchesGoalTopic can still say
 * "yes this matches", but the session still doesn't count -- the same
 * "excluded from every counting path" rule this field's own comment
 * documents, not a special case here). Omitting `labels` reproduces the
 * exact pre-exclusion behavior, which is what goalProgress.golden.test.ts's
 * fixture-parity check (and every other existing caller/test) depends on.
 *
 * `excludedTopicKeys` (default `[]`) is sessionCountsTowardTotals' other
 * exclusion list -- a goal aimed at (or merely matching) one of the six
 * built-in topics doesn't advance from a session tagged with a topic the
 * user has excluded, same rule as `labels` and same backward-compatible
 * default.
 */
export function computeGoalProgress(
  goals: Goal[],
  sessions: LoggedSession[],
  nowMs: number,
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): GoalProgressResult[] {
  return goals
    .filter((g) => !g.archived)
    .map((goal) => {
      const { startMs, endMs } = goalWindow(goal.period, nowMs);
      let focusS = 0;
      let sessionCount = 0;
      for (const s of sessions) {
        if (s.startedAt < startMs || s.startedAt >= endMs) continue;
        if (!matchesGoalTopic(goal, s)) continue;
        if (!sessionCountsTowardTotals(s.topic, labels, excludedTopicKeys)) continue;
        focusS += s.actualS;
        sessionCount += 1;
      }
      const sessionsMet = goal.targetSessions !== undefined ? sessionCount >= goal.targetSessions : undefined;
      return {
        goalId: goal.id,
        period: goal.period,
        targetS: goal.targetS,
        focusS,
        remainingS: Math.max(0, goal.targetS - focusS),
        // See GoalProgressResult.ratio's own comment for why this is
        // guarded rather than a bare `focusS / goal.targetS`.
        ratio: goal.targetS > 0 ? focusS / goal.targetS : 0,
        met: focusS >= goal.targetS && (sessionsMet === undefined || sessionsMet),
        sessionCount,
        ...(goal.targetSessions !== undefined ? { targetSessions: goal.targetSessions, sessionsMet } : {}),
        dueToday: isGoalDueOn(goal, nowMs),
      };
    });
}
