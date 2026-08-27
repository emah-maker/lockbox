// TodaySummary.tsx -- the Home screen's "at a glance value" card (manager
// brief): today's focus time, plus the single most-relevant goal's progress
// and how much is left to hit it, if any goal exists. Tapping it jumps to
// the Stats tab already scoped to the right period, via useNav's `intent`
// contract, instead of making the user re-navigate once they get there.
//
// Presentation-only -- DashboardScreen computes `highlight` from
// useGoalsStore + goals/goalProgress.ts's computeGoalProgress (the shared,
// canonical goal-math helper) and passes the result down. This file does not
// import useGoalsStore or goalProgress itself, so there's no path for it to
// ever reimplement that math.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/theme';
import { typeScale, elevation } from '../../theme/tokens';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { formatDuration } from '../../stats/stats';

export interface GoalHighlight {
  /** Display name for the goal's topic -- already resolved by the caller
   * (DashboardScreen), same "All focus time" / label / "Deleted label"
   * convention GoalsSection.tsx's own describeTopic uses. */
  name: string;
  percent: number; // rounded 0..100+ (unclamped, matches GoalsSection's own display)
  remainingS: number;
  met: boolean;
}

export function TodaySummary({
  todayFocusS,
  highlight,
  hasAnyGoals,
  onPress,
}: {
  todayFocusS: number;
  /** The single nearest-to-completion unmet goal, or the first met one if
   * every goal is already met, or null if there are no goals at all --
   * DashboardScreen picks this one goal so this card never has to grow to
   * fit a whole list. */
  highlight: GoalHighlight | null;
  hasAnyGoals: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const s = styles(theme);

  const a11yLabel = highlight
    ? `Today: ${formatDuration(todayFocusS)} focused. ${highlight.name}: ${highlight.percent} percent${
        highlight.met ? ', met' : `, ${formatDuration(highlight.remainingS)} to go`
      }. Double tap to view stats.`
    : `Today: ${formatDuration(todayFocusS)} focused. Double tap to view stats.`;

  return (
    <AnimatedPressable
      style={s.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View style={s.row}>
        <View style={s.col}>
          <Text style={s.label}>Today</Text>
          <Text style={s.value}>{formatDuration(todayFocusS)}</Text>
        </View>

        {highlight ? (
          <View style={[s.col, s.colRight]}>
            <Text style={s.label} numberOfLines={1}>
              {highlight.name}
            </Text>
            <Text style={[s.value, { color: highlight.met ? theme.accent : theme.text }]}>
              {highlight.percent}%
            </Text>
            <Text style={s.sub} numberOfLines={1}>
              {highlight.met ? 'Goal met' : `${formatDuration(highlight.remainingS)} to go`}
            </Text>
          </View>
        ) : (
          <Text style={s.sub}>{hasAnyGoals ? '' : 'Set a goal on Stats to track progress here'}</Text>
        )}
      </View>
      <Text style={s.chevron}>{'›'}</Text>
    </AnimatedPressable>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 14,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      ...elevation.card,
    },
    row: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    col: { gap: 2 },
    colRight: { alignItems: 'flex-end', maxWidth: '55%' },
    label: { color: t.textDim, ...typeScale.label },
    value: { color: t.text, fontSize: 22, fontWeight: '700' },
    sub: { color: t.textDim, ...typeScale.caption },
    chevron: { color: withAlpha(t.textDim, 0.6), fontSize: 22, marginLeft: 8, fontWeight: '600' },
  });
