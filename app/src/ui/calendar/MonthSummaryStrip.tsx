// MonthSummaryStrip.tsx -- "total focus / best day / streak" glance strip
// under the month grid (manager brief: "a month-summary strip"). Split into
// src/ui/calendar (this feature's own visual-components folder) rather than
// inlined in CalendarScreen.tsx, same reasoning as DayCell.tsx.
import { View, Text, StyleSheet } from 'react-native';
import { ThemeColors } from '../../theme/theme';
import { typeScale } from '../../theme/tokens';
import { formatDuration } from '../../stats/stats';
import { dayKeyToDate } from '../../stats/sessionHistory';
import { MonthSummary } from '../../screens/calendar/monthGrid';

export function MonthSummaryStrip({ summary, theme }: { summary: MonthSummary; theme: ThemeColors }) {
  // dayKeyToDate, not `new Date(key)`: bestDayKey is a dayKey, which
  // sessionHistory.ts builds out of a LOCAL getFullYear/getMonth/getDate, and
  // `new Date('2026-03-01')` is the one Date constructor that reads a bare
  // date-only string back as UTC midnight. West of UTC that instant is the
  // previous local evening, so this named the day BEFORE the busiest one --
  // and when the best day was the 1st, a date that isn't even in the month
  // the strip sits under. Same local parse DaySheet.tsx's title uses.
  const bestDayLabel = summary.bestDayKey
    ? dayKeyToDate(summary.bestDayKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
