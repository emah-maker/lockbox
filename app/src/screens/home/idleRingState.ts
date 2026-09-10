// idleRingState.ts -- pure state computation for the Home hero ring
// (ProgressRing, via FocusHero.tsx) while there's no live session counting
// down. Previously the ring just sat at 0 whenever idle; this decides what
// it should show instead, per the user's own choice of ring "source"
// (useSettingsStore's ringSourceKind, set from RingBaselineSection.tsx):
//   - 'auto' (the original, and still the default): a daily goal's progress
//     if one is set, else the best day in a chosen baseline window, else
//     nothing on a day with no focus time yet.
//   - 'weeklyGoal': progress toward the single untopic'd weekly goal.
//   - 'chosenGoal': progress toward one specific goal the user picked.
//   - 'rollingAverage': today's focus time against the trailing 7-day
//     average (today excluded from the average itself).
//   - 'streak': the current daily streak against the longest one on record.
//   - 'monthlyGoal': progress toward the single untopic'd monthly goal.
//   - 'sessionCount': today's session count against the daily goal's own
//     Goal.targetSessions.
//   - 'pace': today's focus time against how much of the daily goal you'd
//     expect to have done by this hour -- see idleRingSources.ts.
// Kept dependency-free of React/stores (no React, no store reads) so it's
// unit-testable the same way stats/trend.ts's bestDay is, and so FocusHero
// itself stays a pure render of whatever DashboardScreen computed -- every
// one of these sources is computed here from raw values DashboardScreen
// already has (sessions, goals, settings), never from a hook read inside
// this module. The two streak helpers below do import sessionHistory.ts's
// pure groupByDay/dayKey (a type+value import, same as stats/trend.ts's own
// day-bucketing helpers already do) -- still no React/RN/store dependency,
// just one more pure module reused instead of re-derived.
import { groupByDay, dayKey, type LoggedSession } from '../../stats/sessionHistory';
import { lastNDays } from '../../stats/trend';
import { CustomLabel, filterCountedSessions } from '../../stats/customLabels';
// The three sources added after the original five live next door -- see
// idleRingSources.ts's header for why.
import { computeSessionCountRingProgress, computePaceRingProgress } from './idleRingSources';

export type RingBaselineWindow = 'week' | 'month' | 'year' | 'all';

/** What the ring actually ended up showing. Every explicitly-pickable
 * source (RingSourceKind, below) can be a result verbatim -- minus 'auto',
 * which is a REQUEST, not a result: it always resolves to 'goal',
 * 'baseline' or 'empty'. Those three are the only ones this module can
 * produce without the user having picked them, so they are the only members
 * listed here and the rest are derived -- which is what stops a source being
 * added to the picker and forgotten in the result tag, or vice versa. */
export type RingProgressSource = Exclude<RingSourceKind, 'auto'> | 'goal' | 'baseline' | 'empty';

