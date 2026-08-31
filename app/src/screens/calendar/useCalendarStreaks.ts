// useCalendarStreaks.ts -- CalendarScreen.tsx's own state slice for the Goal
// Streaks feature (per-goal streak dots on the month grid + the "which
// goals show" visibility picker), split into its own hook purely to keep
// CalendarScreen.tsx under this project's 500-line guideline -- everything
// here is still screen-specific glue (store reads, a derived Set, a per-day
// dot builder), not pure math, which is why it's a hook rather than another
// screens/calendar/monthGrid.ts export (that file stays dependency-free of
// any store, per its own header).
import { useCallback, useMemo } from 'react';
import { useGoalsStore } from '../../store/useGoalsStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { resolveTopic, CustomLabel } from '../../stats/customLabels';
import type { ThemeMode } from '../../theme/theme';
import type { LoggedSession } from '../../stats/sessionHistory';
import { goalDayStatuses } from '../../stats/goalStreakHistory';
import { resolveCalendarStreakGoalIds } from './monthGrid';

/** One goal's dot for one day cell -- DayCell.tsx's own streakDots prop
 * shape, re-exported from here rather than duplicated so CalendarScreen.tsx
 * has a single import to type the array this hook hands it. */
export interface StreakDot {
  key: string;
  color: string;
  met: boolean;
}

export function useCalendarStreaks(
  sessions: LoggedSession[],
  customLabels: CustomLabel[],
  excludedTopicKeys: string[],
  themeMode: ThemeMode,
  accentColor: string,
  textDimColor: string,
) {
  const goals = useGoalsStore((s) => s.goals);
  const calendarStreakGoalIds = useSettingsStore((s) => s.calendarStreakGoalIds);
  const setCalendarStreakGoalIds = useSettingsStore((s) => s.setCalendarStreakGoalIds);

  const activeGoals = useMemo(() => goals.filter((g) => !g.archived), [goals]);

  // See monthGrid.ts's resolveCalendarStreakGoalIds for why this re-filters
  // the stored preference against the LIVE goal list on every render rather
  // than trusting the stored ids alone (a deleted/archived goal must never
  // keep drawing a dot just because its id is still sitting in an old
  // preference array).
  const visibleStreakGoalIds = useMemo(
    () => resolveCalendarStreakGoalIds(activeGoals, calendarStreakGoalIds),
    [activeGoals, calendarStreakGoalIds],
  );
  const visibleStreakGoalIdSet = useMemo(() => new Set(visibleStreakGoalIds), [visibleStreakGoalIds]);

  /** Toggling always writes a concrete array (never re-derives back to the
   * `null` "all" sentinel) -- see useSettingsStore's own field comment on
   * why `null` and "an array that happens to equal every active goal" are
   * deliberately distinct states. Starting from `visibleStreakGoalIds` (the
   * RESOLVED set, not the raw stored preference) is what lets the first tap
   * in a fresh install -- where the stored preference is still `null` --
   * correctly toggle OFF a goal that's only showing because of the "all by
   * default" resolution, rather than toggling it on top of an empty stored
   * array. */
  const toggleStreakGoal = (goalId: string): void => {
    const next = visibleStreakGoalIdSet.has(goalId)
      ? visibleStreakGoalIds.filter((id) => id !== goalId)
      : [...visibleStreakGoalIds, goalId];
    setCalendarStreakGoalIds(next);
  };

  // Goal ids -> a resolved swatch color, so streakDotsForDay below doesn't
  // re-run resolveTopic once per goal per day it's asked about -- built once
  // per (goals, visibility, labels, theme) change, the same "resolve outside
  // the day loop" shape topicBreakdownWithCustom already gets for free from
  // its own internal Map.
  const streakGoalColors = useMemo(() => {
    const colors = new Map<string, string>();
    for (const goal of activeGoals) {
      if (!visibleStreakGoalIdSet.has(goal.id)) continue;
      const resolved = goal.topic === null ? null : resolveTopic(goal.topic, customLabels, themeMode);
      colors.set(goal.id, goal.topic === null ? accentColor : resolved?.color ?? textDimColor);
    }
    return colors;
  }, [activeGoals, visibleStreakGoalIdSet, customLabels, themeMode, accentColor, textDimColor]);

  /** DayCell.tsx's streakDots for one calendar day -- goalDayStatuses
   * already excludes an off-day goal from its result entirely rather than
   * reporting it as a miss (see that function's own doc comment), so
   * filtering to `visibleStreakGoalIdSet` here is the ONLY filter this
   * needs; there is no separate "is it due" check to re-apply.
   *
   * Wrapped in useCallback (not a plain closure) so CalendarScreen.tsx's own
   * `dayCells` useMemo -- which takes this function as a dependency -- only
   * actually recomputes when one of ITS real inputs changes, not on every
   * render of this hook. */
  const streakDotsForDay = useCallback(
    (date: Date): StreakDot[] =>
      goalDayStatuses(activeGoals, sessions, date, customLabels, excludedTopicKeys)
        .filter((s) => s.dueOn && visibleStreakGoalIdSet.has(s.goalId))
        .map((s) => ({ key: s.goalId, color: streakGoalColors.get(s.goalId) ?? textDimColor, met: s.met })),
    [activeGoals, sessions, customLabels, excludedTopicKeys, visibleStreakGoalIdSet, streakGoalColors, textDimColor],
  );

  return { activeGoals, visibleStreakGoalIdSet, toggleStreakGoal, streakDotsForDay };
}
