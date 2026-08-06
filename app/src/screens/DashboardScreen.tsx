// DashboardScreen.tsx -- the focus-stats dashboard + live box status + remote
// open/close. Navigation lives in App.tsx as a trivial tab switcher; this
// stays the default landing tab.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Switch, Pressable, ScrollView } from 'react-native';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { aggregate, formatDuration, completionRate } from '../stats/stats';

export default function DashboardScreen() {
  const { conn, error, status, sessions, lastAlert, connect, disconnect, closeBox, openBox } =
    useStore();
  const callAlertsEnabled = useSettingsStore((st) => st.callAlertsEnabled);
  const setCallAlertsEnabled = useSettingsStore((st) => st.setCallAlertsEnabled);
  const remoteUnlockOn = useSettingsStore((st) => !!st.boxSettings.unlk);
  const theme = useTheme();
  const s = styles(theme);

  // Computed here, not read over BLE: the box keeps no long-term stats of its
  // own (no SD card, no NVM -- see Box-code/lib/lock_log.py), so the app's
  // local session log (synced live + drained from the box on connect) is the
  // only copy, and the only place these aggregates can come from.
  const stats = useMemo(() => aggregate(sessions), [sessions]);

  const connected = conn === 'connected';
  const canClose = connected && (status?.st === 'idle' || status?.st === 'done');
  const canOpen = connected && (status?.st === 'running' || status?.st === 'closed');

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Text style={s.h1}>Phone Box</Text>

      <View style={s.card}>
        <Text style={s.label}>Connection</Text>
        <Text style={s.value}>{conn}</Text>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Pressable style={s.btn} onPress={connected ? disconnect : connect}>
          <Text style={s.btnText}>{connected ? 'Disconnect' : 'Connect'}</Text>
        </Pressable>
      </View>

      {status && (
        <View style={s.card}>
          <Text style={s.label}>Box status</Text>
          <Text style={s.value}>{status.st.toUpperCase()}</Text>
          {status.st === 'running' && (
            <Text style={s.sub}>{formatDuration(status.rem)} left</Text>
          )}
          <Text style={s.sub}>Battery {status.bat < 0 ? '—' : `${status.bat}%`}</Text>

          <View style={s.controlRow}>
            <Pressable
              style={[s.controlBtn, !canClose && s.controlBtnDisabled]}
              disabled={!canClose}
              onPress={closeBox}
            >
              <Text style={s.controlBtnText}>Close</Text>
            </Pressable>
            <Pressable
              style={[
                s.controlBtn,
                { backgroundColor: theme.danger },
                !canOpen && s.controlBtnDisabled,
              ]}
              disabled={!canOpen}
              onPress={openBox}
            >
              <Text style={s.controlBtnText}>Open</Text>
            </Pressable>
          </View>
          {canOpen && !remoteUnlockOn && (
            <Text style={s.sub}>
              Remote unlock is off in Settings -- Open won't release the box until you turn it on.
            </Text>
          )}
        </View>
      )}

      <View style={s.card}>
        <Text style={s.label}>Focus</Text>
        {stats.n > 0 ? (
          <>
            <Text style={s.big}>{formatDuration(stats.foc)}</Text>
            <Text style={s.sub}>focus time</Text>
            <Text style={s.row}>Sessions: {stats.n}</Text>
            <Text style={s.row}>
              Completed: {stats.done}/{stats.n} ({completionRate(stats)}%)
            </Text>
            <Text style={s.row}>Streak: {stats.str}</Text>
            <Text style={s.row}>Longest: {formatDuration(stats.lng)}</Text>
          </>
        ) : (
          <Text style={s.sub}>Start a session to see focus stats here.</Text>
        )}
      </View>

      <View style={s.card}>
        <View style={s.switchRow}>
          <Text style={s.label}>Alert box on incoming calls</Text>
          <Switch value={callAlertsEnabled} onValueChange={setCallAlertsEnabled} />
        </View>
        <Text style={s.sub}>
          When locked, an incoming call lights up the box screen (it never unlocks).
        </Text>
        {lastAlert ? <Text style={s.sub}>Last alert sent: {lastAlert}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: { padding: 20, gap: 16, backgroundColor: t.bg, paddingBottom: 60 },
    h1: { color: t.text, fontSize: 28, fontWeight: '700', marginTop: 40 },
    card: { backgroundColor: t.surface, borderRadius: 14, padding: 16, gap: 6 },
    label: { color: t.textDim, fontSize: 13 },
    value: { color: t.text, fontSize: 22, fontWeight: '600' },
    big: { color: t.accent, fontSize: 40, fontWeight: '800' },
    sub: { color: t.textDim, fontSize: 14 },
    row: { color: t.text, fontSize: 16, marginTop: 2 },
    error: { color: t.danger, fontSize: 13 },
    btn: { backgroundColor: t.accent, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 },
    btnText: { color: t.accentText, fontWeight: '700' },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    controlRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
    controlBtn: {
      flex: 1,
      backgroundColor: t.accent,
      borderRadius: 10,
      padding: 12,
      alignItems: 'center',
    },
    controlBtnDisabled: { opacity: 0.35 },
    controlBtnText: { color: t.accentText, fontWeight: '700' },
  });
