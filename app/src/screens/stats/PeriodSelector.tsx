// PeriodSelector.tsx -- the Day/Week/Month/All/Goals chip row at the top of
// StatsScreen. Extracted verbatim from StatsScreen's own WINDOW_OPTIONS
// row (same chip visuals/animation) plus one new "Goals" chip, split out
// mainly to keep StatsScreen.tsx under this project's 500-line guideline as
// it grows the new interactive/goals work. `StatsPeriod` matches
// nav/useNav.ts's `NavIntent.statsPeriod` union exactly, so a deep link's
// `statsPeriod` value can be handed straight to `onSelect` with no mapping
// layer at the call site.
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/color';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { typeScale } from '../../theme/tokens';

export type StatsPeriod = 'day' | 'week' | 'month' | 'all' | 'goals';

export const PERIOD_OPTIONS: { key: StatsPeriod; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
  { key: 'goals', label: 'Goals' },
];

export function isStatsPeriod(v: unknown): v is StatsPeriod {
  return v === 'day' || v === 'week' || v === 'month' || v === 'all' || v === 'goals';
}

export function PeriodSelector({ period, onSelect }: { period: StatsPeriod; onSelect: (p: StatsPeriod) => void }) {
  const c = useTheme();
  return (
    <View style={styles.row}>
      {PERIOD_OPTIONS.map((opt) => {
        const active = period === opt.key;
        return (
          <AnimatedPressable
            key={opt.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            // Chip is 8+8+17 = 33px tall; hitSlop takes the touch target to
            // the ~44pt minimum without changing the row's visual density.
            hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
            style={[
              styles.chip,
              { borderColor: withAlpha(c.accent, 0.4) },
              active && { backgroundColor: c.accent, borderColor: c.accent },
            ]}
            onPress={() => onSelect(opt.key)}
          >
            <Text style={[styles.chipText, { color: active ? c.accentText : c.textDim }]}>{opt.label}</Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, borderWidth: 1.5 },
  chipText: { ...typeScale.label, fontWeight: '600' },
});
