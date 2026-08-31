// CalendarScreen.tsx -- month grid over the local session log (sessionHistory
// via useStore.sessions). Each day gets a heat-tinted circle (focus minutes),
// a small topic stack (stats/customLabels.ts's topicBreakdownWithCustom),
// a goal-met ring (goalProgress.ts, via monthGrid.ts's goalsMetOnDay), and
// now a per-goal streak dot row underneath the topic stack (Goal Streaks
// feature, see useCalendarStreaks.ts's own header for the "which goals" view
// preference and streakDotsForDay's per-day math).
// Tapping a day no longer grows an inline panel below the grid (manager
// brief: this app's screens should not "expand up and down") -- it opens
// DaySheet.tsx in a `Sheet` instead, so the grid itself stays a stable,
// fixed-height view. Most of the day-cell/summary-strip/recent-row rendering
// lives in src/ui/calendar/* and src/screens/calendar/* (split out to stay
// under this project's 500-line file guideline -- this file was already
// over budget before this pass).
//
// No "Focus Calendar" h1 (task brief, same as StatsScreen's own h1 removal):
// the tab bar already says which screen this is, and reclaiming that row
// matters here more than most screens, per the next paragraph.
//
// Fits on one page, no scrolling (task brief: "the calendar does not fit the
// singular page"). The outer ScrollView is gone (a plain `flex:1` View, same
// "let overflow spill and be visibly wrong instead of silently scrollable"
// reasoning as StatsScreen.tsx's own header), and the day-cell grid is no
// longer sized purely off screen WIDTH (the old `width:'14.2857%'`/
// `aspectRatio:1` cells,7-per-row, made a 6-row month's height whatever 6x
// that width happened to be, with no regard for whether that fit under the
// month header/weekday row/recent-sessions row/heat legend/summary strip
// sharing this same screen). Cell size is now computed to fit: this file
// measures (via onLayout, not a guessed constant) how much vertical room is
// actually left after every OTHER piece of chrome on this screen has laid
// itself out, divides that by the grid's own row count (4/5/6, from
// buildGrid), and caps the grid container's WIDTH to `cellSize * 7` --
// DayCell.tsx's own cell is already a 14.2857% (1/7) width of ITS parent
// with aspectRatio:1, so constraining the parent's width is enough to make
// every cell scale to that computed size without editing DayCell.tsx itself
// (out of this task's ownership). onLayout, not
// `useWindowDimensions() - <hardcoded StatusStrip/tab-bar heights>`: this
// screen is mounted as App.tsx's `<Screen/>`, a sibling (not a child) of
// StatusStrip and the tab bar under one shared flex column (see App.tsx) --
// measuring what this screen's own root actually receives is exact and
// can't drift if either sibling's height ever changes, where a copied-in
// pixel constant for "StatusStrip's height" would.
//
// DayCell's own ring/circle/flame-badge/stack-row are fixed pixel sizes
// (CIRCLE_SIZE/RING_SIZE etc, not relative to its parent's width) -- since
// that file is out of this task's ownership, cellSize is clamped to a floor
// (MIN_CELL_SIZE) comfortably above DayCell's own natural footprint so
// those fixed-size glyphs are never asked to render inside a cell smaller
// than they need, which would overflow/overlap neighbouring cells instead of
// truly "scaling to fit". On a screen too short even for MIN_CELL_SIZE
// cells (a genuinely tiny device), the grid stays at that floor and may
// slightly exceed the ideal budget rather than render broken.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, PanResponder, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useScheduleStore } from '../store/useScheduleStore';
import { useTheme } from '../theme/useTheme';
import { dayKey, dayKeyToDate, groupByDay, LoggedSession } from '../stats/sessionHistory';
import { topicBreakdownWithCustom } from '../stats/customLabels';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { DayCell } from '../ui/calendar/DayCell';
import { MonthSummaryStrip } from '../ui/calendar/MonthSummaryStrip';
import { HeatLegend } from '../ui/calendar/HeatLegend';
import { RecentSessionsRow } from '../ui/calendar/RecentSessionsRow';
import { CalendarStreaksSheet } from '../ui/calendar/CalendarStreaksSheet';
import { DaySheet } from './calendar/DaySheet';
import { buildGrid, computeMonthSummary, computeStreakRuns, goalsMetOnDay, monthHeatLevels, startOfMonth } from './calendar/monthGrid';
import { useCalendarStreaks } from './calendar/useCalendarStreaks';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { typeScale } from '../theme/tokens';
import { useNav } from '../nav/useNav';

