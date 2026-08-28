// useHomeGoalRing.ts -- Home screen hook bundling the goal-highlight
// (TodaySummary's card) and idle-ring (FocusHero's arc) computations, both
// of which read the same goals/sessions/settings state. Split out of
// DashboardScreen.tsx (which used to compute both inline) once the ring
// gained more sources of its own to look up (task 4's "more things you can
// put on the focus ring") pushed that screen file past this project's
// 500-line guideline -- pure orchestration only, every actual bit of math
// still lives in goals/goalProgress.ts / idleRingState.ts; this hook just
// gathers their inputs and memoizes the results, the same "hook does the
// wiring, a pure module does the math" split DashboardScreen itself already
// keeps for e.g. its own useDisabledFade.
import { useMemo } from 'react';
import type { LoggedSession } from '../../stats/sessionHistory';
import { bestDay } from '../../stats/trend';
import { resolveTopic } from '../../stats/customLabels';
import { computeGoalProgress } from '../../goals/goalProgress';
import type { Goal } from '../../goals/goals';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  computeIdleRingState,
  computeRollingAverageS,
  computeDailyStreak,
  computeLongestDailyStreak,
  type IdleRingState,
  type RingBaselineWindow,
  type RingSourceKind,
} from './idleRingState';
import type { GoalHighlight } from './TodaySummary';

/** Display name for a goal's stored topic string -- same convention
 * GoalsSection.tsx's own (unexported) describeTopic uses: null is "All
 * focus time", otherwise resolveTopic's label, falling back to "Deleted
 * label" for a since-deleted saved custom label. Kept as a small local copy
 * rather than importing GoalsSection's version (not exported, and
 * GoalsSection.tsx belongs to the `stats`/`goals` ownership, not this
 * screen's) -- same "each screen keeps its own tiny display helper"
 * precedent this app already follows elsewhere (RingBaselineSection.tsx has
 * its own near-identical copy, for the same reason). */
function describeGoalTopic(
  topic: string | null,
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'],
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'],
): string {
  if (topic === null) return 'All focus time';
  return resolveTopic(topic, customLabels, themeMode)?.label ?? 'Deleted label';
}

export function useHomeGoalRing(params: {
  sessions: LoggedSession[];
  todayFocusS: number;
  goals: Goal[];
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  ringBaselineWindow: RingBaselineWindow;
  ringSourceKind: RingSourceKind;
  ringGoalId: string | null;
}): { goalHighlight: GoalHighlight | null; idleRing: IdleRingState } {
  const { sessions, todayFocusS, goals, customLabels, themeMode, ringBaselineWindow, ringSourceKind, ringGoalId } =
    params;

  // Every non-archived goal's current-window progress -- goalProgress.ts's
  // shared, canonical math (never reimplemented here), computed once and
  // reused by goalHighlight (below), the idle ring's 'weeklyGoal' source, and
  // its 'chosenGoal' source, rather than each calling computeGoalProgress
  // (and its own fresh Date.now()) separately.
  const goalProgressAll = useMemo(() => computeGoalProgress(goals, sessions, Date.now()), [goals, sessions]);

  // The single most-relevant goal for TodaySummary -- the nearest-to-
  // completion unmet goal wins, so this card always shows whichever goal is
  // closest to a milestone; if every goal is already met, the first one just
  // shows as met rather than the card going empty.
  const goalHighlight: GoalHighlight | null = useMemo(() => {
    if (goalProgressAll.length === 0) return null;
    const unmet = goalProgressAll.filter((p) => !p.met).sort((a, b) => a.remainingS - b.remainingS);
    const chosen = unmet[0] ?? goalProgressAll[0];
    const goal = goals.find((g: Goal) => g.id === chosen.goalId);
    return {
      name: describeGoalTopic(goal ? goal.topic : null, customLabels, themeMode),
      percent: Math.round(chosen.ratio * 100),
      remainingS: chosen.remainingS,
      met: chosen.met,
    };
  }, [goalProgressAll, goals, customLabels, themeMode]);

  // The Home hero ring's idle (non-running) fill -- see idleRingState.ts for
  // the actual precedence/source math; this block only gathers the raw
  // inputs every source might need and hands them to computeIdleRingState's
  // single dispatcher. "The daily/weekly goal" is the single goal with
  // !archived && topic === null for that period: only an untopic'd goal's
  // target is directly comparable to a plain focus total (todayFocusS / this
  // week's aggregate), not scoped to any one topic -- a topic-scoped goal's
  // progress lives in its own computeGoalProgress ratio (goalHighlight/
  // chosenGoal below), which this deliberately does not reuse or reimplement
  // here. bestDay's window comes straight from the caller's own
  // ringBaselineWindow; its ?? 0 (and the other ?? 0/null fallbacks below)
  // cover "nothing to compare against yet", which computeIdleRingState's
  // per-source math itself guards against dividing by or otherwise
  // mishandling.
  const dailyGoal = goals.find((g: Goal) => !g.archived && g.period === 'daily' && g.topic === null);
  const weeklyGoal = goals.find((g: Goal) => !g.archived && g.period === 'weekly' && g.topic === null);
  const weeklyGoalResult = weeklyGoal ? goalProgressAll.find((p) => p.goalId === weeklyGoal.id) : undefined;
  const chosenGoal = ringGoalId ? goals.find((g: Goal) => g.id === ringGoalId && !g.archived) : undefined;
  const chosenGoalResult = chosenGoal ? goalProgressAll.find((p) => p.goalId === chosenGoal.id) : undefined;
  const idleRing = useMemo(
    () =>
      computeIdleRingState({
        ringSource: ringSourceKind,
        todayFocusS,
        dailyGoalTargetS: dailyGoal ? dailyGoal.targetS : null,
        baselineFocusS: bestDay(sessions, ringBaselineWindow)?.focusS ?? 0,
        weeklyGoalRatio: weeklyGoalResult ? weeklyGoalResult.ratio : null,
        chosenGoalRatio: chosenGoalResult ? chosenGoalResult.ratio : null,
        chosenGoalName: chosenGoal ? describeGoalTopic(chosenGoal.topic, customLabels, themeMode) : null,
        rollingAverageS: computeRollingAverageS(sessions),
        streakCurrent: computeDailyStreak(sessions),
        streakLongest: computeLongestDailyStreak(sessions),
      }),
    [
      ringSourceKind,
      todayFocusS,
      dailyGoal,
      sessions,
      ringBaselineWindow,
      weeklyGoalResult,
      chosenGoalResult,
      chosenGoal,
      customLabels,
      themeMode,
    ],
  );

  return { goalHighlight, idleRing };
}
