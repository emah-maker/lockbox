// HeatmapGrid.tsx -- the "Last 5 weeks" heatmap grid, extracted out of
// TrendCard.tsx (see that file's header) so it can be mounted in its own
// Sheet from StatsScreen instead of permanently occupying space in the main
// Stats body -- part of this task's "every period fits one screen with no
// scrolling" brief, which left no room for a 35-cell grid stacked under the
// 7-bar trend chart on top of the total/fun-facts/topic cards.
//
// Pure render, same as SessionListSheet.tsx's own role as a Sheet body:
// StatsScreen owns the Sheet chrome (title, open/close state) and this file
// owns only the grid + its per-cell tap, reusing the existing
// `onInspectDay` -> `setDaySheetKey` wiring TrendCard's bars already drive
// (see StatsScreen's daySheetKey Sheet) rather than inventing a second
// "which day is open" state.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/theme';
import { formatDuration } from '../../stats/stats';
import { HeatmapDay } from '../../stats/trend';
import { AnimatedPressable } from '../../ui/AnimatedPressable';

const HEATMAP_OPACITY = [0.08, 0.3, 0.5, 0.72, 1] as const;

export function HeatmapGrid({
  heatmap,
  onInspectDay,
}: {
  heatmap: HeatmapDay[];
  onInspectDay: (dayKey: string) => void;
}) {
  const c = useTheme();

  return (
    // No `accessible` on this container. It used to carry one (plus a
    // whole-grid summary label), which on iOS collapses the subtree into a
    // single a11y element -- so all 35 cells below, each with its own
    // carefully-written date + duration label and its own tap target, were
    // unreachable to VoiceOver and the summary was all you could hear. The
    // cells ARE the content here, so they win; the Sheet hosting this grid
    // already announces "Last 5 weeks" as its title.
    <View style={styles.heatmapGrid}>
      {heatmap.map((d) => (
        <AnimatedPressable
          key={d.key}
          onPress={() => onInspectDay(d.key)}
          accessibilityRole="button"
          accessibilityLabel={`${new Date(d.dateMs).toLocaleDateString()}, ${formatDuration(d.focusS)}. View sessions.`}
        >
          <View style={[styles.heatmapCell, { backgroundColor: withAlpha(c.accent, HEATMAP_OPACITY[d.level]) }]} />
        </AnimatedPressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  heatmapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  heatmapCell: { width: 32, height: 32, borderRadius: 6 },
});
