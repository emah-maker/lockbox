// TrendCard.tsx -- the "Last 7 days" bar chart + "Last 5 weeks" heatmap,
// extracted from StatsScreen.tsx (500-line-guideline split) and made
// interactive per this task's brief:
//   - tapping a bar or heatmap cell opens a detail popup (StatsScreen's
//     Sheet) with that day's sessions -- `onInspectDay` hands the day key
//     up rather than owning the Sheet itself, so StatsScreen (which also
//     drives the topic-row popup) has exactly one Sheet-open code path.
//   - press-and-hold on a trend bar shows an inline tooltip with the exact
//     duration without leaving this card -- the "tap-to-inspect" alternative
//     the task offers is the popup above; this is the lighter-weight,
//     no-navigation option, released on lift the same way a system tooltip
//     would be.
// Both surfaces keep their original accessibility summary (one label for
// the whole row/grid) since the per-cell interaction is an enhancement, not
// a replacement for how a screen reader already gets the same information
// read aloud in one pass.
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/theme';
import { formatDuration } from '../../stats/stats';
import { DayTotal, HeatmapDay } from '../../stats/trend';
import { AnimatedFill } from '../../ui/AnimatedFill';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { typeScale, elevation } from '../../theme/tokens';

const TREND_BAR_MAX_H = 80;
const HEATMAP_OPACITY = [0.08, 0.3, 0.5, 0.72, 1] as const;

export function TrendCard({
  trend,
  heatmap,
  onInspectDay,
}: {
  trend: DayTotal[];
  heatmap: HeatmapDay[];
  onInspectDay: (dayKey: string) => void;
}) {
  const c = useTheme();
  const trendMax = Math.max(1, ...trend.map((d) => d.focusS));
  const [tooltip, setTooltip] = useState<{ key: string; text: string } | null>(null);

  const pressDay = (dayKey: string) => {
    Haptics.selectionAsync();
    onInspectDay(dayKey);
  };

  return (
    <View style={[styles.card, { backgroundColor: c.surface }]}>
      <Text style={[styles.h2, { color: c.text }]}>Last 7 days</Text>
      <View
        style={styles.trendRow}
        accessible
        accessibilityLabel={`Last 7 days: ${trend.map((d) => `${d.label} ${formatDuration(d.focusS)}`).join(', ')}`}
      >
        {trend.map((d) => {
          const h = Math.max(3, Math.round((d.focusS / trendMax) * TREND_BAR_MAX_H));
          return (
            <View key={d.key} style={styles.trendCol}>
              {tooltip?.key === d.key ? (
                <View style={[styles.tooltip, { backgroundColor: c.text }]}>
                  <Text style={[styles.tooltipText, { color: c.bg }]}>{tooltip.text}</Text>
                </View>
              ) : null}
              <AnimatedPressable
                onPress={() => pressDay(d.key)}
                onPressIn={() => {
                  Haptics.selectionAsync();
                  setTooltip({ key: d.key, text: formatDuration(d.focusS) });
                }}
                onPressOut={() => setTooltip(null)}
                accessibilityRole="button"
                accessibilityLabel={`${d.label}, ${formatDuration(d.focusS)}. View sessions.`}
              >
                <View style={[styles.trendTrack, { height: TREND_BAR_MAX_H, backgroundColor: withAlpha(c.accent, 0.12) }]}>
                  <AnimatedFill axis="height" toValue={h} style={styles.trendBar} color={c.accent} />
                </View>
              </AnimatedPressable>
              <Text style={[styles.trendLabel, { color: c.textDim }]}>{d.label}</Text>
            </View>
          );
        })}
      </View>

      <Text style={[styles.h2, styles.heatmapTitle, { color: c.text }]}>Last 5 weeks</Text>
      <View
        style={styles.heatmapGrid}
        accessible
        accessibilityLabel={`Focus activity heatmap, last 5 weeks: ${heatmap.filter((d) => d.level > 0).length} of ${heatmap.length} days with focus time`}
      >
        {heatmap.map((d) => (
          <AnimatedPressable
            key={d.key}
            onPress={() => pressDay(d.key)}
            accessibilityRole="button"
            accessibilityLabel={`${new Date(d.dateMs).toLocaleDateString()}, ${formatDuration(d.focusS)}. View sessions.`}
          >
            <View style={[styles.heatmapCell, { backgroundColor: withAlpha(c.accent, HEATMAP_OPACITY[d.level]) }]} />
          </AnimatedPressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, gap: 6, ...elevation.card },
  h2: { ...typeScale.sectionTitle, marginBottom: 8 },
  heatmapTitle: { marginTop: 12 },
  trendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 },
  trendCol: { alignItems: 'center', gap: 6, flex: 1 },
  trendTrack: { width: 18, borderRadius: 9, justifyContent: 'flex-end', overflow: 'hidden' },
  trendBar: { width: '100%', borderRadius: 9 },
  trendLabel: { ...typeScale.caption },
  tooltip: { position: 'absolute', top: -26, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, zIndex: 1 },
  tooltipText: { fontSize: 11, fontWeight: '700' },
  heatmapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  heatmapCell: { width: 14, height: 14, borderRadius: 3 },
});
