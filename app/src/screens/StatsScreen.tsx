// StatsScreen.tsx -- total focus time plus lighthearted real-world
// comparisons (app/src/stats/comparisons.ts), computed from the local
// session log (useStore.sessions) the same way DashboardScreen's Focus card
// is -- the box keeps no long-term stats of its own to read this from.
//
// A day/week/month/all-time window control scopes both the total and the
// topic breakdown below to the same slice of `sessions` (sessionHistory.ts's
// filterByWindow) -- the 7-day trend chart (stats/trend.ts) and "Fun facts"
// always look at the full history/last-7-days regardless of this control, so
// they read consistently no matter which window is selected. The topic
// breakdown is a no-op on an untagged history -- it just shows a hint instead
// of an empty chart.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { aggregate, formatDuration, completionRate } from '../stats/stats';
import { topComparisons, formatComparison } from '../stats/comparisons';
import { topicBreakdownWithCustom } from '../stats/customLabels';
import { lastNDays, lastNDaysHeatmap, bestDay } from '../stats/trend';
import { filterByWindow, TimeWindow } from '../stats/sessionHistory';
import { getJSON, setJSON } from '../storage/storage';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { AnimatedFill } from '../ui/AnimatedFill';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { TopicDonut } from '../ui/TopicDonut';
import { typeScale, elevation, springs } from '../theme/tokens';

const TOP_N = 5;
const TREND_BAR_MAX_H = 80;
const HEATMAP_OPACITY = [0.08, 0.3, 0.5, 0.72, 1] as const; // index = HeatmapDay.level
const BEST_STREAK_KEY = 'bestStreakSeen';

const WINDOW_OPTIONS: { key: TimeWindow; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All time' },
];

