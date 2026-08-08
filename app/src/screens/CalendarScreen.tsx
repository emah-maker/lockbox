// CalendarScreen.tsx -- month grid over the local session log (sessionHistory
// via useStore.sessions). Each day with focus time gets a dot; tapping a day
// lists that day's sessions below the grid.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { formatDuration } from '../stats/stats';
import { dayKey, groupByDay, LoggedSession } from '../stats/sessionHistory';
import { dominantTopic, topicColor, TOPIC_LABELS, TopicKey } from '../stats/topics';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function buildGrid(monthStart: Date): (Date | null)[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = monthStart.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function CalendarScreen() {
  const c = useTheme();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const sessions = useStore((s) => s.sessions);
  const [cursor, setCursor] = useState(startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState<string>(dayKey(Date.now()));

  const byDay = useMemo(() => groupByDay(sessions), [sessions]);
  const grid = useMemo(() => buildGrid(cursor), [cursor]);
  const todayKey = dayKey(Date.now());

  const maxFocus = useMemo(() => {
    let max = 0;
    for (const list of byDay.values()) {
      const total = list.reduce((sum, s) => sum + s.actualS, 0);
      if (total > max) max = total;
    }
    return max || 1;
  }, [byDay]);

  const selectedSessions: LoggedSession[] = byDay.get(selectedKey) ?? [];

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.h1, { color: c.text }]}>Focus Calendar</Text>

      <View style={styles.monthHeader}>
        <Pressable
          onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          <Text style={[styles.nav, { color: c.accent }]}>{'<'}</Text>
        </Pressable>
        <Text style={[styles.monthLabel, { color: c.text }]}>
          {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable
          onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        >
          <Text style={[styles.nav, { color: c.accent }]}>{'>'}</Text>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((w, i) => (
          <Text key={i} style={[styles.weekday, { color: c.textDim }]}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {grid.map((date, i) => {
          if (!date) return <View key={i} style={styles.cell} />;
          const key = dayKey(date.getTime());
          const daySessions = byDay.get(key) ?? [];
          const focusS = daySessions.reduce((sum, s) => sum + s.actualS, 0);
          const intensity = focusS > 0 ? 0.25 + 0.75 * Math.min(1, focusS / maxFocus) : 0;
          const selected = key === selectedKey;
          const isToday = key === todayKey;
          const dominant = dominantTopic(daySessions, themeMode);
          return (
            <Pressable key={i} style={styles.cell} onPress={() => setSelectedKey(key)}>
              <View
                style={[
                  styles.dayCircle,
                  selected && { borderColor: c.accent, borderWidth: 2 },
                  isToday && !selected && { borderColor: c.textDim, borderWidth: 1 },
                  focusS > 0 && { backgroundColor: withAlpha(c.accent, intensity) },
                ]}
              >
                <Text style={[styles.dayNum, { color: focusS > 0 ? c.accentText : c.text }]}>
                  {date.getDate()}
                </Text>
              </View>
              {dominant && <View style={[styles.topicDot, { backgroundColor: dominant.color }]} />}
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <Text style={[styles.h2, { color: c.text }]}>
          {new Date(selectedKey).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
        </Text>
        {selectedSessions.length === 0 ? (
          <Text style={[styles.empty, { color: c.textDim }]}>No focus sessions logged this day.</Text>
        ) : (
          selectedSessions.map((s, i) => {
            const topicKey = s.topic as TopicKey | undefined;
            const known = topicKey && topicKey in TOPIC_LABELS;
            return (
              <View key={i} style={styles.sessionRow}>
                <Text style={[styles.sessionTime, { color: c.textDim }]}>
                  {new Date(s.startedAt).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
                <Text style={[styles.sessionDuration, { color: c.text }]}>
                  {formatDuration(s.actualS)}
                </Text>
                <View style={styles.sessionTopic}>
                  {known && (
                    <>
                      <View style={[styles.topicDotInline, { backgroundColor: topicColor(topicKey!, themeMode) }]} />
                      <Text style={[styles.sessionTopicLabel, { color: c.textDim }]}>{TOPIC_LABELS[topicKey!]}</Text>
                    </>
                  )}
                </View>
                <Text
                  style={[
                    styles.sessionOutcome,
                    { color: s.outcome === 'completed' ? c.accent : c.warn },
                  ]}
                >
                  {s.outcome === 'completed' ? 'Completed' : 'Ended early'}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 16 },
  h1: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthLabel: { fontSize: 17, fontWeight: '600' },
  nav: { fontSize: 22, fontWeight: '700', paddingHorizontal: 12 },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNum: { fontSize: 13, fontWeight: '600' },
  topicDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 3 },
  card: { borderRadius: 14, padding: 16 },
  empty: { fontSize: 14 },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  sessionTime: { fontSize: 13, width: 80 },
  sessionDuration: { fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'center' },
  sessionTopic: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 80 },
  topicDotInline: { width: 8, height: 8, borderRadius: 4 },
  sessionTopicLabel: { fontSize: 12 },
  sessionOutcome: { fontSize: 12, width: 90, textAlign: 'right' },
});
