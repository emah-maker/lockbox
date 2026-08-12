// DashboardScreen.tsx -- the focus-stats dashboard + live box status + remote
// open/close. Navigation lives in App.tsx as a trivial tab switcher; this
// stays the default landing tab.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, Switch, ScrollView, Platform, UIManager } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useStore, CONN_LABELS } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { aggregate, formatDuration, completionRate, clampLockSeconds, MAX_LOCK_HOURS } from '../stats/stats';
import { allLabelChoices, resolveTopic } from '../stats/customLabels';
import { lastNDays } from '../stats/trend';
import type { Status } from '../ble/protocol';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { AnimatedFill } from '../ui/AnimatedFill';
import { WheelPicker } from '../ui/WheelPicker';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { typeScale, elevation } from '../theme/tokens';

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

const DISABLED_OPACITY = 0.35;

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
    lastAlert,
    currentTopic,
    callDetectionAvailable,
    connect,
    disconnect,
    setDuration,
    closeBox,
    openBox,
    tagCurrentSession,
  } = useStore();
  const callAlertsEnabled = useSettingsStore((st) => st.callAlertsEnabled);
  const setCallAlertsEnabled = useSettingsStore((st) => st.setCallAlertsEnabled);
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
  const [pickHours, setPickHours] = useState(0);
  const [pickMinutes, setPickMinutes] = useState(25);
  // While a finger is down on the wheel pickers, the outer screen ScrollView
  // must not steal the vertical drag -- two nested vertical scrollers
  // competing for the same gesture is why swiping a wheel used to just
  // scroll the whole screen instead.
  const [pickerTouched, setPickerTouched] = useState(false);
  const pickSeconds = clampLockSeconds(pickHours, pickMinutes);

  // 9:00 is the cap -- once hours hits it, the minutes wheel has nothing
  // left to offer but 0 (mirrors the old stepper's clamp).
  const atMaxHours = pickHours >= MAX_LOCK_HOURS;
  const minuteValues = atMaxHours ? [0] : MINUTE_VALUES;
  const minuteLabels = atMaxHours ? ['00m'] : MINUTE_LABELS;
  const minutesIndex = Math.max(0, minuteValues.indexOf(pickMinutes));

  const onHoursIndexChange = (index: number) => {
    const next = HOUR_VALUES[index];
    setPickHours(next);
    if (next >= MAX_LOCK_HOURS) setPickMinutes(0);
  };
  const onMinutesIndexChange = (index: number) => {
    setPickMinutes(minuteValues[index]);
  };

  // Computed here, not read over BLE: the box keeps no long-term stats of its
  // own (no SD card, no NVM -- see Box-code/lib/lock_log.py), so the app's
  // local session log (synced live + drained from the box on connect) is the
  // only copy, and the only place these aggregates can come from.
  const stats = useMemo(() => aggregate(sessions), [sessions]);
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
  const connColor = conn === 'connected' ? theme.accent : conn === 'error' ? theme.danger : theme.textDim;
  const canClose = connected && (status?.st === 'idle' || status?.st === 'done');
  const canOpen = connected && (status?.st === 'running' || status?.st === 'closed');
  const closeFade = useDisabledFade(!canClose);
  const openFade = useDisabledFade(!canOpen);

  // Push the picked duration to the box as it changes. This is what lets the
  // box's on-screen clock track the stepper live, so the picked time is
  // visible on the box before the user taps its own LOCK button.
  useEffect(() => {
    if (!connected || !canClose) return;
    setDuration(pickSeconds).catch(() => {});
  }, [pickSeconds, connected, canClose, setDuration]);

  return (
    <ScrollView contentContainerStyle={s.container} scrollEnabled={!pickerTouched}>
      <Text style={s.h1}>Phone Box</Text>

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

        {status?.st === 'running' && (
          <>
            <Text style={s.sub}>{formatDuration(status.rem)} left</Text>
            <View style={[s.meterTrack, { backgroundColor: withAlpha(theme.accent, 0.2) }]}>
              <Animated.View
                style={[
                  s.meterFill,
                  {
                    backgroundColor: theme.accent,
                    width: meterAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  },
                ]}
              />
            </View>
          </>
        )}

        <View style={s.battRow}>
          <Feather name="battery" size={14} color={status ? batteryColor(status.bat, theme) : theme.textDim} />
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
        {canOpen && !remoteUnlockOn && (
          <Text style={s.sub}>
            Remote unlock is off in Settings -- Open won't release the box until you turn it on.
          </Text>
        )}

        {canClose && (
          <View style={s.pickerBlock}>
            {/* Duration only -- no lock button here. Locking has to happen
                at the box (tap LOCK once the phone is physically inside);
                this just previews/pushes the duration live (see the
                setDuration effect above) so the box's clock reflects it. */}
            <Text style={s.label}>Set lock duration</Text>
            <View
              style={s.pickerRow}
              onTouchStart={() => setPickerTouched(true)}
              onTouchEnd={() => setPickerTouched(false)}
              onTouchCancel={() => setPickerTouched(false)}
            >
              <WheelPicker labels={HOUR_LABELS} selectedIndex={pickHours} onChange={onHoursIndexChange} />
              <WheelPicker labels={minuteLabels} selectedIndex={minutesIndex} onChange={onMinutesIndexChange} />
            </View>
            <TopicPicker
              heading="Tag this session before you lock it"
              currentTopic={currentTopic}
              customLabels={customLabels}
              themeMode={themeMode}
              theme={theme}
              s={s}
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
            s={s}
            onSelect={tagCurrentSession}
          />
        )}
      </View>

      <View style={s.card}>
        <Text style={s.label}>Focus</Text>
        {stats.n > 0 ? (
          <>
            <Text style={s.big}>{formatDuration(stats.foc)}</Text>
            <Text style={s.sub}>focus time</Text>
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

      <View style={s.card}>
        <View style={s.switchRow}>
          <Text style={s.label}>Alert box on incoming calls</Text>
          <Switch value={callAlertsEnabled} onValueChange={setCallAlertsEnabled} />
        </View>
        {callAlertsEnabled && !callDetectionAvailable ? (
          <Text style={[s.sub, { color: theme.danger }]}>
            Call detection isn't available in this build -- it needs a dev-client build
            (npx expo prebuild + run:ios), not Expo Go, so calls won't be seen yet.
          </Text>
        ) : null}
        {lastAlert ? <Text style={s.sub}>Last alert sent: {lastAlert}</Text> : null}
      </View>
    </ScrollView>
  );
}

// Shared by the pre-session picker (canClose, above) and the in-session chip
// row (status.st === 'running') so both tagging moments render identically
// and stay backed by the same custom-label catalog.
function TopicPicker({
  heading,
  currentTopic,
  customLabels,
  themeMode,
  theme,
  s,
  onSelect,
}: {
  heading: string;
  currentTopic: string | null;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  theme: ReturnType<typeof useTheme>;
  s: ReturnType<typeof styles>;
  onSelect: (topic: string) => void;
}) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={s.label}>
        {currentTopic
          ? `Tagged: ${resolveTopic(currentTopic, customLabels, themeMode)?.label ?? currentTopic}`
          : heading}
      </Text>
      <View style={s.topicChipRow}>
        {allLabelChoices(customLabels, themeMode).map((choice) => {
          const active = currentTopic === choice.id;
          return (
            <AnimatedPressable
              key={choice.id}
              style={[
                s.topicChip,
                { borderColor: choice.color },
                active && { backgroundColor: choice.color },
              ]}
              onPress={() => onSelect(choice.id)}
            >
              <Text style={[s.topicChipText, { color: active ? choice.textColor : theme.text }]}>
                {choice.label}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: { padding: 20, gap: 16, backgroundColor: t.bg, paddingBottom: 60 },
    h1: { color: t.text, ...typeScale.title, marginTop: 40 },
    card: { backgroundColor: t.surface, borderRadius: 14, padding: 16, gap: 6, ...elevation.card },
    label: { color: t.textDim, ...typeScale.label },
    value: { color: t.text, fontSize: 22, fontWeight: '600' },
    big: { color: t.accent, ...typeScale.display },
    sub: { color: t.textDim, ...typeScale.body },
    row: { color: t.text, fontSize: 16, marginTop: 2 },
    error: { color: t.danger, fontSize: 13 },
    btn: { backgroundColor: t.accent, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 },
    btnText: { color: t.accentText, fontWeight: '700' },
    connRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    connDot: { width: 8, height: 8, borderRadius: 4 },
    battRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
    topicChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    topicChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5 },
    sparkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10, gap: 4 },
    sparkCol: { alignItems: 'center', gap: 4, flex: 1 },
    sparkTrack: { width: 12, height: SPARK_MAX_H, borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
    sparkBar: { width: '100%', borderRadius: 6 },
    sparkLabel: { ...typeScale.caption, color: t.textDim },
    topicChipText: { ...typeScale.label },
  });
