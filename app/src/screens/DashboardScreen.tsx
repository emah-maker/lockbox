// DashboardScreen.tsx -- the focus-stats dashboard + live box status + remote
// open/close. Navigation lives in App.tsx as a trivial tab switcher; this
// stays the default landing tab.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, ScrollView, Platform, UIManager } from 'react-native';
import { BatteryIcon } from '../ui/BatteryIcon';
import { useStore, CONN_LABELS } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { aggregate, formatDuration, completionRate, clampLockSeconds, MAX_LOCK_HOURS, MAX_LOCK_SECONDS } from '../stats/stats';
import { TopicPicker } from './TopicPicker';
import { lastNDays } from '../stats/trend';
import { filterByWindow } from '../stats/sessionHistory';
import type { Status } from '../ble/protocol';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { AnimatedFill } from '../ui/AnimatedFill';
import { WheelPicker } from '../ui/WheelPicker';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { typeScale, elevation, opacity } from '../theme/tokens';

const SPARK_MAX_H = 28;

/** Battery-level color following the box's own threshold language
 * (Box-code/lib/lock_ui.py update_battery_view: >=50% accent-ish/green,
 * >=20% amber, else red) instead of a flat textDim -- the number alone
 * doesn't carry the same at-a-glance urgency the box's own screen gives it. */
function batteryColor(pct: number, t: ReturnType<typeof useTheme>): string {
  if (pct < 0) return t.textDim;
  if (pct >= 50) return t.accent;
  if (pct >= 20) return t.warn;
  return t.danger;
}

const DISABLED_OPACITY = opacity.disabled;

/** Fades a button's opacity between enabled/disabled instead of an instant
 * cut, so losing/gaining availability (e.g. Open as box state changes) reads
 * as a state transition rather than a jump. */
function useDisabledFade(disabled: boolean) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(disabled ? DISABLED_OPACITY : 1)).current;
  useEffect(() => {
    const toValue = disabled ? DISABLED_OPACITY : 1;
    if (reducedMotion) {
      opacity.setValue(toValue);
      return;
    }
    Animated.timing(opacity, { toValue, duration: 150, useNativeDriver: true }).start();
  }, [disabled, reducedMotion]);
  return opacity;
}

// Android needs this opt-in for LayoutAnimation; iOS has it on unconditionally.
// Safe to call at module scope -- it's idempotent and side-effect-free until
// something actually calls LayoutAnimation.configureNext().
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const MINUTE_STEP = 5;
// Wheel contents for the H/M duration picker -- hours 0..MAX_LOCK_HOURS,
// minutes in the same 5-minute steps the old stepper used.
const HOUR_VALUES = Array.from({ length: MAX_LOCK_HOURS + 1 }, (_, i) => i);
const MINUTE_VALUES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const HOUR_LABELS = HOUR_VALUES.map((h) => `${h}h`);
const MINUTE_LABELS = MINUTE_VALUES.map((m) => `${String(m).padStart(2, '0')}m`);

/** Fraction of the configured lock duration elapsed so far, for the running
 * -session progress meter. 0 when `set` is unknown (0). */
function elapsedFraction(status: Status): number {
  if (status.set <= 0) return 0;
  return Math.max(0, Math.min(1, (status.set - status.rem) / status.set));
}

