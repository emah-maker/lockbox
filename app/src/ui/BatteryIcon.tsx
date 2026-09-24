// BatteryIcon.tsx -- tiny battery glyph whose fill tracks the box's reported
// charge level, mirroring firmware/lib/lock_ui.py's own battery-view icon
// (outline + terminal nub + a variable-width fill) instead of the fixed
// Feather "battery" glyph it replaces, which only ever changed color, never
// how full it looked. Built on AnimatedFill's existing width axis -- the
// same fill this app already uses for the Focus-card sparkline/StatsScreen
// bars -- rather than a new SVG/animation dependency.
import { View, StyleSheet } from 'react-native';
import { AnimatedFill } from './AnimatedFill';

// Every hardcoded dimension below, scaled by `scale` -- added so
// home/BatteryBadge.tsx can dock a much larger version of this exact glyph
// next to StatusStrip's small inline one, without a second, drifting copy of
// the outline/nub/fill geometry. `scale` defaults to 1, so StatusStrip's
// existing call site (which never passes it) renders pixel-identical to
// before this prop existed.
export function BatteryIcon({ pct, color, scale = 1 }: { pct: number; color: string; scale?: number }) {
  // pct < 0 means "unknown" (Status.bat's own -1-when-unavailable
  // convention, see ble/protocol.ts) -- render an empty outline rather than
  // guessing a fill level.
  const clamped = pct < 0 ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.outline,
          {
            borderColor: color,
            width: 16 * scale,
            height: 9 * scale,
            borderWidth: 1.3 * scale,
            borderRadius: 2 * scale,
            padding: 1.5 * scale,
          },
        ]}
      >
        <AnimatedFill axis="width" toValue={clamped} style={[styles.fill, { borderRadius: 0.5 * scale }]} color={color} />
      </View>
      <View
        style={[
          styles.nub,
          {
            backgroundColor: color,
            width: 1.5 * scale,
            height: 4 * scale,
            borderRadius: 0.5 * scale,
            marginLeft: 1 * scale,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  outline: { overflow: 'hidden' },
  fill: { height: '100%' },
  nub: {},
});
