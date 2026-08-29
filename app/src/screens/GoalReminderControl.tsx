// GoalReminderControl.tsx -- the goal form's "Remind me" block, split out of
// GoalFormExtras.tsx (which keeps the weekday chips and the session-count
// stepper) for the same 500-line-guideline reason that file was itself split
// out of GoalForm.tsx. It grew well past what a sibling of those two small
// controls could be: a goal's reminder is now a LIST of times, an optional
// reminder-weekday set of its own, and a progress-aware flag.
//
// The single most important layout decision here: the hour/minute wheels are
// NOT permanently mounted. They appear only while you're actually picking a
// time, and collapse back to a row of compact time chips afterwards. The
// previous version kept two 200pt-tall wheels on screen the entire time the
// reminder toggle was on, which is most of why the goal form ran past the
// bottom of its sheet. Chips also scale to several times where two fixed
// wheels could only ever express one.
//
// Editing an existing time reuses the same inline picker as adding a new one
// (`editingIndex`), rather than a separate edit affordance -- one picker, one
// set of wheel behaviors to keep working.
//
// Owns no validation and no persistence, same discipline as GoalForm.tsx and
// GoalFormExtras.tsx: every value here is uncommitted form state that
// GoalForm collects and hands to goals.ts on submit. goalReminders.ts is the
// authority on what a valid reminder schedule is.
import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/color';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { WheelPicker } from '../ui/WheelPicker';
import { useSettingsStore } from '../store/useSettingsStore';
import { MAX_NOTIFY_TIMES } from '../goals/goalReminders';
import { isInQuietHours } from '../goals/goalNotificationPlan';
import { formatClockTime } from '../ui/time';
import { WeekdayChips } from './GoalFormExtras';
import { hitSlop, spacing, typeScale } from '../theme/tokens';

// 24h clock wheels for the reminder time -- distinct from GoalForm.tsx's own
// PERIOD_MAX_HOURS-derived hour wheel, which counts a DURATION, not a
// time-of-day; the two are unrelated ranges that happen to both be "hours".
const CLOCK_HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
// Reuses this app's one 5-minute step convention (the Dashboard's
// lock-duration wheel, GoalForm's own target minutes) so every minute wheel
// in the app snaps to the same grid.
const NOTIFY_MINUTE_STEP = 5;
const NOTIFY_MINUTE_VALUES = Array.from({ length: 60 / NOTIFY_MINUTE_STEP }, (_, i) => i * NOTIFY_MINUTE_STEP);
const NOTIFY_MINUTE_LABELS = NOTIFY_MINUTE_VALUES.map((m) => String(m).padStart(2, '0'));
const DEFAULT_NOTIFY_AT = '09:00';

/** Parses 'HH:MM' into wheel indices, snapping an off-grid minute (one
 * written by the website dashboard, which has no 5-minute step) onto the
 * nearest wheel stop -- the same defensive snap GoalForm's target wheels
 * apply to a dashboard-written targetS. Falls back to DEFAULT_NOTIFY_AT for
 * a missing/malformed value so the wheels always have a valid position. */
function parseTime(value: string | undefined): { hour: number; minuteIndex: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? DEFAULT_NOTIFY_AT);
  const hour = match ? Math.min(23, parseInt(match[1], 10)) : 9;
  const minute = match ? parseInt(match[2], 10) : 0;
  const minuteIndex = NOTIFY_MINUTE_VALUES.reduce(
    (best, v, i) => (Math.abs(v - minute) < Math.abs(NOTIFY_MINUTE_VALUES[best] - minute) ? i : best),
    0,
  );
  return { hour, minuteIndex };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * The reminder block. `times` is the canonical list GoalForm submits as
 * Goal.notifyTimes; `days` is the optional reminder-weekday set
 * (Goal.notifyDays), left `undefined` to mean "follow the goal's own
 * schedule" -- goalReminders.ts's goalNotifyDays owns that precedence, and
 * the copy below ("Same days as the goal") is written to match it.
 */
