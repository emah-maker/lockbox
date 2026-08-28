// StatusStrip.tsx -- compact, always-visible top status bar, mounted once in
// App.tsx above every tab's screen (see App.tsx) so a user doesn't have to be
// on a particular tab to see the box's live connection/battery state.
//
// Back to a single row (manager brief: "the account status should only be in
// the settings part, remove it from the top bar so that the bar gets thinner
// at the top"). This briefly grew a second, independently-tappable Row B
// (account identity + sync caption) -- removed here, not just hidden, since
// the brief is "thinner", not "collapsible". Before deleting it, this file's
// own account fields were checked against the Account sheet
// (screens/account/IdentityHeader.tsx + SyncStatusSection.tsx): both already
// show the exact same identity line and sync caption on their own, so no
// information Row B carried is lost -- it's reachable at Settings > Account,
// one tap away via this row's own onPress, same as before.
//
// This row's own battery-sample recording used to live here as two private
// effects (task 2, an earlier pass) -- hoisted out to
// battery/useBatteryStore.ts + battery/batterySamplingBridge.ts so Home's
// BatteryBadge can read/extend the same sample log instead of each keeping an
// independent copy that would double-record every percent change. This file
// now only *reads* useBatteryStore; it no longer records into it.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStore, CONN_LABELS } from '../store/useStore';
import { useBatteryStore } from '../battery/useBatteryStore';
import { batteryColor } from '../battery/batteryColor';
import { estimateRemainingMs, formatRemaining } from '../battery/batteryEstimate';
import { useTheme } from '../theme/useTheme';
import { useNav } from '../nav/useNav';
import { AnimatedPressable } from './AnimatedPressable';
import { BatteryIcon } from './BatteryIcon';
import { typeScale, spacing } from '../theme/tokens';

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
  // Recording into this log is battery/batterySamplingBridge.ts's job now
  // (started once from App.tsx) -- this component only reads it, the same
  // read-only relationship DashboardScreen's home/BatteryBadge.tsx has.
  const samples = useBatteryStore((st) => st.samples);
  const remaining = bat >= 0 ? formatRemaining(estimateRemainingMs(samples, bat)) : null;

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
      {remaining ? (
        <Text style={s.remaining} numberOfLines={1}>
          {remaining}
        </Text>
      ) : null}
      <BatteryIcon pct={bat} color={batteryColor(bat, theme)} />
      <Text style={s.battLabel} numberOfLines={1}>
        {bat >= 0 ? `${bat}%` : '—'}
      </Text>
    </AnimatedPressable>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      // Was spacing.sm (8) top and bottom for two rows' worth of visual
      // weight -- trimmed to spacing.xs (4) now that this is the strip's
      // only row, so the bar itself reads visibly thinner, not just "one row
      // instead of two at the old row height".
      paddingVertical: spacing.xs,
      gap: spacing.sm,
      backgroundColor: t.surface,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    connLabel: { ...typeScale.caption, color: t.textDim, flexShrink: 1 },
    spacer: { flex: 1 },
    remaining: { ...typeScale.caption, color: t.textDim, flexShrink: 1 },
    battLabel: { ...typeScale.caption, color: t.textDim, flexShrink: 1 },
  });
