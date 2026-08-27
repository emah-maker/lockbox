// StatusStrip.tsx -- compact, always-visible battery + connection row, mounted
// once in App.tsx above every tab's screen (see App.tsx) so a user doesn't
// have to be on the Dashboard tab to see the box's live connection/battery
// state -- previously that only ever showed inside DashboardScreen's own
// "Box" card. Reads useStore/useSettingsStore itself and takes no props, so
// mounting it doesn't require threading anything through App.tsx beyond the
// component itself. Tapping it jumps to Settings, the same "the summary row
// is a shortcut to its own detail screen" precedent as the box's own
// touchscreen home view.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStore, CONN_LABELS } from '../store/useStore';
import { useTheme } from '../theme/useTheme';
import { useNav } from '../nav/useNav';
import { AnimatedPressable } from './AnimatedPressable';
import { BatteryIcon } from './BatteryIcon';
import { typeScale, spacing } from '../theme/tokens';
import {
  BatterySample,
  recordBatterySample,
  estimateRemainingMs,
  formatRemaining,
  loadBatterySamples,
  saveBatterySamples,
} from '../battery/batteryEstimate';

// Mirrors DashboardScreen's own batteryColor exactly (box-code/lib/lock_ui.py
// update_battery_view's >=50/>=20 thresholds) -- duplicated rather than
// imported since DashboardScreen is a sibling-owned screen file this task
// may not touch, and it's a 4-line, self-contained rule.
function batteryColor(pct: number, t: ReturnType<typeof useTheme>): string {
  if (pct < 0) return t.textDim;
  if (pct >= 50) return t.accent;
  if (pct >= 20) return t.warn;
  return t.danger;
}

// Same fixed (non-accent) status-dot language as DashboardScreen/
// SettingsScreen's own connection dots -- extended with an explicit amber
// for the two "in progress" states, which those two screens otherwise
// collapse into a plain "not connected" look. This strip is the one place a
// user sees the box's connection state from every tab, so the extra state
// is worth showing here even though the per-screen dots don't.
function connDotColor(conn: string, t: ReturnType<typeof useTheme>): string {
  switch (conn) {
    case 'connected':
      return t.success;
    case 'scanning':
    case 'connecting':
      return t.warn;
    case 'error':
      return t.danger;
    default:
      return t.textDim;
  }
}

export function StatusStrip(): JSX.Element {
  const conn = useStore((s) => s.conn);
  const status = useStore((s) => s.status);
  const theme = useTheme();
  const s = styles(theme);

  const bat = status ? status.bat : -1; // -1 == unavailable, see ble/protocol.ts Status.bat
  const [samples, setSamples] = useState<BatterySample[] | null>(null);
  const lastRecordedPct = useRef<number | null>(null);

  // Hydrates the persisted sample log once on mount -- kept here rather than
  // in useStore.ts (which owns every other piece of BLE-derived state) so
  // this task doesn't have to touch that file; see batteryEstimate.ts's own
  // "thin persistence helper" comment.
  useEffect(() => {
    let mounted = true;
    loadBatterySamples().then((loaded) => {
      if (mounted) setSamples(loaded);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Records a new sample every time the box's reported percent actually
  // changes. Guarded on `samples` already having loaded (via the functional
  // updater's `prev === null` check) so a status tick arriving before
  // hydration finishes can't stomp the persisted log with a partial
  // in-memory one -- worst case that one reading is skipped, and the next
  // *different* percent still gets recorded normally.
  useEffect(() => {
    if (bat < 0) return;
    if (lastRecordedPct.current === bat) return;
    lastRecordedPct.current = bat;
    setSamples((prev) => {
      if (prev === null) return prev;
      const next = recordBatterySample(prev, { t: Date.now(), pct: bat });
      if (next !== prev) saveBatterySamples(next);
      return next;
    });
  }, [bat]);

  const remaining =
    bat >= 0 && samples ? formatRemaining(estimateRemainingMs(samples, bat)) : null;

  return (
    <AnimatedPressable
      style={s.row}
      onPress={() => useNav.getState().navigate('settings')}
      accessibilityRole="button"
      accessibilityLabel={`Box ${status ? status.st : CONN_LABELS[conn]}, battery ${
        bat >= 0 ? `${bat} percent` : 'unknown'
      }${remaining ? `, ${remaining}` : ''}`}
    >
      <View style={[s.dot, { backgroundColor: connDotColor(conn, theme) }]} />
      <Text style={s.connLabel} numberOfLines={1}>
        {status ? status.st.toUpperCase() : CONN_LABELS[conn]}
      </Text>
      <View style={s.spacer} />
      {remaining ? <Text style={s.remaining}>{remaining}</Text> : null}
      <BatteryIcon pct={bat} color={batteryColor(bat, theme)} />
      <Text style={s.battLabel}>{bat >= 0 ? `${bat}%` : '—'}</Text>
    </AnimatedPressable>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
      backgroundColor: t.surface,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    connLabel: { ...typeScale.caption, color: t.textDim, flexShrink: 1 },
    spacer: { flex: 1 },
    remaining: { ...typeScale.caption, color: t.textDim },
    battLabel: { ...typeScale.caption, color: t.textDim },
  });