export function GoalReminderControl({
  notify,
  times,
  days,
  onlyIfBehind,
  onNotifyChange,
  onTimesChange,
  onDaysChange,
  onOnlyIfBehindChange,
  onWheelActiveChange,
  color,
}: {
  notify: boolean;
  times: string[];
  days: number[] | undefined;
  onlyIfBehind: boolean;
  onNotifyChange: (value: boolean) => void;
  onTimesChange: (times: string[]) => void;
  onDaysChange: (days: number[] | undefined) => void;
  onOnlyIfBehindChange: (value: boolean) => void;
  onWheelActiveChange: (active: boolean) => void;
  color: ReturnType<typeof useTheme>;
}) {
  // `null` = the picker is closed. A number = editing the time at that
  // index. -1 = adding a new one. One piece of state for both, so the picker
  // can never be open in two conflicting modes at once.
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<string>(DEFAULT_NOTIFY_AT);

  // Read rather than threaded through as props: the quiet-hours warning
  // below is this control's own business and no caller of GoalForm has any
  // reason to know about it -- same "a section reads its own store slice"
  // shape RingBaselineSection.tsx already uses.
  const quietHoursEnabled = useSettingsStore((s) => s.quietHoursEnabled);
  const quietStart = useSettingsStore((s) => s.quietStart);
  const quietEnd = useSettingsStore((s) => s.quietEnd);

  const { hour, minuteIndex } = parseTime(draft);

  const setToggle = (next: boolean) => {
    onNotifyChange(next);
    // Turning the reminder on for the first time seeds a real time rather
    // than leaving an empty list: there's no such thing as a goal with
    // notify:true and nothing to fire, so the list needs a value the
    // instant the toggle flips.
    if (next && times.length === 0) onTimesChange([DEFAULT_NOTIFY_AT]);
  };

  const openPicker = (index: number) => {
    setDraft(index >= 0 ? times[index] : DEFAULT_NOTIFY_AT);
    setEditingIndex(index);
  };

  const closePicker = () => {
    setEditingIndex(null);
    // The wheels are unmounting -- release the enclosing Sheet's scroll lock
    // unconditionally, since a wheel that disappears mid-drag will never
    // fire its own onDragEnd. Without this the sheet could be left
    // permanently unscrollable, the same class of stuck-lock bug
    // WheelPicker's onDragStart/onDragEnd contract exists to prevent.
    onWheelActiveChange(false);
  };

  const commitDraft = () => {
    if (editingIndex === null) return;
    const next = editingIndex >= 0 ? times.map((t, i) => (i === editingIndex ? draft : t)) : [...times, draft];
    // Deduped and sorted here as well as in goals.ts -- not redundancy for
    // its own sake: the chip row must show the same canonical order the
    // saved goal will have, or adding a time would visibly reorder the list
    // only after saving.
    onTimesChange(Array.from(new Set(next)).sort());
    closePicker();
  };

  const removeAt = (index: number) => {
    const next = times.filter((_, i) => i !== index);
    onTimesChange(next);
    // An empty list with the toggle still on would submit a reminder that
    // can never fire -- turn the whole thing off instead, which is what
    // removing your last reminder time evidently means.
    if (next.length === 0) onNotifyChange(false);
  };

  const suppressed = quietHoursEnabled ? times.filter((t) => isInQuietHours(t, quietStart, quietEnd)) : [];
  const atLimit = times.length >= MAX_NOTIFY_TIMES;

  return (
    <View style={styles.block}>
      <View style={styles.toggleRowLabel}>
        <Text style={[styles.formLabel, { color: color.textDim }]}>Remind me</Text>
        {/* accessibilityRole/State -- same reasoning as GoalFormExtras.tsx's
            SessionTargetControl switch: gives VoiceOver/TalkBack an actual
            switch role + checked state instead of a labelled-but-stateless
            element. Colours stay on the OS default, as everywhere else. */}
        <Switch
          value={notify}
          onValueChange={setToggle}
          accessibilityRole="switch"
          accessibilityLabel="Remind me about this goal"
          accessibilityState={{ checked: notify }}
        />
      </View>

      {notify ? (
        <>
          <View style={styles.chipRow}>
            {times.map((time, i) => (
              <View key={time} style={[styles.timeChip, { borderColor: withAlpha(color.accent, 0.4) }]}>
                <AnimatedPressable
                  onPress={() => openPicker(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`Reminder at ${formatClockTime(time)}, edit`}
                >
                  <Text style={[styles.timeChipText, { color: color.text }]}>{formatClockTime(time)}</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={() => removeAt(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove the ${formatClockTime(time)} reminder`}
                  hitSlop={hitSlop.glyph}
                >
                  <Text style={[styles.removeGlyph, { color: color.textDim }]}>×</Text>
                </AnimatedPressable>
              </View>
            ))}
            {!atLimit ? (
              <AnimatedPressable
                onPress={() => openPicker(-1)}
                accessibilityRole="button"
                accessibilityLabel="Add another reminder time"
                style={[styles.addChip, { borderColor: color.accent }]}
              >
                <Text style={[styles.timeChipText, { color: color.accent }]}>+ Add time</Text>
              </AnimatedPressable>
            ) : null}
          </View>

          {atLimit ? (
            <Text style={[styles.hint, { color: color.textDim }]}>
              That's the maximum of {MAX_NOTIFY_TIMES} reminder times for one goal.
            </Text>
          ) : null}

          {suppressed.length > 0 ? (
            // Named explicitly rather than a generic "some reminders are
            // muted": the whole failure this warns about is a reminder that
            // silently never arrives, so it has to say WHICH one.
            <Text style={[styles.hint, { color: color.danger }]}>
              {suppressed.map(formatClockTime).join(', ')} {suppressed.length === 1 ? 'falls' : 'fall'} inside your quiet
              hours and won't be sent. Change quiet hours in Settings &gt; Notifications.
            </Text>
          ) : null}

          {editingIndex !== null ? (
            <View style={styles.picker}>
              <View
                style={styles.wheelRow}
                onTouchStart={() => onWheelActiveChange(true)}
                onTouchEnd={() => onWheelActiveChange(false)}
                onTouchCancel={() => onWheelActiveChange(false)}
              >
                {/* Same three-way gesture handoff GoalForm's target wheels
                    use: onTouchStart claims the gesture early, onTouchEnd/
                    -Cancel release it for a tap that never became a drag,
                    and onDragEnd is the guaranteed release once a wheel
                    actually captures the drag. Also same fix as GoalForm's
                    wheelRow (see that file's own comment): styles.wheelRow
                    below sets alignSelf: 'center' so this touch-capturing
                    View shrinks to the two wheels' own footprint instead of
                    stretching to styles.picker's full column width -- a
                    touch in what would otherwise be dead margin now falls
                    through to the Sheet's outer scroll instead of silently
                    disabling it for a drag no wheel ever captures. */}
                <WheelPicker
                  labels={CLOCK_HOUR_LABELS}
                  selectedIndex={hour}
                  onChange={(i) => setDraft(formatTime(i, NOTIFY_MINUTE_VALUES[minuteIndex]))}
                  onDragStart={() => onWheelActiveChange(true)}
                  onDragEnd={() => onWheelActiveChange(false)}
                  accessibilityLabel="Reminder time, hour"
                />
                <WheelPicker
                  labels={NOTIFY_MINUTE_LABELS}
                  selectedIndex={minuteIndex}
                  onChange={(i) => setDraft(formatTime(hour, NOTIFY_MINUTE_VALUES[i]))}
                  onDragStart={() => onWheelActiveChange(true)}
                  onDragEnd={() => onWheelActiveChange(false)}
                  accessibilityLabel="Reminder time, minute"
                />
              </View>
              <View style={styles.pickerActions}>
                <AnimatedPressable
                  onPress={commitDraft}
                  accessibilityRole="button"
                  style={[styles.pickerBtn, { backgroundColor: color.accent, borderColor: color.accent }]}
                >
                  <Text style={[styles.pickerBtnText, { color: color.accentText }]}>
                    {editingIndex >= 0 ? 'Update' : 'Add'} {formatClockTime(draft)}
                  </Text>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={closePicker}
                  accessibilityRole="button"
                  style={[styles.pickerBtn, { borderColor: color.textDim }]}
                >
                  <Text style={[styles.pickerBtnText, { color: color.textDim }]}>Cancel</Text>
                </AnimatedPressable>
              </View>
            </View>
          ) : null}

          <View style={styles.toggleRowLabel}>
            <Text style={[styles.formLabel, { color: color.textDim }]}>Only when I'm behind</Text>
            <Switch
              value={onlyIfBehind}
              onValueChange={onOnlyIfBehindChange}
              accessibilityRole="switch"
              accessibilityLabel="Only remind me when I'm behind on this goal"
              accessibilityState={{ checked: onlyIfBehind }}
            />
          </View>
          <Text style={[styles.hint, { color: color.textDim }]}>
            {onlyIfBehind
              ? "Skips the reminder once you've hit the target, and says how much is left when you haven't."
              : 'Reminds you every time, even after the goal is met.'}
          </Text>

          <View style={styles.toggleRowLabel}>
            <Text style={[styles.formLabel, { color: color.textDim }]}>Remind on specific days</Text>
            <Switch
              value={days !== undefined}
              // Seeded with every day rather than none, for the same reason
              // GoalForm seeds its own weekday chips that way: all-on is the
              // reading that looks like "every day", not like nothing has
              // been chosen yet.
              onValueChange={(on) => onDaysChange(on ? [0, 1, 2, 3, 4, 5, 6] : undefined)}
              accessibilityRole="switch"
              accessibilityLabel="Remind me only on specific days"
              accessibilityState={{ checked: days !== undefined }}
            />
          </View>
          {days !== undefined ? (
            <WeekdayChips selected={days} onChange={onDaysChange} color={color} />
          ) : (
            <Text style={[styles.hint, { color: color.textDim }]}>Same days as the goal itself.</Text>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  formLabel: { ...typeScale.label },
  hint: { ...typeScale.caption },
  toggleRowLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  timeChipText: { ...typeScale.label },
  // 16/20 rather than 16/18 -- 1.12 was the only line-height ratio in the
  // app off tokens.ts's curve (16px sits at 1.25 there, typeScale.sectionTitle),
  // and a line box shorter than the glyph's own ascender risks clipping on
  // Android.
  removeGlyph: { fontSize: 16, lineHeight: 20, fontWeight: '700' },
  addChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed' },
  picker: { gap: spacing.sm },
  // alignSelf: 'center' is the fix (see the wheelRow View's own comment
  // above); justifyContent is kept only as a no-op once alignSelf is set.
  wheelRow: { flexDirection: 'row', justifyContent: 'center', alignSelf: 'center', gap: 8 },
  pickerActions: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  pickerBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5 },
  pickerBtnText: { ...typeScale.label, fontWeight: '600' },
});
