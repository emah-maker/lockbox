// TopicCard.tsx -- the "By topic" card, extracted from StatsScreen.tsx
// (500-line-guideline split) and made interactive per this task's brief:
//   - tapping a donut slice (InteractiveTopicDonut) filters the whole
//     screen to that topic -- `selectedKey`/`onSelectTopic` are lifted to
//     StatsScreen so the same filter also narrows the total/trend/heatmap
//     cards above, not just this one.
//   - tapping a topic row instead opens a detail popup with that topic's
//     own sessions (`onInspectTopic`) -- a different gesture target
//     (row vs. donut arc) for a deliberately different action (filter vs.
//     detail), per the task's own split between "chart segments open a
//     detail popup" and "the donut filters".
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme/useTheme';
import { formatDuration } from '../../stats/stats';
import { LabelStat } from '../../stats/customLabels';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { typeScale, elevation } from '../../theme/tokens';
import { InteractiveTopicDonut } from './InteractiveTopicDonut';

export function TopicCard({
  topics,
  selectedKey,
  onSelectTopic,
  onInspectTopic,
}: {
  topics: LabelStat[];
  selectedKey: string | null;
  onSelectTopic: (key: string | null) => void;
  onInspectTopic: (key: string) => void;
}) {
  const c = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: c.surface, minHeight: 160 }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.h2, { color: c.text }]}>By topic</Text>
        {selectedKey ? (
          <AnimatedPressable onPress={() => onSelectTopic(null)} accessibilityRole="button">
            <Text style={[styles.clear, { color: c.accent }]}>Clear filter</Text>
          </AnimatedPressable>
        ) : null}
      </View>
      {topics.length === 0 ? (
        <Text style={[styles.sub, { color: c.textDim }]}>
          Tag a session on the Home tab while it's running to see the split here.
        </Text>
      ) : (
        <>
          <View style={styles.donutRow}>
            <InteractiveTopicDonut
              segments={topics.map((t) => ({ key: t.key, focusS: t.focusS, color: t.color }))}
              selectedKey={selectedKey}
              onSelect={onSelectTopic}
            />
          </View>
          {topics.map((t) => (
            <AnimatedPressable
              key={t.key}
              style={styles.topicRow}
              onPress={() => {
                Haptics.selectionAsync();
                onInspectTopic(t.key);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${t.label}, ${formatDuration(t.focusS)}, ${t.n} sessions. View sessions.`}
            >
              <View style={[styles.topicSwatch, { backgroundColor: t.color }]} />
              <View style={styles.topicHeader}>
                <Text style={[styles.topicLabel, { color: c.text }]}>{t.label}</Text>
                <Text style={[styles.topicValue, { color: c.textDim }]}>
                  {formatDuration(t.focusS)} · {t.n} session{t.n === 1 ? '' : 's'}
                </Text>
              </View>
            </AnimatedPressable>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, gap: 6, ...elevation.card },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h2: { ...typeScale.sectionTitle },
  clear: { ...typeScale.label },
  sub: { ...typeScale.body },
  donutRow: { alignItems: 'center', marginVertical: 8 },
  topicRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8 },
  topicSwatch: { width: 10, height: 10, borderRadius: 5, marginBottom: 2 },
  topicHeader: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  topicLabel: { fontSize: 14, fontWeight: '600', letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
  topicValue: { fontSize: 12, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
});
