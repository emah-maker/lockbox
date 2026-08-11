// CalendarScreen.tsx -- month grid over the local session log (sessionHistory
// via useStore.sessions). Each day with focus time gets a dot; tapping a day
// lists that day's sessions below the grid.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { formatDuration } from '../stats/stats';
import { dayKey, groupByDay, LoggedSession } from '../stats/sessionHistory';
import { dominantTopicWithCustom, resolveTopic, allLabelChoices, ResolvedTopic } from '../stats/customLabels';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { typeScale, elevation, springs } from '../theme/tokens';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function buildGrid(monthStart: Date): (Date | null)[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = monthStart.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function CalendarScreen() {
  const c = useTheme();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const sessions = useStore((s) => s.sessions);
  const retagSession = useStore((s) => s.retagSession);
  const [cursor, setCursor] = useState(startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState<string>(dayKey(Date.now()));
  const [taggingSession, setTaggingSession] = useState<LoggedSession | null>(null);
  const reducedMotion = useReducedMotion();

  // Month nav gets directional motion (spatial consistency: "next" content
  // enters from the right, "prev" from the left) instead of the grid just
  // popping to the new month in place. Entering/exiting ease-out + a
  // "dropdowns, cards" duration, both from motion-and-animation.md's tables --
  // not invented values. A timing, not a spring, since this is a tap-triggered
  // entrance with no gesture/velocity to hand off.
  const MONTH_SLIDE_DISTANCE = 24;
  const MONTH_SLIDE_DURATION = 220;
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

  const byDay = useMemo(() => groupByDay(sessions), [sessions]);
  const grid = useMemo(() => buildGrid(cursor), [cursor]);
  const todayKey = dayKey(Date.now());

  const maxFocus = useMemo(() => {
    let max = 0;
    for (const list of byDay.values()) {
      const total = list.reduce((sum, s) => sum + s.actualS, 0);
      if (total > max) max = total;
    }
    return max || 1;
  }, [byDay]);

  const selectedSessions: LoggedSession[] = byDay.get(selectedKey) ?? [];

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.h1, { color: c.text }]}>Focus Calendar</Text>

      <View style={styles.monthHeader}>
        <AnimatedPressable
          style={styles.navBtn}
          onPress={() => {
            configureLayoutAnimation(reducedMotion);
            animateMonthChange(-1);
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
          }}
        >
          <Feather name="chevron-left" size={22} color={c.accent} />
        </AnimatedPressable>
        <Text style={[styles.monthLabel, { color: c.text }]}>
          {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </Text>
        <AnimatedPressable
          style={styles.navBtn}
          onPress={() => {
            configureLayoutAnimation(reducedMotion);
            animateMonthChange(1);
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
          }}
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
        style={[styles.grid, { opacity: monthOpacity, transform: [{ translateX: monthSlideX }] }]}
      >
        {grid.map((date, i) => {
          if (!date) return <View key={i} style={styles.cell} />;
          const key = dayKey(date.getTime());
          const daySessions = byDay.get(key) ?? [];
          const focusS = daySessions.reduce((sum, s) => sum + s.actualS, 0);
          const intensity = focusS > 0 ? 0.25 + 0.75 * Math.min(1, focusS / maxFocus) : 0;
          const selected = key === selectedKey;
          const isToday = key === todayKey;
          const dominant = dominantTopicWithCustom(daySessions, customLabels, themeMode);
          return (
            <AnimatedPressable
              key={i}
              style={styles.cell}
              onPress={() => {
                configureLayoutAnimation(reducedMotion);
                setSelectedKey(key);
              }}
            >
              <View
                style={[
                  styles.dayCircle,
                  selected && { borderColor: c.accent, borderWidth: 2 },
                  isToday && !selected && { borderColor: c.textDim, borderWidth: 1 },
                  focusS > 0 && { backgroundColor: withAlpha(c.accent, intensity) },
                ]}
              >
                <Text style={[styles.dayNum, { color: focusS > 0 ? c.accentText : c.text }]}>
                  {date.getDate()}
                </Text>
              </View>
              {dominant && <View style={[styles.topicDot, { backgroundColor: dominant.color }]} />}
            </AnimatedPressable>
          );
        })}
      </Animated.View>

      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <Text style={[styles.h2, { color: c.text }]}>
          {new Date(selectedKey).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
        </Text>
        {selectedSessions.length === 0 ? (
          <Text style={[styles.empty, { color: c.textDim }]}>No focus sessions logged this day.</Text>
        ) : (
          selectedSessions.map((s, i) => {
            const resolved = resolveTopic(s.topic, customLabels, themeMode);
            return (
              <View key={i} style={styles.sessionRow}>
                <Text style={[styles.sessionTime, { color: c.textDim }]}>
                  {new Date(s.startedAt).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
                <Text style={[styles.sessionDuration, { color: c.text }]}>
                  {formatDuration(s.actualS)}
                </Text>
                <AnimatedPressable style={styles.sessionTopic} onPress={() => setTaggingSession(s)}>
                  {resolved ? (
                    <>
                      <View style={[styles.topicDotInline, { backgroundColor: resolved.color }]} />
                      <Text style={[styles.sessionTopicLabel, { color: c.textDim }]}>{resolved.label}</Text>
                    </>
                  ) : (
                    <Text style={[styles.sessionTopicLabel, { color: c.accent }]}>Tag</Text>
                  )}
                </AnimatedPressable>
                <Text
                  style={[
                    styles.sessionOutcome,
                    { color: s.outcome === 'completed' ? c.accent : c.warn },
                  ]}
                >
                  {s.outcome === 'completed' ? 'Completed' : 'Ended early'}
                </Text>
              </View>
            );
          })
        )}
      </View>

      <LabelPickerModal
        visible={taggingSession !== null}
        choices={allLabelChoices(customLabels, themeMode)}
        current={taggingSession ? resolveTopic(taggingSession.topic, customLabels, themeMode)?.id : undefined}
        color={c}
        onClose={() => setTaggingSession(null)}
        onPick={(id) => {
          if (taggingSession) retagSession(taggingSession, id);
          setTaggingSession(null);
        }}
        onClear={
          taggingSession?.topic
            ? () => {
                retagSession(taggingSession, undefined);
                setTaggingSession(null);
              }
            : undefined
        }
      />
    </ScrollView>
  );
}

// Sheet presentation: the sheet springs up from SHEET_TRAVEL px below its
// resting place and back down the same path on dismiss, so entry and exit
// trace one motion instead of a cut. Shares the app-wide `springs.default`
// token (tokens.ts) -- damping 30 against stiffness 300 is just under
// critical (2*sqrt(300) ~= 34.6), settling fast with no visible bounce.
const SHEET_TRAVEL = 56;
const BACKDROP_OPACITY = 0.4;
const SHEET_SPRING = { ...springs.default, useNativeDriver: true };

/** Retag/untag picker for one past session -- lists every built-in topic and
 * custom label (allLabelChoices) plus a "Clear tag" option. */
function LabelPickerModal({
  visible,
  choices,
  current,
  color,
  onPick,
  onClear,
  onClose,
}: {
  visible: boolean;
  choices: ResolvedTopic[];
  current: string | undefined;
  color: ReturnType<typeof useTheme>;
  onPick: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  // Stays mounted through the exit animation, then hides.
  const [presented, setPresented] = useState(visible);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(SHEET_TRAVEL)).current;

  useEffect(() => {
    if (visible) {
      setPresented(true);
      if (reduceMotion) {
        backdropOpacity.setValue(BACKDROP_OPACITY);
        sheetY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.spring(backdropOpacity, { toValue: BACKDROP_OPACITY, ...SHEET_SPRING }),
        Animated.spring(sheetY, { toValue: 0, ...SHEET_SPRING }),
      ]).start();
      return;
    }
    if (reduceMotion) {
      backdropOpacity.setValue(0);
      sheetY.setValue(SHEET_TRAVEL);
      setPresented(false);
      return;
    }
    Animated.parallel([
      Animated.spring(sheetY, { toValue: SHEET_TRAVEL, ...SHEET_SPRING }),
      Animated.spring(backdropOpacity, { toValue: 0, ...SHEET_SPRING }),
    ]).start(({ finished }) => {
      if (finished) setPresented(false);
    });
  }, [visible, reduceMotion, backdropOpacity, sheetY]);

  const sheetOpacity = backdropOpacity.interpolate({
    inputRange: [0, BACKDROP_OPACITY],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={presented} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[modalStyles.scrim, { opacity: backdropOpacity }]}>
        <Pressable style={modalStyles.scrimTouch} onPress={onClose} />
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[modalStyles.sheetLayer, { opacity: sheetOpacity, transform: [{ translateY: sheetY }] }]}
      >
        <Pressable style={[modalStyles.sheet, { backgroundColor: color.surface }]} onPress={() => {}}>
          <Text style={[modalStyles.title, { color: color.text }]}>Tag this session</Text>
          <ScrollView style={modalStyles.list}>
            {choices.map((choice) => (
              <AnimatedPressable
                key={choice.id}
                style={modalStyles.row}
                onPress={() => onPick(choice.id)}
              >
                <View style={[modalStyles.dot, { backgroundColor: choice.color }]} />
                <Text style={[modalStyles.rowLabel, { color: color.text }]}>{choice.label}</Text>
                {current === choice.id && <Text style={{ color: color.accent }}>✓</Text>}
              </AnimatedPressable>
            ))}
          </ScrollView>
          {onClear && (
            <AnimatedPressable style={modalStyles.row} onPress={onClear}>
              <Text style={[modalStyles.rowLabel, { color: color.danger }]}>Clear tag</Text>
            </AnimatedPressable>
          )}
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  scrimTouch: { flex: 1 },
  sheetLayer: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '70%',
    ...elevation.card,
  },
  title: { ...typeScale.sectionTitle, marginBottom: 12 },
  list: { marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowLabel: {
    fontSize: 15,
    flex: 1,
    letterSpacing: typeScale.body.letterSpacing,
    lineHeight: typeScale.body.lineHeight,
  },
});

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 16 },
  h1: { ...typeScale.title, marginBottom: 4 },
  h2: { ...typeScale.sectionTitle, marginBottom: 8 },
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
  cell: { width: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNum: { ...typeScale.label },
  topicDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 3 },
  card: { borderRadius: 14, padding: 16, ...elevation.card },
  empty: { ...typeScale.body },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  sessionTime: {
    fontSize: 13,
    width: 80,
    letterSpacing: typeScale.label.letterSpacing,
    lineHeight: typeScale.label.lineHeight,
  },
  sessionDuration: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    letterSpacing: typeScale.body.letterSpacing,
    lineHeight: typeScale.body.lineHeight,
  },
  sessionTopic: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 80 },
  topicDotInline: { width: 8, height: 8, borderRadius: 4 },
  sessionTopicLabel: {
    fontSize: 12,
    letterSpacing: typeScale.caption.letterSpacing,
    lineHeight: typeScale.caption.lineHeight,
  },
  sessionOutcome: {
    fontSize: 12,
    width: 90,
    textAlign: 'right',
    letterSpacing: typeScale.caption.letterSpacing,
    lineHeight: typeScale.caption.lineHeight,
  },
});
