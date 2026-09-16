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
// "Every period fits one screen with NO scrolling" (this task's explicit
// brief): the outer ScrollView this screen used to have is gone entirely --
// not `scrollEnabled={false}`, a plain `View`. A disabled ScrollView still
// clips whatever overflows its bounds, which would hide a "this doesn't fit"
// layout bug behind what looks like a "can't scroll" bug during device
// testing; a plain View lets overflow actually spill and be visibly wrong
// instead. TotalFocusCard and FunFactsCard size to their own content;
// TrendCard and TopicCard split whatever's left via `flex:1` on each (see
// their own headers for what moved into Sheets to make that fit). The
// write-capable, potentially-long goal forms that used to sit permanently
// at the bottom of the old scroll (GoalsSection's add/edit/delete) live
// inside ManageSheet, reached from the Goals view instead of always
// rendered inline. CustomLabelsSection moved to Settings' own "Custom
// labels" row entirely rather than being mounted here too, so there is one
// canonical place to edit the label catalog.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { aggregate } from '../stats/stats';
import { topComparisons } from '../stats/comparisons';
import { topicBreakdownWithCustom } from '../stats/customLabels';
import { lastNDays, lastNDaysHeatmap, bestDay } from '../stats/trend';
import { filterByWindow, dayKey, dayKeyToDate, TimeWindow, LoggedSession } from '../stats/sessionHistory';
import { getJSON, setJSON } from '../storage/storage';
import { useReducedMotion } from '../ui/useReducedMotion';
import { useNowMs } from '../ui/useNowMs';
import { Sheet } from '../ui/Sheet';
import { useNav } from '../nav/useNav';
import { PeriodSelector, StatsPeriod, isStatsPeriod } from './stats/PeriodSelector';
import { TotalFocusCard } from './stats/TotalFocusCard';
import { FunFactsCard } from './stats/FunFactsCard';
import { TrendCard } from './stats/TrendCard';
import { TopicCard, TopicRows } from './stats/TopicCard';
import { HeatmapGrid } from './stats/HeatmapGrid';
import { GoalsProgressView } from './stats/GoalsProgressView';
import { SessionListSheet } from './stats/SessionListSheet';
import { LabelPickerSheet } from '../ui/calendar/LabelPickerSheet';
import { allLabelChoices, resolveTopic } from '../stats/customLabels';
import { ManageSheet } from './stats/ManageSheet';
import { useWheelScrollLock } from '../ui/WheelPicker';

const TOP_N = 5;
const TIME_WINDOW_KEY = 'statsTimeWindow';
const HIGHLIGHT_MS = 1600;

// Excludes 'year': TimeWindow carries it for the Home ring's best-day
// baseline (sessionHistory.ts), but this screen's own StatsPeriod union has
// no 'year' option, so the predicate can only ever narrow to the four
// windows both types share -- naming that intersection explicitly keeps the
// predicate assignable to its own parameter type.
function isTimeWindow(v: StatsPeriod): v is Exclude<TimeWindow, 'year'> {
  return v === 'day' || v === 'week' || v === 'month' || v === 'all';
}

