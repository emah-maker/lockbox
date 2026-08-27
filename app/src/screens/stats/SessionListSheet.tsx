// SessionListSheet.tsx -- the Sheet body shown when a trend bar, heatmap
// cell, or topic row on StatsScreen is tapped: the raw session rows behind
// whichever total was just tapped ("that day's/topic's sessions" from this
// task's brief), each one a deep link into the Calendar tab so "show me
// that session" always ends on the screen that can actually show a day in
// context. Pure render + navigation -- no mutation, no store access beyond
// what's already resolved by the caller (StatsScreen passes the exact
// session slice + display strings so this file stays agnostic to whether
// it's showing a day's sessions or a topic's).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/theme';
import { formatDuration } from '../../stats/stats';
import { dayKey, LoggedSession } from '../../stats/sessionHistory';
import { resolveTopic, CustomLabel } from '../../stats/customLabels';
import type { ThemeMode } from '../../theme/theme';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { typeScale } from '../../theme/tokens';

export function SessionListSheet({
  sessions,
  customLabels,
  themeMode,
  onOpenCalendarDay,
  emptyLabel = 'No sessions in this slice.',
}: {
  sessions: LoggedSession[];
  customLabels: CustomLabel[];
  themeMode: ThemeMode;
  onOpenCalendarDay: (dateKey: string) => void;
  emptyLabel?: string;
}) {
  const c = useTheme();
  // Most recent first -- a detail popup reads naturally newest-on-top, the
  // opposite of the trend/heatmap's oldest-first chronological axis.
  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt);

  if (sorted.length === 0) {
    return (
      <Text style={[styles.empty, { color: c.textDim }]}>{emptyLabel}</Text>
    );
  }

  return (
    <View style={styles.list}>
      {sorted.map((s) => {
        const resolved = resolveTopic(s.topic, customLabels, themeMode);
        const date = new Date(s.startedAt);
        return (
          <AnimatedPressable
            key={`${s.startedAt}:${s.plannedS}:${s.actualS}`}
            style={[styles.row, { borderColor: withAlpha(c.textDim, 0.18) }]}
            onPress={() => onOpenCalendarDay(dayKey(s.startedAt))}
            accessibilityRole="button"
            accessibilityLabel={`Session on ${date.toLocaleDateString()}, ${formatDuration(s.actualS)}, view in Calendar`}
          >
            <View style={[styles.swatch, { backgroundColor: resolved?.color ?? withAlpha(c.textDim, 0.4) }]} />
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: c.text }]}>{resolved?.label ?? 'Untagged'}</Text>
              <Text style={[styles.rowSub, { color: c.textDim }]}>
                {date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
                {date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
            <View style={styles.rowEnd}>
              <Text style={[styles.rowDuration, { color: c.text }]}>{formatDuration(s.actualS)}</Text>
              <Text style={[styles.rowOutcome, { color: s.outcome === 'completed' ? c.success : c.warn }]}>
                {s.outcome === 'completed' ? 'Completed' : 'Overridden'}
              </Text>
            </View>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { ...typeScale.body, padding: 16 },
  list: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 10 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600', letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
  rowSub: { ...typeScale.caption, marginTop: 2 },
  rowEnd: { alignItems: 'flex-end' },
  rowDuration: { fontSize: 14, fontWeight: '700' },
  rowOutcome: { ...typeScale.caption, marginTop: 2 },
});
