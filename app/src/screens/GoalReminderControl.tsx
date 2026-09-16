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
import { ClockWheels, CLOCK_MINUTE_STEP } from '../ui/ClockWheels';
import { WheelLockPhase } from '../ui/WheelPicker';
import { useSettingsStore } from '../store/useSettingsStore';
import { MAX_NOTIFY_TIMES, notifyTimeToMinutes } from '../goals/goalReminders';
import { isInQuietHours } from '../goals/goalNotificationPlan';
import { formatClock24, formatClockTime } from '../ui/time';
import { WeekdayChips } from './GoalFormExtras';
import { hitSlop, spacing, typeScale } from '../theme/tokens';

// The reminder-time picker -- hour + minute wheels and an AM/PM selector --
// is ui/ClockWheels.tsx, shared with the quiet-hours boundaries and a planned
// session's start time. The wheel indices, the 12-hour conversion and the
// off-grid minute snap all live there; what is left here is the draft-time
// list logic below, which is this file's actual subject.
//
// The step is still needed here: nextAvailableDraftTime walks the day on the
// same grid the wheel snaps to, so a seeded draft always lands on a reachable
// stop.
const NOTIFY_MINUTE_STEP = CLOCK_MINUTE_STEP;
const DEFAULT_NOTIFY_AT = '09:00';

const MINUTES_PER_DAY = 24 * 60;

/**
 * Where the "+ Add time" picker's draft opens for a NEW entry -- the fix for
 * the silent-collapse bug this file's header now documents (openPicker used
 * to hand back the hardcoded DEFAULT_NOTIFY_AT unconditionally, identical to
 * an already-seeded '09:00', so a user who tapped "Add" without touching the
 * wheel got no second reminder and no sign anything had gone wrong).
 *
 * Seeds one hour after the LATEST existing time (`times` is always the
 * canonical sorted list -- see commitDraft -- so the last element is the
 * max), which is never itself a duplicate: everything already in `times` is
 * <= that max, so max+1h can only collide with something already in the
 * list if it overflows past the end of the day and lands back on an entry
 * near midnight.
 *
 * Two searches, in order, so it can never wrap past midnight into an
 * earlier time that's ALSO taken and call that a fix (that would just move
 * this same silent-collision bug to a different fixed value):
 *  1. Forward from latest+1h to the end of the day, in the same 5-minute
 *     grid every wheel in this app already snaps to -- this is the common
 *     case, and (per the paragraph above) resolves on its very first
 *     candidate unless latest is already within an hour of midnight.
 *  2. The whole day from midnight, for when step 1 has nowhere left to
 *     search (a `23:xx` latest) or the caller's `times` isn't actually
 *     sorted-with-a-true-max (defensive only -- every real caller sorts).
 * With MAX_NOTIFY_TIMES capped at 6, a free 5-minute slot always exists
 * somewhere in the 288-slot day, so step 2 always finds one in practice;
 * the DEFAULT_NOTIFY_AT after it is an unreachable-but-total fallback, not
 * a real answer -- commitDraft's own collision check is what actually
 * guards the case this function can't resolve.
 */
