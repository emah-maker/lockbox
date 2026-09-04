// GoalFormExtras.tsx -- the small "flexible goals" extension controls split
// out of GoalForm.tsx (same 500-line-guideline reasoning as GoalForm.tsx's
// own split from GoalsSection.tsx): the weekday chip row (daysOfWeek, Daily
// only) and the optional session-count target stepper. Two small,
// independent controls bundled into one file because neither is big enough
// to earn its own module.
//
// The reminder block used to be the third control here. It moved to
// GoalReminderControl.tsx once a reminder stopped being "one toggle and two
// wheels" and became a list of times plus its own weekday set and a
// progress-aware flag -- see that file's header. WeekdayChips below is now
// shared by both files rather than used from one call site.
//
// Owns no validation and no persistence, same discipline GoalForm.tsx's own
// header describes for itself -- every value here is a plain, uncommitted
// piece of form state that GoalForm.tsx collects and hands to goals.ts (via
// useGoalsStore) on submit. goals.ts is still the only authority on whether
// a particular combination (e.g. daysOfWeek on a non-daily goal) is
// actually acceptable.
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/color';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { typeScale, spacing } from '../theme/tokens';

// Two-letter abbreviations rather than single letters -- 'S'/'S' and
// 'T'/'T' (Sun/Sat, Tue/Thu) are indistinguishable at a glance, and these
// chips are the only place in the app that needs every weekday spelled out
// individually (CalendarScreen/focusStats.js's own WEEKDAY_INITIALS get
// away with single letters only because they're column headers sitting
// directly above the day they label). Index 0 = Sunday, matching this
// app's one Sunday-start convention (goalProgress.ts's weeklyWindow).
const WEEKDAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** One-line reading of a weekday selection, for a collapsed
 * ui/FormDisclosure row's summary -- the chips themselves are only mounted
 * while that group is expanded, so this is the ONLY thing saying which days
 * are chosen the rest of the time, and it has to be a real answer rather
 * than a count.
 *
 * `undefined`, `[]` and all seven are all "Every day": that's goals.ts's own
 * daysOfWeek convention (see this file's WeekdayChips doc comment), and the
 * summary must read the same for every representation of it or a goal would
 * appear to change when it round-trips through the form. Weekdays/Weekends
 * are named rather than listed because those two are the selections people
 * actually make, and "Mo, Tu, We, Th, Fr" truncates badly in a summary
 * column. */
export function weekdaySummary(selected: number[] | undefined): string {
  if (!selected || selected.length === 0 || selected.length === 7) return 'Every day';
  const sorted = Array.from(new Set(selected)).sort((a, b) => a - b);
  const key = sorted.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  return sorted.map((d) => WEEKDAY_ABBR[d]).join(', ');
}

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
        {/* accessibilityRole/State are what let VoiceOver/TalkBack announce
            this as a switch with a real on/off value -- accessibilityLabel
            alone left it announced as a bare, stateless element. Colours are
            deliberately left on the OS default, matching every other Switch
            in the app (settings/, account/). */}
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          accessibilityRole="switch"
          accessibilityLabel="Also track session count"
          accessibilityState={{ checked: enabled }}
        />
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
});
