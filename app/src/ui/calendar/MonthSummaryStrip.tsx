// MonthSummaryStrip.tsx -- "total focus / best day / streak" glance strip
// under the month grid (manager brief: "a month-summary strip"). Split into
// src/ui/calendar (this feature's own visual-components folder) rather than
// inlined in CalendarScreen.tsx, same reasoning as DayCell.tsx.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ThemeColors } from '../../theme/theme';
import { typeScale } from '../../theme/tokens';
import { formatDuration } from '../../stats/stats';
import { MonthSummary } from '../../screens/calendar/monthGrid';

export function MonthSummaryStrip({ summary, theme }: { summary: MonthSummary; theme: ThemeColors }) {
  const bestDayLabel = summary.bestDayKey
    ? new Date(summary.bestDayKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '--';

  return (
    <View style={[styles.row, { backgroundColor: theme.surface }]}>
      <SummaryStat label="This month" value={formatDuration(summary.totalFocusS)} theme={theme} />
      <View style={[styles.divider, { backgroundColor: theme.textDim }]} />
      <SummaryStat
        label="Best day"
        value={summary.bestDayFocusS > 0 ? `${bestDayLabel} · ${formatDuration(summary.bestDayFocusS)}` : '--'}
        theme={theme}
      />
      <View style={[styles.divider, { backgroundColor: theme.textDim }]} />
      <SummaryStat
        label="Streak"
        value={summary.streakDays > 0 ? `${summary.streakDays}d` : '--'}
        theme={theme}
      />
    </View>
  );
}

function SummaryStat({ label, value, theme }: { label: string; value: string; theme: ThemeColors }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.value, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.label, { color: theme.textDim }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  divider: { width: 1, height: 28, opacity: 0.25 },
  value: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: typeScale.label.letterSpacing,
    lineHeight: typeScale.label.lineHeight,
  },
  label: {
    fontSize: 11,
    letterSpacing: typeScale.caption.letterSpacing,
    lineHeight: typeScale.caption.lineHeight,
  },
});
