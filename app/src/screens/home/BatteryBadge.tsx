// BatteryBadge.tsx -- large "how's the box's battery doing" glyph docked
// directly below the Home hero ring (FocusHero.tsx), above the topic-pill
// row (manager brief, task 2). A second concentric arc on ProgressRing
// itself was the obvious first idea for this -- rejected, and noted here
// rather than tried and reverted: ProgressRing's single arc now means
// "today's focus progress" (see screens/home/idleRingState.ts), and
// overlaying a second, unrelated meaning (battery level) onto that same
// shape would compete with that new read instead of sitting alongside it.
// A separate glyph keeps "today's focus" (the ring) and "box battery" (this)
// visually distinct despite sharing the hero's general vicinity.
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

// Large enough to read as its own glyph at a glance from across the hero,
// not merely a bigger version of StatusStrip's small inline one.
const BADGE_SCALE = 2.2;

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
  // `remaining` caption happens to be present this render.
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, marginTop: 12 },
  pct: { ...typeScale.sectionTitle },
  caption: { ...typeScale.caption },
});
