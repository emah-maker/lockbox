// StatusStrip.tsx -- compact, always-visible top status bar, mounted once in
// App.tsx above every tab's screen (see App.tsx) so a user doesn't have to be
// on a particular tab to see either the box's live connection/battery state
// or which account they're signed into.
//
// Two independently-tappable rows (manager brief, task 3) instead of the
// single box-only row this used to be: Row A (box connection + battery) is
// entirely unchanged behavior and copy from before; Row B (account) is new,
// because this strip is the one place shown on every tab, and it used to say
// nothing at all about sign-in state -- a user could sign out (or hit a sync
// error) and not notice until they happened to open Settings.
//
// Row B's copy is never written fresh here -- every string is lifted
// verbatim from the Account page's own components (IdentityHeader.tsx's
// displayName/email/"Signed in" fallback chain; SyncStatusSection.tsx's
// syncError/syncing/lastSyncedAt/"Not synced yet" caption, including its
// literal 'Syncing...' with three periods) so this strip can never disagree
// with what the Account sheet itself says.
//
// Row A's battery-sample recording used to live here as two private effects
// (task 2) -- hoisted out to battery/useBatteryStore.ts +
// battery/batterySamplingBridge.ts so Home's new BatteryBadge can read/extend
// the same sample log instead of each keeping an independent copy that would
// double-record every percent change. This file now only *reads*
// useBatteryStore; it no longer records into it.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore, CONN_LABELS } from '../store/useStore';
import { useAuthStore } from '../auth/useAuthStore';
import { formatRelative } from '../auth/accountDisplay';
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

  const user = useAuthStore((st) => st.user);
  const syncing = useAuthStore((st) => st.syncing);
  const syncError = useAuthStore((st) => st.syncError);
  const lastSyncedAt = useAuthStore((st) => st.lastSyncedAt);

  // Verbatim IdentityHeader.tsx fallback chain (`name`) -- see this file's
  // header comment on why Row B never writes its own copy.
  const accountLabel = user ? user.displayName ?? user.email ?? 'Signed in' : 'Not signed in';
  // Verbatim SyncStatusSection.tsx `statusLabel`, with its syncError branch
  // folded in ahead of it (that section renders syncError as a second,
  // separate line below the same Row; this strip has room for only one
  // caption, so an error takes priority over the ordinary status wording).
  // Null while signed out -- Row B shows no second line at all then.
  const syncCaption = !user
    ? null
    : syncError
      ? syncError
      : syncing
        ? 'Syncing...'
        : lastSyncedAt
          ? `Synced ${formatRelative(lastSyncedAt)}`
          : 'Not synced yet';

  return (
    <View>
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

      {/* Row B -- account. Navigates straight to the Account sheet (rather
          than the Settings hub Row A lands on) via useNav's existing
          `settingsSection` intent -- 'account' is already a valid
          NavIntent.settingsSection member and SettingsScreen already
          consumes it (see useNav.ts / SettingsScreen.tsx), so this is wiring
          up an existing deep-link, not adding a new one. */}
      <AnimatedPressable
        style={s.row}
        onPress={() => useNav.getState().navigate('settings', { settingsSection: 'account' })}
        accessibilityRole="button"
        accessibilityLabel={`Account: ${accountLabel}${syncCaption ? `, ${syncCaption}` : ''}`}
      >
        {/* Same Account-row icon convention SettingsScreen.tsx's own hub row
            uses (person-circle / person-circle-outline, accent when signed
            in else textDim) -- smaller size here to fit this compact strip. */}
        <Ionicons
          name={user ? 'person-circle' : 'person-circle-outline'}
          size={16}
          color={user ? theme.accent : theme.textDim}
        />
        <Text style={s.connLabel} numberOfLines={1}>
          {accountLabel}
        </Text>
        <View style={s.spacer} />
        {syncCaption ? (
          <Text style={[s.remaining, syncError ? { color: theme.danger } : null]} numberOfLines={1}>
            {syncCaption}
          </Text>
        ) : null}
      </AnimatedPressable>
    </View>
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
    remaining: { ...typeScale.caption, color: t.textDim, flexShrink: 1 },
    battLabel: { ...typeScale.caption, color: t.textDim, flexShrink: 1 },
  });
