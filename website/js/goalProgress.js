/* =========================================================================
   goalProgress.js -- the window/progress math for focus goals: which
   calendar window a goal is measured over, whether it is due today, and how
   far through it the user is.

   Split out of goals.js to mirror app/src/goals/goalProgress.ts, which has
   always been its own module. goals.js is the goal MODEL -- create, update,
   archive, sanitize, merge -- and this is the arithmetic performed on it;
   the two share no state and nothing here reads the model's internals.

   The two sides are pinned to each other by a shared golden fixture,
   tests/fixtures/goalProgress.golden.json, asserted from both (this file's
   twin tests/website/goalProgress.golden.test.js and the app's
   goalProgress.golden.test.ts). Changing ANY of the math here means
   regenerating that fixture -- see its own header -- and checking
   app/src/goals/goalProgress.ts still agrees. That fixture is the one place
   drift between the two surfaces actually gets caught.
   ========================================================================= */
import { sessionCountsTowardTotals } from './focusStats.js';

// This section (goalWindow, isGoalDueOn, computeGoalProgress below) is the
// plain-JS port of app/src/goals/goalProgress.ts's window/progress math.
// The two are checked against each other by a shared golden fixture,
// tests/fixtures/goalProgress.golden.json, asserted from both sides (this
// file's own tests/website/goalProgress.golden.test.js twin and the app's
// goalProgress.golden.test.ts). Changing ANY of the math here means
// regenerating that fixture (see its own header for the recipe) and
// checking app/src/goals/goalProgress.ts still agrees -- the fixture is the
// one place drift between the two would actually get caught.

/** First-day-of-week finding: focusStats.js's buildMonthGrid pads its grid
 * with `firstWeekday = monthStart.getDay()` leading `null` cells and its
 * sibling WEEKDAY_INITIALS array starts at 'S' for Sunday (Date#getDay()'s
 * native 0=Sunday..6=Saturday order) -- an explicit "Sun-first ... mirrors
 * CalendarScreen.tsx's buildGrid" port, per that function's own comment. The
 * app's CalendarScreen.tsx uses the same `monthStart.getDay()` leading-blank
 * -cell count. Neither side has a Monday-start convention anywhere in this
 * codebase, so the half-open weekly window below is Sunday-start, confirmed
 * against app/src/goals/goalProgress.ts's own goalWindow rather than the
 * shared contract's Monday-start fallback text.
 *
 * Half-open `[startMs, endMs)` on `session.startedAt` for all three periods
 * -- a session starting exactly at `startMs` counts, one starting exactly
 * at `endMs` belongs to the *next* window, not this one. Matters at exact
 * local-midnight boundaries (daily), exact Sunday-midnight boundaries
 * (weekly), and exact 1st-of-the-month-midnight boundaries (monthly). The
 * monthly branch's `new Date(y, m + 1, 1)` deliberately overflows `m`
 * rather than hand-computing "days in this month" -- the `Date`
 * constructor already normalizes month-index overflow into the correct
 * next-year rollover for December, confirmed against
 * app/src/goals/goalProgress.ts's own monthlyWindow. */
export function goalWindow(period, nowMs) {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'daily') {
    const endOfToday = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() + 1);
    return { startMs: startOfToday.getTime(), endMs: endOfToday.getTime() };
  }
  if (period === 'monthly') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { startMs: startOfMonth.getTime(), endMs: startOfNextMonth.getTime() };
  }
  const sunday = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - startOfToday.getDay());
  const nextSunday = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + 7);
  return { startMs: sunday.getTime(), endMs: nextSunday.getTime() };
}

/** Whether `goal`'s target actually applies to the calendar day containing
 * `nowMs` -- confirmed against app/src/goals/goalProgress.ts's own
 * isGoalDueOn. Always true for weekly/monthly goals and for a daily goal
 * with no daysOfWeek restriction (undefined/[] both mean "every day"); for
 * a day-restricted daily goal, true only when nowMs's local weekday
 * (0=Sun..6=Sat) is one of the goal's selected days. */
export function isGoalDueOn(goal, nowMs) {
  if (goal.period !== 'daily' || !goal.daysOfWeek || goal.daysOfWeek.length === 0) return true;
  return goal.daysOfWeek.includes(new Date(nowMs).getDay());
}

/**
 * The percentage a UI actually SHOWS for a goal's progress -- `ratio`
 * clamped to [0, 1] before the *100 and round, unlike `ratio` itself, which
 * computeGoalProgress below deliberately leaves unbounded (see its own
 * comment) because a bar that still has room to draw "how far over" needs
 * the raw number. Port of app/src/goals/goalProgress.ts's function of the
 * same name; keep the two in step.
 *
 * A PERCENTAGE LABEL is a different contract from a bar, and conflating the
 * two is the bug this fixes: goalsPanel.js's row derived its own
 * `Math.round(ratio * 100)` off the unclamped ratio, so a 1h daily goal with
 * 1h48m logged printed "180%" next to a bar barGeometry had already
 * saturated at full width. The label and the visual contradicted each other
 * because only the visual side was ever clamped. The app hit the identical
 * bug across three surfaces and fixed it by funnelling all of them through
 * this one function rather than each re-deriving the maths.
 *
 * The rule, matching the app exactly: cap at 100 and let `met` (already true
 * whenever ratio >= 1) carry "you're over" via the row's existing "Goal met"
 * copy, rather than inventing a second over-100 display. Every under-target
 * reading stays byte-identical to the old derivation. Note this does NOT
 * touch barGeometry, which keeps consuming the unclamped ratio so its target
 * notch can still show the size of the overshoot -- same division of labour
 * as app/src/screens/GoalRow.tsx.
 *
 * Also clamps a non-finite input (a stray NaN/Infinity from a
 * divide-by-zero elsewhere) to 0 rather than rendering "NaN%".
 */
