// HeatLegend.tsx -- "Less ... More" row of 5 heat swatches under the month
// grid, GitHub-contributions-style. Split into its own file for the same
// reason MonthSummaryStrip.tsx is: a small, dumb, memo-friendly leaf that
// mounts next to it on CalendarScreen.tsx.
//
// Built directly from DayCell.tsx's exported `ALPHA_FOR_LEVEL` table rather
// than any hand-picked alpha values of its own -- that's the whole point of
// exporting the table in the first place: this legend and every day cell's
// fill are guaranteed to agree because they both read the same five numbers.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ThemeColors, withAlpha } from '../../theme/theme';
import { typeScale } from '../../theme/tokens';
import { ALPHA_FOR_LEVEL } from './DayCell';

const SWATCH_SIZE = 12;
const LEVELS: (0 | 1 | 2 | 3 | 4)[] = [0, 1, 2, 3, 4];

export function HeatLegend({ theme }: { theme: ThemeColors }) {
  return (
    <View style={styles.row} accessibilityLabel="Heat legend: less focus time to more focus time">
      <Text style={[styles.label, { color: theme.textDim }]}>Less</Text>
      {LEVELS.map((level) => (
        <View
          key={level}
          style={[
            styles.swatch,
            {
              backgroundColor: level === 0 ? theme.surface : withAlpha(theme.accent, ALPHA_FOR_LEVEL[level]),
              borderColor: theme.textDim,
              borderWidth: level === 0 ? 1 : 0,
            },
          ]}
        />
      ))}
      <Text style={[styles.label, { color: theme.textDim }]}>More</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  swatch: { width: SWATCH_SIZE, height: SWATCH_SIZE, borderRadius: 3 },
  label: {
    fontSize: 11,
    letterSpacing: typeScale.caption.letterSpacing,
    lineHeight: typeScale.caption.lineHeight,
    marginHorizontal: 2,
  },
});
