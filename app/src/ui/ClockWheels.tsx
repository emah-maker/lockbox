// ClockWheels.tsx -- the app's one time-of-day picker: an hour wheel, a
// minute wheel, and an AM/PM selector, over a plain 'HH:MM' 24-hour string.
//
// WHY THIS EXISTS AT ALL
//
// Three screens each hand-rolled the same picker, and each one offered a
// 00-23 hour wheel:
//   - calendar/SessionReminderForm.tsx  (a planned session's start time)
//   - GoalReminderControl.tsx           (a goal's reminder times)
//   - settings/NotificationsSection.tsx (both quiet-hours boundaries)
// Every one of those values is READ BACK through ui/time.ts's formatClockTime,
// which formats for the device locale -- so a US user picked "17" on a wheel
// and was then shown "5:30 PM" by the summary line directly above it, by the
// chips, and by the notification body. The wheels were the only surface in
// the app speaking 24-hour time, and the only place the user had to do that
// conversion themselves.
//
// Consolidating was the honest way to change that: the alternative was three
// copies of the 12-hour conversion and three copies of the AM/PM control,
// which is exactly how the three copies of parseTime/formatTime (each with
// its own fallback) got there in the first place. Those all collapse into
// ui/time.ts's parseClockTime/hourToClock12 and this file.
//
// WHAT IT DOES NOT CHANGE
//
// The value. In goes 'HH:MM' 24-hour, out comes 'HH:MM' 24-hour -- the shape
// Goal.notifyTimes, ScheduledSession.time and quietStart/quietEnd are
// validated and stored as, and the shape the website dashboard writes. The
// 12-hour split is display only, and lives entirely between parseClockTime
// and formatClock24 below.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AnimatedPressable } from './AnimatedPressable';
import { WheelPicker, WheelLockPhase } from './WheelPicker';
import {
  ClockPeriod,
  HOUR_12_LABELS,
  clock12ToHour,
  formatClock24,
  hourToClock12,
  parseClockTime,
} from './time';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/color';
import { spacing, typeScale } from '../theme/tokens';

/** The 5-minute grid every minute wheel in this app snaps to -- the
 * Dashboard's lock duration, a goal's target, a reminder time. It was
 * re-derived in each of the three files this replaces, with a comment in each
 * one saying it matched the others; now there is one of it. */
export const CLOCK_MINUTE_STEP = 5;

/** Narrower than WheelPicker's 90pt default: two digits at typeScale.title is
 * ~34pt of glyph, and three controls in a row have to fit a sheet's content
 * width on a small phone (2 x 66 + toggle + gaps stays under 260). */
const HOUR_MINUTE_WIDTH = 66;

function minuteGrid(step: number): { values: number[]; labels: string[] } {
  const values = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  return { values, labels: values.map((m) => String(m).padStart(2, '0')) };
}

/** Nearest stop on the minute wheel for an off-grid minute. Reachable in
 * normal use: the website dashboard writes reminder times with no 5-minute
 * step, and a wheel still has to park somewhere valid. Ties go to the lower
 * stop, which is what each of the three replaced copies did. */
function nearestMinuteIndex(values: number[], minute: number): number {
  return values.reduce((best, v, i) => (Math.abs(v - minute) < Math.abs(values[best] - minute) ? i : best), 0);
}