export default function DashboardScreen() {
  const {
    conn,
    error,
    status,
    sessions,
    currentTopic,
    connect,
    disconnect,
    setDuration,
    closeBox,
    openBox,
    tagCurrentSession,
  } = useStore();
  const remoteUnlockOn = useSettingsStore((st) => !!st.boxSettings.unlk);
  const themeMode = useSettingsStore((st) => st.themeMode);
  const customLabels = useSettingsStore((st) => st.customLabels);
  const theme = useTheme();
  const s = styles(theme);
  const reducedMotion = useReducedMotion();

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
  const [pick, setPick] = useState({ hours: 0, minutes: 25 });
  // While a finger is down on the wheel pickers, the outer screen ScrollView
  // must not steal the vertical drag -- two nested vertical scrollers
  // competing for the same gesture is why swiping a wheel used to just
  // scroll the whole screen instead. Plain React state driving the
  // ScrollView's own `scrollEnabled` prop -- NOT a ref + setNativeProps --
  // is deliberate here: setNativeProps is a documented React Native escape
  // hatch (writes straight to the native view, bypassing props
  // reconciliation) that was tried first for lower latency, but it's exactly
  // the kind of imperative/render-desync footgun RN's own docs warn is
  // "difficult to follow" and not guaranteed safe to mix with an Animated
  // native-driven ScrollView -- it lined up with reports of the picker (and
  // occasionally the whole app) freezing. A state-driven prop can only ever
  // be as fast as the next render, which very occasionally means a swipe
  // has to be repeated, but it can never leave native and JS holding
  // conflicting ideas of whether this view is scrollable.
  const [pickerActive, setPickerActive] = useState(false);
  // Belt-and-suspenders against WheelPicker's onDragEnd not firing -- same
  // reasoning as clampLockSeconds double-clamping what the box already caps.
  // Observed at the wheels' hard limits (0m/55m, 0h/9h): releasing while the
  // ScrollView is still elastically bouncing back from an overscroll at the
  // edge (the "screen moves up and down" at those exact values) could leave
  // the outer ScrollView disabled with no gesture left to ever re-enable it,
  // reading as the whole Focus screen freezing. No real drag+bounce-settle
  // takes anywhere near this long, so a stuck flag always means the paired
  // unlock was lost, not a session still legitimately in progress.
  const pickerSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockOuterScroll = () => {
    setPickerActive(true);
    if (pickerSafetyTimer.current) clearTimeout(pickerSafetyTimer.current);
    pickerSafetyTimer.current = setTimeout(() => setPickerActive(false), 600);
  };
  const unlockOuterScroll = () => {
    if (pickerSafetyTimer.current) {
      clearTimeout(pickerSafetyTimer.current);
      pickerSafetyTimer.current = null;
    }
    setPickerActive(false);
  };
  useEffect(() => () => {
    if (pickerSafetyTimer.current) clearTimeout(pickerSafetyTimer.current);
  }, []);
  const pickSeconds = clampLockSeconds(pick.hours, pick.minutes);
  const minutesIndex = Math.max(0, MINUTE_VALUES.indexOf(pick.minutes));

  const onHoursIndexChange = (index: number) => {
    setPick((p) => ({ ...p, hours: HOUR_VALUES[index] }));
  };
  const onMinutesIndexChange = (index: number) => {
    setPick((p) => ({ ...p, minutes: MINUTE_VALUES[index] }));
  };

  // Computed here, not read over BLE: the box keeps no long-term stats of its
  // own (no SD card, no NVM -- see Box-code/lib/lock_log.py), so the app's
  // local session log (synced live + drained from the box on connect) is the
  // only copy, and the only place these aggregates can come from.
  const stats = useMemo(() => aggregate(sessions), [sessions]);
  // Headline "focus time" figure is scoped to today only (manager request) --
  // everything else in this card (session count, completion rate, streak,
  // longest) stays a lifetime figure from `stats` above, same as before and
  // matching StatsScreen's own precedent of never windowing streak/longest.
  // filterByWindow('day', ...) anchors to local midnight, same helper
  // StatsScreen uses for its own "day" window.
  const todayStats = useMemo(() => aggregate(filterByWindow(sessions, 'day')), [sessions]);
  // Same real per-day totals StatsScreen's "Last 7 days" advanced view
  // computes -- surfaced here too, as a compact sparkline, so the Focus
  // card gives an at-a-glance shape without switching tabs or opting into
  // Advanced stats.
  const trend = useMemo(() => lastNDays(sessions), [sessions]);
  const trendMax = Math.max(1, ...trend.map((d) => d.focusS));

  // Animates the running-session meter toward each BLE status tick instead of
  // snapping -- width can't use the native driver, but a single bar's layout
  // recalculation per tick is cheap, unlike animating layout on a big DOM tree.
  const meterAnim = useRef(new Animated.Value(status ? elapsedFraction(status) : 0)).current;
  useEffect(() => {
    if (!status) return;
    const toValue = elapsedFraction(status);
    if (reducedMotion) {
      meterAnim.setValue(toValue);
      return;
    }
    Animated.timing(meterAnim, {
      toValue,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [status?.rem, status?.set, reducedMotion]);

  // The topic-tagging chip row appears/disappears with the running state;
  // animate that shape change instead of a hard pop.
  useEffect(() => {
    configureLayoutAnimation(reducedMotion);
  }, [status?.st === 'running']);

  const connected = conn === 'connected';
  // Same status-dot language as SettingsScreen's connBadge -- the two screens
  // show the same connection state and should read identically at a glance.
  // Fixed green/red, not accent/textDim -- this dot is a status indicator
  // (like the box's own locked=red/closed=amber/unlocked=green), so it must
  // read the same regardless of which accent is picked, and disconnected
  // (idle/scanning/connecting/error alike) must always read as clearly "not
  // connected", not a neutral grey that only turns red on a hard error.
  const connColor = connected ? theme.success : theme.danger;
  const canClose = connected && (status?.st === 'idle' || status?.st === 'done');
  const canOpen = connected && (status?.st === 'running' || status?.st === 'closed');
  // Unlike canClose (which also gates the actual Close button -- that one
  // has to require a live BLE connection), the duration picker itself stays
  // up whenever there's no reason to hide it: while disconnected (status is
  // null) or once a session's finished (idle/done). It only hides while a
  // session is actively running, since there's nothing to preview a
  // duration for until that session ends. Previously this piggybacked on
  // canClose, so the whole picker vanished on disconnect instead of just
  // staying put with nothing to push yet.
  const showDurationPicker = !status || status.st === 'idle' || status.st === 'done';
  const closeFade = useDisabledFade(!canClose);
  const openFade = useDisabledFade(!canOpen);

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
  // is shown in, and skipped once status.set already matches what's
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

  return (
    <ScrollView scrollEnabled={!pickerActive} contentContainerStyle={s.container}>
      {/* Connection state and box status share one card that's always
          mounted -- it used to be two pieces (an always-visible "Connection"
          card and a separate "Box status" card that only existed once
          `status` arrived), and that card popping in/out on every
          connect/disconnect was the biggest layout jump on this screen.
          Now the same card just swaps its status line to "Not connected"
          and leaves the battery/close/open rows in place (disabled) instead
          of unmounting them. */}
      <View style={s.card}>
        <Text style={s.label}>Box</Text>
        <View style={s.connRow}>
          <View style={[s.connDot, { backgroundColor: connColor }]} />
          <Text style={s.value}>{status ? status.st.toUpperCase() : CONN_LABELS[conn]}</Text>
        </View>
        {error && conn === 'error' ? <Text style={s.error}>{error}</Text> : null}
        <AnimatedPressable style={s.btn} onPress={connected ? disconnect : connect}>
          <Text style={s.btnText}>{connected ? 'Disconnect' : 'Connect'}</Text>
        </AnimatedPressable>

        {/* Always mounted, same "reserve the space, don't unmount" fix as
            this card's own merge (see the comment above) -- previously this
            whole block appeared/disappeared with running state, shifting
            the battery/control rows below it up and down every time a
            session started or ended. The track shows an empty (0%) bar
            instead of the real one while not running, so the row's height
            never changes, only its content. */}
        <Text style={s.sub}>{status?.st === 'running' ? `${formatDuration(status.rem)} left` : ' '}</Text>
        <View style={[s.meterTrack, { backgroundColor: withAlpha(theme.accent, 0.2) }]}>
          <Animated.View
            style={[
              s.meterFill,
              {
                backgroundColor: theme.accent,
                width:
                  status?.st === 'running'
                    ? meterAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                    : '0%',
              },
            ]}
          />
        </View>

        <View style={s.battRow}>
          <BatteryIcon pct={status ? status.bat : -1} color={status ? batteryColor(status.bat, theme) : theme.textDim} />
          <Text style={s.sub}>Battery {status && status.bat >= 0 ? `${status.bat}%` : '—'}</Text>
        </View>

        {/* No remote Lock-start here -- starting a countdown has to happen
            physically at the box (tap LOCK once the phone is inside it).
            Close (arm the latch, no timer yet) and Open/unlock are
            unaffected -- both remain the "Allow open/close from this
            phone" remote actions Settings already promises. */}
        <View style={s.controlRow}>
          <AnimatedPressable
            style={[s.controlBtn, { opacity: closeFade }]}
            disabled={!canClose}
            onPress={closeBox}
          >
            <Text style={s.controlBtnText}>Close</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={[
              s.controlBtn,
              { backgroundColor: theme.danger },
              { opacity: openFade },
            ]}
            disabled={!canOpen}
            onPress={openBox}
          >
            <Text style={s.controlBtnText}>Open</Text>
          </AnimatedPressable>
        </View>
        {/* Always mounted (reserves 2 lines' worth of height via s.warnSub's
            minHeight) rather than appearing/disappearing with canOpen/
            remoteUnlockOn, which used to shift the duration-picker/topic-
            picker block below it every time those flipped. */}
        <Text style={s.warnSub}>
          {canOpen && !remoteUnlockOn
            ? "Remote unlock is off in Settings -- Open won't release the box until you turn it on."
            : ''}
        </Text>

        {showDurationPicker && (
          <View style={s.pickerBlock}>
            {/* Duration only -- no lock button here. Locking has to happen
                at the box (tap LOCK once the phone is physically inside);
                this just previews/pushes the duration live (see the
                setDuration effect above) so the box's clock reflects it. */}
            <Text style={s.label}>Set lock duration</Text>
            <View
              style={s.pickerRow}
              onTouchStart={lockOuterScroll}
              onTouchEnd={unlockOuterScroll}
              onTouchCancel={unlockOuterScroll}
            >
              {/* onTouchStart above disables the outer scroll early enough to
                  win the gesture; onTouchEnd/onTouchCancel only re-enable it
                  reliably for a tap that never became a drag -- once a wheel
                  actually captures a drag, this wrapping View stops getting
                  touch-end/-cancel at all (only the responder does), so
                  onDragEnd below is the guaranteed re-enable for that case.
                  Without it, an actual swipe left the outer scroll disabled
                  forever, reading as the whole screen freezing. */}
              <WheelPicker
                labels={HOUR_LABELS}
                selectedIndex={pick.hours}
                onChange={onHoursIndexChange}
                onDragStart={lockOuterScroll}
                onDragEnd={unlockOuterScroll}
                accessibilityLabel="Lock duration, hours"
              />
              <WheelPicker
                labels={MINUTE_LABELS}
                selectedIndex={minutesIndex}
                onChange={onMinutesIndexChange}
                onDragStart={lockOuterScroll}
                onDragEnd={unlockOuterScroll}
                accessibilityLabel="Lock duration, minutes"
              />
            </View>
            <TopicPicker
              heading="Tag this session before you lock it"
              currentTopic={currentTopic}
              customLabels={customLabels}
              themeMode={themeMode}
              theme={theme}
              onSelect={tagCurrentSession}
            />
          </View>
        )}

        {status?.st === 'running' && (
          <TopicPicker
            heading="What are you focusing on?"
            currentTopic={currentTopic}
            customLabels={customLabels}
            themeMode={themeMode}
            theme={theme}
            onSelect={tagCurrentSession}
          />
        )}
      </View>

      {/* minHeight sized to the full-stats variant below (label + big number
          + sub + 4 stat rows + sparkline row + card padding/gaps) so the
          empty-history placeholder doesn't leave this card short and make
          the rest of the screen jump up/down the moment the first session
          is logged. Reasoned from typeScale line-heights + s.card's own
          padding/gap, not measured in a live layout inspector -- verify
          visually and adjust if it's off. */}
      <View style={[s.card, { minHeight: 260 }]}>
        <Text style={s.label}>Focus</Text>
        {stats.n > 0 ? (
          <>
            <Text style={s.big}>{formatDuration(todayStats.foc)}</Text>
            <Text style={s.sub}>focus time today</Text>
            <Text style={s.row}>Sessions: {stats.n}</Text>
            <Text style={s.row}>
              Completed: {stats.done}/{stats.n} ({completionRate(stats)}%)
            </Text>
            <Text style={s.row}>Streak: {stats.str}</Text>
            <Text style={s.row}>Longest: {formatDuration(stats.lng)}</Text>
            <View style={s.sparkRow}>
              {trend.map((d) => {
                const h = Math.max(2, Math.round((d.focusS / trendMax) * SPARK_MAX_H));
                return (
                  <View key={d.key} style={s.sparkCol}>
                    <View style={[s.sparkTrack, { backgroundColor: withAlpha(theme.accent, 0.12) }]}>
                      <AnimatedFill axis="height" toValue={h} style={s.sparkBar} color={theme.accent} />
                    </View>
                    <Text style={s.sparkLabel}>{d.label}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <Text style={s.sub}>Start a session to see focus stats here.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    // paddingTop replaces the old h1 title's marginTop:40 for top clearance
    // now that the title (redundant with the bottom tab bar's own label,
    // manager request) is gone -- matches the paddingTop:50 convention the
    // other three screens already use for the same purpose.
    container: { padding: 20, paddingTop: 50, gap: 16, backgroundColor: t.bg, paddingBottom: 60 },
    card: { backgroundColor: t.surface, borderRadius: 14, padding: 16, gap: 6, ...elevation.card },
    label: { color: t.textDim, ...typeScale.label },
    value: { color: t.text, fontSize: 22, fontWeight: '600' },
    big: { color: t.accent, ...typeScale.display },
    sub: { color: t.textDim, ...typeScale.body },
    // Same as `sub`, but reserves 2 lines of height (typeScale.body.lineHeight
    // * 2) so this row's box doesn't collapse/grow when the warning text is
    // hidden vs shown -- see the remote-unlock warning above.
    warnSub: { color: t.textDim, ...typeScale.body, minHeight: typeScale.body.lineHeight * 2 },
    row: { color: t.text, fontSize: 16, marginTop: 2 },
    error: { color: t.danger, fontSize: 13 },
    btn: { backgroundColor: t.accent, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 },
    btnText: { color: t.accentText, fontWeight: '700' },
    connRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    connDot: { width: 8, height: 8, borderRadius: 4 },
    battRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    controlRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
    controlBtn: {
      flex: 1,
      backgroundColor: t.accent,
      borderRadius: 10,
      padding: 12,
      alignItems: 'center',
    },
    controlBtnText: { color: t.accentText, fontWeight: '700' },
    pickerBlock: { marginTop: 12 },
    pickerRow: { flexDirection: 'row', gap: 16, marginTop: 6 },
    meterTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 2 },
    meterFill: { height: '100%', borderRadius: 4 },
    sparkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10, gap: 4 },
    sparkCol: { alignItems: 'center', gap: 4, flex: 1 },
    sparkTrack: { width: 12, height: SPARK_MAX_H, borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
    sparkBar: { width: '100%', borderRadius: 6 },
    sparkLabel: { ...typeScale.caption, color: t.textDim },
  });
