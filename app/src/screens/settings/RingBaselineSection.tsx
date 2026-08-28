// RingBaselineSection.tsx -- the settings hub's "Focus ring" sheet: which
// window's best day the Home hero ring's idle arc compares today's focus
// time against, when the user hasn't set a (single, untopic'd) daily goal --
// see screens/home/idleRingState.ts for the actual precedence rule and
// DashboardScreen.tsx for how the daily goal is resolved. Shaped exactly
// like AppearanceSection.tsx: one Section, one row of Chips (ChipPicker.tsx),
// plus an exported one-line hub summary.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { Section, rowLabelStyle } from '../SettingsPrimitives';
import { Chip } from './ChipPicker';
import { RingBaselineWindow, ringBaselineWindowLabel } from '../home/idleRingState';

const WINDOWS: RingBaselineWindow[] = ['week', 'month', 'year', 'all'];
const WINDOW_CHIP_LABELS: Record<RingBaselineWindow, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
  all: 'All',
};

export function RingBaselineSection({
  color,
  ringBaselineWindow,
  setRingBaselineWindow,
}: {
  color: ReturnType<typeof useTheme>;
  ringBaselineWindow: RingBaselineWindow;
  setRingBaselineWindow: (w: RingBaselineWindow) => void;
}) {
  return (
    <Section
      title="Focus ring"
      // Makes the scoping explicit (task brief) -- a daily goal, when set,
      // always drives the ring instead; this only ever matters on a day/
      // account with no daily goal to compare against.
      subtitle="Only used when you haven't set a daily goal -- with one, the ring fills toward that instead"
      color={color}
    >
      <Text style={[styles.label, { color: color.textDim, marginBottom: 8 }]}>
        Compare today to your best day this...
      </Text>
      <View style={styles.chipRow}>
        {WINDOWS.map((w) => (
          <Chip key={w} active={ringBaselineWindow === w} onPress={() => setRingBaselineWindow(w)} color={color}>
            {WINDOW_CHIP_LABELS[w]}
          </Chip>
        ))}
      </View>
    </Section>
  );
}

/** One-line hub summary for the Focus ring row, e.g. "Best day this week". */
export function ringBaselineSummary(w: RingBaselineWindow): string {
  return `Best day ${ringBaselineWindowLabel(w)}`;
}

const styles = StyleSheet.create({
  label: rowLabelStyle,
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
