// FocusHero.tsx -- the Home screen's single unmistakable focal point
// (manager brief: "a large, calm focus/lock control as the visual anchor").
// Previously DashboardScreen spread this same information across three
// separate, always-mounted rows (a status line, a thin linear meter, and a
// duration/topic block that only existed inline) -- none of them read as
// *the* thing on the screen. This component owns every visual state that
// deserves the anchor spot (no box, idle, closed, running) behind one
// fixed-size ProgressRing, cross-fading between states instead of the old
// screen's blocks appearing/disappearing and shoving layout around.
//
// The ring's idle (non-running) arc used to just sit at 0 -- it now shows
// today's actual progress via idleRing, computed by DashboardScreen from
// screens/home/idleRingState.ts against whichever source the user picked in
// Settings > Focus ring (daily goal/baseline, a weekly goal, one specific
// chosen goal, a 7-day average, or a streak). See the precedence in this
// file's own headline/caption branching below: running beats not-connected
// beats closed beats an empty day beats "today has some progress", and the
// last of those branches on idleRing.source for per-source wording.
//
// Renders only -- every actual control here (opening the duration/tag sheet,
// opening the retag sheet) is a callback prop; DashboardScreen still owns
// the BLE state, the picked-duration state, and the sheets themselves.
import React, { useEffect, useRef } from 'react';
import { Animated, Text, View, StyleSheet } from 'react-native';
import type { Status } from '../../ble/protocol';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/theme';
import { typeScale } from '../../theme/tokens';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { formatDuration } from '../../stats/stats';
import { resolveTopic } from '../../stats/customLabels';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ProgressRing } from './ProgressRing';
import { BatteryBadge } from './BatteryBadge';
import { IdleRingState, RingBaselineWindow, ringBaselineWindowLabel } from './idleRingState';

/** Fraction of the configured lock duration elapsed so far. Moved here
 * unchanged from DashboardScreen.tsx (where the old linear meter used the
 * same formula) -- this is now the only place that needs it. 0 when `set`
 * is unknown (0). */
function elapsedFraction(status: Status): number {
  if (status.set <= 0) return 0;
  return Math.max(0, Math.min(1, (status.set - status.rem) / status.set));
}

