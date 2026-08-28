// DashboardScreen.tsx -- the Home tab. Navigation lives in App.tsx as a
// trivial tab switcher; this stays the default landing tab.
//
// UI/UX pass (manager brief, see this pass's own commit): the screen used to
// be one tall ScrollView stacking a connection card, a linear session meter,
// an inline duration/topic picker block, and a full stats card -- every one
// of those pieces appeared/grew/shrank independently, which is exactly the
// "expands up and down" complaint this pass exists to fix. The BLE
// interaction itself (duration preview via setDuration, lock/close/open,
// topic tagging, the box-sync/push effects below) is unchanged; what moved
// is presentation:
//   - The connection dot/label/battery row is gone -- foundation's global
//     StatusStrip (App.tsx, shown on every tab) already covers it; keeping
//     a second copy here would just be the same information twice.
//   - The duration wheels + pre-session topic picker moved into
//     home/DurationSheet.tsx, opened from the hero instead of always inline.
//   - The in-session retag picker moved into home/TagSheet.tsx, opened from
//     the hero's topic pill instead of always inline.
//   - The full stats card (session count/completion/streak/longest/
//     sparkline) is gone from this screen entirely -- home/TodaySummary.tsx
//     is the compact "at a glance" replacement (today's focus time + the
//     single most-relevant goal), and it links out to Stats (already
//     scoped to the right period via useNav's intent) for the rest.
// What's left fits in a fixed-height layout with no ScrollView: the
// home/FocusHero.tsx anchor, the Close/Open remote-control row, and
// TodaySummary -- plus, since then, home/TopicBreakdownStrip.tsx (manager
// brief: "find something more to put on the home screen to fill the
// space"), a compact today's-topic-split block between the control row and
// TodaySummary. It's deliberately just one more fixed block in this same
// space-between column, not a new ScrollView -- the empty space it fills was
// this layout's own slack, not a sign the layout needed to change shape.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useTheme } from '../theme/useTheme';
import { aggregate, clampLockSeconds, MAX_LOCK_HOURS, MAX_LOCK_SECONDS } from '../stats/stats';
import { filterByWindow } from '../stats/sessionHistory';
import type { Goal } from '../goals/goals';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useReducedMotion } from '../ui/useReducedMotion';
import { useNav } from '../nav/useNav';
import { typeScale, opacity } from '../theme/tokens';
import { FocusHero } from './home/FocusHero';
import { DurationSheet } from './home/DurationSheet';
import { TagSheet } from './home/TagSheet';
import { TodaySummary } from './home/TodaySummary';
import { TopicBreakdownStrip } from './home/TopicBreakdownStrip';
import { useHomeGoalRing } from './home/useHomeGoalRing';

const DISABLED_OPACITY = opacity.disabled;

/** Fades a button's opacity between enabled/disabled instead of an instant
 * cut, so losing/gaining availability (e.g. Open as box state changes) reads
 * as a state transition rather than a jump. Unchanged from this file's
 * previous version -- still the one place on this screen that needs it,
 * now that the rest of the screen's animation lives in home/FocusHero.tsx. */
function useDisabledFade(disabled: boolean) {
  const reducedMotion = useReducedMotion();
  const fadeOpacity = useRef(new Animated.Value(disabled ? DISABLED_OPACITY : 1)).current;
  useEffect(() => {
    const toValue = disabled ? DISABLED_OPACITY : 1;
    if (reducedMotion) {
      fadeOpacity.setValue(toValue);
      return;
    }
    Animated.timing(fadeOpacity, { toValue, duration: 150, useNativeDriver: true }).start();
  }, [disabled, reducedMotion]);
  return fadeOpacity;
}

const MINUTE_STEP = 5;
// Wheel contents for the H/M duration picker -- hours 0..MAX_LOCK_HOURS,
// minutes in the same 5-minute steps the old stepper used.
const HOUR_VALUES = Array.from({ length: MAX_LOCK_HOURS + 1 }, (_, i) => i);
const MINUTE_VALUES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const HOUR_LABELS = HOUR_VALUES.map((h) => `${h}h`);
const MINUTE_LABELS = MINUTE_VALUES.map((m) => `${String(m).padStart(2, '0')}m`);