export interface IdleRingState {
  /** Unclamped fraction -- ProgressRing itself clamps to 0..1 (see its own
   * `progress` prop comment), so a goal exceeded past 100% still reports the
   * real ratio here; only the ring's drawn arc gets clamped, not this value
   * (FocusHero's caption math wants the real, uncapped percentage). */
  progress: number;
  source: RingProgressSource;
  /** Only present when source === 'streak' -- the raw day counts, since a
   * streak caption ("5-day streak, best 12") doesn't read as a percentage
   * the way every other source's caption does, so FocusHero needs the exact
   * numbers rather than just `progress`. */
  streak?: { current: number; longest: number };
  /** Only present when source === 'chosenGoal' -- the chosen goal's display
   * name, already resolved by the caller (DashboardScreen's
   * describeGoalTopic), same "caller resolves display strings, this module
   * never does" convention ringBaselineWindowLabel below and every other
   * caption helper in this app already follows. */
  chosenGoalName?: string;
  /** Only present when source === 'sessionCount' -- a count against a count,
   * which no more reads as a percentage than a streak does, so FocusHero
   * needs the exact numbers (see `streak` above, same reasoning). */
  sessionCount?: { count: number; target: number };
  /** Only present for the three goal-ratio sources ('weeklyGoal',
   * 'monthlyGoal', 'chosenGoal') -- that goal's own window totals, straight
   * from goals/goalProgress.ts's GoalProgressResult.
   *
   * Here for the same reason `streak`, `sessionCount` and `pace` are: the
   * caption's percentage is not enough on its own, and the numbers behind it
   * CANNOT be recovered from `progress`. For every other source `progress`
   * is literally todayFocusS / comparison, so a caption can divide its way
   * back to the comparison. These three are not: their ratio's numerator is
   * the whole week's (or month's) focus time, not today's. Dividing today's
   * seconds by that ratio yields a number that is neither the target nor
   * anything else -- for a 10h weekly goal at 6h done and 30m logged today,
   * it reports "20m to go" against a real 4h remaining. Passing the real
   * pair is the only way a caption can say something true. */
  goalWindow?: { focusS: number; targetS: number };
  /** Only present when source === 'pace' -- seconds expected by now vs.
   * seconds actually done, so the caption can say how far ahead or behind
   * you are in real time rather than only as a ratio. */
  pace?: { expectedS: number; actualS: number };
  /** Today's focus time split by topic, largest first, as fractions of the
   * day's total -- drawn by ProgressRing as a second concentric arc inside
   * the main one. Independent of `source`: the mix is a different question
   * from whatever the outer ring is measuring, which is exactly why it can
   * be shown alongside any of them. Absent when the user has the segment
   * ring switched off, or when nothing has been logged today. */
  segments?: RingSegment[];
}

/** One topic's share of today's focus time. `color` is resolved by the
 * caller (useHomeGoalRing, via stats/customLabels.ts), the same "caller
 * resolves display values, this module never does" convention
 * chosenGoalName follows. */
export interface RingSegment {
  key: string;
  /** 0..1 share of the day's total. The set sums to <= 1. */
  fraction: number;
  color: string;
}

/**
 * Decides the idle ring's progress + which source produced it, in priority
 * order:
 *  1. No focus time at all today (`todayFocusS <= 0`) always reads as empty
 *     -- there's nothing yet to visualize progress toward, regardless of
 *     whether a goal or baseline exists.
 *  2. A daily goal target (the single untopic'd daily goal -- see
 *     DashboardScreen.tsx's own `.find()` and its comment on why only that
 *     one goal is eligible) always wins over the baseline comparison once
 *     today has *some* focus time: an explicit goal the user set is a
 *     stronger signal of what "today" should be measured against than a
 *     historical best day ever could be.
 *  3. Otherwise, today's focus time is compared against `baselineFocusS`
 *     (the best day in the caller's chosen window -- see
 *     ringBaselineWindowLabel below and stats/trend.ts's bestDay, which
 *     DashboardScreen calls with the window from useSettingsStore's
 *     ringBaselineWindow). A `baselineFocusS <= 0` (no history in that
 *     window yet, e.g. a brand-new install) guards the division rather than
 *     dividing by zero -- there's no baseline to show progress against yet,
 *     so this reports 0 rather than Infinity/NaN, but still tags the result
 *     'baseline' (not 'empty') since today itself does have real focus time.
 *
 * This is the 'auto' ring source's own math -- the original (and still
 * default) behavior, unchanged by the multi-source extension below.
 */
export function computeIdleRingProgress(
  todayFocusS: number,
  dailyGoalTargetS: number | null,
  baselineFocusS: number,
): IdleRingState {
  if (todayFocusS <= 0) return { progress: 0, source: 'empty' };
  if (dailyGoalTargetS != null && dailyGoalTargetS > 0) {
    return { progress: todayFocusS / dailyGoalTargetS, source: 'goal' };
  }
  if (baselineFocusS <= 0) return { progress: 0, source: 'baseline' };
  return { progress: todayFocusS / baselineFocusS, source: 'baseline' };
}