export default function StatsScreen() {
  const c = useTheme();
  const sessions = useStore((s) => s.sessions);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const excludedTopicKeys = useSettingsStore((s) => s.excludedTopicKeys);
  const retagSession = useStore((s) => s.retagSession);
  // The session whose label is being changed, or null. Reuses the exact
  // picker + retagSession path CalendarScreen's day sheet already uses, so
  // "fix this session's label" behaves identically wherever you notice the
  // mistake -- see SessionListSheet's own header for why noticing it here
  // and having to go to Calendar to act on it was the problem.
  const [retagTarget, setRetagTarget] = useState<LoggedSession | null>(null);
  const reducedMotion = useReducedMotion();

  const [period, setPeriod] = useState<StatsPeriod>('all');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [daySheetKey, setDaySheetKey] = useState<string | null>(null);
  const [topicSheetKey, setTopicSheetKey] = useState<string | null>(null);
  const [funFactsSheetOpen, setFunFactsSheetOpen] = useState(false);
  const [heatmapSheetOpen, setHeatmapSheetOpen] = useState(false);
  const [allTopicsSheetOpen, setAllTopicsSheetOpen] = useState(false);
  const [manageSheetOpen, setManageSheetOpen] = useState(false);
  // Set true only by the Goals-empty-state's own "Start adding goals" CTA
  // (openManageToCreate below) -- bug fix: that CTA used to just call the
  // same open-the-sheet handler the ordinary "Manage goals" button uses,
  // which opened onto GoalsSection's OWN "no goals yet" empty state (a
  // SECOND "Start adding goals" button, requiring a second identical tap to
  // actually reach GoalForm). This flag tells ManageSheet/GoalsSection to
  // open straight into the create form instead. Reset back to false on
  // close (closeManageSheet below) so it's a fresh false->true edge next
  // time, not a value GoalsSection (which stays mounted between opens, see
  // ui/Sheet.tsx -- Modal's own `visible` only hides it) would otherwise
  // see as "already true" and ignore.
  const [manageSheetAutoCreate, setManageSheetAutoCreate] = useState(false);
  // True from openManageToCreate's tap until the outer "Manage goals" Sheet
  // below actually finishes presenting -- see manageSheetAutoCreate's own
  // comment for what this flag ultimately triggers, and Sheet.tsx's
  // `onOpened` doc comment for why that trigger can't fire on the same tick
  // as `setManageSheetOpen(true)`: doing so used to start the inner form
  // Sheet's own slide-up/backdrop-fade at the exact same moment as this
  // outer one's, so for the length of both springs the empty state, this
  // sheet's own body, and the form sheet were all visibly mid-transition on
  // top of each other. A ref, not state, since setting it never needs to
  // trigger a render on its own -- only manageSheetAutoCreate flipping does.
  const pendingAutoCreateRef = useRef(false);
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
  // The backstop window is picked from the gesture phase rather than a flat
  // 600ms -- see useWheelScrollLock in WheelPicker.tsx for why a flat one
  // fired in the middle of any longer drag.
  const { wheelActive, setWheelActive: onWheelActiveChange } = useWheelScrollLock();

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
    if (!intent.goalId) return;
    userSelectedRef.current = true;
    setPeriod('goals');
    setHighlightGoalId(intent.goalId);
    // Cleared on unmount like the wheel safety timer above, rather than left
    // to fire into a screen that is gone: switching tabs unmounts this one
    // (App.tsx renders exactly one screen at a time), and the highlight timer
    // is armed by a cross-tab deep link, so leaving this tab within the
    // highlight window is the ordinary case, not the unlikely one.
    const timer = setTimeout(() => setHighlightGoalId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, []);

  const selectPeriod = (p: StatsPeriod) => {
    userSelectedRef.current = true;
    if (p === period) return;
    setPeriod(p);
    setJSON(TIME_WINDOW_KEY, p);
  };

  const windowKey: TimeWindow = isTimeWindow(period) ? period : 'all';
  // Ticks on its own (ui/useNowMs.ts) so windowOnlySessions/best/trend/
  // heatmap below re-cross their day/window boundaries while this screen
  // just sits open, instead of freezing at whatever instant they last
  // recomputed because sessions/customLabels/excludedTopicKeys happened to
  // change reference -- see that hook's own header for the underlying bug.
  const nowMs = useNowMs();

  // Topic filter (InteractiveTopicDonut / TopicCard row taps) scopes every
  // card on this screen, not just the topic card itself -- computed as two
  // layers: `windowOnlySessions` (period control only) feeds the topic
  // breakdown itself, since that list has to keep showing every topic to
  // stay selectable/clearable; `topicScoped` (topic filter only, no period
  // window) feeds the always-unwindowed trend/heatmap/streak, matching
  // those cards' pre-existing "ignore the period control" behavior.
  const windowOnlySessions = useMemo(
    () => filterByWindow(sessions, windowKey, nowMs),
    [sessions, windowKey, nowMs],
  );
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

  // A topic filter can outlive the topic it names. The retag affordance is
  // ON this screen (SessionListSheet's onRetag, in both sheets below), so
  // the ordinary "notice a mislabelled session while filtered to a topic,
  // fix it right there" path relabels the last session carrying the very
  // topic being filtered by. `topics` recomputes and drops it, but
  // `selectedTopic` kept pointing at it -- and since every card reads
  // topicScoped/scopedWindowed rather than `topics`, the whole screen read
  // 0 sessions / 0m while the un-filtered "By topic" list beside it still
  // listed the real ones. The only clue was an unlabelled "Clear filter"
  // link, next to a donut with no highlighted segment to explain itself.
  //
  // Reconciled against the FULL session history, deliberately not against
  // `topics` (which is windowed). Filtering to a topic and switching to a
  // period it has no sessions in is a legitimate state whose correct answer
  // IS zero -- "no study time today" -- and clearing the filter there would
  // silently discard a choice the user just made. Only a topic that no
  // session anywhere still carries is genuinely stale. An empty `sessions`
  // is left alone so a deep link (useNav's intent.topic, consumed on mount)
  // survives until the store has hydrated.
  useEffect(() => {
    if (!sessions.length) return;
    const orphaned = (topic: string | null) => topic !== null && !sessions.some((s) => s.topic === topic);
    if (orphaned(selectedTopic)) setSelectedTopic(null);
    // Same rule for the topic sheet, which otherwise stayed open with an
    // `undefined` title -- a blank header over an empty-state line.
    if (orphaned(topicSheetKey)) setTopicSheetKey(null);
  }, [sessions, selectedTopic, topicSheetKey]);

  // Every aggregate below is handed `customLabels`/`excludedTopicKeys` so a
  // session tagged with an excludeFromTotals label, or an excluded built-in
  // topic (stats/customLabels.ts), drops out of the total/comparisons/trend/
  // heatmap the same way it does everywhere else that counts -- while still
  // appearing in `topics` above and in the session-list sheets below, which
  // never filter by this flag.
  const stats = useMemo(
    () => aggregate(scopedWindowed, customLabels, excludedTopicKeys),
    [scopedWindowed, customLabels, excludedTopicKeys],
  );
  const unwindowedStats = useMemo(
    () => aggregate(topicScoped, customLabels, excludedTopicKeys),
    [topicScoped, customLabels, excludedTopicKeys],
  );
  const comparisons = useMemo(() => topComparisons(stats.foc).slice(0, TOP_N), [stats.foc]);
  const best = useMemo(
    () => bestDay(topicScoped, 'all', nowMs, customLabels, excludedTopicKeys),
    [topicScoped, nowMs, customLabels, excludedTopicKeys],
  );
  const trend = useMemo(
    () => lastNDays(topicScoped, 7, nowMs, customLabels, excludedTopicKeys),
    [topicScoped, nowMs, customLabels, excludedTopicKeys],
  );
  const heatmap = useMemo(
    () => lastNDaysHeatmap(topicScoped, nowMs, customLabels, excludedTopicKeys),
    [topicScoped, nowMs, customLabels, excludedTopicKeys],
  );

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

  // Sheet is a single Modal, so two can't be visible at once (same
  // constraint openCalendarDay above already works around for the day/topic
  // sheets) -- opening the topic-detail sheet from a row tapped inside the
  // "See all topics" sheet has to close that sheet first, in the same state
  // update, rather than trying to layer a second Modal on top of it.
  const openTopicFromAllSheet = (key: string) => {
    setAllTopicsSheetOpen(false);
    setTopicSheetKey(key);
  };

  // The Goals-empty-state's own CTA (see manageSheetAutoCreate's own
  // comment) -- opens the same ManageSheet the ordinary "Manage goals"
  // button does, but flagged to land straight on GoalForm instead of on
  // GoalsSection's own empty state.
  const openManageToCreate = () => {
    // Doesn't flip manageSheetAutoCreate itself -- that only happens once
    // the Sheet below reports (via onOpened) that it's actually done
    // presenting, via handleManageSheetOpened. See pendingAutoCreateRef's
    // own comment for why.
    pendingAutoCreateRef.current = true;
    setManageSheetOpen(true);
  };
  const handleManageSheetOpened = () => {
    if (!pendingAutoCreateRef.current) return;
    pendingAutoCreateRef.current = false;
    setManageSheetAutoCreate(true);
  };
  const closeManageSheet = () => {
    setManageSheetOpen(false);
    setManageSheetAutoCreate(false);
    pendingAutoCreateRef.current = false;
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
      {/* No "Stats" h1 here -- the tab bar (App.tsx) already says which
          screen this is, so a repeated title only cost vertical space this
          no-scroll layout can't spare (task brief: reclaim it rather than
          leave a gap, hence paddingTop trimmed from 14 to 8 too). */}
      <PeriodSelector period={period} onSelect={selectPeriod} />

      {period === 'goals' ? (
        <View style={{ flex: 1, marginTop: 10 }}>
          <GoalsProgressView
            onOpenGoalInSettings={(goalId) => useNav.getState().navigate('settings', { settingsSection: 'goals', goalId })}
            onManage={() => setManageSheetOpen(true)}
            onAddGoal={openManageToCreate}
            highlightGoalId={highlightGoalId}
          />
        </View>
      ) : (
        <View style={{ flex: 1, gap: 8, marginTop: 10 }}>
          <TotalFocusCard stats={stats} unwindowedStreak={unwindowedStats.str} reducedMotion={reducedMotion} />
          <FunFactsCard
            hasFocus={stats.foc > 0}
            best={best}
            comparisons={comparisons}
            onSeeMore={() => setFunFactsSheetOpen(true)}
          />
          <TrendCard
            trend={trend}
            onInspectDay={setDaySheetKey}
            onOpenHeatmap={() => setHeatmapSheetOpen(true)}
            style={{ flex: 1 }}
          />
          <TopicCard
            topics={topics}
            selectedKey={selectedTopic}
            onSelectTopic={setSelectedTopic}
            onInspectTopic={setTopicSheetKey}
            onSeeAllTopics={() => setAllTopicsSheetOpen(true)}
            style={{ flex: 1 }}
          />
        </View>
      )}

      <Sheet
        visible={daySheetKey !== null}
        onClose={() => setDaySheetKey(null)}
        title={daySheetKey ? dayKeyToDate(daySheetKey).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : undefined}
      >
        <SessionListSheet
          sessions={daySheetSessions}
          customLabels={customLabels}
          themeMode={themeMode}
          onOpenCalendarDay={openCalendarDay}
          onRetag={setRetagTarget}
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
          onRetag={setRetagTarget}
          emptyLabel="No sessions for this topic in the selected period."
        />
      </Sheet>

      {/* Stacked on top of whichever session-list sheet is open -- the same
          two-Modal layering DaySheet.tsx already uses for this picker. */}
      <LabelPickerSheet
        visible={retagTarget !== null}
        choices={allLabelChoices(customLabels, themeMode, excludedTopicKeys)}
        current={retagTarget ? resolveTopic(retagTarget.topic, customLabels, themeMode)?.id : undefined}
        theme={c}
        onClose={() => setRetagTarget(null)}
        onPick={(id) => {
          if (retagTarget) retagSession(retagTarget, id);
          setRetagTarget(null);
        }}
        onClear={
          retagTarget?.topic
            ? () => {
                if (retagTarget) retagSession(retagTarget, undefined);
                setRetagTarget(null);
              }
            : undefined
        }
      />

      <Sheet visible={funFactsSheetOpen} onClose={() => setFunFactsSheetOpen(false)} title="Fun facts">
        <View style={{ gap: 8 }}>
          {comparisons.map((cmp) => (
            <Text key={cmp.ref.key} style={[styles.factSheetRow, { color: c.text }]}>
              {`That's like ${cmp.count >= 10 ? Math.round(cmp.count) : Math.round(cmp.count * 10) / 10}x ${cmp.ref.label}.`}
            </Text>
          ))}
        </View>
      </Sheet>

      {/* The heatmap used to render inline in TrendCard -- see that file's
          header for why it moved here instead (no room left once this
          screen's outer scroll was removed). Reuses the same
          onInspectDay -> setDaySheetKey wiring TrendCard's own bars drive. */}
      <Sheet visible={heatmapSheetOpen} onClose={() => setHeatmapSheetOpen(false)} title="Last 5 weeks">
        <HeatmapGrid heatmap={heatmap} onInspectDay={setDaySheetKey} />
      </Sheet>

      {/* TopicCard only renders its first two rows inline (see that file's
          header) -- this is the rest, reusing TopicCard's own exported
          TopicRows so the full list renders identically instead of via a
          second copy of that markup. Tapping a row here closes this sheet
          first (openTopicFromAllSheet above), since Sheet is a single Modal
          and can't stack a second one on top of itself. */}
      <Sheet visible={allTopicsSheetOpen} onClose={() => setAllTopicsSheetOpen(false)} title="By topic">
        <View style={{ gap: 4 }}>
          <TopicRows topics={topics} onInspectTopic={openTopicFromAllSheet} />
        </View>
      </Sheet>

      {/* scrollEnabled hands the vertical gesture to GoalForm's H/M WheelPickers
          while a finger is down on one -- same two-nested-vertical-scrollers
          hazard this screen used to solve for its own (now removed) inline
          ScrollView, just handed to Sheet's own body scroll instead. */}
      <Sheet
        visible={manageSheetOpen}
        onClose={closeManageSheet}
        onOpened={handleManageSheetOpened}
        title="Manage goals"
        size="large"
        scrollEnabled={!wheelActive}
        // Wheels in the body -- see Sheet.tsx's dragBodyToDismiss.
        dragBodyToDismiss={false}
      >
        <ManageSheet color={c} onWheelActiveChange={onWheelActiveChange} initialCreate={manageSheetAutoCreate} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  factSheetRow: { fontSize: 15, lineHeight: 20 },
});
