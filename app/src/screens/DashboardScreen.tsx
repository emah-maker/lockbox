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
// What's left fits, on a typical device, in a single fixed-height screen: the
// home/FocusHero.tsx anchor, the Close/Open remote-control row, and
// TodaySummary -- plus, since then, home/TopicBreakdownStrip.tsx (manager
// brief: "find something more to put on the home screen to fill the
// space"), a compact today's-topic-split block between the control row and
// TodaySummary. Every block above is a fixed size (none grows to soak up
// slack), so the column's total height is only ever as tall as its content
// actually needs -- but "typical" isn't "every": a long goal/topic name
// (TodaySummary's own highlight column) or a larger system text size can
// push that total past a shorter device's available height. The outer
// ScrollView below is this layout's safety net for exactly that case, not a
// design change -- its contentContainerStyle keeps the same flexGrow+
// space-between shape, so on any screen where the content already fits
// nothing looks different; it only starts scrolling instead of letting
// TodaySummary's last line get clipped against the tab bar underneath.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, Text, ScrollView, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useTheme } from '../theme/useTheme';
import { aggregate, clampLockSeconds, MAX_LOCK_HOURS, splitLockSeconds } from '../stats/stats';
import { filterByWindow } from '../stats/sessionHistory';
import type { Goal } from '../goals/goals';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useReducedMotion } from '../ui/useReducedMotion';
import { useNowMs } from '../ui/useNowMs';
import { useNav } from '../nav/useNav';
import { typeScale, opacity } from '../theme/tokens';
import { FocusHero } from './home/FocusHero';
import { nextRingSourceKind } from './home/idleRingState';
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
  // Field-by-field, not `useStore()`. Subscribing to the whole store makes
  // this screen re-render on every field it doesn't read -- `error`,
  // `autoConnect`, `lastAlert`, `initialized`, `pendingBoxTopic` -- and the
  // store this screen watches is the one BLE writes to, so those arrive
  // unprompted rather than in response to anything the user did. It was also
  // the only whole-store subscription left in the app; every other read here
  // (and on every other screen) is already a selector.
  const conn = useStore((st) => st.conn);
  const status = useStore((st) => st.status);
  const sessions = useStore((st) => st.sessions);
  const currentTopic = useStore((st) => st.currentTopic);
  // The actions are stable identities for the life of the store (zustand
  // never re-creates them), so selecting each one can't itself cause a
  // render -- these are just reads, not subscriptions that ever fire.
  const connect = useStore((st) => st.connect);
  const disconnect = useStore((st) => st.disconnect);
  const setDuration = useStore((st) => st.setDuration);
  const closeBox = useStore((st) => st.closeBox);
  const openBox = useStore((st) => st.openBox);
  const tagCurrentSession = useStore((st) => st.tagCurrentSession);
  const setPendingBoxTopic = useStore((st) => st.setPendingBoxTopic);
  const remoteUnlockOn = useSettingsStore((st) => !!st.boxSettings.unlk);
  const themeMode = useSettingsStore((st) => st.themeMode);
  const customLabels = useSettingsStore((st) => st.customLabels);
  const excludedTopicKeys = useSettingsStore((st) => st.excludedTopicKeys);
  const ringBaselineWindow = useSettingsStore((st) => st.ringBaselineWindow);
  const ringSourceKind = useSettingsStore((st) => st.ringSourceKind);
  const ringGoalId = useSettingsStore((st) => st.ringGoalId);
  const ringShowTopicMix = useSettingsStore((st) => st.ringShowTopicMix);
  // Tap-to-cycle on the hero's own source chip writes straight back to the
  // same per-device setting Settings > Focus ring edits -- one piece of
  // state, so the two surfaces can never disagree about which source is
  // showing.
  const setRingSourceKind = useSettingsStore((st) => st.setRingSourceKind);
  const goals = useGoalsStore((st) => st.goals);
  const theme = useTheme();
  const s = styles(theme);
  // Selector, same reason as the useStore reads above: `useNav()` whole
  // would also re-render this screen whenever a *pending intent* changes,
  // which is a value only the destination screen ever consumes.
  const navigate = useNav((st) => st.navigate);
  // Ticks on its own (ui/useNowMs.ts) so "today" below re-crosses local
  // midnight while this screen just sits open, instead of freezing at
  // whatever instant todaySessions/todayStats last recomputed because
  // `sessions` happened to change reference -- see that hook's own header
  // for the underlying bug. This is the Home tab's headline number, so it's
  // the highest-visibility instance of that bug in the app.
  const nowMs = useNowMs();

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
  // consume boxOriginSecondsRef's guard before the second setState landed,
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
    boxOriginSecondsRef.current = null; // a finger moved this wheel -- what the box last told us is no longer what's picked
    setPick((p) => {
      const hours = HOUR_VALUES[index];
      const minutes = hours === 0 && p.minutes === 0 ? MINUTE_STEP : p.minutes;
      return { hours, minutes };
    });
  };
  const onMinutesIndexChange = (index: number) => {
    boxOriginSecondsRef.current = null; // as above -- a user edit supersedes the box's own last word
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
  const todaySessions = useMemo(() => filterByWindow(sessions, 'day', nowMs), [sessions, nowMs]);
  // customLabels so a session tagged with an excludeFromTotals label
  // (stats/customLabels.ts) doesn't inflate "focus time today" -- todayStats.foc
  // feeds useHomeGoalRing's todayFocusS below, which the idle ring and
  // TodaySummary both read as the day's real total.
  const todayStats = useMemo(
    () => aggregate(todaySessions, customLabels, excludedTopicKeys),
    [todaySessions, customLabels, excludedTopicKeys],
  );

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
    excludedTopicKeys,
    themeMode,
    ringBaselineWindow,
    ringSourceKind,
    ringGoalId,
    ringShowTopicMix,
  });

  const connected = conn === 'connected';
  const canClose = connected && (status?.st === 'idle' || status?.st === 'done');
  const canOpen = connected && (status?.st === 'running' || status?.st === 'closed');

  // The pickSeconds the box itself last told us about -- lets the push effect
  // skip re-sending a value the box already has, instead of round-tripping
  // the same number straight back to it.
  //
  // Keyed on the VALUE, not a one-shot `true` token. As a boolean this was set
  // by the box-sync effect but consumed by the push effect, which only runs
  // when its own deps change -- so it leaked in both directions:
  //   * Stranded: clampLockSeconds floors at MIN_LOCK_SECONDS and so isn't
  //     injective, meaning a sync can land on a `pick` whose pickSeconds is
  //     UNCHANGED. The push effect then never re-ran, the flag stayed true,
  //     and it silently swallowed the next genuine user edit's push -- the
  //     box would just never hear about the duration the wheels were showing.
  //   * Mis-consumed: the push effect also re-runs on connected/canClose, so
  //     a reconnect could eat the token before the pick change it was meant
  //     to suppress ever arrived, and that box-driven value then got pushed
  //     straight back at the box anyway.
  // A value can't be spent by the wrong render: the push effect skips exactly
  // the number the box supplied and nothing else. Cleared on any wheel edit
  // below, so a user landing back on that same number still pushes it.
  const boxOriginSecondsRef = useRef<number | null>(null);

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
    // Defensive clamp + carry handling both live in splitLockSeconds (see its
    // own doc comment) -- the box already caps at the same MAX_LOCK_SECONDS
    // (lock_config.py MAX_HOURS), but a remainder that rounds up to a full
    // hour used to land on an impossible `minutes: 60` here, which the minute
    // wheel silently rendered as 00m while pushing a whole extra hour.
    const next = splitLockSeconds(status.set, MINUTE_STEP);
    // Record the pickSeconds this will actually produce, not status.set --
    // splitLockSeconds and clampLockSeconds don't round-trip for a box value
    // below MIN_LOCK_SECONDS, and it's the derived number the push effect
    // below compares against.
    boxOriginSecondsRef.current = clampLockSeconds(next.hours, next.minutes);
    setPick(next); // one atomic update -- see the `pick` state's own comment above
  }, [status?.set, status?.st]);

  // Push the picked duration to the box as it changes. This is what lets the
  // box's on-screen clock track the stepper live, so the picked time is
  // visible on the box before the user taps its own LOCK button.
  useEffect(() => {
    if (boxOriginSecondsRef.current === pickSeconds) {
      boxOriginSecondsRef.current = null; // consumed -- this exact value came from the box, not the user
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
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
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
        currentTopic={currentTopic}
        customLabels={customLabels}
        themeMode={themeMode}
        todayFocusS={todayStats.foc}
        idleRing={idleRing}
        ringBaselineWindow={ringBaselineWindow}
        ringSourceKind={ringSourceKind}
        onCycleRingSource={() => setRingSourceKind(nextRingSourceKind(ringSourceKind))}
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
        {/* This is the one button in the app filled with `danger` rather
            than `accent`, so its label takes `dangerText` -- it used to take
            `controlBtnText`'s `accentText`, which is tuned against the
            accent, not against red (see ThemeColors.dangerText). */}
        <AnimatedPressable
          style={[s.controlBtn, { backgroundColor: theme.danger, opacity: openFade }]}
          disabled={!canOpen}
          onPress={handleOpen}
          accessibilityRole="button"
          accessibilityLabel="Open box"
        >
          <Text style={[s.controlBtnText, { color: theme.dangerText }]}>Open</Text>
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

      </ScrollView>
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
    // The ScrollView itself owns flex:1 (fills the space between the top/
    // bottom SafeAreaViews in App.tsx); this is its contentContainerStyle,
    // so flexGrow:1 (not flex:1) is what makes it fill that same space and
    // still let justifyContent:'space-between' read as one fixed screen
    // when everything fits -- flex:1 has no effect on a ScrollView's own
    // content container, which sizes to its content by default regardless.
    // paddingTop matches the paddingTop:50 convention the other three
    // screens use for top clearance under the tab bar/notch.
    screen: { flex: 1, backgroundColor: t.bg },
    container: { flexGrow: 1, padding: 20, paddingTop: 50, paddingBottom: 24, justifyContent: 'space-between' },
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
