// GoalsProgressView.tsx -- the read-only body StatsScreen swaps in when its
// period selector is set to "Goals" (task: "one card per active goal with a
// progress ring/bar, current-vs-target, streak or on-pace indicator, and
// the weekday restriction shown when present"). This is deliberately NOT
// the existing write-capable GoalsSection.tsx (add/edit/delete forms,
// wheel pickers) -- that stays reachable from StatsScreen's "Manage" sheet
// (see ManageSheet.tsx) so goal editing keeps working from Stats even
// before Settings grows its own goals section, but this card list itself
// only ever reads goals/progress, same "render only" discipline
// GoalsSection.tsx's own header describes for itself.
//
// Progress math is entirely delegated: computeGoalProgress/goalWindow from
// goals/goalProgress.ts (including its now-final daysOfWeek/targetSessions/
// dueToday/monthly-period fields -- see that file's own header, settled by
// the goals agent), streak/on-pace from stats/goalStreak.ts (this screen's
// own pure helper, itself built only on top of those same goalProgress
// exports -- see that file's header for why it doesn't duplicate any of
// goalProgress.ts's actual window/ratio logic).
import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStore } from '../../store/useStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useGoalsStore } from '../../store/useGoalsStore';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/theme';
import { formatDuration } from '../../stats/stats';
import { resolveTopic } from '../../stats/customLabels';
import { Goal } from '../../goals/goals';
import { computeGoalProgress, goalWindow } from '../../goals/goalProgress';
import { computeGoalStreak, isGoalOnPace } from '../../stats/goalStreak';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { typeScale } from '../../theme/tokens';
import { GoalRing } from './GoalRing';

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PERIOD_LABELS: Record<Goal['period'], string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

/** Renders the restricted-days list only when the goal actually carries a
 * real subset (present, non-empty, and not literally "every day", which is
 * indistinguishable from no restriction at all -- Goal.daysOfWeek's own
 * comment says undefined/[] both mean "every day"). */
function weekdayRestrictionLabel(goal: Goal): string | null {
  const days = goal.daysOfWeek;
  if (!days || days.length === 0 || days.length >= 7) return null;
  return [...days].sort().map((d) => WEEKDAY_ABBR[d] ?? '?').join(', ');
}

