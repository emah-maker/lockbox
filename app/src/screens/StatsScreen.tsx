// StatsScreen.tsx -- total focus time plus lighthearted real-world
// comparisons (app/src/stats/comparisons.ts), computed from the local
// session log (useStore.sessions) the same way DashboardScreen's Focus card
// is -- the box keeps no long-term stats of its own to read this from.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useStore } from '../store/useStore';
import { useTheme } from '../theme/useTheme';
import { aggregate, formatDuration } from '../stats/stats';
import { topComparisons, formatComparison } from '../stats/comparisons';

const TOP_N = 5;

export default function StatsScreen() {
  const c = useTheme();
  const sessions = useStore((s) => s.sessions);

  const stats = useMemo(() => aggregate(sessions), [sessions]);
  const comparisons = useMemo(() => topComparisons(stats.foc).slice(0, TOP_N), [stats.foc]);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.h1, { color: c.text }]}>Stats</Text>

      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <Text style={[styles.label, { color: c.textDim }]}>Total focus time</Text>
        <Text style={[styles.big, { color: c.accent }]}>{formatDuration(stats.foc)}</Text>
        <Text style={[styles.sub, { color: c.textDim }]}>
          across {stats.n} session{stats.n === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <Text style={[styles.h2, { color: c.text }]}>Fun facts</Text>
        {stats.foc <= 0 ? (
          <Text style={[styles.sub, { color: c.textDim }]}>
            Start a focus session to see how it stacks up.
          </Text>
        ) : (
          comparisons.map((cmp) => (
            <Text key={cmp.ref.key} style={[styles.fact, { color: c.text }]}>
              {formatComparison(cmp)}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 16 },
  h1: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  card: { borderRadius: 14, padding: 16, gap: 6 },
  label: { fontSize: 13 },
  big: { fontSize: 40, fontWeight: '800' },
  sub: { fontSize: 14 },
  fact: { fontSize: 15, paddingVertical: 4 },
});
