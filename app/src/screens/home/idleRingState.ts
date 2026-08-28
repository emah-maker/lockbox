// idleRingState.ts -- pure state computation for the Home hero ring
// (ProgressRing, via FocusHero.tsx) while there's no live session counting
// down. Previously the ring just sat at 0 whenever idle; this decides what
// it should show instead: progress toward the day's single daily goal (if
// one is set), or -- with no such goal -- progress toward the best day in a
// user-chosen baseline window (useSettingsStore's ringBaselineWindow, see
// RingBaselineSection.tsx), or nothing at all on a day with no focus time
// yet. Kept dependency-free and pure (no React, no store reads) so it's
// unit-testable the same way stats/trend.ts's bestDay is, and so FocusHero
// itself stays a pure render of whatever DashboardScreen computed.
export type RingBaselineWindow = 'week' | 'month' | 'year' | 'all';

export type RingProgressSource = 'goal' | 'baseline' | 'empty';

export interface IdleRingState {
  /** Unclamped fraction -- ProgressRing itself clamps to 0..1 (see its own
   * `progress` prop comment), so a goal exceeded past 100% still reports the
   * real ratio here; only the ring's drawn arc gets clamped, not this value
   * (FocusHero's caption math wants the real, uncapped percentage). */
  progress: number;
  source: RingProgressSource;
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