export function GoalsProgressView({
  onOpenGoalInSettings,
  onManage,
  highlightGoalId,
}: {
  onOpenGoalInSettings: (goalId: string) => void;
  onManage: () => void;
  highlightGoalId?: string | null;
}) {
  const c = useTheme();
  const sessions = useStore((s) => s.sessions);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const goals = useGoalsStore((s) => s.goals);

  const active = React.useMemo(() => goals.filter((g) => !g.archived), [goals]);
  const nowMs = Date.now();
  const progress = React.useMemo(() => computeGoalProgress(goals, sessions, nowMs), [goals, sessions]);
  const progressById = React.useMemo(() => new Map(progress.map((p) => [p.goalId, p])), [progress]);

  if (active.length === 0) {
    return (
      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <Text style={[styles.hint, { color: c.textDim }]}>
          No goals yet. Add one to track how much of your target you've hit this day or week.
        </Text>
        <AnimatedPressable
          style={[styles.manageBtn, { borderColor: withAlpha(c.accent, 0.5) }]}
          onPress={onManage}
          accessibilityRole="button"
        >
          <Text style={[styles.manageBtnText, { color: c.accent }]}>Add a goal</Text>
        </AnimatedPressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {active.map((goal) => {
        const result = progressById.get(goal.id);
        const focusS = result?.focusS ?? 0;
        const ratio = result?.ratio ?? 0;
        const met = result?.met ?? false;
        const dueToday = result?.dueToday ?? true;
        const sessionCount = result?.sessionCount ?? 0;
        const window = goalWindow(goal.period, nowMs);
        const streak = computeGoalStreak(goal, sessions, nowMs);
        const onPace = isGoalOnPace(ratio, met, window, nowMs);
        const restriction = weekdayRestrictionLabel(goal);
        const resolved = goal.topic === null ? null : resolveTopic(goal.topic, customLabels, themeMode);
        const name = goal.topic === null ? 'All focus time' : resolved?.label ?? 'Deleted label';
        const swatch = goal.topic === null ? c.accent : resolved?.color ?? c.textDim;
        // Off-day goals get a neutral ring rather than the "behind" warn
        // color -- a Mon/Wed/Fri goal reading amber on a Tuesday would look
        // like it's failing a target it was never scheduled to hit today
        // (see goalProgress.ts's dueToday comment on why 0 progress on an
        // off day isn't a miss).
        const ringColor = met ? c.success : !dueToday ? c.textDim : onPace ? c.accent : c.warn;

        return (
          <GoalCard
            key={goal.id}
            name={name}
            swatch={swatch}
            period={goal.period}
            focusS={focusS}
            targetS={goal.targetS}
            sessionCount={sessionCount}
            targetSessions={goal.targetSessions}
            ratio={ratio}
            met={met}
            dueToday={dueToday}
            onPace={onPace}
            streak={streak}
            restriction={restriction}
            highlighted={highlightGoalId === goal.id}
            ringColor={ringColor}
            color={c}
            onPress={() => onOpenGoalInSettings(goal.id)}
          />
        );
      })}
      <AnimatedPressable
        style={[styles.manageBtn, { borderColor: withAlpha(c.textDim, 0.3) }]}
        onPress={onManage}
        accessibilityRole="button"
      >
        <Text style={[styles.manageBtnText, { color: c.textDim }]}>Manage goals</Text>
      </AnimatedPressable>
    </View>
  );
}

function GoalCard({
  name,
  swatch,
  period,
  focusS,
  targetS,
  sessionCount,
  targetSessions,
  ratio,
  met,
  dueToday,
  onPace,
  streak,
  restriction,
  highlighted,
  ringColor,
  color,
  onPress,
}: {
  name: string;
  swatch: string;
  period: Goal['period'];
  focusS: number;
  targetS: number;
  sessionCount: number;
  targetSessions?: number;
  ratio: number;
  met: boolean;
  dueToday: boolean;
  onPace: boolean;
  streak: number;
  restriction: string | null;
  highlighted: boolean;
  ringColor: string;
  color: ReturnType<typeof useTheme>;
  onPress: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const highlightAnim = useRef(new Animated.Value(0)).current;

  // Deep-linking here from a NavIntent.goalId (StatsScreen's consumeIntent
  // handling) is a one-shot "look here" cue, not a persistent selection --
  // pulses once on mount when this card is the target, then settles back
  // to its normal resting look, same restraint AnimatedTotal/StreakStat
  // apply elsewhere on this screen for a value that "just changed".
  useEffect(() => {
    if (!highlighted || reducedMotion) return;
    highlightAnim.setValue(1);
    Animated.timing(highlightAnim, { toValue: 0, duration: 1400, useNativeDriver: false }).start();
  }, [highlighted, reducedMotion, highlightAnim]);

  const percent = Math.round(ratio * 100);
  const subtitle = `${formatDuration(focusS)} of ${formatDuration(targetS)}${
    targetSessions !== undefined ? ` · ${sessionCount}/${targetSessions} sessions` : ''
  } · ${PERIOD_LABELS[period]}`;

  return (
    <AnimatedPressable
      style={[
        styles.card,
        { backgroundColor: color.surface, borderColor: withAlpha(color.accent, 0.4), borderWidth: highlighted ? 1.5 : 0 },
      ]}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${period} goal, ${formatDuration(focusS)} of ${formatDuration(targetS)}, ${percent} percent. Open in Settings.`}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: 14, backgroundColor: withAlpha(color.accent, 0.15), opacity: highlightAnim },
        ]}
      />
      <GoalRing ratio={ratio} color={ringColor} trackColor={withAlpha(color.textDim, 0.2)}>
        <Text style={[styles.ringPercent, { color: color.text }]}>{percent}%</Text>
      </GoalRing>
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <View style={[styles.swatch, { backgroundColor: swatch }]} />
          <Text style={[styles.cardName, { color: color.text }]} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <Text style={[styles.cardSub, { color: color.textDim }]}>{subtitle}</Text>
        <View style={styles.badgeRow}>
          {streak > 0 ? (
            <View style={[styles.badge, { backgroundColor: withAlpha(color.accent, 0.16) }]}>
              <Text style={[styles.badgeText, { color: color.accent }]}>{streak}x streak</Text>
            </View>
          ) : null}
          {!dueToday ? (
            <View style={[styles.badge, { backgroundColor: withAlpha(color.textDim, 0.16) }]}>
              <Text style={[styles.badgeText, { color: color.textDim }]}>Not due today</Text>
            </View>
          ) : !met ? (
            <View style={[styles.badge, { backgroundColor: withAlpha(onPace ? color.accent : color.warn, 0.16) }]}>
              <Text style={[styles.badgeText, { color: onPace ? color.accent : color.warn }]}>
                {onPace ? 'On pace' : 'Behind pace'}
              </Text>
            </View>
          ) : null}
          {restriction ? (
            <View style={[styles.badge, { backgroundColor: withAlpha(color.textDim, 0.14) }]}>
              <Text style={[styles.badgeText, { color: color.textDim }]}>{restriction}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  hint: { ...typeScale.body, marginBottom: 10 },
  manageBtn: { alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  manageBtnText: { ...typeScale.label },
  ringPercent: { fontSize: 13, fontWeight: '700' },
  cardBody: { flex: 1, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  cardName: { fontSize: 15, fontWeight: '600', flex: 1, letterSpacing: typeScale.sectionTitle.letterSpacing },
  cardSub: { ...typeScale.caption },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { ...typeScale.caption, fontWeight: '700' },
});
