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
import { useNowMs } from '../../ui/useNowMs';
import type { LoggedSession } from '../../stats/sessionHistory';
import { bestDay } from '../../stats/trend';
import { goalTopicLabel } from '../../goals/goalTopicDisplay';
import { topicBreakdownWithCustom } from '../../stats/customLabels';
import { groupByDay, dayKey } from '../../stats/sessionHistory';
import { computeGoalProgress, goalDisplayPercent } from '../../goals/goalProgress';
import type { Goal } from '../../goals/goals';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  computeIdleRingState,
  computeRollingAverageS,
  computeDailyStreak,
  computeLongestDailyStreak,
  type IdleRingState,
  type RingBaselineWindow,
  type RingSegment,
  type RingSourceKind,
} from './idleRingState';
import { todaySessionCount } from './idleRingSources';
import type { GoalHighlight } from './TodaySummary';

export function useHomeGoalRing(params: {
  sessions: LoggedSession[];
  todayFocusS: number;
  goals: Goal[];
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  /** Built-in topics excluded from totals/goals/streaks (settings/
   * customLabels.ts's setTopicKeyExcluded) -- customLabels' own counterpart
   * for the six built-ins, forwarded to every aggregate below the same way
   * customLabels itself already is. */
  excludedTopicKeys: string[];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  ringBaselineWindow: RingBaselineWindow;
  ringSourceKind: RingSourceKind;
  ringGoalId: string | null;
  /** Whether to draw the topic-mix arc inside the main ring (Settings >
   * Focus ring). Off means `segments` is simply never computed -- the
   * breakdown pass is skipped entirely rather than computed and discarded. */
  ringShowTopicMix: boolean;
}): { goalHighlight: GoalHighlight | null; idleRing: IdleRingState } {
  const {
    sessions,
    todayFocusS,
    goals,
    customLabels,
    excludedTopicKeys,
    themeMode,
    ringBaselineWindow,
    ringSourceKind,
    ringGoalId,
    ringShowTopicMix,
  } = params;

  // Ticks on its own (ui/useNowMs.ts) so every "today"/"this window" memo
  // below re-crosses its day/window boundary while Home just sits open,
  // instead of freezing at whatever instant it last recomputed because
  // sessions/goals/customLabels/excludedTopicKeys happened to change
  // reference -- see that hook's own header for the underlying bug. The
  // 'pace' ring source (idleRing below) is the sharpest case: it's meant to
  // move visibly within a single day, and without this it would read the
  // same expectedS/progress at 9am as at 8pm.
  const nowMs = useNowMs();

  // Every non-archived goal's current-window progress -- goalProgress.ts's
  // shared, canonical math (never reimplemented here), computed once and
  // reused by goalHighlight (below), the idle ring's 'weeklyGoal' source, and
  // its 'chosenGoal' source, rather than each calling computeGoalProgress
  // separately.
  // customLabels so an excludeFromTotals-tagged session never advances a
  // goal here either -- goalHighlight (TodaySummary's card) and the ring's
  // 'weeklyGoal'/'monthlyGoal'/'chosenGoal' sources all read off this same
  // array (stats/customLabels.ts).
  const goalProgressAll = useMemo(
    () => computeGoalProgress(goals, sessions, nowMs, customLabels, excludedTopicKeys),
    [goals, sessions, nowMs, customLabels, excludedTopicKeys],
  );

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
      name: goalTopicLabel(goal ? goal.topic : null, customLabels, themeMode),
      // Clamped display percentage -- see goalProgress.ts's
      // goalDisplayPercent for why this isn't `Math.round(chosen.ratio *
      // 100)` off the unclamped ratio (that used to print "1741%" on this
      // same card alongside a "Goal met" caption for a wildly-exceeded
      // goal).
      percent: goalDisplayPercent(chosen.ratio),
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
  // Same "the single untopic'd goal for that period" rule the daily/weekly
  // lookups above use, for the same reason -- only an untopic'd goal's
  // target is directly comparable to a plain focus total.
  const monthlyGoal = goals.find((g: Goal) => !g.archived && g.period === 'monthly' && g.topic === null);
  const monthlyGoalResult = monthlyGoal ? goalProgressAll.find((p) => p.goalId === monthlyGoal.id) : undefined;
  const chosenGoal = ringGoalId ? goals.find((g: Goal) => g.id === ringGoalId && !g.archived) : undefined;
  const chosenGoalResult = chosenGoal ? goalProgressAll.find((p) => p.goalId === chosenGoal.id) : undefined;
  // Today's focus split by topic, as fractions of the day's total. Memoized
  // separately from the ring state itself so toggling between two ring
  // SOURCES doesn't redo the breakdown pass -- the mix is the same either
  // way (see IdleRingState.segments). Skipped entirely when the arc is off.
  const segments: RingSegment[] | undefined = useMemo(() => {
    if (!ringShowTopicMix || todayFocusS <= 0) return undefined;
    const today = groupByDay(sessions).get(dayKey(nowMs)) ?? [];
    const breakdown = topicBreakdownWithCustom(today, customLabels, themeMode);
    const total = breakdown.reduce((sum, b) => sum + b.focusS, 0);
    if (total <= 0) return undefined;
    // Already sorted largest-first by topicBreakdownWithCustom. Capped so a
    // day spread across a dozen labels doesn't draw a dozen unreadable
    // hairline slivers -- the remainder simply isn't drawn, which reads as
    // the same "rest of the day" gap an under-100% ring already leaves.
    return breakdown.slice(0, 6).map((b) => ({ key: b.key, fraction: b.focusS / total, color: b.color }));
  }, [ringShowTopicMix, sessions, todayFocusS, nowMs, customLabels, themeMode]);

  const idleRing = useMemo(
    () =>
      computeIdleRingState({
        ringSource: ringSourceKind,
        todayFocusS,
        dailyGoalTargetS: dailyGoal ? dailyGoal.targetS : null,
        baselineFocusS: bestDay(sessions, ringBaselineWindow, nowMs, customLabels, excludedTopicKeys)?.focusS ?? 0,
        weeklyGoalRatio: weeklyGoalResult ? weeklyGoalResult.ratio : null,
        monthlyGoalRatio: monthlyGoalResult ? monthlyGoalResult.ratio : null,
        chosenGoalRatio: chosenGoalResult ? chosenGoalResult.ratio : null,
        // The raw seconds behind each of those ratios. FocusHero's caption
        // needs them because a weekly/monthly ratio's numerator is the whole
        // window's focus time, not today's -- see IdleRingState.goalWindow.
        weeklyGoalWindow: weeklyGoalResult
          ? { focusS: weeklyGoalResult.focusS, targetS: weeklyGoalResult.targetS }
          : null,
        monthlyGoalWindow: monthlyGoalResult
          ? { focusS: monthlyGoalResult.focusS, targetS: monthlyGoalResult.targetS }
          : null,
        chosenGoalWindow: chosenGoalResult
          ? { focusS: chosenGoalResult.focusS, targetS: chosenGoalResult.targetS }
          : null,
        chosenGoalName: chosenGoal ? goalTopicLabel(chosenGoal.topic, customLabels, themeMode) : null,
        rollingAverageS: computeRollingAverageS(sessions, nowMs, customLabels, excludedTopicKeys),
        streakCurrent: computeDailyStreak(sessions, nowMs, customLabels, excludedTopicKeys),
        streakLongest: computeLongestDailyStreak(sessions, customLabels, excludedTopicKeys),
        todaySessionCount: todaySessionCount(sessions, nowMs, customLabels, excludedTopicKeys),
        // The daily goal's own session target -- never invented when it has
        // none (see computeSessionCountRingProgress), which is what makes
        // the 'sessionCount' source read as empty rather than as a
        // meaningless fraction of a made-up number.
        dailySessionTarget: dailyGoal?.targetSessions ?? null,
        nowMs,
        segments,
      }),
    [
      ringSourceKind,
      todayFocusS,
      dailyGoal,
      sessions,
      ringBaselineWindow,
      weeklyGoalResult,
      monthlyGoalResult,
      chosenGoalResult,
      chosenGoal,
      nowMs,
      customLabels,
      excludedTopicKeys,
      themeMode,
      segments,
    ],
  );

  return { goalHighlight, idleRing };
}
