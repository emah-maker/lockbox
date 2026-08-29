// TopicBreakdownStrip.tsx -- Home screen filler block (manager brief: "find
// something more to put on the home screen to fill the space"). A compact
// "how did today split across topics" mini-bar: a slim proportional segment
// bar plus a short legend, both built from stats/customLabels.ts's own
// topicBreakdownWithCustom -- the exact same widened (built-in + custom
// labels) breakdown StatsScreen/CalendarScreen already use, so this never
// invents a second way to tally a day's topics. Presentation-only, same
// division of labor as TodaySummary.tsx: DashboardScreen passes today's
// sessions down, this file only renders them.
//
// Deliberately NOT a second stats card (TodaySummary already owns "today's
// value at a glance") -- this is scoped to just the topic SPLIT, which
// TodaySummary doesn't show at all, so the two read as complementary rather
// than duplicating each other.
//
// Empty-safe by construction: topicBreakdownWithCustom returns [] for a day
// with no tagged sessions (disconnected, brand-new install, or a day that
// simply hasn't been tagged yet), and the render below has an explicit,
// deliberately calm empty state for that -- never a zero-width bar or a
// broken-looking blank card.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/color';
import { typeScale, elevation, radius } from '../../theme/tokens';
import { formatDuration } from '../../stats/stats';
import { topicBreakdownWithCustom, type LabelStat } from '../../stats/customLabels';
import type { LoggedSession } from '../../stats/sessionHistory';
import { useSettingsStore } from '../../store/useSettingsStore';
import { AnimatedPressable } from '../../ui/AnimatedPressable';

// Legend rows beyond this many collapse into a single "+N more" line -- a
// day with 6+ distinct topics is rare, and listing all of them would grow
// this card back into the "expands and shoves layout around" shape the rest
// of this screen's own redesign was written to get away from (see
// DashboardScreen.tsx's own header comment).
const MAX_LEGEND_ROWS = 4;
const BAR_HEIGHT = 8;

export function TopicBreakdownStrip({
  todaySessions,
  customLabels,
  themeMode,
  onPress,
}: {
  todaySessions: LoggedSession[];
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  onPress: () => void;
}) {
  const theme = useTheme();
  const s = styles(theme);
  const stats: LabelStat[] = topicBreakdownWithCustom(todaySessions, customLabels, themeMode);
  const shown = stats.slice(0, MAX_LEGEND_ROWS);
  const extraCount = stats.length - shown.length;

  const a11yLabel =
    stats.length > 0
      ? `Today's topics: ${shown.map((st) => `${st.label} ${formatDuration(st.focusS)}`).join(', ')}${
          extraCount > 0 ? `, and ${extraCount} more` : ''
        }. Double tap to view stats.`
      : "No topics tagged yet today. Double tap to view stats.";

  return (
    <AnimatedPressable style={s.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11yLabel}>
      <Text style={s.title}>Today's topics</Text>

      {stats.length > 0 ? (
        <>
          <View style={s.bar}>
            {stats.map((st) => (
              <View key={st.key} style={{ flex: Math.max(st.focusS, 1), backgroundColor: st.color }} />
            ))}
          </View>
          <View style={s.legend}>
            {shown.map((st) => (
              <View key={st.key} style={s.legendRow}>
                <View style={[s.dot, { backgroundColor: st.color }]} />
                <Text style={s.legendLabel} numberOfLines={1}>
                  {st.label}
                </Text>
                <Text style={s.legendValue}>{formatDuration(st.focusS)}</Text>
              </View>
            ))}
            {extraCount > 0 ? <Text style={s.more}>+{extraCount} more</Text> : null}
          </View>
        </>
      ) : (
        <>
          <View style={[s.bar, { backgroundColor: withAlpha(theme.textDim, 0.15) }]} />
          <Text style={s.empty}>Tag a session to see today's split here</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: radius.md,
      padding: 16,
      gap: 10,
      ...elevation.card,
    },
    title: { color: t.textDim, ...typeScale.label },
    bar: { flexDirection: 'row', height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, overflow: 'hidden' },
    legend: { gap: 4 },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    legendLabel: { flex: 1, color: t.text, ...typeScale.caption },
    legendValue: { color: t.textDim, ...typeScale.caption },
    more: { color: t.textDim, ...typeScale.caption, marginLeft: 14 },
    empty: { color: t.textDim, ...typeScale.caption },
  });
