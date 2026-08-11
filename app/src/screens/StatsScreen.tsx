// StatsScreen.tsx -- total focus time plus lighthearted real-world
// comparisons (app/src/stats/comparisons.ts), computed from the local
// session log (useStore.sessions) the same way DashboardScreen's Focus card
// is -- the box keeps no long-term stats of its own to read this from.
//
// "Advanced stats" is an opt-in toggle (off by default, like callAlertsEnabled)
// that reveals two extra views built on top of that same local log: a 7-day
// focus-time trend (stats/trend.ts) and a breakdown by the topic tags the user
// applied from the Focus tab (stats/topics.ts). Both are no-ops on an untagged
// history -- they just show a hint instead of an empty chart.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { aggregate, formatDuration, completionRate } from '../stats/stats';
import { topComparisons, formatComparison } from '../stats/comparisons';
import { topicBreakdownWithCustom } from '../stats/customLabels';
import { lastNDays, bestDay } from '../stats/trend';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { AnimatedFill } from '../ui/AnimatedFill';
import { typeScale, elevation } from '../theme/tokens';

const TOP_N = 5;
const TREND_BAR_MAX_H = 80;

export default function StatsScreen() {
  const c = useTheme();
  const sessions = useStore((s) => s.sessions);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const advancedStatsEnabled = useSettingsStore((s) => s.advancedStatsEnabled);
  const setAdvancedStatsEnabled = useSettingsStore((s) => s.setAdvancedStatsEnabled);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const reducedMotion = useReducedMotion();

  const toggleAdvancedStats = (v: boolean) => {
    configureLayoutAnimation(reducedMotion);
    setAdvancedStatsEnabled(v);
  };

  const stats = useMemo(() => aggregate(sessions), [sessions]);
  const comparisons = useMemo(() => topComparisons(stats.foc).slice(0, TOP_N), [stats.foc]);
  const best = useMemo(() => bestDay(sessions), [sessions]);
  const trend = useMemo(() => lastNDays(sessions), [sessions]);
  const topics = useMemo(
    () => topicBreakdownWithCustom(sessions, customLabels, themeMode),
    [sessions, customLabels, themeMode],
  );

  const trendMax = Math.max(1, ...trend.map((d) => d.focusS));
  const topicMax = Math.max(1, ...topics.map((t) => t.focusS));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.h1, { color: c.text }]}>Stats</Text>

      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <Text style={[styles.label, { color: c.textDim }]}>Total focus time</Text>
        <Text style={[styles.big, { color: c.accent }]}>{formatDuration(stats.foc)}</Text>
        <Text style={[styles.sub, { color: c.textDim }]}>
          across {stats.n} session{stats.n === 1 ? '' : 's'}
        </Text>
        {stats.n > 0 && (
          <View style={styles.miniRow}>
            <MiniStat label="Completed" value={`${completionRate(stats)}%`} color={c} />
            <MiniStat label="Streak" value={String(stats.str)} color={c} />
            <MiniStat label="Longest" value={formatDuration(stats.lng)} color={c} />
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <Text style={[styles.h2, { color: c.text }]}>Fun facts</Text>
        {stats.foc <= 0 ? (
          <Text style={[styles.sub, { color: c.textDim }]}>
            Start a focus session to see how it stacks up.
          </Text>
        ) : (
          <>
            {best && (
              <View style={[styles.bestDay, { backgroundColor: withAlpha(c.accent, 0.12) }]}>
                <Feather name="award" size={16} color={c.accent} />
                <Text style={[styles.fact, styles.bestDayText, { color: c.text }]}>
                  Your best day was{' '}
                  {new Date(best.dateMs).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  -- {formatDuration(best.focusS)} focused.
                </Text>
              </View>
            )}
            {comparisons.map((cmp) => (
              <View key={cmp.ref.key} style={styles.factRow}>
                <Feather name="zap" size={14} color={c.textDim} />
                <Text style={[styles.fact, { color: c.text }]}>{formatComparison(cmp)}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <View style={styles.switchRow}>
          <Text style={[styles.h2, { color: c.text, marginBottom: 0 }]}>Advanced stats</Text>
          <Switch value={advancedStatsEnabled} onValueChange={toggleAdvancedStats} />
        </View>
        <Text style={[styles.sub, { color: c.textDim }]}>
          Trend over the last week, plus a breakdown by what you tagged each session as
          from the Focus tab.
        </Text>
      </View>

      {advancedStatsEnabled && (
        <>
          <View style={[styles.card, { backgroundColor: c.surface }]}>
            <Text style={[styles.h2, { color: c.text }]}>Last 7 days</Text>
            <View style={styles.trendRow}>
              {trend.map((d) => {
                const h = Math.max(3, Math.round((d.focusS / trendMax) * TREND_BAR_MAX_H));
                return (
                  <View key={d.key} style={styles.trendCol}>
                    <View style={[styles.trendTrack, { height: TREND_BAR_MAX_H, backgroundColor: withAlpha(c.accent, 0.12) }]}>
                      <AnimatedFill axis="height" toValue={h} style={styles.trendBar} color={c.accent} />
                    </View>
                    <Text style={[styles.trendLabel, { color: c.textDim }]}>{d.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface }]}>
            <Text style={[styles.h2, { color: c.text }]}>By topic</Text>
            {topics.length === 0 ? (
              <Text style={[styles.sub, { color: c.textDim }]}>
                Tag a session on the Focus tab while it's running to see the split here.
              </Text>
            ) : (
              topics.map((t) => (
                <View key={t.key} style={styles.topicRow}>
                  <View style={styles.topicHeader}>
                    <Text style={[styles.topicLabel, { color: c.text }]}>{t.label}</Text>
                    <Text style={[styles.topicValue, { color: c.textDim }]}>
                      {formatDuration(t.focusS)} · {t.n} session{t.n === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={[styles.topicTrack, { backgroundColor: withAlpha(t.color, 0.15) }]}>
                    <AnimatedFill
                      axis="width"
                      toValue={Math.max(4, Math.round((t.focusS / topicMax) * 100))}
                      style={styles.topicFill}
                      color={t.color}
                    />
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.miniStat}>
      <Text style={[styles.miniValue, { color: color.text }]}>{value}</Text>
      <Text style={[styles.miniLabel, { color: color.textDim }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 16, paddingBottom: 60 },
  h1: { ...typeScale.title, marginBottom: 4 },
  h2: { ...typeScale.sectionTitle, marginBottom: 8 },
  card: { borderRadius: 14, padding: 16, gap: 6, ...elevation.card },
  label: { fontSize: 13, letterSpacing: typeScale.label.letterSpacing, lineHeight: typeScale.label.lineHeight },
  big: { ...typeScale.display },
  sub: { ...typeScale.body },
  fact: { fontSize: 15, letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight, flex: 1 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  bestDay: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 10, marginBottom: 6 },
  bestDayText: { fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  miniRow: { flexDirection: 'row', gap: 20, marginTop: 8 },
  miniStat: { alignItems: 'flex-start' },
  miniValue: { fontSize: 18, fontWeight: '700', letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 22 },
  miniLabel: { fontSize: 12, marginTop: 2, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  trendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 },
  trendCol: { alignItems: 'center', gap: 6, flex: 1 },
  trendTrack: { width: 18, borderRadius: 9, justifyContent: 'flex-end', overflow: 'hidden' },
  trendBar: { width: '100%', borderRadius: 9 },
  trendLabel: { ...typeScale.caption },
  topicRow: { gap: 6, marginTop: 4 },
  topicHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  topicLabel: { fontSize: 14, fontWeight: '600', letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
  topicValue: { fontSize: 12, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  topicTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  topicFill: { height: '100%', borderRadius: 5 },
});