export function nextAvailableDraftTime(times: string[]): string {
  if (times.length === 0) return DEFAULT_NOTIFY_AT;
  const taken = new Set(times);
  const latestMinutes = notifyTimeToMinutes(times[times.length - 1]) ?? 0;
  for (let m = latestMinutes + 60; m < MINUTES_PER_DAY; m += NOTIFY_MINUTE_STEP) {
    const candidate = formatClock24(Math.floor(m / 60), m % 60);
    if (!taken.has(candidate)) return candidate;
  }
  for (let m = 0; m < MINUTES_PER_DAY; m += NOTIFY_MINUTE_STEP) {
    const candidate = formatClock24(Math.floor(m / 60), m % 60);
    if (!taken.has(candidate)) return candidate;
  }
  return DEFAULT_NOTIFY_AT;
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
  onWheelActiveChange: (active: boolean, phase?: WheelLockPhase) => void;
  color: ReturnType<typeof useTheme>;
}) {
  // `null` = the picker is closed. A number = editing the time at that
  // index. -1 = adding a new one. One piece of state for both, so the picker
  // can never be open in two conflicting modes at once.
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<string>(DEFAULT_NOTIFY_AT);
  // Set only when commitDraft finds the draft collides with a DIFFERENT
  // existing entry -- the surfaced half of the silent-collapse fix. `null`
  // whenever the picker isn't showing a rejected commit, including right
  // after it opens (a stale message from a previous attempt would otherwise
  // linger under a since-changed draft).
  const [collisionError, setCollisionError] = React.useState<string | null>(null);

  // Read rather than threaded through as props: the quiet-hours warning
  // below is this control's own business and no caller of GoalForm has any
  // reason to know about it -- same "a section reads its own store slice"
  // shape RingBaselineSection.tsx already uses.
  const quietHoursEnabled = useSettingsStore((s) => s.quietHoursEnabled);
  const quietStart = useSettingsStore((s) => s.quietStart);
  const quietEnd = useSettingsStore((s) => s.quietEnd);

  // Clears a stale collision message the instant the user actually changes
  // the wheel -- otherwise "You already have a reminder at that time"
  // would keep showing under a draft that no longer collides with anything.
  const changeDraft = (next: string) => {
    setDraft(next);
    setCollisionError(null);
  };

  const setToggle = (next: boolean) => {
    onNotifyChange(next);
    // Turning the reminder on for the first time seeds a real time rather
    // than leaving an empty list: there's no such thing as a goal with
    // notify:true and nothing to fire, so the list needs a value the
    // instant the toggle flips.
    if (next && times.length === 0) onTimesChange([DEFAULT_NOTIFY_AT]);
  };

  const openPicker = (index: number) => {
    // Editing an existing chip still seeds from that chip's own time
    // (unchanged). A NEW entry no longer seeds the hardcoded
    // DEFAULT_NOTIFY_AT unconditionally -- that was the bug: it opened
    // identical to an already-seeded '09:00', so tapping "Add" without
    // touching the wheel silently produced a duplicate that then
    // de-duped away with no error. nextAvailableDraftTime seeds a time
    // that isn't already taken instead.
    setDraft(index >= 0 ? times[index] : nextAvailableDraftTime(times));
    setEditingIndex(index);
    setCollisionError(null);
  };

  const closePicker = () => {
    setEditingIndex(null);
    setCollisionError(null);
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
    const dedup = Array.from(new Set(next)).sort();
    // A shorter deduped list means `draft` collided with some OTHER entry
    // (editing a chip back to its own unchanged value doesn't shrink
    // anything, since that value only ever appeared once to begin with).
    // This is the other half of the fix: instead of silently saving the
    // deduped list and closing as though the commit succeeded, surface it
    // and leave the picker open so the user can actually pick a different
    // time. De-duping stays in place below as a final safety net -- the
    // goal is that the user is never misled, not that a duplicate becomes
    // storable.
    if (dedup.length !== next.length) {
      setCollisionError('You already have a reminder at that time.');
      return;
    }
    // Deduped and sorted here as well as in goals.ts -- not redundancy for
    // its own sake: the chip row must show the same canonical order the
    // saved goal will have, or adding a time would visibly reorder the list
    // only after saving.
    onTimesChange(dedup);
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
              {suppressed.map((t) => formatClockTime(t)).join(', ')} {suppressed.length === 1 ? 'falls' : 'fall'} inside your quiet
              hours and won't be sent. Change quiet hours in Settings &gt; Notifications.
            </Text>
          ) : null}

          {editingIndex !== null ? (
            <View style={styles.picker}>
              <ClockWheels
                value={draft}
                onChange={changeDraft}
                onWheelActiveChange={onWheelActiveChange}
                accessibilityPrefix="Reminder time"
                fallback={DEFAULT_NOTIFY_AT}
              />
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
              {collisionError ? (
                // Same styles.hint/color.danger treatment the quiet-hours
                // warning above already uses for this screen's other
                // reminder-time validation message -- reused rather than
                // inventing a second way to surface an inline form error.
                <Text style={[styles.hint, { color: color.danger }]}>{collisionError}</Text>
              ) : null}
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
  pickerActions: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  pickerBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5 },
  pickerBtnText: { ...typeScale.label, fontWeight: '600' },
});
