// BatteryIcon.tsx -- tiny battery glyph whose fill tracks the box's reported
// charge level, mirroring Box-code/lib/lock_ui.py's own battery-view icon
// (outline + terminal nub + a variable-width fill) instead of the fixed
// Feather "battery" glyph it replaces, which only ever changed color, never
// how full it looked. Built on AnimatedFill's existing width axis -- the
// same fill this app already uses for the Focus-card sparkline/StatsScreen
// bars -- rather than a new SVG/animation dependency.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AnimatedFill } from './AnimatedFill';

export function BatteryIcon({ pct, color }: { pct: number; color: string }) {
  // pct < 0 means "unknown" (Status.bat's own -1-when-unavailable
  // convention, see ble/protocol.ts) -- render an empty outline rather than
  // guessing a fill level.
  const clamped = pct < 0 ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <View style={styles.row}>
      <View style={[styles.outline, { borderColor: color }]}>
        <AnimatedFill axis="width" toValue={clamped} style={styles.fill} color={color} />
      </View>
      <View style={[styles.nub, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  outline: { width: 16, height: 9, borderWidth: 1.3, borderRadius: 2, padding: 1.5, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 0.5 },
  nub: { width: 1.5, height: 4, borderRadius: 0.5, marginLeft: 1 },
});