export function FocusHero({
  status,
  connected,
  pickSeconds,
  currentTopic,
  customLabels,
  themeMode,
  todayFocusS,
  idleRing,
  ringBaselineWindow,
  onPressIdle,
  onPressTag,
}: {
  status: Status | null;
  connected: boolean;
  /** The wheel-picker's currently previewed duration, in seconds -- no longer
   * shown as the hero's headline (that's now today's focus time or a
   * connection/box-state prompt, see the branching below), but still
   * threaded through as a prop since DashboardScreen's DurationSheet/tag
   * flow is unchanged and some future idle-state copy may want it again. */
  pickSeconds: number;
  currentTopic: string | null;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  /** Today's total focus time in seconds (DashboardScreen's own todayStats
   * memo) -- the idle-state headline once any focus has happened today. */
  todayFocusS: number;
  /** Precomputed idle-ring progress + which source produced it (goal vs.
   * baseline vs. empty) -- see screens/home/idleRingState.ts. Only consulted
   * outside the running state; this component never recomputes it itself,
   * same "props only, no BLE/goals/settings state owned here" contract as
   * every other FocusHero prop. */
  idleRing: IdleRingState;
  /** Which best-day window idleRing's 'baseline' source (when present) was
   * computed against -- used only to word the caption ("...this week" vs
   * "...this month"), never to re-derive the ring's own math. */
  ringBaselineWindow: RingBaselineWindow;
  /** Opens the duration+tag sheet. Called for every non-running state (no
   * box, closed, and both idle-ring states) -- duration preview and
   * pre-session tagging are both meaningful right up until a session is
   * actually counting down. */
  onPressIdle: () => void;
  /** Opens the retag sheet. Only meaningful, and only wired up by
   * DashboardScreen, while a session is running. */
  onPressTag: () => void;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const running = status?.st === 'running';
  const closed = status?.st === 'closed';
  const done = status?.st === 'done';

  // Every non-running state's arc is idleRing.progress -- including the
  // empty-day case, since computeIdleRingProgress itself already forces
  // `progress: 0` whenever todayFocusS <= 0 (see that module's own doc
  // comment), so there's no separate "arc = 0" branch needed here.
  const progress = running && status ? elapsedFraction(status) : idleRing.progress;
  const resolved = currentTopic ? resolveTopic(currentTopic, customLabels, themeMode) : null;

  // Cross-fade between states (manager brief: state changes should "cross-
  // fade or swap in place rather than push layout") -- a simple fade-in
  // pulse on every `st` change, the same shared shape as useDisabledFade
  // elsewhere in this app (DashboardScreen's old closeFade/openFade): reset
  // to a low opacity, then settle back to 1, rather than a full content
  // cross-dissolve (which would need to hold the outgoing content around
  // for its own fade-out, a lot of extra state for a ring this size).
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reducedMotion) return;
    fade.setValue(0.35);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [status?.st, reducedMotion]);

  const ringColor = running ? theme.accent : withAlpha(theme.accent, closed ? 0.55 : 0.3);
  const trackColor = withAlpha(theme.accent, 0.14);

  // Precedence: running -> not connected -> closed -> today-empty ->
  // today-has-progress (manager brief's own ordering). `done` no longer gets
  // its own top-level branch -- a completed session either already shows up
  // in todayFocusS (today-has-progress) or, on the rare chance it hasn't yet
  // (e.g. still logging), just changes the empty-day caption's wording below
  // rather than the bucket itself. The last branch further splits on
  // idleRing.source -- one per ring source the user can pick in Settings >
  // Focus ring (RingBaselineSection.tsx) -- since each reads a different
  // comparison ("of today's goal" vs "of your best day..." vs a streak
  // count), and this is the one place that wording is written.
  let headline: string;
  let caption: string;
  if (running && status) {
    headline = formatDuration(status.rem);
    caption = 'left';
  } else if (!connected) {
    headline = 'Connect your box';
    caption = 'Connect to preview and start a session';
  } else if (closed) {
    headline = 'Closed';
    caption = 'Press LOCK on the box to start';
  } else if (idleRing.source === 'empty') {
    headline = 'Tap to schedule a session';
    caption = done ? 'Session complete -- set up your next one' : 'No focus time yet today';
  } else if (idleRing.source === 'streak') {
    // Not a percentage-of-something like every other source below -- a
    // streak reads as a day count against a day count, so the headline
    // itself is the streak (the ring's own fill is current/longest, see
    // idleRingState.ts's computeStreakRingProgress), not today's duration.
    const { current, longest } = idleRing.streak ?? { current: 0, longest: 0 };
    headline = `${current}-day streak`;
    caption = longest > current ? `Best: ${longest} days` : current > 0 ? 'Your best streak yet' : 'Start one today';
  } else {
    headline = formatDuration(todayFocusS);
    const pct = Math.round(idleRing.progress * 100);
    switch (idleRing.source) {
      case 'weeklyGoal':
        caption = `${pct}% of your weekly goal`;
        break;
      case 'chosenGoal':
        caption = `${pct}% of ${idleRing.chosenGoalName ?? 'your goal'}`;
        break;
      case 'rollingAverage':
        caption = `${pct}% of your 7-day average`;
        break;
      case 'goal':
        caption = `${pct}% of today's goal`;
        break;
      default: // 'baseline'
        caption = `${pct}% of your best day ${ringBaselineWindowLabel(ringBaselineWindow)}`;
    }
  }

  const onPress = running ? onPressTag : onPressIdle;
  const label = running
    ? `Focus session running, ${formatDuration(status!.rem)} left. Tap to change the tagged topic.`
    : `${headline}. ${caption}`;

  return (
    <AnimatedPressable
      style={styles.wrap}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View style={{ opacity: fade, alignItems: 'center' }}>
        <ProgressRing
          progress={progress}
          color={ringColor}
          trackColor={trackColor}
          // Battery glyph now sits IN the ring's own bottom cut-out (manager
          // brief, ring redesign task) rather than docked below it -- a
          // second concentric arc was the rejected first idea (see
          // BatteryBadge.tsx's own header for why), but placing the same
          // glyph inside the gap the arc already leaves open needs no such
          // second arc: it just fills space the ring was going to leave
          // empty anyway. Self-supplies status.bat the same way this
          // component already self-supplies everything else it reads off
          // `status`; DashboardScreen never threads a battery prop through.
          // Always mounted (never gated on `status` existing) so its own
          // reserved space never causes a layout jump while `status` is
          // briefly null (e.g. right after a disconnect).
          bottomSlot={<BatteryBadge pct={status?.bat ?? -1} />}
        >
          <Text style={[styles.headline, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
            {headline}
          </Text>
          <Text style={[styles.caption, { color: theme.textDim }]} numberOfLines={2}>
            {caption}
          </Text>
        </ProgressRing>

        {/* Topic pill -- always reserves its row (even with empty content)
            so the hero's overall height never changes between a tagged and
            an untagged session, one of this screen's own "don't grow"
            constraints applied to itself. */}
        <View style={styles.topicRow}>
          {resolved ? (
            <View style={[styles.topicPill, { backgroundColor: withAlpha(resolved.color, running ? 1 : 0.85) }]}>
              <Text style={[styles.topicPillText, { color: resolved.textColor }]} numberOfLines={1}>
                {resolved.label}
              </Text>
            </View>
          ) : running ? (
            <Text style={[styles.topicHint, { color: theme.textDim }]}>Tap to tag this session</Text>
          ) : null}
        </View>
      </Animated.View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 8 },
  headline: { ...typeScale.display, fontSize: 34, lineHeight: 36 },
  caption: { ...typeScale.body, textAlign: 'center', marginTop: 4, maxWidth: 150 },
  topicRow: { marginTop: 14, minHeight: 28, justifyContent: 'center' },
  topicPill: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16 },
  topicPillText: { ...typeScale.label },
  topicHint: { ...typeScale.label },
});
