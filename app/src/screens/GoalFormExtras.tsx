// GoalFormExtras.tsx -- the "flexible goals" extension controls split out
// of GoalForm.tsx (same 500-line-guideline reasoning as GoalForm.tsx's own
// split from GoalsSection.tsx): the weekday chip row (daysOfWeek, Daily
// only), the optional session-count target stepper, and the notify
// toggle + reminder-time wheels. Three small, independent controls bundled
// into one file because none of them is big enough to earn its own module,
// and all three are used from exactly one call site (GoalForm.tsx).
//
// Owns no validation and no persistence, same discipline GoalForm.tsx's own
// header describes for itself -- every value here is a plain, uncommitted
// piece of form state that GoalForm.tsx collects and hands to goals.ts (via
// useGoalsStore) on submit. goals.ts is still the only authority on whether
// a particular combination (e.g. daysOfWeek on a non-daily goal) is
// actually acceptable.
import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { WheelPicker } from '../ui/WheelPicker';
import { typeScale, spacing } from '../theme/tokens';

// Two-letter abbreviations rather than single letters -- 'S'/'S' and
// 'T'/'T' (Sun/Sat, Tue/Thu) are indistinguishable at a glance, and these
// chips are the only place in the app that needs every weekday spelled out
// individually (CalendarScreen/focusStats.js's own WEEKDAY_INITIALS get
// away with single letters only because they're column headers sitting
// directly above the day they label). Index 0 = Sunday, matching this
// app's one Sunday-start convention (goalProgress.ts's weeklyWindow).
const WEEKDAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Multi-select weekday row for a daily goal's daysOfWeek. `selected: []`
 * and `selected` containing all 7 both render as "every day" would, i.e.
 * every chip filled -- see WeekdayChips' own call site in GoalForm.tsx for
 * why an empty array is seeded as all-selected rather than none-selected
 * (goals.ts's daysOfWeek "undefined/[] = every day" convention means the
 * two are data-equivalent; showing all 7 filled is the reading that
 * actually looks like "every day" rather than looking like nothing is
 * chosen at all). Toggling every chip back off is a valid, intentional way
 * to return to "every day" -- normalizeDaysOfWeek in goals.ts collapses
 * that back to `undefined` on submit, not an error. */