/** Display wording for the ring's baseline caption, e.g. "62% of your best
 * day this week." -- FocusHero.tsx's own copy owns the "of your best day"
 * part, this only supplies the trailing window phrase. */
export function ringBaselineWindowLabel(w: RingBaselineWindow): string {
  switch (w) {
    case 'week':
      return 'this week';
    case 'month':
      return 'this month';
    case 'year':
      return 'this year';
    case 'all':
      return 'all time';
  }
}

// -- Multi-source ring extension (manager brief: "more things you can put
// on the focus ring") --------------------------------------------------

/** The user-facing setting (useSettingsStore's ringSourceKind, picked in
 * RingBaselineSection.tsx) -- distinct from RingProgressSource above, which
 * is this module's own computed RESULT tag and is DERIVED from this union
 * (e.g. 'auto' always resolves to either 'goal', 'baseline', or 'empty',
 * never a literal 'auto' result). */
export type RingSourceKind =
  | 'auto'
  | 'weeklyGoal'
  | 'monthlyGoal'
  | 'chosenGoal'
  | 'rollingAverage'
  | 'streak'
  | 'sessionCount'
  | 'pace';

// Also the order the Home ring's own tap-to-cycle steps through (FocusHero's
// source chip), so this array is the single place that order is decided --
// Settings' chip row and the on-screen cycle can never disagree about what
// comes next.
export const RING_SOURCE_KINDS: RingSourceKind[] = [
  'auto',
  'weeklyGoal',
  'monthlyGoal',
  'chosenGoal',
  'rollingAverage',
  'streak',
  'sessionCount',
  'pace',
];

/** The next source in RING_SOURCE_KINDS, wrapping at the end -- what
 * FocusHero's tap-to-cycle affordance advances to. An unrecognized current
 * value (a stale persisted string) restarts at the first entry rather than
 * getting stuck. */
export function nextRingSourceKind(current: RingSourceKind): RingSourceKind {
  const i = RING_SOURCE_KINDS.indexOf(current);
  return RING_SOURCE_KINDS[(i + 1) % RING_SOURCE_KINDS.length];
}

export function ringSourceKindLabel(k: RingSourceKind): string {
  switch (k) {
    case 'auto':
      return 'Daily goal / best day';
    case 'weeklyGoal':
      return 'Weekly goal';
    case 'monthlyGoal':
      return 'Monthly goal';
    case 'chosenGoal':
      return 'A specific goal';
    case 'rollingAverage':
      return '7-day average';
    case 'streak':
      return 'Streak';
    case 'sessionCount':
      return 'Session count';
    case 'pace':
      return 'On pace today';
  }
}

/** Shared "ratio-of-a-goal" shape for the weeklyGoal/chosenGoal sources --
 * both are just "today's progress toward some single goal's current-window
 * ratio", differing only in which goal and (for chosenGoal) a display name
 * for the caption. `ratio`/`chosenGoalName` are computed by the caller
 * (DashboardScreen, via goals/goalProgress.ts's computeGoalProgress -- this
 * module never recomputes goal math, same restriction idleRingState.ts has
 * always had) -- `null` means "no such goal" (none set, or the chosen one
 * was since archived/deleted), which reads as empty here rather than a
 * broken 0%. */
function computeGoalRatioRingProgress(
  ratio: number | null,
  source: 'weeklyGoal' | 'monthlyGoal' | 'chosenGoal',
  chosenGoalName?: string | null,
  goalWindow?: { focusS: number; targetS: number } | null,
): IdleRingState {
  if (ratio == null) return { progress: 0, source: 'empty' };
  // Spread conditionally so a caller that has no window to give (only the
  // ratio, as the unit tests do) produces the same object it always did,
  // rather than one carrying an explicit `goalWindow: undefined`.
  const window = goalWindow ? { goalWindow } : {};
  return source === 'chosenGoal'
    ? { progress: ratio, source, chosenGoalName: chosenGoalName ?? undefined, ...window }
    : { progress: ratio, source, ...window };
}

