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
import type { Goal } from '../goals/goals';
import { goalWindow, isGoalDueOn, GoalWindow } from '../goals/goalProgress';
import type { LoggedSession } from './sessionHistory';

// Caps how far back the streak walk looks so a years-old goal with a broken
// (or simply never-met) window can't turn this into an unbounded loop --
// 60 covers two months of a daily goal or well over a year of a weekly/
// monthly one, far past what's useful to show as "streak" in a small ring
// card.
const MAX_STREAK_WINDOWS = 60;

/** Whether `session` counts toward `goal`, per the exact matching rule
 * documented on Goal.topic in goals.ts and re-implemented (not imported) by
 * goalProgress.ts's own module-private matchesGoalTopic -- this is the same
 * one-line predicate, not a re-derivation of any of goalProgress.ts's actual
 * window/ratio math, so it isn't the "goal math" this file's header says to
 * consume rather than reimplement. */
function matchesGoalTopic(goal: Goal, session: LoggedSession): boolean {
  return goal.topic === null || session.topic === goal.topic;
}

/** Focus seconds AND matching-session count within `window` -- the same two
 * numbers goalProgress.ts's computeGoalProgress sums for its own
 * focusS/sessionCount, re-derived here (not imported) only because that
 * function always evaluates the CURRENT window, and a streak walk needs the
 * same sum for arbitrary past windows too. */
function windowTotals(goal: Goal, sessions: LoggedSession[], window: GoalWindow): { focusS: number; sessionCount: number } {
  let focusS = 0;
  let sessionCount = 0;
  for (const s of sessions) {
    if (s.startedAt < window.startMs || s.startedAt >= window.endMs) continue;
    if (!matchesGoalTopic(goal, s)) continue;
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
function isWindowMet(goal: Goal, totals: { focusS: number; sessionCount: number }): boolean {
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
 */
export function computeGoalStreak(goal: Goal, sessions: LoggedSession[], nowMs: number): number {
  if (goal.archived) return 0;
  let streak = 0;
  let cursorMs = nowMs;
  let isCurrentWindow = true;
  for (let i = 0; i < MAX_STREAK_WINDOWS; i++) {
    const window = goalWindow(goal.period, cursorMs);
    if (!isGoalDueOn(goal, window.startMs)) {
      cursorMs = window.startMs - 1;
      continue; // off day -- neither a hit nor a miss, doesn't count or break
    }
    const met = isWindowMet(goal, windowTotals(goal, sessions, window));
    if (isCurrentWindow) {
      if (met) streak += 1;
    } else if (met) {
      streak += 1;
    } else {
      break;
    }
    isCurrentWindow = false;
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