export function WeekdayChips({
  selected,
  onChange,
  color,
}: {
  selected: number[];
  onChange: (days: number[]) => void;
  color: ReturnType<typeof useTheme>;
}) {
  const toggle = (day: number) => {
    onChange(selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day]);
  };
  return (
    <View style={styles.weekdayRow} accessibilityRole="none">
      {WEEKDAY_ABBR.map((label, day) => {
        const active = selected.includes(day);
        return (
          <AnimatedPressable
            key={day}
            onPress={() => toggle(day)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${FULL_WEEKDAY[day]}${active ? ', selected' : ''}`}
            style={[
              styles.weekdayChip,
              { borderColor: withAlpha(color.accent, 0.4) },
              active && { backgroundColor: color.accent, borderColor: color.accent },
            ]}
          >
            <Text style={[styles.weekdayChipText, { color: active ? color.accentText : color.textDim }]}>{label}</Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

const FULL_WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Optional session-count target: a plain toggle (Row-less, so it fits
 * GoalForm's own compact-label-then-control layout rather than
 * SettingsPrimitives' full-width Row) gating a -/+ stepper, rather than a
 * third WheelPicker -- this app already has two duration wheels open in
 * the same form, and a count from 1-MAX_TARGET_SESSIONS is a small enough
 * range that a stepper reads faster than spinning a wheel to it. Clamped
 * to [1, max] -- the toggle itself is what represents "off" (undefined),
 * never a steppable 0. */
export function SessionTargetControl({
  value,
  onChange,
  max,
  color,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  max: number;
  color: ReturnType<typeof useTheme>;
}) {
  const enabled = value !== undefined;
  const setEnabled = (next: boolean) => onChange(next ? value ?? 1 : undefined);
  const step = (delta: number) => {
    if (value === undefined) return;
    onChange(Math.min(max, Math.max(1, value + delta)));
  };
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleRowLabel}>
        <Text style={[styles.formLabel, { color: color.textDim }]}>Also track session count</Text>
        <Switch value={enabled} onValueChange={setEnabled} accessibilityLabel="Also track session count" />
      </View>
      {enabled ? (
        <View style={styles.stepper}>
          <AnimatedPressable
            onPress={() => step(-1)}
            accessibilityRole="button"
            accessibilityLabel="Decrease session target"
            style={[styles.stepperBtn, { borderColor: withAlpha(color.accent, 0.4) }]}
          >
            <Text style={[styles.stepperBtnText, { color: color.accent }]}>-</Text>
          </AnimatedPressable>
          <Text
            style={[styles.stepperValue, { color: color.text }]}
            numberOfLines={1}
            accessibilityLabel={`${value} sessions`}
          >
            {value} {value === 1 ? 'session' : 'sessions'}
          </Text>
          <AnimatedPressable
            onPress={() => step(1)}
            accessibilityRole="button"
            accessibilityLabel="Increase session target"
            style={[styles.stepperBtn, { borderColor: withAlpha(color.accent, 0.4) }]}
          >
            <Text style={[styles.stepperBtnText, { color: color.accent }]}>+</Text>
          </AnimatedPressable>
        </View>
      ) : null}
    </View>
  );
}

// 24h clock wheel for the reminder time's hour component -- distinct from
// GoalForm.tsx's own PERIOD_MAX_HOURS-derived hour wheel, which counts a
// DURATION (0..MAX_*_TARGET_S/3600), not a time-of-day; the two are
// unrelated ranges that happen to both be "hours" in the same form.
const CLOCK_HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
// Reuses GoalForm.tsx's own 5-minute step convention (matches
// DashboardScreen's lock-duration wheel) so every minute wheel in this app
// snaps to the same grid.
const NOTIFY_MINUTE_STEP = 5;
const NOTIFY_MINUTE_VALUES = Array.from({ length: 60 / NOTIFY_MINUTE_STEP }, (_, i) => i * NOTIFY_MINUTE_STEP);
const NOTIFY_MINUTE_LABELS = NOTIFY_MINUTE_VALUES.map((m) => String(m).padStart(2, '0'));
const DEFAULT_NOTIFY_AT = '09:00';

/** Parses a "HH:MM" string into wheel indices, snapping an off-grid minute
 * (e.g. a notifyAt written by some future non-5-minute-step writer) onto
 * the nearest wheel stop -- same defensive snap GoalForm.tsx's own target
 * wheels already apply to a dashboard-written targetS. Falls back to
 * DEFAULT_NOTIFY_AT's own components for a missing/malformed value, so the
 * wheels always have SOME valid position to render even before the user
 * has touched them. */
function parseNotifyAt(notifyAt: string | undefined): { hour: number; minuteIndex: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(notifyAt ?? DEFAULT_NOTIFY_AT);
  const hour = match ? Math.min(23, parseInt(match[1], 10)) : 9;
  const minute = match ? parseInt(match[2], 10) : 0;
  const minuteIndex = NOTIFY_MINUTE_VALUES.reduce(
    (best, v, i) => (Math.abs(v - minute) < Math.abs(NOTIFY_MINUTE_VALUES[best] - minute) ? i : best),
    0,
  );
  return { hour, minuteIndex };
}

function formatNotifyAt(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Reminder opt-in: a toggle gating two clock wheels (hour + 5-minute-step
 * minute), the time-of-day counterpart to GoalForm's own duration wheels.
 * Turning the toggle on for the first time (no notifyAt yet) seeds
 * DEFAULT_NOTIFY_AT rather than leaving the wheels on some arbitrary
 * "unset" display -- there's no such thing as a Goal with notify:true and
 * no notifyAt that would ever reach goals.ts's validateGoalExtras (it
 * requires both or neither), so the wheels need a real value the instant
 * the toggle flips. */
export function NotifyControl({
  notify,
  notifyAt,
  onNotifyChange,
  onNotifyAtChange,
  onWheelActiveChange,
  color,
}: {
  notify: boolean;
  notifyAt: string | undefined;
  onNotifyChange: (value: boolean) => void;
  onNotifyAtChange: (value: string) => void;
  onWheelActiveChange: (active: boolean) => void;
  color: ReturnType<typeof useTheme>;
}) {
  const { hour, minuteIndex } = parseNotifyAt(notifyAt);
  const setToggle = (next: boolean) => {
    onNotifyChange(next);
    if (next && !notifyAt) onNotifyAtChange(DEFAULT_NOTIFY_AT);
  };
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleRowLabel}>
        <Text style={[styles.formLabel, { color: color.textDim }]}>Remind me</Text>
        <Switch value={notify} onValueChange={setToggle} accessibilityLabel="Remind me about this goal" />
      </View>
      {notify ? (
        <View
          style={styles.wheelRow}
          onTouchStart={() => onWheelActiveChange(true)}
          onTouchEnd={() => onWheelActiveChange(false)}
          onTouchCancel={() => onWheelActiveChange(false)}
        >
          <WheelPicker
            labels={CLOCK_HOUR_LABELS}
            selectedIndex={hour}
            onChange={(i) => onNotifyAtChange(formatNotifyAt(i, NOTIFY_MINUTE_VALUES[minuteIndex]))}
            onDragStart={() => onWheelActiveChange(true)}
            onDragEnd={() => onWheelActiveChange(false)}
            accessibilityLabel="Reminder time, hour"
          />
          <WheelPicker
            labels={NOTIFY_MINUTE_LABELS}
            selectedIndex={minuteIndex}
            onChange={(i) => onNotifyAtChange(formatNotifyAt(hour, NOTIFY_MINUTE_VALUES[i]))}
            onDragStart={() => onWheelActiveChange(true)}
            onDragEnd={() => onWheelActiveChange(false)}
            accessibilityLabel="Reminder time, minute"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  formLabel: { ...typeScale.label },
  weekdayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  weekdayChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1.5 },
  weekdayChipText: { ...typeScale.label },
  toggleRow: { gap: 8 },
  toggleRowLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, justifyContent: 'center' },
  stepperBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontSize: 18, fontWeight: '700', lineHeight: 20 },
  stepperValue: { ...typeScale.body, minWidth: 90, textAlign: 'center' },
  wheelRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
});
