// DayCell.tsx -- one grid cell for CalendarScreen's month view. Split out
// (per this project's 500-line file guideline, and to isolate the SVG goal
// ring/topic-stack rendering from the screen's own layout/state code) so it
// can be unit-visually-reasoned-about on its own: given a date + that day's
// derived numbers, render it. No store reads, no navigation -- purely a
// dumb, memo-friendly leaf.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AnimatedPressable } from '../AnimatedPressable';
import { ThemeColors, withAlpha } from '../../theme/theme';
import { typeScale } from '../../theme/tokens';
import { formatDuration } from '../../stats/stats';
import type { LabelStat } from '../../stats/customLabels';

const CIRCLE_SIZE = 34;
const RING_SIZE = CIRCLE_SIZE + 6;
const RING_STROKE = 2;
// Cap the topic stack to the top N topics so a day with many different tags
// doesn't turn into an unreadable sliver of colors -- the day's full
// breakdown is always one tap away in the detail sheet, this is just a
// glance-level hint of "how mixed was this day".
const MAX_STACK_SEGMENTS = 4;

export function DayCell({
  date,
  focusS,
  maxFocus,
  topicStats,
  goalMet,
  selected,
  isToday,
  theme,
  onPress,
}: {
  date: Date;
  focusS: number;
  maxFocus: number;
  /** This day's topic breakdown (stats/customLabels.ts's
   * topicBreakdownWithCustom), already sorted highest-focus-first. */
  topicStats: LabelStat[];
  /** Whether any active goal's window containing this day was satisfied
   * (monthGrid.ts's goalsMetOnDay) -- drawn as a ring around the day circle
   * rather than a second badge, since which specific goal(s) is answered by
   * opening the day (the detail sheet lists them by name). */
  goalMet: boolean;
  selected: boolean;
  isToday: boolean;
  theme: ThemeColors;
  onPress: () => void;
}) {
  const intensity = focusS > 0 ? 0.25 + 0.75 * Math.min(1, focusS / maxFocus) : 0;
  const dayA11yLabel = `${date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })}${focusS > 0 ? `, ${formatDuration(focusS)} focused` : ', no focus time'}${goalMet ? ', goal met' : ''}`;

  const stackTotal = topicStats.reduce((sum, t) => sum + t.focusS, 0);
  const stackSegments = topicStats.slice(0, MAX_STACK_SEGMENTS);

  return (
    <AnimatedPressable
      style={styles.cell}
      accessibilityRole="button"
      accessibilityLabel={dayA11yLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      <View style={styles.ringWrap}>
        {goalMet && (
          <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={(RING_SIZE - RING_STROKE) / 2}
              stroke={theme.success}
              strokeWidth={RING_STROKE}
              fill="none"
            />
          </Svg>
        )}
        <View
          style={[
            styles.dayCircle,
            selected && { borderColor: theme.accent, borderWidth: 2 },
            isToday && !selected && { borderColor: theme.textDim, borderWidth: 1 },
            focusS > 0 && { backgroundColor: withAlpha(theme.accent, intensity) },
          ]}
        >
          <Text style={[styles.dayNum, { color: focusS > 0 ? theme.accentText : theme.text }]}>
            {date.getDate()}
          </Text>
        </View>
      </View>
      {stackSegments.length > 0 && (
        <View style={styles.stackRow}>
          {stackSegments.map((t) => (
            <View
              key={t.key}
              style={[styles.stackSegment, { backgroundColor: t.color, flex: t.focusS / stackTotal }]}
            />
          ))}
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  cell: { width: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  dayCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNum: { ...typeScale.label },
  stackRow: {
    flexDirection: 'row',
    width: CIRCLE_SIZE,
    height: 3,
    marginTop: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
    gap: 1,
  },
  stackSegment: { height: 3 },
});