// DayCell.tsx's own tallest content stack is its RING_SIZE (40) ring, PLUS
// its topic stack-row (3px bar + 3px margin = 6), PLUS its streak-dot row
// (5px dot + 3px margin = 8, Goal Streaks feature) -- 54px total, fixed
// regardless of this cell's own computed size. A few px of breathing room
// above that so nothing touches the cell's edge. See this file's header for
// why this floor exists at all. (Bumped from 52 -> 60 when the streak-dot
// row was added, else it would clip on every device, not just tiny ones.)
const MIN_CELL_SIZE = 60;
// Above the original ungoverned (deviceWidth-40)/7 (~47-55px on most phones)
// there's nothing left in a 7-wide row worth spending on a single day cell.
// Bumped from 60 -> 66 alongside MIN_CELL_SIZE's own bump above, keeping
// roughly the same adaptive range it had before that row ate into it.
const MAX_CELL_SIZE = 66;
const HORIZONTAL_PADDING = 20; // this screen's own container paddingHorizontal -- PER SIDE (RN semantics)
// This screen's own root flex column `gap` (styles.container below) --
// shared as a constant, not just duplicated into that StyleSheet entry,
// because the cellSize math a few lines down also has to subtract it twice
// (the two gaps around the grid: above-chrome<->grid and grid<->below-chrome)
// to know the grid's own true budget; a copy that drifted from
// styles.container.gap would silently mis-size the grid.
const CONTAINER_GAP = 8;

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
  const excludedTopicKeys = useSettingsStore((s) => s.excludedTopicKeys);
  const sessions = useStore((s) => s.sessions);
  const retagSessionAction = useStore((s) => s.retagSession);
  const goals = useGoalsStore((s) => s.goals);
  const scheduled = useScheduleStore((s) => s.scheduled);
  const [cursor, setCursor] = useState(startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState<string>(dayKey(Date.now()));
  const [daySheetVisible, setDaySheetVisible] = useState(false);
  const [streaksSheetVisible, setStreaksSheetVisible] = useState(false);
  const reducedMotion = useReducedMotion();

  // Goal Streaks feature's own state slice (active goals, the resolved
  // "which goals show" set, the toggle action, and the per-day dot builder)
  // -- split into its own hook, see useCalendarStreaks.ts's header for why.
  const { activeGoals, visibleStreakGoalIdSet, toggleStreakGoal, streakDotsForDay } = useCalendarStreaks(
    sessions,
    customLabels,
    excludedTopicKeys,
    themeMode,
    c.accent,
    c.textDim,
  );

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
  // The PanResponder below is built once (useRef) and can therefore only ever
  // call the `goToMonth` from the FIRST render -- which closed over that
  // render's `reducedMotion`. useReducedMotion() resolves asynchronously and
  // then tracks live changes (AccessibilityInfo's reduceMotionChanged), so
  // that first value is `false` on every mount and goes stale the moment the
  // user has (or turns on) Reduce Motion: the chevron buttons, whose onPress
  // arrows are rebuilt each render, correctly skipped the slide while a swipe
  // to the same month still ran the full animation forever. Routing the
  // gesture through a ref that an effect keeps current fixes that without
  // rebuilding the responder mid-gesture.
  const goToMonthRef = useRef(goToMonth);
  useEffect(() => {
    goToMonthRef.current = goToMonth;
  });

  // Swipe-to-change-month. No gesture-handler/reanimated dependency in this
  // app (see SettingsPrimitives.tsx's SliderRow precedent) -- PanResponder
  // from RN core is the established way to read a raw drag here. Claims the
  // gesture only once it's clearly more horizontal than vertical, so an
  // incidental vertical brush elsewhere on the page is never hijacked into a
  // month change (this screen no longer scrolls at all -- see this file's
  // header -- but the same more-horizontal-than-vertical check still guards
  // against e.g. a slightly-diagonal tap being misread as a swipe).
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dx <= -SWIPE_THRESHOLD) goToMonthRef.current(1);
        else if (gesture.dx >= SWIPE_THRESHOLD) goToMonthRef.current(-1);
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

  // Which days carry a still-outstanding planned session. A Set of dayKeys
  // rather than a per-cell filter of the whole array: the grid asks this
  // question 42 times per render, and a plan is already keyed by the exact
  // 'YYYY-MM-DD' string the grid uses (schedule/scheduledSessions.ts), so
  // there is no date math to do here at all. Ticked-off plans are excluded
  // -- once a plan is done the day's own heat/goal marks describe it, and a
  // forward-pointing dot on a finished day is just noise.
  const plannedDays = useMemo(
    () => new Set(scheduled.filter((p) => !p.done).map((p) => p.date)),
    [scheduled],
  );

  const dayCells = useMemo(
    () =>
      grid.map((date, i) => {
        if (!date) return null;
        const key = dayKey(date.getTime());
        const daySessions = byDay.get(key) ?? [];
        const focusS = daySessions.reduce((sum, s) => sum + s.actualS, 0);
        const topicStats = topicBreakdownWithCustom(daySessions, customLabels, themeMode);
        const goalMet = goalsMetOnDay(goals, sessions, date, customLabels, excludedTopicKeys).length > 0;
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
        const hasPlan = plannedDays.has(key);
        // Per-goal streak dots -- see useCalendarStreaks.ts's streakDotsForDay.
        const streakDots = streakDotsForDay(date);
        return { date, key, daySessions, focusS, topicStats, goalMet, level, streakEdge, showFlame, hasPlan, streakDots };
      }),
    [grid, byDay, customLabels, excludedTopicKeys, themeMode, goals, sessions, heatLevels, streakRuns, plannedDays, streakDotsForDay],
  );

  const selectedSessions: LoggedSession[] = byDay.get(selectedKey) ?? [];
  const selectedGoalsMet = useMemo(
    () => goalsMetOnDay(goals, sessions, dayKeyToDate(selectedKey), customLabels, excludedTopicKeys),
    [goals, sessions, selectedKey, customLabels, excludedTopicKeys],
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

  // Fit-to-viewport sizing (task brief: no scrolling to see the month) --
  // see this file's header for why this measures actual rendered heights
  // (onLayout) rather than computing "screen height minus known constants"
  // for App.tsx's StatusStrip/tab bar. Three numbers: this screen's own
  // root (the exact space App.tsx's flex column left for it, already net of
  // StatusStrip/tab bar/safe areas), and the two chrome blocks that sit
  // above and below the grid on THIS screen (recent-sessions row + month
  // nav + weekday row; heat legend + summary strip) -- whatever's left over
  // is the grid's own budget.
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [rootHeight, setRootHeight] = useState(0);
  const [aboveGridHeight, setAboveGridHeight] = useState(0);
  const [belowGridHeight, setBelowGridHeight] = useState(0);

  const numRows = grid.length / 7;
  // * 2 because `paddingHorizontal` applies to BOTH sides -- this subtracted
  // one side's worth, so cellSize came out ~2.9px too wide and the grid
  // (width: cellSize * 7, alignSelf: 'center') overhung its own container's
  // padding by ~10px on each side.
  const availableWidth = windowWidth - insets.left - insets.right - HORIZONTAL_PADDING * 2;
  const availableGridHeight = Math.max(
    0,
    rootHeight - aboveGridHeight - belowGridHeight - CONTAINER_GAP * 2,
  );
  // Before the first onLayout pass reports real numbers (rootHeight still
  // 0), fall back to the old width-only sizing rather than the floor/ceiling
  // clamp below -- clamping against a height budget of 0 would floor every
  // cell to MIN_CELL_SIZE for one frame regardless of what actually fits,
  // which is a worse flash than briefly showing the width-only size while
  // the real measurement catches up (typically the very first frame only).
  const cellSize =
    rootHeight > 0
      ? Math.min(
          MAX_CELL_SIZE,
          Math.max(MIN_CELL_SIZE, Math.min(availableWidth / 7, availableGridHeight / numRows)),
        )
      : Math.min(MAX_CELL_SIZE, availableWidth / 7);

  return (
    <View
      style={[styles.container, { backgroundColor: c.bg }]}
      onLayout={(e) => setRootHeight(e.nativeEvent.layout.height)}
    >
      <View onLayout={(e) => setAboveGridHeight(e.nativeEvent.layout.height)} style={styles.aboveGrid}>
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
      </View>

      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.grid,
          { width: cellSize * 7, alignSelf: 'center', opacity: monthOpacity, transform: [{ translateX: monthSlideX }] },
        ]}
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
              hasPlan={cell.hasPlan}
              streakDots={cell.streakDots}
            />
          );
        })}
      </Animated.View>

      <View onLayout={(e) => setBelowGridHeight(e.nativeEvent.layout.height)} style={styles.belowGrid}>
        <View style={styles.legendRow}>
          <View style={{ flex: 1 }}>
            <HeatLegend theme={c} />
          </View>
          {/* Reaches CalendarStreaksSheet -- placed beside the heat legend,
              not as its own row, so it costs nothing extra out of this
              screen's fit-to-viewport vertical budget (onLayout-measured,
              see this file's header). */}
          <AnimatedPressable
            style={styles.streaksBtn}
            onPress={() => setStreaksSheetVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose which goals' streaks show on the calendar"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="target" size={14} color={c.textDim} />
          </AnimatedPressable>
        </View>
        <MonthSummaryStrip summary={monthSummary} theme={c} />
      </View>

      <DaySheet
        visible={daySheetVisible}
        onClose={() => setDaySheetVisible(false)}
        dateKey={selectedKey}
        sessions={selectedSessions}
        goalsMet={selectedGoalsMet}
        goals={goals}
        theme={c}
        customLabels={customLabels}
        excludedTopicKeys={excludedTopicKeys}
        themeMode={themeMode}
        onRetag={(target, topic) => retagSessionAction(target, topic)}
      />

      <CalendarStreaksSheet
        visible={streaksSheetVisible}
        goals={activeGoals}
        visibleIds={visibleStreakGoalIdSet}
        customLabels={customLabels}
        themeMode={themeMode}
        theme={c}
        onClose={() => setStreaksSheetVisible(false)}
        onToggle={toggleStreakGoal}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: HORIZONTAL_PADDING, paddingTop: 8, paddingBottom: 8, gap: CONTAINER_GAP },
  aboveGrid: { gap: 6 },
  belowGrid: { gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  streaksBtn: { paddingHorizontal: 4, paddingVertical: 2 },
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
