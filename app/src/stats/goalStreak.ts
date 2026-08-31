// goalStreak.ts -- pure "how many windows in a row has this goal been hit"
// and "am I currently on pace for this window" helpers for the Stats
// screen's read-only Goals view (GoalsProgressView.tsx). Deliberately kept
// out of goals/goalProgress.ts (which this module only reads from, never
// duplicates) -- goalProgress.ts's own header restricts itself to a single
// current window per goal, by design, so a multi-window streak walk belongs
// beside the screen that renders it, not inside the shared progress model
// every sync/dashboard consumer also depends on.
//
// Both functions are pure/no-RN-deps, same convention as trend.ts and
// comparisons.ts, and take `nowMs` as a parameter rather than reading
// Date.now() internally, matching goalProgress.ts's own testability
// convention.
//
// windowTotals/isWindowMet/matchesGoalTopic are exported (not just
// module-private) so goalStreakHistory.ts's best-streak walk and
// window-history/day-status helpers reuse the exact same "does this window
// count as met" arithmetic this file's own computeGoalStreak already uses,
// instead of a second copy that could drift -- see that file's own header
// for why it's a sibling module rather than folded in here (500-line
// guideline).
import type { Goal } from '../goals/goals';
import { goalWindow, isGoalDueOn, GoalWindow } from '../goals/goalProgress';
import type { LoggedSession } from './sessionHistory';
import type { CustomLabel } from './customLabels';
// sessionCountsTowardTotals does not exist in customLabels.ts as of this
// writing -- a second agent working in parallel on the "which labels count
// toward totals" feature owns that file and is actively adding it (see this
// feature's own cross-agent contract). Imported and called here anyway, per
// that contract: a goal's streak must not count a session logged under an
// excludeFromTotals label (e.g. a "Sleep" label someone tags but never wants
// counted toward a focus streak) any more than goalProgress.ts's own
// computeGoalProgress should -- see that agent's parallel work for the
// other half of this rule.
import { sessionCountsTowardTotals } from './customLabels';

// Caps how many DUE windows the streak walk inspects so a years-old goal
// with a broken (or simply never-met) window can't turn this into an
// unbounded loop -- 60 covers two months of a daily goal or well over a
// year of a weekly/monthly one, far past what's useful to show as "streak"
// in a small ring card.
const MAX_STREAK_WINDOWS = 60;

// The underlying calendar-step cap, separate from MAX_STREAK_WINDOWS above.
// A day-restricted daily goal (Goal.daysOfWeek) skips most calendar days as
// off days -- computeGoalStreak used to count every STEP of the walk against
// MAX_STREAK_WINDOWS, off days included, so a goal due only one day a week
// hit the cap after just ~60 calendar days (~8-9 due days), silently
// truncating a real streak far short of 60. Off days can consume up to 6 of
// every 7 steps (Goal.daysOfWeek's own comment: at least one day must be
// selected for a restriction to mean anything), so 7x headroom guarantees
// MAX_STREAK_WINDOWS *due* windows are always reachable even in that
// sparsest case, while an unrestricted goal (every window due) still exits
// long before this bound via MAX_STREAK_WINDOWS itself.
const MAX_STREAK_CALENDAR_STEPS = MAX_STREAK_WINDOWS * 7;

/** Whether `session` counts toward `goal`, per the exact matching rule
 * documented on Goal.topic in goals.ts and re-implemented (not imported) by
 * goalProgress.ts's own module-private matchesGoalTopic -- this is the same
 * one-line predicate, not a re-derivation of any of goalProgress.ts's actual
 * window/ratio math, so it isn't the "goal math" this file's header says to
 * consume rather than reimplement. */
export function matchesGoalTopic(goal: Goal, session: LoggedSession): boolean {
  return goal.topic === null || session.topic === goal.topic;
}

