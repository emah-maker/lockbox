// FunFactsCard.tsx -- "Fun facts" card, extracted from StatsScreen.tsx (same
// 500-line-guideline split as the other screens/stats/*.tsx files) and
// trimmed to a fixed-height two-fact strip with a "More" sheet for the rest,
// instead of an unbounded inline list -- part of this task's "stop the
// screen growing vertically" requirement (TOP_N used to render up to 5
// comparison rows directly into the scroll).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/theme';
import { formatDuration } from '../../stats/stats';
import { BestDay } from '../../stats/trend';
import { Comparison, formatComparison } from '../../stats/comparisons';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { typeScale, elevation } from '../../theme/tokens';

const INLINE_COUNT = 2;

export function FunFactsCard({
  hasFocus,
  best,
  comparisons,
  onSeeMore,
}: {
  hasFocus: boolean;
  best: BestDay | null;
  comparisons: Comparison[];
  onSeeMore: () => void;
}) {
  const c = useTheme();
  const inline = comparisons.slice(0, INLINE_COUNT);
  const more = comparisons.length - inline.length;

  return (
    <View style={[styles.card, { backgroundColor: c.surface, minHeight: 120 }]}>
      <Text style={[styles.h2, { color: c.text }]}>Fun facts</Text>
      {!hasFocus ? (
        <Text style={[styles.sub, { color: c.textDim }]}>Start a focus session to see how it stacks up.</Text>
      ) : (
        <>
          {best && (
            <View style={[styles.bestDay, { backgroundColor: withAlpha(c.accent, 0.12) }]}>
              <Feather name="award" size={16} color={c.accent} />
              <Text style={[styles.fact, styles.bestDayText, { color: c.text }]}>
                Your best day was{' '}
                {new Date(best.dateMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                -- {formatDuration(best.focusS)} focused.
              </Text>
            </View>
          )}
          {inline.map((cmp) => (
            <View key={cmp.ref.key} style={styles.factRow}>
              <Feather name="zap" size={14} color={c.textDim} />
              <Text style={[styles.fact, { color: c.text }]}>{formatComparison(cmp)}</Text>
            </View>
          ))}
          {more > 0 ? (
            <AnimatedPressable onPress={onSeeMore} accessibilityRole="button">
              <Text style={[styles.more, { color: c.accent }]}>See {more} more</Text>
            </AnimatedPressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, gap: 6, ...elevation.card },
  h2: { ...typeScale.sectionTitle, marginBottom: 4 },
  sub: { ...typeScale.body },
  fact: { fontSize: 15, letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight, flex: 1 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  bestDay: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 10, marginBottom: 6 },
  bestDayText: { fontWeight: '600' },
  more: { ...typeScale.label, marginTop: 4 },
});
