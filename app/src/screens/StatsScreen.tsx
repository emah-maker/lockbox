// StatsScreen.tsx -- total focus time plus lighthearted real-world
// comparisons (app/src/stats/comparisons.ts), computed from the local
// session log (useStore.sessions) the same way DashboardScreen's Focus card
// is -- the box keeps no long-term stats of its own to read this from.
//
// The period selector (screens/stats/PeriodSelector.tsx) is Day/Week/Month/
// All, scoping the total + topic breakdown to that slice of `sessions`
// (sessionHistory.ts's filterByWindow), PLUS a fifth "Goals" option that
// swaps the whole body for a read-only goal-progress view
// (screens/stats/GoalsProgressView.tsx) instead of scoping anything -- see
// that file's header for why goal editing itself is reached from the Goals
// view's own "Manage goals" affordance (screens/stats/ManageSheet.tsx) --
// a contextual shortcut for editing a goal while looking at it; Settings'
// own goals row is the canonical home, and every per-card tap here
// navigates there rather than opening a second editor.
//
// This file is now an orchestrator: it owns the period/topic-filter/sheet
// state and composes screens/stats/*.tsx, which is where the actual card
// bodies, the trend/topic interactivity, and the goals view live -- split
// out once this file's own single-scroll version of all of that started
// pushing past this project's 500-line guideline (see each sub-file's own
// header for why it exists separately).
//
// "Stop the screen growing vertically" (this task's brief): the
// write-capable, potentially-long goal forms that used to sit permanently
// at the bottom of this scroll (GoalsSection's add/edit/delete) now live
// inside ManageSheet, reached from the Goals view instead of always
// rendered inline. CustomLabelsSection moved to Settings' own "Custom
// labels" row entirely rather than being mounted here too, so there is one
// canonical place to edit the label catalog -- the main scroll is just the total
// card, fun facts (capped, with a "see more" sheet), the trend/heatmap
// card, and the topic card, which is the "fits one screen with light
// scrolling" the brief asks for.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { aggregate } from '../stats/stats';
import { topComparisons } from '../stats/comparisons';
import { topicBreakdownWithCustom } from '../stats/customLabels';
import { lastNDays, lastNDaysHeatmap, bestDay } from '../stats/trend';
import { filterByWindow, dayKey, TimeWindow, LoggedSession } from '../stats/sessionHistory';
import { getJSON, setJSON } from '../storage/storage';
import { useReducedMotion } from '../ui/useReducedMotion';
import { Sheet } from '../ui/Sheet';
import { useNav } from '../nav/useNav';
import { PeriodSelector, StatsPeriod, isStatsPeriod } from './stats/PeriodSelector';
import { TotalFocusCard } from './stats/TotalFocusCard';
import { FunFactsCard } from './stats/FunFactsCard';
import { TrendCard } from './stats/TrendCard';
import { TopicCard } from './stats/TopicCard';
import { GoalsProgressView } from './stats/GoalsProgressView';
import { SessionListSheet } from './stats/SessionListSheet';
import { ManageSheet } from './stats/ManageSheet';
import { typeScale } from '../theme/tokens';

const TOP_N = 5;
const TIME_WINDOW_KEY = 'statsTimeWindow';
const HIGHLIGHT_MS = 1600;

function isTimeWindow(v: StatsPeriod): v is TimeWindow {
  return v === 'day' || v === 'week' || v === 'month' || v === 'all';
}

