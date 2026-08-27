// FocusHero.tsx -- the Home screen's single unmistakable focal point
// (manager brief: "a large, calm focus/lock control as the visual anchor").
// Previously DashboardScreen spread this same information across three
// separate, always-mounted rows (a status line, a thin linear meter, and a
// duration/topic block that only existed inline) -- none of them read as
// *the* thing on the screen. This component owns every visual state that
// deserves the anchor spot (no box, idle/done, closed, running) behind one
// fixed-size ProgressRing, cross-fading between states instead of the old
// screen's blocks appearing/disappearing and shoving layout around.
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
  onPressIdle,
  onPressTag,
}: {
  status: Status | null;
  connected: boolean;
  /** The wheel-picker's currently previewed duration, in seconds -- shown as
   * the hero's headline number while there's no live session to count down. */
  pickSeconds: number;
  currentTopic: string | null;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  /** Opens the duration+tag sheet. Called for every non-running state (idle/
   * done/no-box, and closed) -- duration preview and pre-session tagging are
   * both meaningful right up until a session is actually counting down. */
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

  const progress = running && status ? elapsedFraction(status) : 0;
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

  let headline: string;
  let caption: string;
  if (running && status) {
    headline = formatDuration(status.rem);
    caption = 'left';
  } else if (closed) {
    headline = 'Closed';
    caption = 'Press LOCK on the box to start';
  } else if (done) {
    headline = formatDuration(pickSeconds);
    caption = 'Session complete -- tap to set up the next one';
  } else if (!connected) {
    headline = formatDuration(pickSeconds);
    caption = 'Tap to set duration & tag, then connect';
  } else {
    headline = formatDuration(pickSeconds);
    caption = 'Tap to set duration & tag -- lock at the box';
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
        <ProgressRing progress={progress} color={ringColor} trackColor={trackColor}>
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
