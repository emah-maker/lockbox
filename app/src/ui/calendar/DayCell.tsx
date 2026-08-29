// DayCell.tsx -- one grid cell for CalendarScreen's month view. Split out
// (per this project's 500-line file guideline, and to isolate the SVG goal
// ring/topic-stack rendering from the screen's own layout/state code) so it
// can be unit-visually-reasoned-about on its own: given a date + that day's
// derived numbers, render it. No store reads, no navigation -- purely a
// dumb, memo-friendly leaf.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPressable } from '../AnimatedPressable';
import { bestTextOn, blendOver, ThemeColors, withAlpha } from '../../theme/theme';
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

// The single source of truth mapping a discrete heat level (stats/trend.ts's
// heatmapLevel, now also monthGrid.ts's monthHeatLevels) to a fill alpha.
// Exported so HeatLegend.tsx's swatches are built from the exact same table
// this cell's own background comes from -- that's what guarantees the
// legend and the grid never drift apart the way the old continuous-alpha
// scheme and trend.ts's discrete one silently did.
export const ALPHA_FOR_LEVEL: Record<0 | 1 | 2 | 3 | 4, number> = {
  0: 0,
  1: 0.25,
  2: 0.5,
  3: 0.75,
  4: 1,
};

/** Text color for the day number, given this cell's own heat level.
 *
 * Previously `focusS > 0 ? theme.accentText : theme.text`, which is wrong
 * for every level except 4: `accentText` is contrast-tuned against the
 * accent at FULL strength, but levels 1-3 draw the circle as a 25/50/75%
 * accent tint over `bg`, which resolves much closer to the page background
 * than to the accent. Measured across all 8 accents in both modes, the old
 * rule put the day number at 1.33-1.53:1 on a level-1 cell and 2.17-3.08:1
 * on a level-2 one -- i.e. the busiest thing the calendar is trying to say
 * ("this day had focus time") was rendered in a color you could not read.
 *
 * Rather than hardcode a threshold level (the right answer flips between
 * light and dark at level 3), this composites the actual fill and asks
 * which of the two candidate colors wins on that pixel -- correct for every
 * (mode, accent, level) combination by construction, including any accent
 * added later. `accentText` is passed first so it keeps winning ties at
 * level 4, where it is the deliberate choice. */
export function dayNumColor(theme: ThemeColors, level: 0 | 1 | 2 | 3 | 4): string {
  if (level === 0) return theme.text;
  const fill = blendOver(theme.accent, theme.bg, ALPHA_FOR_LEVEL[level]);
  return bestTextOn(fill, theme.accentText, theme.text);
}

export function DayCell({
  date,
  focusS,
  level,
  topicStats,
  goalMet,
  selected,
  isToday,
  theme,
  onPress,
  streakEdge,
  showFlame,
}: {
  date: Date;
  focusS: number;
  /** Discrete heat level (monthGrid.ts's monthHeatLevels, itself routed
   * through stats/trend.ts's heatmapLevel) -- replaces the old continuous
   * `maxFocus`-relative alpha. Looked up through the exported
   * `ALPHA_FOR_LEVEL` table below for the cell's own fill; HeatLegend.tsx
   * reads the exact same table for its swatches, so the two can't drift. */
  level: 0 | 1 | 2 | 3 | 4;
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
  /** Whether this cell sits inside a streak run (monthGrid.ts's
   * computeStreakRuns) alongside its immediate left/right grid neighbour --
   * drawn as a thin connector bar reaching toward that neighbour so a run of
   * days reads as one connected chain instead of a row of isolated dots.
   * Undefined/omitted draws no connector, same as both false. */
  streakEdge?: { left: boolean; right: boolean };
  /** Small flame badge (Ionicons "flame") marking the most recent day of a
   * streak run -- CalendarScreen.tsx only sets this for runs of length >= 3
   * (see its own comment), so a casual 2-day pair doesn't litter the grid. */
  showFlame?: boolean;
}) {
  const dayA11yLabel = `${date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })}${focusS > 0 ? `, ${formatDuration(focusS)} focused` : ', no focus time'}${goalMet ? ', goal met' : ''}${
    showFlame ? ', streak' : ''
  }`;

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
      {streakEdge?.left && (
        <View
          pointerEvents="none"
          style={[styles.connector, styles.connectorLeft, { backgroundColor: withAlpha(theme.accent, 0.35) }]}
        />
      )}
      {streakEdge?.right && (
        <View
          pointerEvents="none"
          style={[styles.connector, styles.connectorRight, { backgroundColor: withAlpha(theme.accent, 0.35) }]}
        />
      )}
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
            level > 0 && { backgroundColor: withAlpha(theme.accent, ALPHA_FOR_LEVEL[level]) },
          ]}
        >
          <Text style={[styles.dayNum, { color: dayNumColor(theme, level) }]}>{date.getDate()}</Text>
        </View>
        {showFlame && (
          <View style={[styles.flameBadge, { backgroundColor: theme.surface }]}>
            <Ionicons name="flame" size={10} color={theme.warn} />
          </View>
        )}
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
  // Absolutely positioned within `cell` (View's default `position: relative`
  // needs no extra style here), rendered before `ringWrap` in JSX so it
  // paints behind the day circle without an explicit zIndex. Each half
  // spans from the cell's own edge to its horizontal center, so a run's
  // adjacent cells' bars meet exactly at the shared cell boundary and read
  // as one continuous chain rather than two separate stubs.
  connector: { position: 'absolute', height: 4, borderRadius: 2, top: '50%', marginTop: -2 },
  connectorLeft: { left: 0, width: '50%' },
  connectorRight: { right: 0, width: '50%' },
  flameBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