export default function DashboardScreen() {
  const {
    conn,
    status,
    sessions,
    currentTopic,
    connect,
    disconnect,
    setDuration,
    closeBox,
    openBox,
    tagCurrentSession,
    setPendingBoxTopic,
  } = useStore();
  const remoteUnlockOn = useSettingsStore((st) => !!st.boxSettings.unlk);
  const themeMode = useSettingsStore((st) => st.themeMode);
  const customLabels = useSettingsStore((st) => st.customLabels);
  const ringBaselineWindow = useSettingsStore((st) => st.ringBaselineWindow);
  const ringSourceKind = useSettingsStore((st) => st.ringSourceKind);
  const ringGoalId = useSettingsStore((st) => st.ringGoalId);
  const goals = useGoalsStore((st) => st.goals);
  const theme = useTheme();
  const s = styles(theme);
  const { navigate } = useNav();

  // Duration picker -- local to this screen, not persisted. Preview-only: it
  // can't start a lock from the phone (that has to happen at the box, with
  // the phone physically inside it -- see show_idle/show_closed in
  // Box-code/lib/lock_ui.py). Every stepper change pushes a live preview via
  // setDuration below (opcode "dur:<seconds>") so the box's clock reflects
  // the picked time immediately, ready for LOCK to be tapped on the box.
  // Hours/minutes as one state object, not two separate useState calls --
  // previously the box-sync effect below (mirroring a duration changed
  // directly on the box) called setPickHours then setPickMinutes back to
  // back, which is safe only as long as React batches both into a single
  // render. If it ever didn't (a "speculative" finding in the production
  // readiness review, Low), the first, partially-updated render could
  // consume syncingFromBoxRef's guard before the second setState landed,
  // leaving the push effect below free to fire an ordinary user-edit push
  // for what was actually a box-driven sync. One state object makes that
  // impossible regardless of batching.
  const [pick, setPick] = useState({ hours: 0, minutes: 5 });
  const pickSeconds = clampLockSeconds(pick.hours, pick.minutes);
  const minutesIndex = Math.max(0, MINUTE_VALUES.indexOf(pick.minutes));

  // Sheet visibility -- the duration+tag picker and the in-session retag
  // picker used to be permanently-inline blocks (see this file's header);
  // now they're on-demand popups, each opened from FocusHero.
  const [durationSheetOpen, setDurationSheetOpen] = useState(false);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  // A session starting/ending makes whichever sheet was open for the
  // *other* state stop making sense -- close it rather than leave a stale
  // popup sitting over a screen that's moved on (e.g. the box's own LOCK
  // button gets pressed while the duration sheet happens to be open).
  useEffect(() => {
    if (status?.st === 'running') setDurationSheetOpen(false);
    else setTagSheetOpen(false);
  }, [status?.st]);

  // Neither wheel may land on 0h00m -- mirrors the box's own adjust() floor
  // (lock_controller.py), which bumps a decrement-to-zero up to one MIN_STEP
  // instead. Enforced on `pick` itself (not just the derived pickSeconds
  // below) so the wheels' displayed value never disagrees with what actually
  // gets pushed to the box.
  const onHoursIndexChange = (index: number) => {
    setPick((p) => {
      const hours = HOUR_VALUES[index];
      const minutes = hours === 0 && p.minutes === 0 ? MINUTE_STEP : p.minutes;
      return { hours, minutes };
    });
  };
  const onMinutesIndexChange = (index: number) => {
    setPick((p) => {
      const minutes = MINUTE_VALUES[index];
      // Reject 0 while hours is 0 -- must return a *new* object even when
      // rejecting, not the same `p` reference: WheelPicker's own external-
      // resync effect (see WheelPicker.tsx) only re-parks the wheel when its
      // `selectedIndex` prop changes between renders, and returning the same
      // reference here makes React bail the re-render entirely, so that prop
      // never changes and the wheel silently stays wherever the drag left it
      // (visually 0) instead of snapping back.
      if (p.hours === 0 && minutes === 0) return { ...p };
      return { ...p, minutes };
    });
  };

  // Computed here, not read over BLE: the box keeps no long-term stats of its
  // own (no SD card, no NVM -- see Box-code/lib/lock_log.py), so the app's
  // local session log (synced live + drained from the box on connect) is the
  // only copy, and the only place these aggregates can come from.
  // Headline "focus time today" comes from filterByWindow('day', ...), the
  // same local-midnight-anchored helper StatsScreen's own "day" window uses.
  // Kept as its own memo (rather than inlined into todayStats below) since
  // the new TopicBreakdownStrip filler block (task 5) also needs the raw,
  // untotaled session list, not just its aggregate.
  const todaySessions = useMemo(() => filterByWindow(sessions, 'day'), [sessions]);
  const todayStats = useMemo(() => aggregate(todaySessions), [todaySessions]);

  // Goal-highlight (TodaySummary) + idle-ring (FocusHero) computations --
  // both depend on the same goals/sessions/settings state, so they're
  // bundled into one hook (home/useHomeGoalRing.ts) rather than computed
  // inline here; see that file's own header for why this moved out of this
  // screen once the ring gained more sources of its own to look up.
  const { goalHighlight, idleRing } = useHomeGoalRing({
    sessions,
    todayFocusS: todayStats.foc,
    goals,
    customLabels,
    themeMode,
    ringBaselineWindow,
    ringSourceKind,
    ringGoalId,
  });

  const connected = conn === 'connected';
  const canClose = connected && (status?.st === 'idle' || status?.st === 'done');
  const canOpen = connected && (status?.st === 'running' || status?.st === 'closed');

  // True for exactly one render right after the wheels below were moved by
  // the box-sync effect (not by the user's own finger) -- lets the push
  // effect skip re-sending a value the box just told us it already has,
  // instead of round-tripping the same number straight back to it.
  const syncingFromBoxRef = useRef(false);

  // Mirrors a duration changed directly on the box (its own +/- buttons or
  // swipe-to-adjust while idle) back into the app's wheels -- otherwise the
  // picker silently drifts out of sync with whatever the box is actually
  // about to lock for, since until now this sync only ever ran one way
  // (app -> box, just below). Guarded to the same states the picker itself
  // is meaningful in, and skipped once status.set already matches what's
  // picked -- which is also what stops this from re-triggering on the
  // ordinary echo of this app's own pushed value.
  useEffect(() => {
    if (!status || status.st === 'running' || status.set <= 0 || status.set === pickSeconds) return;
    // Defensive clamp only -- the box already caps at the same MAX_LOCK_SECONDS
    // (lock_config.py MAX_HOURS), so this is just guarding against a stale/odd
    // value rather than a case expected to actually trigger.
    const seconds = Math.min(MAX_LOCK_SECONDS, status.set);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60 / MINUTE_STEP) * MINUTE_STEP;
    syncingFromBoxRef.current = true;
    setPick({ hours, minutes }); // one atomic update -- see the `pick` state's own comment above
  }, [status?.set, status?.st]);

  // Push the picked duration to the box as it changes. This is what lets the
  // box's on-screen clock track the stepper live, so the picked time is
  // visible on the box before the user taps its own LOCK button.
  useEffect(() => {
    if (syncingFromBoxRef.current) {
      syncingFromBoxRef.current = false; // consumed -- this pickSeconds change came from the box, not the user
      return;
    }
    if (!connected || !canClose) return;
    setDuration(pickSeconds).catch(() => {});
  }, [pickSeconds, connected, canClose, setDuration]);

  const closeFade = useDisabledFade(!canClose);
  const openFade = useDisabledFade(!canOpen);

  // Haptics on lock/unlock and on topic selection (manager brief) -- fired
  // unconditionally, not gated on `reducedMotion`: iOS's own Settings treats
  // "Reduce Motion" and "System Haptics" as two separate toggles, and RN's
  // AccessibilityInfo only ever reports the former. A haptic tap carries the
  // same "this happened" confirmation an animation would, so it stays even
  // when the visual motion is trimmed down. `.catch(() => {})` matches this
  // file's existing setDuration()-call convention -- a missing/broken
  // haptics backend should never block the actual box command.
  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    closeBox();
  };
  const handleOpen = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    openBox();
  };
  const handleSelectTopic = (topic: string) => {
    Haptics.selectionAsync().catch(() => {});
    // Two directions, deliberately both: tagCurrentSession is the BACKWARD
    // path (remember this pick locally so buildLoggedSessions can attach it
    // to whichever history entry the box eventually hands over -- the box's
    // NVM entries have no room for a topic id), while setPendingBoxTopic is
    // the FORWARD path (push the pick to the box over BLE so pressing LOCK
    // there opens the confirm screen for this topic instead of the plain
    // picker -- see Box-code/lib/lock_controller.py's apply_ble_pending_topic
    // and go_confirming). Neither replaces the other: the forward push is
    // best-effort and silently no-ops on an old box or while disconnected,
    // in which case the backward path is still what actually tags the
    // session.
    tagCurrentSession(topic);
    setPendingBoxTopic(topic);
  };
  const openDurationSheet = () => {
    Haptics.selectionAsync().catch(() => {});
    setDurationSheetOpen(true);
  };
  const openTagSheet = () => {
    Haptics.selectionAsync().catch(() => {});
    setTagSheetOpen(true);
  };

  return (
    <View style={s.container}>
      {/* Minimal connect action -- the connection dot/label/battery display
          itself lives once, globally, in foundation's StatusStrip (App.tsx)
          now, so this is only the one action StatusStrip doesn't own.
          Used to also render the store's `error` string here (e.g. BLE's own
          "No PhoneBox found in range" scan-timeout message, ble/
          PhoneBoxClient.ts) whenever conn === 'error' -- removed (manager
          brief: "just the connect/disconnect button", no error text next to
          it). The underlying error is left alone in useStore -- this is a
          presentation change only, not a "stop tracking the error" change;
          FocusHero's own !connected copy ("Connect your box") already covers
          "not connected" without repeating BLE's internal scan-failure
          wording. `s.topBar` keeps justify-content: space-between so the
          Connect/Disconnect button stays pinned to the row's trailing edge
          exactly as before, now with nothing on the leading edge. */}
      <View style={s.topBar}>
        <View />
        <AnimatedPressable
          style={s.connectBtn}
          onPress={connected ? disconnect : connect}
          accessibilityRole="button"
          accessibilityLabel={connected ? 'Disconnect from box' : 'Connect to box'}
        >
          <Text style={s.connectBtnText}>{connected ? 'Disconnect' : 'Connect'}</Text>
        </AnimatedPressable>
      </View>

      <FocusHero
        status={status}
        connected={connected}
        pickSeconds={pickSeconds}
        currentTopic={currentTopic}
        customLabels={customLabels}
        themeMode={themeMode}
        todayFocusS={todayStats.foc}
        idleRing={idleRing}
        ringBaselineWindow={ringBaselineWindow}
        onPressIdle={openDurationSheet}
        onPressTag={openTagSheet}
      />

      {/* No remote Lock-start here -- starting a countdown has to happen
          physically at the box (tap LOCK once the phone is inside it).
          Close (arm the latch, no timer yet) and Open/unlock are
          unaffected -- both remain the "Allow open/close from this phone"
          remote actions Settings already promises. */}
      <View style={s.controlRow}>
        <AnimatedPressable
          style={[s.controlBtn, { opacity: closeFade }]}
          disabled={!canClose}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close box"
        >
          <Text style={s.controlBtnText}>Close</Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[s.controlBtn, { backgroundColor: theme.danger, opacity: openFade }]}
          disabled={!canOpen}
          onPress={handleOpen}
          accessibilityRole="button"
          accessibilityLabel="Open box"
        >
          <Text style={s.controlBtnText}>Open</Text>
        </AnimatedPressable>
      </View>
      {/* Always mounted (reserves 2 lines' worth of height via s.warnSub's
          minHeight) rather than appearing/disappearing with canOpen/
          remoteUnlockOn, which would otherwise shift TodaySummary below it
          every time those flip. */}
      <Text style={s.warnSub}>
        {canOpen && !remoteUnlockOn
          ? "Remote unlock is off in Settings -- Open won't release the box until you turn it on."
          : ''}
      </Text>

      {/* Fill-space block (manager brief, task 5): today's topic split, the
          one "at a glance" fact TodaySummary below doesn't already show.
          Reuses stats/customLabels.ts's own topicBreakdownWithCustom, so it
          can never disagree with what Stats/Calendar compute for the same
          day. Empty-safe (see TopicBreakdownStrip's own header) -- a
          disconnected or brand-new-install Home never renders this looking
          broken, just its calm "nothing tagged yet" state. */}
      <TopicBreakdownStrip
        todaySessions={todaySessions}
        customLabels={customLabels}
        themeMode={themeMode}
        onPress={() => navigate('stats', { statsPeriod: 'day' })}
      />

      <TodaySummary
        todayFocusS={todayStats.foc}
        highlight={goalHighlight}
        hasAnyGoals={goals.some((g: Goal) => !g.archived)}
        onPress={() => navigate('stats', { statsPeriod: goalHighlight ? 'goals' : 'day' })}
      />

      <DurationSheet
        visible={durationSheetOpen}
        onClose={() => setDurationSheetOpen(false)}
        hourLabels={HOUR_LABELS}
        minuteLabels={MINUTE_LABELS}
        hoursIndex={pick.hours}
        minutesIndex={minutesIndex}
        onHoursIndexChange={onHoursIndexChange}
        onMinutesIndexChange={onMinutesIndexChange}
        currentTopic={currentTopic}
        customLabels={customLabels}
        themeMode={themeMode}
        onSelectTopic={handleSelectTopic}
      />
      <TagSheet
        visible={tagSheetOpen}
        onClose={() => setTagSheetOpen(false)}
        currentTopic={currentTopic}
        customLabels={customLabels}
        themeMode={themeMode}
        onSelect={handleSelectTopic}
      />
    </View>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    // paddingTop matches the paddingTop:50 convention the other three
    // screens use for top clearance under the tab bar/notch.
    container: { flex: 1, padding: 20, paddingTop: 50, paddingBottom: 24, backgroundColor: t.bg, justifyContent: 'space-between' },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
    connectBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10, backgroundColor: t.surface },
    connectBtnText: { color: t.text, ...typeScale.label },
    controlRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
    controlBtn: {
      flex: 1,
      backgroundColor: t.accent,
      borderRadius: 10,
      padding: 12,
      alignItems: 'center',
    },
    controlBtnText: { color: t.accentText, fontWeight: '700' },
    // Same as typeScale.body, but reserves 2 lines of height so this row's
    // box doesn't collapse/grow when the warning text is hidden vs shown.
    warnSub: { color: t.textDim, ...typeScale.body, minHeight: typeScale.body.lineHeight * 2, marginTop: 4 },
  });
