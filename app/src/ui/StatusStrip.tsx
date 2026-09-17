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
import { useStore, BOX_STATE_LABELS, CONN_LABELS } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useBatteryStore } from '../battery/useBatteryStore';
import { batteryColor } from '../battery/batteryColor';
import { estimateRemainingMs, formatRemaining } from '../battery/batteryEstimate';
import { useTheme } from '../theme/useTheme';
import { useNav } from '../nav/useNav';
import { AnimatedPressable } from './AnimatedPressable';
import { BatteryIcon } from './BatteryIcon';
import { typeScale, spacing } from '../theme/tokens';
import { withAlpha } from '../theme/color';

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

export function StatusStrip(): React.JSX.Element {
  const conn = useStore((s) => s.conn);
  const status = useStore((s) => s.status);
  const demoMode = useSettingsStore((st) => st.demoModeEnabled);
  const theme = useTheme();
  const s = styles(theme);

  const bat = status ? status.bat : -1; // -1 == unavailable, see ble/protocol.ts Status.bat
  // Recording into this log is battery/batterySamplingBridge.ts's job now
  // (started once from App.tsx) -- this component only reads it, the same
  // read-only relationship DashboardScreen's home/BatteryBadge.tsx has.
  const samples = useBatteryStore((st) => st.samples);
  const remaining = bat >= 0 ? formatRemaining(estimateRemainingMs(samples, bat)) : null;

  return (
    <>
      {/* Mounted here rather than on Home, because this strip is the one
          thing App.tsx renders above EVERY tab -- a reviewer or tester who
          turned demo mode on and then wandered into Stats or the Calendar
          has to keep seeing that the numbers in front of them came from a
          box that does not exist. The Settings row alone is not enough: by
          the time the sessions have landed, nobody is looking at Settings.
          Same tap target as the strip below it, so it also gets you back to
          the switch that turns it off. */}
      {demoMode ? <DemoModeBanner theme={theme} /> : null}
      <AnimatedPressable
        style={s.row}
        onPress={() => useNav.getState().navigate('settings')}
        accessibilityRole="button"
        accessibilityLabel={`Box ${status ? BOX_STATE_LABELS[status.st] : CONN_LABELS[conn]}, battery ${
          bat >= 0 ? `${bat} percent` : 'unknown'
        }${remaining ? `, ${remaining}` : ''}`}
      >
        <View style={[s.dot, { backgroundColor: connDotColor(conn, theme) }]} />
        {/* BOX_STATE_LABELS, not `status.st.toUpperCase()`. The raw token is
            the firmware's wire spelling, and this row is the only place it
            was ever shown to a person -- fine while the union happened to be
            four English words, a leak the moment it grew 'picking' and
            'confirming' and the strip started saying PICKING at users
            sitting in the box's own tag picker (which has no timeout, so
            that is not a flicker). The map is a total Record<BoxState,
            string> so the next firmware state can't reach a release without
            someone wording it. Title case, not shouted, to match
            CONN_LABELS in the other arm of this same ternary -- the two
            alternate in one slot and used to disagree on case. */}
        <Text style={s.connLabel} numberOfLines={1}>
          {status ? BOX_STATE_LABELS[status.st] : CONN_LABELS[conn]}
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
    </>
  );
}

/** The persistent "this box is not real" marker, shown above the status row
 * for as long as demo mode is on (ble/DemoBoxClient.ts).
 *
 * A tinted fill with ordinary `text` on top, not warn-colored text on a warn
 * fill: the tint is what catches the eye, and the label still has to be
 * legible against it in both themes at whatever accent is selected. The dot
 * carries the color so the strip reads as a warning without betting the
 * copy's contrast on it. */
function DemoModeBanner({ theme }: { theme: ReturnType<typeof useTheme> }): React.JSX.Element {
  const s = styles(theme);
  return (
    <AnimatedPressable
      style={[s.banner, { backgroundColor: withAlpha(theme.warn, 0.18) }]}
      onPress={() => useNav.getState().navigate('settings')}
      accessibilityRole="button"
      accessibilityLabel="Demo mode is on. Sessions are simulated and stay on this device. Opens Settings."
    >
      <View style={[s.dot, { backgroundColor: theme.warn }]} />
      <Text style={s.bannerLabel} numberOfLines={1}>
        DEMO MODE
      </Text>
      <Text style={s.bannerDetail} numberOfLines={1}>
        Simulated box · sessions stay on this device
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
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    bannerLabel: { ...typeScale.caption, color: t.text, fontWeight: '800' },
    // Shrinks (and truncates) before the label does, so the words that
    // matter survive a narrow screen or a large system text size.
    bannerDetail: { ...typeScale.caption, color: t.text, flexShrink: 1 },
    connLabel: { ...typeScale.caption, color: t.textDim, flexShrink: 1 },
    spacer: { flex: 1 },
    remaining: { ...typeScale.caption, color: t.textDim, flexShrink: 1 },
    battLabel: { ...typeScale.caption, color: t.textDim, flexShrink: 1 },
  });