/** Today's focus time against the trailing 7-day average (today excluded
 * from the average itself, via computeRollingAverageS below) -- 0 today
 * still reads as empty (nothing to show progress toward yet), matching
 * computeIdleRingProgress's own todayFocusS <= 0 guard. A zero/negative
 * average (e.g. a brand-new install with under a week of history) is guarded
 * the same way baselineFocusS <= 0 is above: 0 rather than a divide-by-zero,
 * tagged 'rollingAverage' rather than 'empty' since today itself has real
 * focus time. */
function computeRollingAverageRingProgress(todayFocusS: number, averageS: number): IdleRingState {
  if (todayFocusS <= 0) return { progress: 0, source: 'empty' };
  if (averageS <= 0) return { progress: 0, source: 'rollingAverage' };
  return { progress: todayFocusS / averageS, source: 'rollingAverage' };
}

/** Current streak against the longest one on record. Progress is
 * current/longest (clamped at 1 -- tying or breaking the record both read as
 * a full ring, there's no "past 100%" reading for a streak the way a goal
 * exceeded past its target has), or 1 outright the first time a streak
 * exists with no prior record to compare against (longest <= 0 but current >
 * 0 -- a brand-new streak IS the longest one so far). Both at 0 (no focus
 * history at all) reads as empty, same as every other source's "nothing
 * logged yet" case. */
function computeStreakRingProgress(current: number, longest: number): IdleRingState {
  if (current <= 0 && longest <= 0) return { progress: 0, source: 'empty' };
  if (longest <= 0) return { progress: current > 0 ? 1 : 0, source: 'streak', streak: { current, longest } };
  return { progress: Math.min(1, current / longest), source: 'streak', streak: { current, longest } };
}

/** Every raw input the five ring sources collectively need, gathered into
 * one bag so DashboardScreen has a single call into this module instead of
 * branching on `ringSource` itself -- keeps the source-selection logic in
 * the one file that already owns every other bit of idle-ring precedence. */
export interface IdleRingInputs {
  ringSource: RingSourceKind;
  todayFocusS: number;
  /** 'auto' source only -- the untopic'd daily goal's target, if any. */
  dailyGoalTargetS: number | null;
  /** 'auto' source only -- the best day in the caller's chosen
   * ringBaselineWindow (stats/trend.ts's bestDay). */
  baselineFocusS: number;
  /** 'weeklyGoal' source only -- the untopic'd weekly goal's current-window
   * ratio (goals/goalProgress.ts's GoalProgressResult.ratio), or null if no
   * such goal exists. */
  weeklyGoalRatio: number | null;
  /** 'weeklyGoal' source only -- the same goal's raw window totals, the
   * companion to weeklyGoalRatio above. Optional so a caller (or a test)
   * that only cares about the arc can pass the ratio alone; supply it
   * whenever a caption needs to state real amounts. See
   * IdleRingState.goalWindow for why the ratio alone is not enough. */
  weeklyGoalWindow?: { focusS: number; targetS: number } | null;
  /** 'monthlyGoal' source only -- the untopic'd monthly goal's
   * current-window ratio, or null if no such goal exists. Same shape and
   * same treatment as weeklyGoalRatio above. */
  monthlyGoalRatio: number | null;
  /** 'monthlyGoal' source only -- companion to monthlyGoalRatio, same
   * treatment as weeklyGoalWindow above. */
  monthlyGoalWindow?: { focusS: number; targetS: number } | null;
  /** 'chosenGoal' source only -- the user's picked goal's current-window
   * ratio, or null if none is picked or the picked one no longer exists
   * (archived/deleted). */
  chosenGoalRatio: number | null;
  /** 'chosenGoal' source only -- companion to chosenGoalRatio, same
   * treatment as weeklyGoalWindow above. */
  chosenGoalWindow?: { focusS: number; targetS: number } | null;
  /** 'chosenGoal' source only -- the picked goal's display name, already
   * resolved by the caller (DashboardScreen's describeGoalTopic). Ignored
   * (and may be null) for every other source. */
  chosenGoalName: string | null;
  /** 'rollingAverage' source only -- see computeRollingAverageS below. */
  rollingAverageS: number;
  /** 'streak' source only -- see computeDailyStreak below. */
  streakCurrent: number;
  /** 'streak' source only -- see computeLongestDailyStreak below. */
  streakLongest: number;
  /** 'sessionCount' source only -- sessions logged today
   * (idleRingSources.ts's todaySessionCount). */
  todaySessionCount: number;
  /** 'sessionCount' source only -- the daily goal's own Goal.targetSessions,
   * or null when it has none. Never invented (see
   * computeSessionCountRingProgress). */
  dailySessionTarget: number | null;
  /** 'pace' source only -- the current time, so the day's elapsed fraction
   * can be computed. Passed in rather than read via Date.now() here, same as
   * every other time input in this module. */
  nowMs: number;
  /** Today's topic mix, already resolved to colors by the caller. Passed
   * through to the result unchanged for EVERY source -- see
   * IdleRingState.segments for why it's independent of the source. */
  segments?: RingSegment[];
}

