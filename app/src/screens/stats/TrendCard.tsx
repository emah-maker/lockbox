// TrendCard.tsx -- the "Last 7 days" bar chart, extracted from
// StatsScreen.tsx (500-line-guideline split) and made interactive per this
// task's brief:
//   - tapping a bar opens a detail popup (StatsScreen's Sheet) with that
//     day's sessions -- `onInspectDay` hands the day key up rather than
//     owning the Sheet itself, so StatsScreen (which also drives the topic-
//     row and heatmap popups) has exactly one Sheet-open code path per
//     surface.
//   - press-and-hold on a trend bar shows an inline tooltip with the exact
//     duration without leaving this card -- the "tap-to-inspect" alternative
//     the task offers is the popup above; this is the lighter-weight,
//     no-navigation option, released on lift the same way a system tooltip
//     would be.
//
// The "Last 5 weeks" heatmap that used to live inline here moved out to its
// own screens/stats/HeatmapGrid.tsx, mounted in a Sheet from StatsScreen
// instead -- part of the "every period fits one screen with no scrolling"
// brief: this card (plus TopicCard below it) has to share a `flex:1` budget
// of ~185px total for BOTH cards once the total/fun-facts/header rows are
// accounted for, which a 5-row/7-col cell grid stacked under a 7-bar chart
// cannot fit into on top of everything else. `onOpenHeatmap` is a small
// Feather icon button in this card's own title row rather than a second
// full row of text, so the affordance costs no extra vertical space here.
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/theme';
import { formatDuration } from '../../stats/stats';
import { DayTotal } from '../../stats/trend';
import { AnimatedFill } from '../../ui/AnimatedFill';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { typeScale, elevation } from '../../theme/tokens';

// Shrunk from 80 -- this card now shares a flex:1 budget with TopicCard
// instead of sizing itself to its own content (see header comment), so its
// tallest element has to give up height for the two cards to fit together.
const TREND_BAR_MAX_H = 48;

export function TrendCard({
  trend,
  onInspectDay,
  onOpenHeatmap,
  style,
}: {
  trend: DayTotal[];
  onInspectDay: (dayKey: string) => void;
  /** Opens the "Last 5 weeks" heatmap in its own Sheet (StatsScreen owns the
   * Sheet itself, same lifted-open pattern as onInspectDay). */
  onOpenHeatmap: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const trendMax = Math.max(1, ...trend.map((d) => d.focusS));
  const [tooltip, setTooltip] = useState<{ key: string; text: string } | null>(null);

  const pressDay = (dayKey: string) => {
    Haptics.selectionAsync();
    onInspectDay(dayKey);
  };

  return (
    <View style={[styles.card, { backgroundColor: c.surface }, style]}>
      <View style={styles.headerRow}>
        <Text style={[styles.h2, { color: c.text }]}>Last 7 days</Text>
        <AnimatedPressable
          onPress={() => {
            Haptics.selectionAsync();
            onOpenHeatmap();
          }}
          accessibilityRole="button"
          accessibilityLabel="View last 5 weeks heatmap"
          hitSlop={8}
        >
          <Feather name="grid" size={18} color={c.textDim} />
        </AnimatedPressable>
      </View>
      {/* No `accessible` on this row -- it used to have one plus a summary
          label, which collapses the subtree into a single VoiceOver element
          and made all seven bar buttons (each already labelled with its day
          and duration, and each a tap into that day's sessions) unreachable.
          The card's own "Last 7 days" heading supplies the context the
          summary was carrying. */}
      <View style={styles.trendRow}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  // Padding trimmed from 16 -- same budget reasoning as TREND_BAR_MAX_H above.
  card: { borderRadius: 14, padding: 12, gap: 6, ...elevation.card },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h2: { ...typeScale.sectionTitle },
  trendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8, flex: 1 },
  trendCol: { alignItems: 'center', gap: 6, flex: 1 },
  trendTrack: { width: 18, borderRadius: 9, justifyContent: 'flex-end', overflow: 'hidden' },
  trendBar: { width: '100%', borderRadius: 9 },
  trendLabel: { ...typeScale.caption },
  tooltip: { position: 'absolute', top: -26, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, zIndex: 1 },
  tooltipText: { fontSize: 11, fontWeight: '700' },
});
