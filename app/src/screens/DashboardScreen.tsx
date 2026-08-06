// DashboardScreen.tsx -- the focus-stats dashboard + live box status. This is
// the read-only "viewer MVP" surface: it shows the same aggregates the box
// renders on its own screen, plus a call-alert toggle.
import React from 'react';
import { View, Text, StyleSheet, Switch, Pressable, ScrollView } from 'react-native';
import { useStore } from '../store/useStore';
import { formatDuration, completionRate } from '../stats/stats';

export default function DashboardScreen() {
  const { conn, error, status, stats, callAlertsEnabled, setCallAlerts, lastAlert, connect, disconnect } =
    useStore();

  const connected = conn === 'connected';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>Phone Box</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Connection</Text>
        <Text style={styles.value}>{conn}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.btn} onPress={connected ? disconnect : connect}>
          <Text style={styles.btnText}>{connected ? 'Disconnect' : 'Connect'}</Text>
        </Pressable>
      </View>

      {status && (
        <View style={styles.card}>
          <Text style={styles.label}>Box status</Text>
          <Text style={styles.value}>{status.st.toUpperCase()}</Text>
          {status.st === 'running' && (
            <Text style={styles.sub}>{formatDuration(status.rem)} left</Text>
          )}
          <Text style={styles.sub}>Battery {status.bat < 0 ? '—' : `${status.bat}%`}</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.label}>Focus</Text>
        {stats && stats.avail ? (
          <>
            <Text style={styles.big}>{formatDuration(stats.foc)}</Text>
            <Text style={styles.sub}>focus time</Text>
            <Text style={styles.row}>Sessions: {stats.n}</Text>
            <Text style={styles.row}>
              Completed: {stats.done}/{stats.n} ({completionRate(stats)}%)
            </Text>
            <Text style={styles.row}>Streak: {stats.str}</Text>
            <Text style={styles.row}>Longest: {formatDuration(stats.lng)}</Text>
          </>
        ) : (
          <Text style={styles.sub}>
            {stats ? 'No SD card in the box' : 'Connect to load focus stats'}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.label}>Alert box on incoming calls</Text>
          <Switch value={callAlertsEnabled} onValueChange={setCallAlerts} />
        </View>
        <Text style={styles.sub}>
          When locked, an incoming call lights up the box screen (it never unlocks).
        </Text>
        {lastAlert ? <Text style={styles.sub}>Last alert sent: {lastAlert}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, backgroundColor: '#0b0b0c' },
  h1: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 40 },
  card: { backgroundColor: '#17181b', borderRadius: 14, padding: 16, gap: 6 },
  label: { color: '#9aa0a6', fontSize: 13 },
  value: { color: '#fff', fontSize: 22, fontWeight: '600' },
  big: { color: '#22c55e', fontSize: 40, fontWeight: '800' },
  sub: { color: '#9aa0a6', fontSize: 14 },
  row: { color: '#e6e6e6', fontSize: 16, marginTop: 2 },
  error: { color: '#ef4444', fontSize: 13 },
  btn: { backgroundColor: '#22c55e', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#04210f', fontWeight: '700' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