/** Single entry point DashboardScreen calls to get the idle ring's state,
 * dispatching on the user's chosen ringSource. Every branch delegates to one
 * of the pure per-source functions above/below -- this function itself is
 * just the switch, so each source's own math stays independently testable. */
export function computeIdleRingState(inputs: IdleRingInputs): IdleRingState {
  // The topic-mix arc rides along with whatever the dispatcher returns
  // rather than being a source of its own -- it answers a different question
  // (what today was spent ON) from the outer ring (how today compares to a
  // target), so the two are shown together, not instead of each other.
  const state = dispatchIdleRingState(inputs);
  return inputs.segments && inputs.segments.length > 0 ? { ...state, segments: inputs.segments } : state;
}

function dispatchIdleRingState(inputs: IdleRingInputs): IdleRingState {
  switch (inputs.ringSource) {
    case 'weeklyGoal':
      return computeGoalRatioRingProgress(inputs.weeklyGoalRatio, 'weeklyGoal', null, inputs.weeklyGoalWindow);
    case 'monthlyGoal':
      return computeGoalRatioRingProgress(inputs.monthlyGoalRatio, 'monthlyGoal', null, inputs.monthlyGoalWindow);
    case 'sessionCount':
      return computeSessionCountRingProgress(inputs.todaySessionCount, inputs.dailySessionTarget);
    case 'pace':
      return computePaceRingProgress(inputs.todayFocusS, inputs.dailyGoalTargetS, inputs.nowMs);
    case 'chosenGoal':
      return computeGoalRatioRingProgress(inputs.chosenGoalRatio, 'chosenGoal', inputs.chosenGoalName, inputs.chosenGoalWindow);
    case 'rollingAverage':
      return computeRollingAverageRingProgress(inputs.todayFocusS, inputs.rollingAverageS);
    case 'streak':
      return computeStreakRingProgress(inputs.streakCurrent, inputs.streakLongest);
    case 'auto':
    default:
      return computeIdleRingProgress(inputs.todayFocusS, inputs.dailyGoalTargetS, inputs.baselineFocusS);
  }
}

// Caps how far back the streak walks look so a years-old history can't turn
// either helper below into an unbounded loop -- same defensive cap
// stats/goalStreak.ts's own MAX_STREAK_WINDOWS uses for the identical reason,
// sized here in days (~10 years) rather than goal-windows.
const MAX_STREAK_DAYS = 3650;

/** Local-date arithmetic (not raw ms subtraction), same DST-safe pattern
 * sessionHistory.ts's own dayKey callers (lastNDays, filterByWindow) use --
 * the calendar day `offsetDays` before the one containing `nowMs`. */
