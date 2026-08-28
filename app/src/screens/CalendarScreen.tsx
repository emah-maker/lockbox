// CalendarScreen.tsx -- month grid over the local session log (sessionHistory
// via useStore.sessions). Each day gets a heat-tinted circle (focus minutes),
// a small topic stack (stats/customLabels.ts's topicBreakdownWithCustom),
// and a goal-met ring (goalProgress.ts, via monthGrid.ts's goalsMetOnDay).
// Tapping a day no longer grows an inline panel below the grid (manager
// brief: this app's screens should not "expand up and down") -- it opens
// DaySheet.tsx in a `Sheet` instead, so the grid itself stays a stable,
// fixed-height view. Most of the day-cell/summary-strip/recent-row rendering
// lives in src/ui/calendar/* and src/screens/calendar/* (split out to stay
// under this project's 500-line file guideline -- this file was already
// over budget before this pass).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated, Easing, PanResponder } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useTheme } from '../theme/useTheme';
import { dayKey, groupByDay, LoggedSession } from '../stats/sessionHistory';
import { topicBreakdownWithCustom } from '../stats/customLabels';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { DayCell } from '../ui/calendar/DayCell';
import { MonthSummaryStrip } from '../ui/calendar/MonthSummaryStrip';
import { HeatLegend } from '../ui/calendar/HeatLegend';
import { RecentSessionsRow } from '../ui/calendar/RecentSessionsRow';
import { DaySheet } from './calendar/DaySheet';
import {
  buildGrid,
  computeMonthSummary,
  computeStreakRuns,
  goalsMetOnDay,
  monthHeatLevels,
  startOfMonth,
} from './calendar/monthGrid';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { typeScale } from '../theme/tokens';
import { useNav } from '../nav/useNav';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A horizontal drag past this many px (released, not just moved) counts as a
// deliberate "change month" swipe rather than an incidental brush while
// scrolling the page vertically -- same rough threshold apple-design's
// gesture guidance uses for a "commit" swipe, and the onMoveShouldSetPanResponder
// check below already requires the gesture to be more horizontal than
// vertical before this responder even claims it.
const SWIPE_THRESHOLD = 50;
const MONTH_SLIDE_DISTANCE = 24;
const MONTH_SLIDE_DURATION = 220;