export default function StatsScreen() {
  const c = useTheme();
  const sessions = useStore((s) => s.sessions);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const reducedMotion = useReducedMotion();

  const [period, setPeriod] = useState<StatsPeriod>('all');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [daySheetKey, setDaySheetKey] = useState<string | null>(null);
  const [topicSheetKey, setTopicSheetKey] = useState<string | null>(null);
  const [funFactsSheetOpen, setFunFactsSheetOpen] = useState(false);
  const [manageSheetOpen, setManageSheetOpen] = useState(false);
  const [highlightGoalId, setHighlightGoalId] = useState<string | null>(null);
  // Guards the mount load below against overwriting a selection the user
  // (or an incoming deep link) already made while the AsyncStorage read was
  // still in flight -- same guard StatsScreen has always used for its
  // period control.
  const userSelectedRef = useRef(false);
  // GoalsSection's H/M target wheels (inside ManageSheet) are vertical
  // scrollers nested inside that sheet's own ScrollView -- same
  // scrollEnabled hand-off DashboardScreen/the old inline GoalsSection here
  // used, just now scoped to the sheet instead of this screen's own
  // (removed) ScrollView drag.
  const [wheelActive, setWheelActive] = useState(false);
  const wheelSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWheelActiveChange = (active: boolean) => {
    if (wheelSafetyTimer.current) {
      clearTimeout(wheelSafetyTimer.current);
      wheelSafetyTimer.current = null;
    }
    setWheelActive(active);
    if (active) wheelSafetyTimer.current = setTimeout(() => setWheelActive(false), 600);
  };
  useEffect(() => () => {
    if (wheelSafetyTimer.current) clearTimeout(wheelSafetyTimer.current);
  }, []);

  // Per-device view preference -- deliberately not part of useSettingsStore's
  // SyncableSettings, since which period is selected shouldn't follow the
  // user to another device (see that store's header comment).
  useEffect(() => {
    let cancelled = false;
    getJSON<StatsPeriod | null>(TIME_WINDOW_KEY, null).then((saved) => {
      if (!cancelled && !userSelectedRef.current && isStatsPeriod(saved)) setPeriod(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Honor an incoming NavIntent on mount (task brief: "Honor an incoming
  // consumeIntent() on mount"). statsPeriod selects the tab the same way a
  // manual tap would; goalId both jumps to the Goals period (so the card it
  // names is actually visible) and highlights that one card briefly;
  // topic pre-applies the donut/topic-row filter this screen already
  // supports, so a deep link from elsewhere in the app can land already
  // scoped to one topic.
  useEffect(() => {
    const intent = useNav.getState().consumeIntent();
    if (!intent) return;
    if (intent.statsPeriod) {
      userSelectedRef.current = true;
      setPeriod(intent.statsPeriod);
    }
    if (intent.topic) setSelectedTopic(intent.topic);
    if (intent.goalId) {
      userSelectedRef.current = true;
      setPeriod('goals');
      setHighlightGoalId(intent.goalId);
      setTimeout(() => setHighlightGoalId(null), HIGHLIGHT_MS);
    }
  }, []);

  const selectPeriod = (p: StatsPeriod) => {
    userSelectedRef.current = true;
    if (p === period) return;
    setPeriod(p);
    setJSON(TIME_WINDOW_KEY, p);
  };

  const windowKey: TimeWindow = isTimeWindow(period) ? period : 'all';

  // Topic filter (InteractiveTopicDonut / TopicCard row taps) scopes every
  // card on this screen, not just the topic card itself -- computed as two
  // layers: `windowOnlySessions` (period control only) feeds the topic
  // breakdown itself, since that list has to keep showing every topic to
  // stay selectable/clearable; `topicScoped` (topic filter only, no period
  // window) feeds the always-unwindowed trend/heatmap/streak, matching
  // those cards' pre-existing "ignore the period control" behavior.
  const windowOnlySessions = useMemo(() => filterByWindow(sessions, windowKey), [sessions, windowKey]);
  const topics = useMemo(
    () => topicBreakdownWithCustom(windowOnlySessions, customLabels, themeMode),
    [windowOnlySessions, customLabels, themeMode],
  );

  const topicScoped = useMemo(
    () => (selectedTopic ? sessions.filter((s) => s.topic === selectedTopic) : sessions),
    [sessions, selectedTopic],
  );
  const scopedWindowed = useMemo(
    () => (selectedTopic ? windowOnlySessions.filter((s) => s.topic === selectedTopic) : windowOnlySessions),
    [windowOnlySessions, selectedTopic],
  );

  const stats = useMemo(() => aggregate(scopedWindowed), [scopedWindowed]);
  const unwindowedStats = useMemo(() => aggregate(topicScoped), [topicScoped]);
  const comparisons = useMemo(() => topComparisons(stats.foc).slice(0, TOP_N), [stats.foc]);
  const best = useMemo(() => bestDay(topicScoped), [topicScoped]);
  const trend = useMemo(() => lastNDays(topicScoped), [topicScoped]);
  const heatmap = useMemo(() => lastNDaysHeatmap(topicScoped), [topicScoped]);

  const daySheetSessions: LoggedSession[] = daySheetKey
    ? topicScoped.filter((s) => dayKey(s.startedAt) === daySheetKey)
    : [];
  const topicSheetSessions: LoggedSession[] = topicSheetKey
    ? windowOnlySessions.filter((s) => s.topic === topicSheetKey)
    : [];

  const openCalendarDay = (dateKey: string) => {
    setDaySheetKey(null);
    setTopicSheetKey(null);
    useNav.getState().navigate('calendar', { calendarDate: dateKey });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
        <Text style={[styles.h1, { color: c.text }]}>Stats</Text>

        <PeriodSelector period={period} onSelect={selectPeriod} />

        {period === 'goals' ? (
          <GoalsProgressView
            onOpenGoalInSettings={(goalId) => useNav.getState().navigate('settings', { settingsSection: 'goals', goalId })}
            onManage={() => setManageSheetOpen(true)}
            highlightGoalId={highlightGoalId}
          />
        ) : (
          <>
            <TotalFocusCard stats={stats} unwindowedStreak={unwindowedStats.str} reducedMotion={reducedMotion} />
            <FunFactsCard
              hasFocus={stats.foc > 0}
              best={best}
              comparisons={comparisons}
              onSeeMore={() => setFunFactsSheetOpen(true)}
            />
            <TrendCard trend={trend} heatmap={heatmap} onInspectDay={setDaySheetKey} />
            <TopicCard
              topics={topics}
              selectedKey={selectedTopic}
              onSelectTopic={setSelectedTopic}
              onInspectTopic={setTopicSheetKey}
            />
          </>
        )}
      </ScrollView>

      <Sheet
        visible={daySheetKey !== null}
        onClose={() => setDaySheetKey(null)}
        title={daySheetKey ? new Date(daySheetKey).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : undefined}
      >
        <SessionListSheet
          sessions={daySheetSessions}
          customLabels={customLabels}
          themeMode={themeMode}
          onOpenCalendarDay={openCalendarDay}
          emptyLabel="No sessions on this day."
        />
      </Sheet>

      <Sheet
        visible={topicSheetKey !== null}
        onClose={() => setTopicSheetKey(null)}
        title={topics.find((t) => t.key === topicSheetKey)?.label}
      >
        <SessionListSheet
          sessions={topicSheetSessions}
          customLabels={customLabels}
          themeMode={themeMode}
          onOpenCalendarDay={openCalendarDay}
          emptyLabel="No sessions for this topic in the selected period."
        />
      </Sheet>

      <Sheet visible={funFactsSheetOpen} onClose={() => setFunFactsSheetOpen(false)} title="Fun facts">
        <View style={{ gap: 8 }}>
          {comparisons.map((cmp) => (
            <Text key={cmp.ref.key} style={[styles.factSheetRow, { color: c.text }]}>
              {`That's like ${cmp.count >= 10 ? Math.round(cmp.count) : Math.round(cmp.count * 10) / 10}x ${cmp.ref.label}.`}
            </Text>
          ))}
        </View>
      </Sheet>

      {/* scrollEnabled hands the vertical gesture to GoalForm's H/M WheelPickers
          while a finger is down on one -- same two-nested-vertical-scrollers
          hazard this screen used to solve for its own (now removed) inline
          ScrollView, just handed to Sheet's own body scroll instead. */}
      <Sheet
        visible={manageSheetOpen}
        onClose={() => setManageSheetOpen(false)}
        title="Manage goals"
        size="large"
        scrollEnabled={!wheelActive}
      >
        <ManageSheet color={c} onWheelActiveChange={onWheelActiveChange} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 16, paddingBottom: 32 },
  h1: { ...typeScale.title, marginBottom: 4 },
  factSheetRow: { fontSize: 15, lineHeight: 20 },
});