export function ClockWheels({
  value,
  onChange,
  accessibilityPrefix,
  onWheelActiveChange,
  minuteStep = CLOCK_MINUTE_STEP,
  fallback = '09:00',
}: {
  /** 'HH:MM', 24-hour. */
  value: string | undefined;
  /** Receives 'HH:MM', 24-hour. */
  onChange: (next: string) => void;
  /** Prefixed onto each control's accessibility label, so "Reminder time"
   * becomes "Reminder time, hour" / "..., minute" / "..., AM". Required
   * because a screen can hold more than one of these (both quiet-hours
   * boundaries), and three unlabelled adjustables are unusable. */
  accessibilityPrefix: string;
  /** The enclosing scroller's lock -- see useWheelScrollLock in
   * WheelPicker.tsx, which every caller should use to implement it. The
   * `phase` argument is what keeps that lock's own backstop from firing in
   * the middle of a long drag. */
  onWheelActiveChange: (active: boolean, phase?: WheelLockPhase) => void;
  /** Minutes per wheel stop. Defaults to the app-wide 5. */
  minuteStep?: number;
  /** Where the wheels park when `value` is absent or malformed -- a
   * quiet-hours boundary wants midnight, a reminder wants 9am. Each replaced
   * copy had its own hardcoded answer; this is that answer, passed in. */
  fallback?: string;
}) {
  const color = useTheme();
  const { values: minuteValues, labels: minuteLabels } = React.useMemo(() => minuteGrid(minuteStep), [minuteStep]);

  const { hour, minute } = parseClockTime(value, fallback);
  const { hourIndex, period } = hourToClock12(hour);
  const minuteIndex = nearestMinuteIndex(minuteValues, minute);
  // Read back off the grid rather than from the parsed string: committing any
  // one of the three controls must not silently carry an off-grid minute
  // along with it, or the value would keep a minute the wheel isn't showing.
  const snappedMinute = minuteValues[minuteIndex];

  const emit = (nextHourIndex: number, nextMinute: number, nextPeriod: ClockPeriod) =>
    onChange(formatClock24(clock12ToHour(nextHourIndex, nextPeriod), nextMinute));

  return (
    <View style={styles.row}>
      {/* The touch-capturing region is exactly the two wheels, and no wider.
          A merely-centered row stretches to its parent's full width and
          leaves a dead margin either side that claims (and, on release,
          releases) the enclosing Sheet's scroll lock without any wheel ever
          capturing the drag -- read as "hard to scroll beside the wheels".
          alignSelf on styles.row is what shrink-wraps it; GoalForm.tsx has
          the long-form version of this note. The AM/PM toggle is deliberately
          OUTSIDE this View: it is a tap target, so locking the outer scroll
          for it would claim a gesture it never needs. */}
      <View
        style={styles.wheels}
        onTouchStart={() => onWheelActiveChange(true, 'touch')}
        onTouchEnd={() => onWheelActiveChange(false)}
        onTouchCancel={() => onWheelActiveChange(false)}
      >
        {/* Three-way gesture handoff, same as every other wheel row in this
            app: onTouchStart claims the gesture early, onTouchEnd/-Cancel
            release it for a tap that never became a drag, and onDragStart/
            onDragEnd are the pair WheelPicker guarantees once it actually
            captures the drag (a wrapping View stops seeing touch events the
            moment the inner ScrollView becomes the responder). */}
        <WheelPicker
          labels={HOUR_12_LABELS}
          selectedIndex={hourIndex}
          crossAxisSize={HOUR_MINUTE_WIDTH}
          onChange={(i) => emit(i, snappedMinute, period)}
          onDragStart={() => onWheelActiveChange(true, 'drag')}
          onDragEnd={() => onWheelActiveChange(false)}
          accessibilityLabel={`${accessibilityPrefix}, hour`}
        />
        <WheelPicker
          labels={minuteLabels}
          selectedIndex={minuteIndex}
          crossAxisSize={HOUR_MINUTE_WIDTH}
          onChange={(i) => emit(hourIndex, minuteValues[i], period)}
          onDragStart={() => onWheelActiveChange(true, 'drag')}
          onDragEnd={() => onWheelActiveChange(false)}
          accessibilityLabel={`${accessibilityPrefix}, minute`}
        />
      </View>

      {/* A two-tap segmented control, not a third WheelPicker. AM/PM is a
          binary, and a 2-item wheel in a 5-slot window is three empty rows
          plus a drag to express one bit -- and one more control sharing the
          sheet's scroll axis, which is the axis every freeze in this
          picker's history came from. Tapping is also strictly fewer gestures
          than the 12-hour swing it replaces. */}
      <View style={styles.period}>
        {(['AM', 'PM'] as ClockPeriod[]).map((p) => (
          <AnimatedPressable
            key={p}
            // No-op when it is already the selected one. Otherwise a tap the
            // user reads as "nothing to change here" writes the value anyway
            // -- which for an off-grid stored minute (the website dashboard
            // writes reminder times with no 5-minute step) silently snapped
            // 00:07 to 00:05, and for quiet hours fired a redundant store
            // write on every stray tap.
            onPress={() => (period === p ? undefined : emit(hourIndex, snappedMinute, p))}
            accessibilityRole="button"
            accessibilityState={{ selected: period === p }}
            accessibilityLabel={`${accessibilityPrefix}, ${p}`}
            style={[
              styles.periodItem,
              { borderColor: withAlpha(color.accent, 0.4) },
              period === p && { backgroundColor: color.accent, borderColor: color.accent },
            ]}
          >
            <Text style={[styles.periodText, { color: period === p ? color.accentText : color.textDim }]}>{p}</Text>
          </AnimatedPressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // alignSelf is the fix, not justifyContent -- see the wheels View's comment.
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: spacing.sm },
  wheels: { flexDirection: 'row', gap: spacing.sm },
  period: { gap: spacing.xs },
  periodItem: {
    minWidth: 52,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  periodText: { ...typeScale.label },
});
