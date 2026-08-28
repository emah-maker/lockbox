// goalVisuals.tsx -- small visual bits shared by BOTH goal surfaces
// (GoalsProgressView.tsx's read-only cards and GoalsSection.tsx's
// write-capable rows), split into their own file rather than living in
// either one so neither carries something the other equally needs -- the
// same "shared, not duplicated" reasoning TopicCard.tsx's own exported
// TopicRows follows for its inline/sheet split.
import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GoalPeriod } from '../../goals/goals';
import { springs } from '../../theme/tokens';

/** One glyph per goal period -- sunrise for a day, a calendar page for a
 * week, a grid (month-view shape) for a month. Purely decorative alongside
 * each surface's own existing period label/tag text, not a replacement for
 * it. */
export const PERIOD_ICON: Record<GoalPeriod, React.ComponentProps<typeof Feather>['name']> = {
  daily: 'sunrise',
  weekly: 'calendar',
  monthly: 'grid',
};

export function PeriodIcon({ period, size = 12, color }: { period: GoalPeriod; size?: number; color: string }) {
  return <Feather name={PERIOD_ICON[period]} size={size} color={color} />;
}

/** A one-shot pulse on a false -> true `met` transition -- "this goal just
 * got hit" is a distinct event from "a deep link wants your attention on
 * this card" (GoalsProgressView's own `highlightAnim`, driven by a NavIntent
 * goalId), so this is layered ADDITIONALLY rather than replacing that
 * animation; see this hook's call sites for both firing independently.
 *
 * Copied from TotalFocusCard.tsx's own StreakStat pattern (a
 * checkedValueRef guarding a one-shot Animated.spring off springs.default)
 * rather than reusing StreakStat itself -- that component owns its own
 * "best streak ever seen" persistence (AsyncStorage read/write) which has
 * no equivalent here: a goal's `met` flag is already the boolean this hook
 * needs, with no separate "best value ever" concept to track. */
export function useMetCelebration(met: boolean, reducedMotion: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(1)).current;
  // Tracks the last `met` value this hook has already reacted to, so the
  // pulse fires exactly once per false->true edge -- re-renders with `met`
  // still true (a progress update that doesn't change the met/not-met
  // outcome) must not re-trigger it, the same guard StreakStat's own
  // checkedValueRef applies to a streak value that hasn't actually grown.
  const prevMetRef = useRef(met);

  useEffect(() => {
    const wasMet = prevMetRef.current;
    prevMetRef.current = met;
    if (met && !wasMet && !reducedMotion) {
      pulse.setValue(1.35);
      Animated.spring(pulse, { toValue: 1, ...springs.default, useNativeDriver: true }).start();
    }
  }, [met, reducedMotion, pulse]);

  return pulse;
}