export default function StatsScreen() {
  const c = useTheme();
  const sessions = useStore((s) => s.sessions);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const reducedMotion = useReducedMotion();
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all');

  const selectWindow = (w: TimeWindow) => {
    if (w === timeWindow) return;
    configureLayoutAnimation(reducedMotion);
    setTimeWindow(w);
  };

  const windowedSessions = useMemo(() => filterByWindow(sessions, timeWindow), [sessions, timeWindow]);
  const stats = useMemo(() => aggregate(windowedSessions), [windowedSessions]);
  // Streak is "consecutive completed sessions ending now" -- windowing it by
  // day/week/month would truncate a real streak to whatever fraction of it
  // falls in the selected window (e.g. a 30-day streak would read as "1" the
  // moment "Day" is selected). Computed unwindowed instead, same choice as
  // trend/bestDay below.
  const unwindowedStats = useMemo(() => aggregate(sessions), [sessions]);
  const comparisons = useMemo(() => topComparisons(stats.foc).slice(0, TOP_N), [stats.foc]);
  const best = useMemo(() => bestDay(sessions), [sessions]);
  const trend = useMemo(() => lastNDays(sessions), [sessions]);
  const heatmap = useMemo(() => lastNDaysHeatmap(sessions), [sessions]);
  const topics = useMemo(
    () => topicBreakdownWithCustom(windowedSessions, customLabels, themeMode),
    [windowedSessions, customLabels, themeMode],
  );

  const trendMax = Math.max(1, ...trend.map((d) => d.focusS));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.h1, { color: c.text }]}>Stats</Text>

      <View style={styles.windowRow}>
        {WINDOW_OPTIONS.map((opt) => {
          const active = timeWindow === opt.key;
          return (
            <AnimatedPressable
              key={opt.key}
              style={[
                styles.windowChip,
                { borderColor: withAlpha(c.accent, 0.4) },
                active && { backgroundColor: c.accent, borderColor: c.accent },
              ]}
              onPress={() => selectWindow(opt.key)}
            >
              <Text style={[styles.windowChipText, { color: active ? c.accentText : c.textDim }]}>
                {opt.label}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>

      {/* minHeight reserves the miniRow's space below even on a window with
          zero sessions, so switching windows (or logging the first session)
          doesn't change this card's height and shift everything below it. */}
      <View style={[styles.card, { backgroundColor: c.surface, minHeight: 170 }]}>
        <Text style={[styles.label, { color: c.textDim }]}>Total focus time</Text>
        <AnimatedTotal text={formatDuration(stats.foc)} color={c.accent} reducedMotion={reducedMotion} />
        <Text style={[styles.sub, { color: c.textDim }]}>
          across {stats.n} session{stats.n === 1 ? '' : 's'}
        </Text>
        {stats.n > 0 && (
          <View style={styles.miniRow}>
            <MiniStat label="Completed" value={`${completionRate(stats)}%`} color={c} />
            <StreakStat value={unwindowedStats.str} color={c} reducedMotion={reducedMotion} />
            <MiniStat label="Longest" value={formatDuration(stats.lng)} color={c} />
          </View>
        )}
      </View>

      {/* minHeight ~= one best-day banner + one comparison row, so the empty
          placeholder doesn't leave this noticeably shorter than the typical
          populated state -- can't fully fix an unbounded comparisons list,
          but removes the common small-vs-empty jump. */}
      <View style={[styles.card, { backgroundColor: c.surface, minHeight: 140 }]}>
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
        <Text style={[styles.h2, { color: c.text }]}>Last 5 weeks</Text>
        <View style={styles.heatmapGrid}>
          {heatmap.map((d) => (
            <View
              key={d.key}
              style={[
                styles.heatmapCell,
                { backgroundColor: withAlpha(c.accent, HEATMAP_OPACITY[d.level]) },
              ]}
            />
          ))}
        </View>
      </View>

      {/* minHeight ~= donut + one topic row, same reasoning as the other
          placeholder cards above -- a genuinely long topic list still grows
          past this, which is expected content growth, not the reflow bug
          being fixed here. */}
      <View style={[styles.card, { backgroundColor: c.surface, minHeight: 160 }]}>
        <Text style={[styles.h2, { color: c.text }]}>By topic</Text>
        {topics.length === 0 ? (
          <Text style={[styles.sub, { color: c.textDim }]}>
            Tag a session on the Home tab while it's running to see the split here.
          </Text>
        ) : (
          <>
            <View style={styles.donutRow}>
              <TopicDonut segments={topics.map((t) => ({ key: t.key, focusS: t.focusS, color: t.color }))} />
            </View>
            {topics.map((t) => (
              <View key={t.key} style={styles.topicRow}>
                <View style={[styles.topicSwatch, { backgroundColor: t.color }]} />
                <View style={styles.topicHeader}>
                  <Text style={[styles.topicLabel, { color: c.text }]}>{t.label}</Text>
                  <Text style={[styles.topicValue, { color: c.textDim }]}>
                    {formatDuration(t.focusS)} · {t.n} session{t.n === 1 ? '' : 's'}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

// Pops the total gently whenever its formatted value actually changes (e.g.
// the window control above is switched) instead of snapping straight to the
// new number -- gated to real changes only (skipped on first mount and on
// re-renders where the text is unchanged), same restraint AnimatedFill/
// AnimatedPressable already apply elsewhere on this screen.
function AnimatedTotal({ text, color, reducedMotion }: { text: string; color: string; reducedMotion: boolean }) {
  const pop = useRef(new Animated.Value(1)).current;
  const prevText = useRef(text);

  useEffect(() => {
    if (prevText.current === text) return;
    prevText.current = text;
    if (reducedMotion) return;
    pop.setValue(0.92);
    Animated.spring(pop, { toValue: 1, ...springs.default, useNativeDriver: true }).start();
  }, [text, reducedMotion]);

  return (
    <Animated.Text style={[styles.big, { color, transform: [{ scale: pop }] }]}>{text}</Animated.Text>
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

/** Same as MiniStat, but pulses once the moment `value` (the current streak)
 * actually beats the best streak this device has ever seen -- not on every
 * render, and not on every day an existing streak just continues. The best
 * seen so far persists in storage (BEST_STREAK_KEY) so the milestone is a
 * real personal record across app restarts, not just within one mount. */
function StreakStat({
  value,
  color,
  reducedMotion,
}: {
  value: number;
  color: ReturnType<typeof useTheme>;
  reducedMotion: boolean;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  const checkedValueRef = useRef<number | null>(null);

  useEffect(() => {
    if (value <= 0 || checkedValueRef.current === value) return;
    checkedValueRef.current = value;
    let cancelled = false;
    getJSON<number>(BEST_STREAK_KEY, 0).then((best) => {
      if (cancelled || value <= best) return;
      setJSON(BEST_STREAK_KEY, value);
      if (reducedMotion) return;
      pulse.setValue(1.4);
      Animated.spring(pulse, { toValue: 1, ...springs.default, useNativeDriver: true }).start();
    });
    return () => {
      cancelled = true;
    };
  }, [value, reducedMotion, pulse]);

  return (
    <View style={styles.miniStat}>
      <Animated.Text style={[styles.miniValue, { color: color.text, transform: [{ scale: pulse }] }]}>
        {value}
      </Animated.Text>
      <Text style={[styles.miniLabel, { color: color.textDim }]}>Streak</Text>
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
  windowRow: { flexDirection: 'row', gap: 8 },
  windowChip: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, borderWidth: 1.5 },
  windowChipText: { ...typeScale.label, fontWeight: '600' },
  miniRow: { flexDirection: 'row', gap: 20, marginTop: 8 },
  miniStat: { alignItems: 'flex-start' },
  miniValue: { fontSize: 18, fontWeight: '700', letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 22 },
  miniLabel: { fontSize: 12, marginTop: 2, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  trendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 },
  trendCol: { alignItems: 'center', gap: 6, flex: 1 },
  trendTrack: { width: 18, borderRadius: 9, justifyContent: 'flex-end', overflow: 'hidden' },
  trendBar: { width: '100%', borderRadius: 9 },
  trendLabel: { ...typeScale.caption },
  donutRow: { alignItems: 'center', marginVertical: 8 },
  topicRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8 },
  topicSwatch: { width: 10, height: 10, borderRadius: 5, marginBottom: 2 },
  topicHeader: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  topicLabel: { fontSize: 14, fontWeight: '600', letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
  topicValue: { fontSize: 12, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  heatmapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  heatmapCell: { width: 14, height: 14, borderRadius: 3 },
});
