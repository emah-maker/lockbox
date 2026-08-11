// DashboardScreen.tsx -- the focus-stats dashboard + live box status + remote
// open/close. Navigation lives in App.tsx as a trivial tab switcher; this
// stays the default landing tab.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, Switch, ScrollView, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useStore, CONN_LABELS } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { aggregate, formatDuration, completionRate, clampLockSeconds, MAX_LOCK_HOURS } from '../stats/stats';
import { allLabelChoices, resolveTopic } from '../stats/customLabels';
import type { Status } from '../ble/protocol';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useReducedMotion } from '../ui/useReducedMotion';
import { typeScale, elevation } from '../theme/tokens';

const DISABLED_OPACITY = 0.35;

/** Fades a button's opacity between enabled/disabled instead of an instant
 * cut, so losing/gaining availability (e.g. Close vs. Open as box state
 * changes) reads as a state transition rather than a jump. */
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
    startLock,
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

  // Duration picker for "Lock for H:MM" -- local to this screen, not persisted;
  // startLock(seconds) both sets the box's duration and starts the countdown
  // (Box-code/lib/lock_controller.apply_ble_command "start:<seconds>").
  const [pickHours, setPickHours] = useState(0);
  const [pickMinutes, setPickMinutes] = useState(25);
  const pickSeconds = clampLockSeconds(pickHours, pickMinutes);

  const stepPickHours = (dir: 1 | -1) => {
    const next = Math.max(0, Math.min(MAX_LOCK_HOURS, pickHours + dir));
    setPickHours(next);
    if (next >= MAX_LOCK_HOURS) setPickMinutes(0); // 9:00 is the cap -- no extra minutes
  };
  const stepPickMinutes = (dir: 1 | -1) => {
    if (pickHours >= MAX_LOCK_HOURS) return;
    setPickMinutes((m) => Math.max(0, Math.min(55, m + dir * MINUTE_STEP)));
  };

  // Computed here, not read over BLE: the box keeps no long-term stats of its
  // own (no SD card, no NVM -- see Box-code/lib/lock_log.py), so the app's
  // local session log (synced live + drained from the box on connect) is the
  // only copy, and the only place these aggregates can come from.
  const stats = useMemo(() => aggregate(sessions), [sessions]);

  // Animates the running-session meter toward each BLE status tick instead of
  // snapping -- width can't use the native driver, but a single bar's layout
  // recalculation per tick is cheap, unlike animating layout on a big DOM tree.
  const meterAnim = useRef(new Animated.Value(status ? elapsedFraction(status) : 0)).current;
  useEffect(() => {
    if (!status) return;
    Animated.timing(meterAnim, {
      toValue: elapsedFraction(status),
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [status?.rem, status?.set]);

  // The topic-tagging chip row appears/disappears with the running state;
  // animate that shape change instead of a hard pop.
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [status?.st === 'running']);

  const connected = conn === 'connected';
  const canClose = connected && (status?.st === 'idle' || status?.st === 'done');
  const canOpen = connected && (status?.st === 'running' || status?.st === 'closed');
  const closeFade = useDisabledFade(!canClose);
  const openFade = useDisabledFade(!canOpen);
  const lockFade = useDisabledFade(pickSeconds <= 0);

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Text style={s.h1}>Phone Box</Text>

      <View style={s.card}>
        <Text style={s.label}>Connection</Text>
        <Text style={s.value}>{CONN_LABELS[conn]}</Text>
        {error && conn !== 'error' ? <Text style={s.error}>{error}</Text> : null}
        <AnimatedPressable style={s.btn} onPress={connected ? disconnect : connect}>
          <Text style={s.btnText}>{connected ? 'Disconnect' : 'Connect'}</Text>
        </AnimatedPressable>
      </View>

      {status && (
        <View style={s.card}>
          <Text style={s.label}>Box status</Text>
          <Text style={s.value}>{status.st.toUpperCase()}</Text>
          {status.st === 'running' && (
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
          <Text style={s.sub}>Battery {status.bat < 0 ? '—' : `${status.bat}%`}</Text>

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
              <Text style={s.label}>Or lock for a set time</Text>
              <View style={s.pickerRow}>
                <DurationStepper
                  value={`${pickHours}h`}
                  onMinus={() => stepPickHours(-1)}
                  onPlus={() => stepPickHours(1)}
                  theme={theme}
                  s={s}
                />
                <DurationStepper
                  value={`${String(pickMinutes).padStart(2, '0')}m`}
                  onMinus={() => stepPickMinutes(-1)}
                  onPlus={() => stepPickMinutes(1)}
                  disabled={pickHours >= MAX_LOCK_HOURS}
                  theme={theme}
                  s={s}
                />
              </View>
              <AnimatedPressable
                style={[s.controlBtn, s.lockForBtn, { opacity: lockFade }]}
                disabled={pickSeconds <= 0}
                onPress={() => startLock(pickSeconds)}
              >
                <Text style={s.controlBtnText}>
                  Lock for {pickHours}:{String(pickMinutes).padStart(2, '0')}
                </Text>
              </AnimatedPressable>
            </View>
          )}

          {status.st === 'running' && (
            <View style={{ marginTop: 8 }}>
              <Text style={s.label}>
                {currentTopic
                  ? `Tagged: ${resolveTopic(currentTopic, customLabels, themeMode)?.label ?? currentTopic}`
                  : 'What are you focusing on?'}
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
                      onPress={() => tagCurrentSession(choice.id)}
                    >
                      <Text style={[s.topicChipText, { color: active ? choice.textColor : theme.text }]}>
                        {choice.label}
                      </Text>
                    </AnimatedPressable>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      )}

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
        <Text style={s.sub}>
          When locked, an incoming call lights up the box screen (it never unlocks).
        </Text>
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

// Local stepper matching SettingsScreen's StepperRow (-/+ buttons) convention,
// sized for this screen's two-up hours/minutes row.
function DurationStepper({
  value,
  onMinus,
  onPlus,
  disabled,
  theme,
  s,
}: {
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>;
  s: ReturnType<typeof styles>;
}) {
  const fade = useDisabledFade(!!disabled);
  return (
    <View style={s.stepper}>
      <AnimatedPressable
        style={[s.stepBtn, { borderColor: theme.textDim, opacity: fade }]}
        disabled={disabled}
        onPress={onMinus}
      >
        <Text style={{ color: theme.text, fontSize: 18 }}>-</Text>
      </AnimatedPressable>
      <Text style={s.stepValue}>{value}</Text>
      <AnimatedPressable
        style={[s.stepBtn, { borderColor: theme.textDim, opacity: fade }]}
        disabled={disabled}
        onPress={onPlus}
      >
        <Text style={{ color: theme.text, fontSize: 18 }}>+</Text>
      </AnimatedPressable>
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
    lockForBtn: { marginTop: 10 },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepBtn: {
      width: 32,
      height: 32,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepValue: { minWidth: 40, textAlign: 'center', color: t.text, fontSize: 15, fontWeight: '600' },
    meterTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 2 },
    meterFill: { height: '100%', borderRadius: 4 },
    topicChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    topicChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5 },
    topicChipText: { ...typeScale.label },
  });
