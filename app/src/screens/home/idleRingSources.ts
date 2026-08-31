// idleRingSources.ts -- the per-source math for the three Home ring sources
// added after the original five (session count, pace-through-the-day, and
// the monthly-goal ratio, which reuses the shared goal-ratio shape and so
// needs no function of its own here).
//
// Split from idleRingState.ts, which keeps the IdleRingState/RingSourceKind
// types, the original five sources, and the single dispatcher every caller
// goes through -- that file was already at 305 lines against this project's
// 500-line guideline. Same discipline as its parent: no React, no store
// reads, no Date.now() of its own (every time-dependent input is a
// parameter), so each source stays independently unit-testable.
import { groupByDay, dayKey, type LoggedSession } from '../../stats/sessionHistory';
import { filterCountedSessions, type CustomLabel } from '../../stats/customLabels';
import type { IdleRingState } from './idleRingState';

/**
 * The window a "pace" reading is measured across: 08:00 to midnight local.
 *
 * A pace ring answers "am I where I should be by now", which needs some
 * notion of how much of the usable day has gone. Measuring from actual
 * midnight is the obvious choice and the wrong one: at 08:00 it would claim
 * you are already a third of the way through the day and badly behind,
 * purely for having been asleep. Starting at 08:00 means the ring reads
 * full-but-empty first thing in the morning (nothing expected yet, nothing
 * done) and climbs through the day.
 *
 * A fixed window rather than a learned one -- deriving each user's real
 * waking hours from their session history is a much bigger idea than this
 * ring needs, and would make the number quietly unpredictable.
 */
export const PACE_DAY_START_HOUR = 8;
export const PACE_DAY_END_HOUR = 24;

/**
 * How far through the pace window `nowMs` falls, 0..1. Before the window
 * opens this is 0 (nothing is expected of you yet); after it closes, 1 (the
 * whole day's target was expected).
 */
export function paceFractionOfDay(nowMs: number): number {
  const d = new Date(nowMs);
  const hours = d.getHours() + d.getMinutes() / 60;
  const span = PACE_DAY_END_HOUR - PACE_DAY_START_HOUR;
  return Math.max(0, Math.min(1, (hours - PACE_DAY_START_HOUR) / span));
}

/**
 * Today's focus time against how much of the daily goal you'd expect to
 * have done by this hour -- so 100% means exactly on pace, not "goal met".
 *
 * Reads as empty when there's no daily goal to pace against (there's no
 * meaningful expectation without a target) or before the pace window opens
 * (`expectedS` is 0, and dividing today's real focus time by it would be
 * either Infinity or a meaningless 0). Note the deliberate difference from
 * every other source: this one does NOT bail on `todayFocusS <= 0`. Being at
 * 0% of what you should have done by 4pm is the single most useful thing
 * this ring can tell you, and suppressing it as "empty" would hide exactly
 * the reading the user turned this source on for.
 */
export function computePaceRingProgress(
  todayFocusS: number,
  dailyGoalTargetS: number | null,
  nowMs: number,
): IdleRingState {
  if (dailyGoalTargetS == null || dailyGoalTargetS <= 0) return { progress: 0, source: 'empty' };
  const fraction = paceFractionOfDay(nowMs);
  const expectedS = dailyGoalTargetS * fraction;
  if (expectedS <= 0) {
    // The day hasn't started expecting anything yet -- a full ring would
    // read as "done" and an empty one as "behind"; neither is true, so this
    // reports a real pace source with 0 progress and lets the caption
    // ("nothing expected yet") carry the meaning.
    return { progress: 0, source: 'pace', pace: { expectedS: 0, actualS: todayFocusS } };
  }
  return {
    progress: todayFocusS / expectedS,
    source: 'pace',
    pace: { expectedS, actualS: todayFocusS },
  };
}

/**
 * Today's completed session COUNT against a target count. A different
 * question from every time-based source -- "did I sit down to focus four
 * times" rather than "did I accumulate two hours" -- and the one people
 * tracking a habit rather than a workload usually mean.
 *
 * `targetCount` comes from the daily goal's own Goal.targetSessions when it
 * has one (never invented here: a made-up target would make the ring's fill
 * meaningless). Without one this reads as empty rather than guessing.
 */
export function computeSessionCountRingProgress(count: number, targetCount: number | null): IdleRingState {
  if (targetCount == null || targetCount <= 0) return { progress: 0, source: 'empty' };
  return {
    progress: count / targetCount,
    source: 'sessionCount',
    sessionCount: { count, target: targetCount },
  };
}

/** How many sessions were logged on the calendar day containing `nowMs`.
 * Uses sessionHistory.ts's own groupByDay/dayKey rather than re-bucketing by
 * raw ms, so "today" means the same calendar day here as everywhere else in
 * the app (and stays correct across a DST transition).
 *
 * Takes the same optional `labels`/`excludedTopicKeys` trailing pair every
 * other counting path in the app does (customLabels.ts's
 * sessionCountsTowardTotals), so a session tagged with an excluded label
 * doesn't inflate the count -- it would otherwise disagree with the very
 * `dailySessionTarget` it gets compared against in
 * computeSessionCountRingProgress above, which IS computed from filtered
 * goal progress. This filter used to live at the single call site in
 * useHomeGoalRing.ts instead; it belongs here, so the next caller of this
 * function gets the rule for free rather than having to know to reapply it.
 * Defaults to "everything counts", keeping existing callers and tests
 * valid -- the same optional-trailing-param convention aggregate/bestDay/
 * computeGoalProgress already follow. */
export function todaySessionCount(
  sessions: LoggedSession[],
  nowMs: number,
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): number {
  const counted = filterCountedSessions(sessions, labels, excludedTopicKeys);
  return groupByDay(counted).get(dayKey(nowMs))?.length ?? 0;
}
