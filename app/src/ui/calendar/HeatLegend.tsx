// HeatLegend.tsx -- "Less ... More" row of 5 heat swatches under the month
// grid, GitHub-contributions-style. Split into its own file for the same
// reason MonthSummaryStrip.tsx is: a small, dumb, memo-friendly leaf that
// mounts next to it on CalendarScreen.tsx.
//
// Built from theme/dayHeat.ts's `heatFill` rather than any hand-picked alpha
// values of its own -- that's the whole point of that module: this legend and
// every day cell's fill are guaranteed to agree because they call the same
// function.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ThemeColors } from '../../theme/theme';
import { typeScale } from '../../theme/tokens';
import { heatFill, HEAT_LEVELS } from '../../theme/dayHeat';

const SWATCH_SIZE = 12;

export function HeatLegend({ theme }: { theme: ThemeColors }) {
  return (
    <View style={styles.row} accessibilityLabel="Heat legend: less focus time to more focus time">
      <Text style={[styles.label, { color: theme.textDim }]}>Less</Text>
      {HEAT_LEVELS.map((level) => (
        <View
          key={level}
          style={[
            styles.swatch,
            {
              backgroundColor: level === 0 ? theme.surface : heatFill(theme, level),
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