export function goalDisplayPercent(ratio) {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** Progress for every non-archived goal in `goals`, in the same order they
 * appear in that array (archived ones are filtered out before computing --
 * they never appear in the output, not even as a zeroed entry -- and this
 * never re-sorts; sort `goals` first, or the result, if a particular display
 * order is wanted). Field names/shape confirmed against
 * app/src/goals/goalProgress.ts's own GoalProgressResult: `goalId` (not
 * `id`), `period`, `targetS`, `focusS`, `remainingS`, `ratio`, `met`,
 * `sessionCount`, `targetSessions`, `sessionsMet`, `dueToday` -- no others.
 *
 * A session counts toward a goal's window when `goal.topic === null` (every
 * in-window session, including untagged ones) or `session.topic ===
 * goal.topic` exactly -- raw string compare, never resolved through
 * resolveTopic, so a goal pinned to a since-deleted custom label id still
 * matches sessions tagged with that id, and an untagged session never counts
 * toward a topic-specific goal.
 *
 * A day-restricted daily goal (Goal.daysOfWeek) is NOT excluded on an
 * off-day the way an archived goal is -- any matching session logged today
 * still counts toward focusS/sessionCount; only the result's `dueToday`
 * flag changes, per isGoalDueOn above. `met` requires BOTH the time target
 * AND the session-count target (when the goal has one) -- for a time-only
 * goal (no targetSessions, the shape every goal had before this field
 * existed) this is exactly the pre-extension `focusS >= targetS` check.
 *
 * `labels` (default `[]`, i.e. nothing excluded) additionally requires
 * focusStats.js's sessionCountsTowardTotals to allow each session before it
 * contributes to focusS/sessionCount -- a session tagged with an
 * `excludeFromTotals` label never advances a goal's progress, even a goal
 * explicitly aimed at that exact label id (the raw topic match above can
 * still say "yes this matches"; the session still doesn't count). Mirrors
 * app/src/goals/goalProgress.ts's own `labels` parameter -- see that
 * function's comment for the full rationale. Omitting `labels` reproduces
 * the exact pre-exclusion behavior, which is what every pre-existing caller/
 * test depends on.
 *
 * `excludedTopicKeys` (default `[]`) is sessionCountsTowardTotals' other
 * exclusion list -- a goal aimed at (or merely matching) one of the six
 * built-in topics doesn't advance from a session tagged with a topic the
 * user has excluded, same rule as `labels` and same backward-compatible
 * default. */
export function computeGoalProgress(goals, sessions, nowMs = Date.now(), labels = [], excludedTopicKeys = []) {
  const results = [];
  for (const goal of goals) {
    if (goal.archived) continue;
    const { startMs, endMs } = goalWindow(goal.period, nowMs);
    let focusS = 0;
    let sessionCount = 0;
    for (const s of sessions) {
      if (s.startedAt < startMs || s.startedAt >= endMs) continue;
      if (goal.topic !== null && s.topic !== goal.topic) continue;
      if (!sessionCountsTowardTotals(s.topic, labels, excludedTopicKeys)) continue;
      focusS += s.actualS;
      sessionCount += 1;
    }
    const sessionsMet = goal.targetSessions !== undefined ? sessionCount >= goal.targetSessions : undefined;
    results.push({
      goalId: goal.id,
      period: goal.period,
      targetS: goal.targetS,
      focusS,
      remainingS: Math.max(0, goal.targetS - focusS),
      // Deliberately unclamped -- can exceed 1 (e.g. 1.8 = 180% of target).
      // Guarded against divide-by-zero to match app/src/goals/goalProgress.ts,
      // which has carried this guard (and a test for it) all along: goals
      // reaching this dashboard come through sanitizeRemoteGoals from whatever
      // device wrote them, so a 0 or negative targetS is not something this
      // side gets to assume away. Unguarded it rendered NaN or Infinity here
      // while the app showed 0 for the same synced goal.
      ratio: goal.targetS > 0 ? focusS / goal.targetS : 0,
      met: focusS >= goal.targetS && (sessionsMet === undefined || sessionsMet),
      sessionCount,
      ...(goal.targetSessions !== undefined ? { targetSessions: goal.targetSessions, sessionsMet } : {}),
      dueToday: isGoalDueOn(goal, nowMs),
    });
  }
  return results;
}