export default function CalendarScreen() {
  const c = useTheme();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const sessions = useStore((s) => s.sessions);
  const retagSessionAction = useStore((s) => s.retagSession);
  const goals = useGoalsStore((s) => s.goals);
  const [cursor, setCursor] = useState(startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState<string>(dayKey(Date.now()));
  const [daySheetVisible, setDaySheetVisible] = useState(false);
  const reducedMotion = useReducedMotion();

  // Inbound link from another tab: DashboardScreen/StatsScreen/etc. can
  // navigate('calendar', { calendarDate }) to land straight on a specific
  // day's detail sheet (see this screen's contract with src/nav/useNav.ts).
  // Read once via getState() rather than a subscribed selector -- consuming
  // the intent is a one-shot side effect on mount, not something this screen
  // should re-run on every intent change while already mounted.
  useEffect(() => {
    const intent = useNav.getState().consumeIntent();
    if (intent?.calendarDate) {
      const d = new Date(intent.calendarDate);
      setCursor(startOfMonth(d));
      setSelectedKey(dayKey(d.getTime()));
      setDaySheetVisible(true);
    }
  }, []);

  // Month nav gets directional motion (spatial consistency: "next" content
  // enters from the right, "prev" from the left) instead of the grid just
  // popping to the new month in place. A timing, not a spring, since this is
  // a tap/swipe-triggered entrance with no ongoing gesture velocity to hand
  // off (the swipe itself is fully released before this starts).
  const monthSlideX = useRef(new Animated.Value(0)).current;
  const monthOpacity = useRef(new Animated.Value(1)).current;
  const animateMonthChange = (direction: 1 | -1) => {
    if (reducedMotion) return;
    monthSlideX.setValue(direction * MONTH_SLIDE_DISTANCE);
    monthOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(monthSlideX, {
        toValue: 0,
        duration: MONTH_SLIDE_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(monthOpacity, {
        toValue: 1,
        duration: MONTH_SLIDE_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const goToMonth = (direction: 1 | -1) => {
    configureLayoutAnimation(reducedMotion);
    animateMonthChange(direction);
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
  };

  // Swipe-to-change-month. No gesture-handler/reanimated dependency in this
  // app (see SettingsPrimitives.tsx's SliderRow precedent) -- PanResponder
  // from RN core is the established way to read a raw drag here. Claims the
  // gesture only once it's clearly more horizontal than vertical, so a
  // vertical scroll on the page (this screen is itself inside a ScrollView)
  // is never hijacked into a month change.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dx <= -SWIPE_THRESHOLD) goToMonth(1);
        else if (gesture.dx >= SWIPE_THRESHOLD) goToMonth(-1);
      },
    }),
  ).current;

  const byDay = useMemo(() => groupByDay(sessions), [sessions]);
  const grid = useMemo(() => buildGrid(cursor), [cursor]);
  const todayKey = dayKey(Date.now());

  // Discrete heat level per day, scoped to the currently displayed month
  // (not an all-time-global max the old continuous-alpha scheme used) --
  // see monthGrid.ts's monthHeatLevels doc comment for why: a legend needs
  // nameable discrete steps, and "the month's busiest day" should mean the
  // busiest day actually on screen, not one from a month the user isn't
  // looking at.
  const heatLevels = useMemo(() => monthHeatLevels(grid, byDay), [grid, byDay]);

  // Maximal runs of consecutive on-screen days with logged focus time
  // (monthGrid.ts's computeStreakRuns) -- a different question from
  // computeMonthSummary's streakDays (that one walks back from today,
  // independent of the displayed month). Used below to derive each cell's
  // connector bar and flame badge.
  const streakRuns = useMemo(() => computeStreakRuns(grid, byDay), [grid, byDay]);

  const monthSummary = useMemo(() => computeMonthSummary(grid, byDay), [grid, byDay]);

  const dayCells = useMemo(
    () =>
      grid.map((date, i) => {
        if (!date) return null;
        const key = dayKey(date.getTime());
        const daySessions = byDay.get(key) ?? [];
        const focusS = daySessions.reduce((sum, s) => sum + s.actualS, 0);
        const topicStats = topicBreakdownWithCustom(daySessions, customLabels, themeMode);
        const goalMet = goalsMetOnDay(goals, sessions, date).length > 0;
        const level = heatLevels.get(key) ?? 0;
        // A cell's left/right connector lights up when the *adjacent grid
        // index* (not adjacent calendar date -- see computeStreakRuns's own
        // comment on why that's equivalent here) belongs to the same run.
        // showFlame is reserved for a run's most recent day (its highest
        // index, since `grid` runs oldest-to-newest) and only for runs of
        // length >= 3, per the manager brief -- a casual 2-day pair
        // shouldn't get a flame badge.
        const run = streakRuns.find((r) => i >= r.startIndex && i <= r.endIndex);
        const streakEdge = run
          ? { left: i > run.startIndex, right: i < run.endIndex }
          : { left: false, right: false };
        const showFlame = !!run && run.length >= 3 && i === run.endIndex;
        return { date, key, daySessions, focusS, topicStats, goalMet, level, streakEdge, showFlame };
      }),
    [grid, byDay, customLabels, themeMode, goals, sessions, heatLevels, streakRuns],
  );

  const selectedSessions: LoggedSession[] = byDay.get(selectedKey) ?? [];
  const selectedGoalsMet = useMemo(
    () => goalsMetOnDay(goals, sessions, new Date(selectedKey)),
    [goals, sessions, selectedKey],
  );

  // Newest-last in storage (see stats.ts's aggregate doc comment) -- reverse
  // for a most-recent-first quick-jump row.
  const recentSessions = useMemo(() => sessions.slice(-8).reverse(), [sessions]);

  // A recent session can belong to a month the grid isn't currently showing
  // (that's the whole point of a "recent" shortcut -- last week's session
  // is still "recent" after you've paged the grid elsewhere), so this moves
  // both the displayed month and the selected day, not just the latter.
  const jumpToSession = (sess: LoggedSession) => {
    configureLayoutAnimation(reducedMotion);
    setCursor(startOfMonth(new Date(sess.startedAt)));
    setSelectedKey(dayKey(sess.startedAt));
  };

  const selectDay = (key: string) => {
    Haptics.selectionAsync();
    setSelectedKey(key);
    setDaySheetVisible(true);
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.h1, { color: c.text }]}>Focus Calendar</Text>

      <RecentSessionsRow
        sessions={recentSessions}
        selectedKey={selectedKey}
        theme={c}
        customLabels={customLabels}
        themeMode={themeMode}
        onSelect={jumpToSession}
      />

      <View style={styles.monthHeader}>
        <AnimatedPressable
          style={styles.navBtn}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => goToMonth(-1)}
        >
          <Feather name="chevron-left" size={22} color={c.accent} />
        </AnimatedPressable>
        <Text style={[styles.monthLabel, { color: c.text }]}>
          {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </Text>
        <AnimatedPressable
          style={styles.navBtn}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => goToMonth(1)}
        >
          <Feather name="chevron-right" size={22} color={c.accent} />
        </AnimatedPressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((w, i) => (
          <Text key={i} style={[styles.weekday, { color: c.textDim }]}>
            {w}
          </Text>
        ))}
      </View>

      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.grid, { opacity: monthOpacity, transform: [{ translateX: monthSlideX }] }]}
      >
        {dayCells.map((cell, i) => {
          if (!cell) return <View key={i} style={styles.emptyCell} />;
          return (
            <DayCell
              key={i}
              date={cell.date}
              focusS={cell.focusS}
              level={cell.level}
              topicStats={cell.topicStats}
              goalMet={cell.goalMet}
              selected={cell.key === selectedKey}
              isToday={cell.key === todayKey}
              theme={c}
              onPress={() => selectDay(cell.key)}
              streakEdge={cell.streakEdge}
              showFlame={cell.showFlame}
            />
          );
        })}
      </Animated.View>

      <HeatLegend theme={c} />
      <MonthSummaryStrip summary={monthSummary} theme={c} />

      <DaySheet
        visible={daySheetVisible}
        onClose={() => setDaySheetVisible(false)}
        dateKey={selectedKey}
        sessions={selectedSessions}
        goalsMet={selectedGoalsMet}
        goals={goals}
        theme={c}
        customLabels={customLabels}
        themeMode={themeMode}
        onRetag={(target, topic) => retagSessionAction(target, topic)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 16 },
  h1: { ...typeScale.title, marginBottom: 4 },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthLabel: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: typeScale.sectionTitle.letterSpacing,
    lineHeight: typeScale.sectionTitle.lineHeight,
  },
  navBtn: { paddingHorizontal: 12, paddingVertical: 4 },
  weekRow: { flexDirection: 'row' },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    letterSpacing: typeScale.caption.letterSpacing,
    lineHeight: typeScale.caption.lineHeight,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  emptyCell: { width: '14.2857%', aspectRatio: 1 },
});