function dayKeyOffset(nowMs: number, offsetDays: number): string {
  const d = new Date(nowMs);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offsetDays).getTime());
}

/** Consecutive calendar days, ending today, with at least one logged
 * session -- 0 if today itself has no focus time yet (an idle ring on a
 * fresh day before the first session shouldn't claim yesterday's streak is
 * still "current"; today has to have already contributed). Walks backward
 * one day at a time and stops at the first day with no sessions at all.
 *
 * `labels` and `excludedTopicKeys` (both default `[]`) are run through
 * customLabels.ts's filterCountedSessions before bucketing by day, same as
 * stats/trend.ts's bestDay/lastNDays -- a day where every session was tagged
 * with an excludeFromTotals label (e.g. only "Sleep"), or with an excluded
 * built-in topic, doesn't count as a day this streak was kept. */
export function computeDailyStreak(
  sessions: LoggedSession[],
  nowMs: number = Date.now(),
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): number {
  const byDay = groupByDay(filterCountedSessions(sessions, labels, excludedTopicKeys));
  let streak = 0;
  for (let i = 0; i < MAX_STREAK_DAYS; i++) {
    if (!byDay.has(dayKeyOffset(nowMs, i))) break;
    streak += 1;
  }
  return streak;
}

/** The next calendar day's key after `key` -- date-arithmetic (not ms diff),
 * so comparing two keys for "consecutive" stays correct across a DST
 * transition (a DST day is not exactly 86400000ms long in UTC terms, but
 * `Date`'s own y/m/d overflow normalization is, same reasoning
 * sessionHistory.ts's own dayKey callers already lean on). */
function nextDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + 1).getTime());
}

/** The longest run of consecutive calendar days with at least one logged
 * session anywhere in history -- a single linear pass over every distinct
 * day key present (sorted -- 'Y-M-D' zero-padded keys sort chronologically
 * as plain strings, so no date parsing is needed just to order them).
 *
 * `labels` and `excludedTopicKeys` (both default `[]`) exclude
 * `excludeFromTotals`-tagged/excluded-built-in-topic sessions before
 * bucketing, same as computeDailyStreak above. */
export function computeLongestDailyStreak(
  sessions: LoggedSession[],
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): number {
  const byDay = groupByDay(filterCountedSessions(sessions, labels, excludedTopicKeys));
  const keys = Array.from(byDay.keys()).sort();
  let longest = 0;
  let run = 0;
  let prevKey: string | null = null;
  for (const key of keys) {
    run = prevKey !== null && nextDayKey(prevKey) === key ? run + 1 : 1;
    if (run > longest) longest = run;
    prevKey = key;
  }
  return longest;
}

/** The trailing 7-day average focus time, NOT counting today -- "today vs.
 * a typical day" wants today compared against what came before it, not
 * against an average that already includes today's own (partial, still
 * accumulating) total. Reuses stats/trend.ts's lastNDays (the same
 * day-bucketing every other trend view in this app draws from) for 8 days
 * (today + the 7 before it), then averages every day except the last
 * (today). 0 when there's no prior history at all (a brand-new install) --
 * computeRollingAverageRingProgress above is what guards dividing by that.
 *
 * `labels` and `excludedTopicKeys` (both default `[]`) are forwarded straight
 * to lastNDays, so an excludeFromTotals label's (or excluded built-in
 * topic's) time is out of both the average AND the "today" side of the
 * comparison this ring draws -- see lastNDays's own comment. */
export function computeRollingAverageS(
  sessions: LoggedSession[],
  nowMs: number = Date.now(),
  labels: CustomLabel[] = [],
  excludedTopicKeys: string[] = [],
): number {
  const days = lastNDays(sessions, 8, nowMs, labels, excludedTopicKeys);
  const prior = days.slice(0, -1);
  if (!prior.length) return 0;
  return prior.reduce((sum, d) => sum + d.focusS, 0) / prior.length;
}
