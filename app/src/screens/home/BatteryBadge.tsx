// BatteryBadge.tsx -- "how's the box's battery doing" glyph docked in the
// Home hero ring's own bottom cut-out (ProgressRing's `bottomSlot`, wired up
// by FocusHero.tsx) -- ring redesign task. A second concentric arc on
// ProgressRing itself was the obvious first idea for showing battery here --
// rejected, and noted here rather than tried and reverted: ProgressRing's
// single arc means "today's focus progress" (see screens/home/
// idleRingState.ts), and overlaying a second, unrelated meaning (battery
// level) onto that same arc shape would compete with that read instead of
// sitting alongside it. Docking this glyph in the gap the redesigned ring
// already leaves open at 6 o'clock gets the "share the hero's anchor
// spot" without either problem: it's visually inside the ring, but it is
// not a second arc.
//
// Self-supplies its data the same way FocusHero self-supplies status.bat --
// DashboardScreen never threads a battery prop through (see this task's own
// "do NOT add a battery prop from DashboardScreen" rule): this component
// reads useBatteryStore directly for the sample log estimateRemainingMs
// needs, the same shared log StatusStrip now also just reads (see
// battery/useBatteryStore.ts, battery/batterySamplingBridge.ts).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { typeScale } from '../../theme/tokens';
import { BatteryIcon } from '../../ui/BatteryIcon';
import { batteryColor } from '../../battery/batteryColor';
import { useBatteryStore } from '../../battery/useBatteryStore';
import { estimateRemainingMs, formatRemaining } from '../../battery/batteryEstimate';

// Was 2.2 (bigger, for the old "docked below the ring" placement, which had
// a full row's own width to spend) -- trimmed down now that this renders
// inside the ring's gap, a tighter space it shares with the ring's own
// stroke geometry either side of it.
const BADGE_SCALE = 1.7;

export function BatteryBadge({ pct }: { pct: number }) {
  const theme = useTheme();
  const samples = useBatteryStore((s) => s.samples);
  // pct < 0 ("unknown", ble/protocol.ts Status.bat convention) always skips
  // the estimate -- same guard estimateRemainingMs itself applies, made
  // explicit here so `remaining` reads null instead of relying on that
  // function's own internal check.
  const remaining = pct >= 0 ? formatRemaining(estimateRemainingMs(samples, pct)) : null;
  const color = batteryColor(pct, theme);

  return (
    <View style={styles.row}>
      <BatteryIcon pct={pct} color={color} scale={BADGE_SCALE} />
      <Text style={[styles.pct, { color: theme.text }]} numberOfLines={1}>
        {pct >= 0 ? `${pct}%` : '—'}
      </Text>
      {remaining ? (
        <Text style={[styles.caption, { color: theme.textDim }]} numberOfLines={1}>
          {remaining}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Fixed minHeight (not just padding) is what reserves this row's space --
  // FocusHero always mounts this component (never conditionally on `status`
  // being non-null), so the row itself never appears/disappears; minHeight
  // just keeps its height stable regardless of whether the optional
  // `remaining` caption happens to be present this render. No marginTop
  // (unlike the pre-redesign "docked below the ring" version) -- this now
  // renders inside ProgressRing's own absolutely-positioned bottomSlot,
  // which already centers it on the gap itself.
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  pct: { ...typeScale.sectionTitle },
  caption: { ...typeScale.caption },
});