/** Focus seconds AND matching-session count within `window` -- the same two
 * numbers goalProgress.ts's computeGoalProgress sums for its own
 * focusS/sessionCount, re-derived here (not imported) only because that
 * function always evaluates the CURRENT window, and a streak walk needs the
 * same sum for arbitrary past windows too.
 *
 * `labels` additionally excludes any session tagged with an
 * excludeFromTotals custom label (stats/customLabels.ts's
 * sessionCountsTowardTotals) -- a session that doesn't count toward the
 * user's totals/goals shouldn't count toward a goal's streak either, same
 * rule goalProgress.ts's own consumer of that function applies. Defaults to
 * `[]`, under which sessionCountsTowardTotals accepts every session (there
 * is nothing to exclude), so every existing call site that hasn't been
 * updated to pass a real label catalog keeps behaving exactly as before.
 *
 * `excludedTopicKeys` (default `[]`) is the identical exclusion for the six
 * built-in topics, forwarded alongside `labels` to sessionCountsTowardTotals. */
export function windowTotals(
  goal: Goal,
  sessions: LoggedSession[],
  window: GoalWindow,
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): { focusS: number; sessionCount: number } {
  let focusS = 0;
  let sessionCount = 0;
  for (const s of sessions) {
    if (s.startedAt < window.startMs || s.startedAt >= window.endMs) continue;
    if (!matchesGoalTopic(goal, s)) continue;
    if (!sessionCountsTowardTotals(s.topic, labels, excludedTopicKeys)) continue;
    focusS += s.actualS;
    sessionCount += 1;
  }
  return { focusS, sessionCount };
}

/** A window is "met" under the exact same combined rule
 * GoalProgressResult.met documents: focusS >= targetS AND, only if the goal
 * has a session-count target too, sessionCount >= targetSessions. For a
 * time-only goal (no targetSessions) this is identical to the old
 * focusS >= targetS check. */
export function isWindowMet(goal: Goal, totals: { focusS: number; sessionCount: number }): boolean {
  const focusMet = totals.focusS >= goal.targetS;
  const sessionsMet = goal.targetSessions === undefined || totals.sessionCount >= goal.targetSessions;
  return focusMet && sessionsMet;
}

/**
 * Consecutive met windows, most recent first, walking backward from the
 * window containing `nowMs`. The in-progress current window counts toward
 * the streak the moment it's already met (an early finish keeps a streak
 * alive right away, rather than waiting for the window to close) but does
 * NOT break the streak just for not being met yet -- the walk simply moves
 * on to the previous (already-closed) window to keep counting, since an
 * unfinished window is not a miss. A genuinely missed prior window stops the
 * walk.
 *
 * A day-restricted daily goal's off days (Goal.daysOfWeek, isGoalDueOn) are
 * skipped entirely rather than counted as either a hit or a miss -- a
 * Mon/Wed/Fri goal's streak should read "how many scheduled days in a row",
 * not be reset to 0 every Tuesday morning just because Tuesday was never a
 * day it was due.
 *
 * Capped at MAX_STREAK_WINDOWS; returns 0 for an archived goal (no streak to
 * show for a tombstone) or one with no met windows at all.
 *
 * `labels`/`excludedTopicKeys` are forwarded to windowTotals -- see that
 * function's own comment on `sessionCountsTowardTotals` -- and both default
 * to `[]` for the same backward-compatible reason.
 */
