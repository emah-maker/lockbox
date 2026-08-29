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
//
// This card now shares a flex:1 budget with TrendCard instead of sizing
// itself to however many topics exist (see "every period fits one screen"
// brief) -- the donut shrank (InteractiveTopicDonut's own size/strokeWidth
// props) and only the
// first two rows render inline; anything past that is a "See all N topics"
// tap into a Sheet (StatsScreen's allTopicsSheetOpen) that reuses this same
// row markup via the exported TopicRows, so the two surfaces can't drift
// apart the way two copies of the same JSX would.
import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme/useTheme';
import { formatDuration } from '../../stats/stats';
import { LabelStat } from '../../stats/customLabels';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { elevation, hitSlop, typeScale } from '../../theme/tokens';
import { InteractiveTopicDonut } from './InteractiveTopicDonut';

// Inline row cap -- past this many topics, the remainder are a tap away in
// the "See all" sheet rather than pushing this card past its flex:1 share of
// the no-scroll layout (see header comment).
const INLINE_ROWS = 2;
// InteractiveTopicDonut defaults to 132/18 (sized for when this card owned
// its whole content height); shrunk to fit alongside two rows of text and a
// title within TopicCard's much smaller flex:1 share.
const DONUT_SIZE = 76;
const DONUT_STROKE = 12;

/** The per-topic row markup, shared between this card's inline list and the
 * "See all" sheet's full list -- factored out so the two surfaces render
 * identically instead of maintaining two copies that could drift apart. */
export function TopicRows({
  topics,
  onInspectTopic,
}: {
  topics: LabelStat[];
  onInspectTopic: (key: string) => void;
}) {
  const c = useTheme();
  return (
    <>
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
            <Text style={[styles.topicLabel, { color: c.text }]} numberOfLines={1}>
              {t.label}
            </Text>
            <Text style={[styles.topicValue, { color: c.textDim }]}>
              {formatDuration(t.focusS)} · {t.n} session{t.n === 1 ? '' : 's'}
            </Text>
          </View>
        </AnimatedPressable>
      ))}
    </>
  );
}

export function TopicCard({
  topics,
  selectedKey,
  onSelectTopic,
  onInspectTopic,
  onSeeAllTopics,
  style,
}: {
  topics: LabelStat[];
  selectedKey: string | null;
  onSelectTopic: (key: string | null) => void;
  onInspectTopic: (key: string) => void;
  /** Opens the full topic list in its own Sheet -- only rendered as a row
   * when `topics.length` exceeds INLINE_ROWS. */
  onSeeAllTopics: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const inline = topics.slice(0, INLINE_ROWS);
  const overflow = topics.length - inline.length;

  return (
    <View style={[styles.card, { backgroundColor: c.surface }, style]}>
      <View style={styles.headerRow}>
        <Text style={[styles.h2, { color: c.text }]}>By topic</Text>
        {selectedKey ? (
          <AnimatedPressable
            onPress={() => onSelectTopic(null)}
            accessibilityRole="button"
            accessibilityLabel="Clear topic filter"
            hitSlop={hitSlop.text}
          >
            <Text style={[styles.clear, { color: c.accent }]}>Clear filter</Text>
          </AnimatedPressable>
        ) : null}
      </View>
      {topics.length === 0 ? (
        <Text style={[styles.sub, { color: c.textDim }]}>
          Tag a session on the Home tab while it's running to see the split here.
        </Text>
      ) : (
        <View style={styles.body}>
          <View style={styles.donutRow}>
            <InteractiveTopicDonut
              segments={topics.map((t) => ({ key: t.key, focusS: t.focusS, color: t.color }))}
              selectedKey={selectedKey}
              onSelect={onSelectTopic}
              size={DONUT_SIZE}
              strokeWidth={DONUT_STROKE}
            />
          </View>
          <View style={styles.rowsCol}>
            <TopicRows topics={inline} onInspectTopic={onInspectTopic} />
            {overflow > 0 ? (
              <AnimatedPressable
                onPress={() => {
                  Haptics.selectionAsync();
                  onSeeAllTopics();
                }}
                accessibilityRole="button"
                accessibilityLabel={`See all ${topics.length} topics`}
                hitSlop={hitSlop.text}
              >
                <Text style={[styles.seeAll, { color: c.accent }]}>See all {topics.length} topics ›</Text>
              </AnimatedPressable>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 12, gap: 6, ...elevation.card },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h2: { ...typeScale.sectionTitle },
  clear: { ...typeScale.label },
  sub: { ...typeScale.body },
  // Donut beside the rows rather than stacked above them -- stacking would
  // cost this card a whole extra row of height it no longer has to spend
  // (see header comment on the shared flex:1 budget).
  body: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  donutRow: { alignItems: 'center', justifyContent: 'center' },
  rowsCol: { flex: 1, gap: 4 },
  topicRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  topicSwatch: { width: 10, height: 10, borderRadius: 5, marginBottom: 2 },
  topicHeader: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  topicLabel: { fontSize: 14, fontWeight: '600', letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight, flexShrink: 1 },
  topicValue: { fontSize: 12, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  seeAll: { ...typeScale.label, marginTop: 2 },
});
