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
import { ThemeColors } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { dayNumColor, heatFill, HeatLevel } from '../../theme/dayHeat';
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
// Same reasoning as MAX_STACK_SEGMENTS just above, applied to the streak dot
// row below it -- a user can opt as many as MAX_GOALS (goals.ts, 20) goals
// into the calendar's streak view, and a 20-dot row in a ~34px-wide cell
// would be unreadable static, not information. The day sheet (one tap away)
// already lists every goal's exact status; this row is a glance-level hint,
// same job MAX_STACK_SEGMENTS does for the topic stack.
const MAX_STREAK_DOTS = 4;
const STREAK_DOT_SIZE = 5;

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
  hasPlan,
  streakDots,
}: {
  date: Date;
  focusS: number;
  /** Discrete heat level (monthGrid.ts's monthHeatLevels, itself routed
   * through stats/trend.ts's heatmapLevel) -- replaces the old continuous
   * `maxFocus`-relative alpha. Looked up through the exported
   * `ALPHA_FOR_LEVEL` table below for the cell's own fill; HeatLegend.tsx
   * reads the exact same table for its swatches, so the two can't drift. */
  level: HeatLevel;
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
  /** Whether this day has at least one scheduled focus session still
   * outstanding (schedule/scheduledSessions.ts, via CalendarScreen). Drawn
   * as a small dot on the opposite corner from the flame badge, so a day
   * can carry both without them overlapping.
   *
   * A dot, not a count: the number of things you planned is not something
   * worth reading at a glance from a 34px circle, and the day sheet lists
   * them the moment you tap. Deliberately a DIFFERENT mark from the goal
   * ring and the heat fill, both of which describe what already happened --
   * this is the one mark on the grid that points forward. */
  hasPlan?: boolean;
  /** Per-goal streak dot row (Goal Streaks feature) -- one entry per
   * VISIBLE goal (CalendarScreen.tsx has already filtered to the user's
   * calendar-streak picker selection, see useSettingsStore's
   * calendarStreakGoalIds) that is actually due this day. A goal that
   * wasn't due this day (Goal.daysOfWeek off day) is simply absent from
   * this array entirely -- never present with `met: false` -- so an off day
   * never draws a dot that would misread as a miss (same "not due, never a
   * miss" rule stats/goalStreakHistory.ts's goalDayStatuses documents for
   * itself). `undefined`/`[]` both draw no row at all, same convention as
   * `topicStats`/`stackSegments` below drawing nothing for an empty day. */
  streakDots?: { key: string; color: string; met: boolean }[];
}) {
  const dueTrackedCount = streakDots?.length ?? 0;
  const metTrackedCount = streakDots?.filter((d) => d.met).length ?? 0;
  const dayA11yLabel = `${date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })}${focusS > 0 ? `, ${formatDuration(focusS)} focused` : ', no focus time'}${goalMet ? ', goal met' : ''}${
    showFlame ? ', streak' : ''
  }${hasPlan ? ', has a planned session' : ''}${
    dueTrackedCount > 0 ? `, ${metTrackedCount} of ${dueTrackedCount} tracked goal streaks on track` : ''
  }`;

  const stackTotal = topicStats.reduce((sum, t) => sum + t.focusS, 0);
  const stackSegments = topicStats.slice(0, MAX_STACK_SEGMENTS);
  const dotSegments = (streakDots ?? []).slice(0, MAX_STREAK_DOTS);

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
            level > 0 && { backgroundColor: heatFill(theme, level) },
          ]}
        >
          <Text style={[styles.dayNum, { color: dayNumColor(theme, level) }]}>{date.getDate()}</Text>
        </View>
        {showFlame && (
          <View style={[styles.flameBadge, { backgroundColor: theme.surface }]}>
            <Ionicons name="flame" size={10} color={theme.warn} />
          </View>
        )}
        {hasPlan && (
          <View
            pointerEvents="none"
            style={[styles.planDot, { backgroundColor: theme.accent, borderColor: theme.surface }]}
          />
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
      {dotSegments.length > 0 && (
        <View style={styles.streakDotsRow}>
          {dotSegments.map((d) => (
            // Met: a solid dot in the goal's own swatch color. Missed: the
            // SAME swatch drawn hollow (a ring, not a fill) rather than in a
            // second "miss" color -- a red/grey dot next to a green goal-met
            // ring would read as a second, competing status system on the
            // same cell (this file's own header calls out not fighting the
            // existing heat map, and a loud miss color is exactly the kind
            // of visual competition that warns against). A dimmer, outlined
            // version of the goal's own color reads as "this goal, not hit
            // today" without shouting over everything else in the cell.
            <View
              key={d.key}
              style={[
                styles.streakDot,
                d.met
                  ? { backgroundColor: d.color }
                  : { backgroundColor: 'transparent', borderWidth: 1, borderColor: withAlpha(d.color, 0.6) },
              ]}
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
  // Top-LEFT, opposite the flame badge's top-right, so a day that is both
  // the tip of a streak and has something planned shows both marks. The
  // surface-colored border is what keeps it legible when the day circle
  // underneath is at a high heat level.
  planDot: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1.5,
  },
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
  // A second slim row below the topic stack, same CIRCLE_SIZE width so it
  // stays visually aligned with the stack row above it and the circle above
  // that. See CalendarScreen.tsx's MIN_CELL_SIZE comment for the fixed-px
  // footprint this adds to every cell's own content height.
  streakDotsRow: {
    flexDirection: 'row',
    width: CIRCLE_SIZE,
    justifyContent: 'center',
    marginTop: 3,
    gap: 3,
  },
  streakDot: { width: STREAK_DOT_SIZE, height: STREAK_DOT_SIZE, borderRadius: STREAK_DOT_SIZE / 2 },
});