export function computeGoalStreak(
  goal: Goal,
  sessions: LoggedSession[],
  nowMs: number,
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): number {
  if (goal.archived) return 0;
  let streak = 0;
  let cursorMs = nowMs;
  let dueWindowsChecked = 0;
  for (let i = 0; i < MAX_STREAK_CALENDAR_STEPS && dueWindowsChecked < MAX_STREAK_WINDOWS; i++) {
    const window = goalWindow(goal.period, cursorMs);
    // `i === 0` is exactly "the window containing nowMs", which is the only
    // window that can still be in progress -- every later iteration has
    // stepped strictly backwards past it. This used to be a mutable flag
    // cleared at the BOTTOM of the loop, which the off-day `continue` below
    // jumps over: on a Mon/Wed/Fri goal checked on a Tuesday, the flag was
    // still set when the walk reached Monday, so Monday got the leniency
    // meant for an unfinished window even though its window had closed
    // hours earlier. A missed Monday was silently forgiven and the streak
    // kept counting from the Monday before it -- the Stats screen showed a
    // live streak to someone who had just broken it, and only on the days
    // they weren't scheduled, which is why it reads as intermittent.
    const isCurrentWindow = i === 0;
    if (!isGoalDueOn(goal, window.startMs)) {
      cursorMs = window.startMs - 1;
      continue; // off day -- neither a hit nor a miss, doesn't count or break
    }
    // Only a DUE window advances the MAX_STREAK_WINDOWS cap (see
    // MAX_STREAK_CALENDAR_STEPS's own comment) -- an off day above never
    // reaches this line.
    dueWindowsChecked += 1;
    const met = isWindowMet(goal, windowTotals(goal, sessions, window, labels, excludedTopicKeys));
    if (met) {
      streak += 1;
    } else if (!isCurrentWindow) {
      break; // a closed window that was missed ends the streak
    }
    // An unmet CURRENT window falls through without counting and without
    // breaking -- an unfinished window is not a miss (see the doc comment).
    cursorMs = window.startMs - 1; // step into the previous window
  }
  return streak;
}

/**
 * Whether a goal that hasn't been met yet is still tracking to be met by the
 * time its current window closes, comparing the fraction of the window
 * elapsed against the fraction of the target already banked. An already-met
 * goal is trivially on pace; a window that just opened (elapsed ~0) is
 * treated as on pace too, since there's nothing yet to have fallen behind
 * on. `ratio`/`met` come straight from goalProgress.ts's GoalProgressResult
 * (not recomputed here) -- this function only adds the elapsed-time
 * comparison goalProgress.ts's single-window result doesn't carry. `met`
 * already folds in a session-count target if the goal has one (see
 * GoalProgressResult.met's own comment), so this stays correct for either
 * kind of goal without needing to know which.
 */
export function isGoalOnPace(
  ratio: number,
  met: boolean,
  window: GoalWindow,
  nowMs: number,
): boolean {
  if (met) return true;
  const span = window.endMs - window.startMs;
  if (span <= 0) return true;
  const elapsed = Math.max(0, Math.min(1, (nowMs - window.startMs) / span));
  if (elapsed <= 0) return true;
  return ratio >= elapsed;
}

/**
 * The streak's own health, as a small closed set a UI can key colors/copy
 * off of directly, rather than every card re-deriving the same if/else chain
 * from `streak`/`bestStreak`/`dueToday`/`met`/`onPace` (GoalsProgressView.tsx
 * is the first consumer, but this is pure/display-agnostic like
 * goalDisplayPercent in goalProgress.ts, so it belongs here rather than in a
 * .tsx file).
 *
 * - 'active': a live streak (`streak > 0`) that is currently safe -- either
 *   the goal isn't due today, it's already met today, or it's still on pace
 *   to be met before the window closes.
 * - 'atRisk': a live streak whose CURRENT window is due, not yet met, and no
 *   longer on pace -- the closed-window check inside computeGoalStreak
 *   itself hasn't run yet (the window is still open), but on the current
 *   trajectory it's about to, which is exactly the moment a user can still
 *   do something about it.
 * - 'broken': no live streak (`streak === 0`) but `bestStreak > 0` -- there
 *   WAS one, distinct from a goal that has simply never built one, so a card
 *   can say "streak broken" instead of showing nothing.
 * - 'none': no live streak and no best streak either -- nothing streak-shaped
 *   has ever happened for this goal yet.
 */
export type GoalStreakState = 'active' | 'atRisk' | 'broken' | 'none';

export function goalStreakState(
  streak: number,
  bestStreak: number,
  dueToday: boolean,
  met: boolean,
  onPace: boolean,
): GoalStreakState {
  if (streak > 0) {
    return dueToday && !met && !onPace ? 'atRisk' : 'active';
  }
  return bestStreak > 0 ? 'broken' : 'none';
}
