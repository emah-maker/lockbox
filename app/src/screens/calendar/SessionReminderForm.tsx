// SessionReminderForm.tsx -- the add/edit form for one scheduled focus
// session, mounted in its own Sheet from DaySheet.tsx. One form serves both
// create and edit, for the same reason GoalForm.tsx's header gives: a plan's
// editable surface is exactly its creatable surface, so a second copy would
// only be two places to keep the wheel/chip behavior in sync.
//
// Built on ui/FormDisclosure.tsx from the start rather than as a flat stack
// of every control: the day this form is opened from already answers "when,
// roughly", so the only field that always deserves to be open is the start
// time. Label, duration and note each collapse to a one-line summary until
// you actually want them -- which is what keeps this sheet short enough to
// read without scrolling, and is the same treatment GoalForm.tsx was
// restructured into.
//
// Owns no persistence and no validation: it hands a ScheduledSessionInput to
// `onSubmit` and renders whatever `error` its parent passes back down.
// schedule/scheduledSessions.ts is the only authority on whether those
// values are acceptable, and its LEAD_MINUTE_OPTIONS is what this file's
// chips are derived from rather than a second list of the same numbers.
import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Sheet } from '../../ui/Sheet';
import { FormDisclosure } from '../../ui/FormDisclosure';
import { WheelPicker } from '../../ui/WheelPicker';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { Button } from '../SettingsPrimitives';
import { TopicChip } from '../GoalTopicChips';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/color';
import { allLabelChoices, resolveTopic } from '../../stats/customLabels';
import { formatDuration } from '../../stats/stats';
import { formatClockTime } from '../../ui/time';
import { dayKeyToDate } from '../../stats/sessionHistory';
import { reminderFallsInQuietHours } from '../../schedule/sessionReminderPlan';
import {
  LEAD_MINUTE_OPTIONS,
  MAX_NOTE_LENGTH,
  ScheduledSession,
  ScheduledSessionInput,
} from '../../schedule/scheduledSessions';
import { spacing, typeScale } from '../../theme/tokens';

// Same 5-minute grid every other minute wheel in this app snaps to (the
// dashboard's lock duration, the goal target, the goal reminder time) --
// re-derived here rather than imported from GoalReminderControl.tsx, which
// is a form component, not a shared constants module.
const MINUTE_STEP = 5;
const MINUTE_VALUES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const MINUTE_LABELS = MINUTE_VALUES.map((m) => String(m).padStart(2, '0'));
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

const DEFAULT_TIME = '09:00';
const DEFAULT_LEAD = 10;

// Matches DurationSheet.tsx's SCROLL_LOCK_SAFETY_MS -- long enough that a
// real wheel drag never trips it, short enough that a dropped release isn't
// felt as a frozen screen. See wheelSafetyTimer below.
const WHEEL_LOCK_SAFETY_MS = 600;

// Durations offered as chips instead of a third and fourth WheelPicker.
// A planned session's length is a rough intention picked from a handful of
// habitual values, not an arbitrary number needing 24x12 reachable
// combinations -- and this form's whole point is to not be a wall of wheels.
// Free-form lengths remain possible where they matter: the box's actual
// timer is set at the box (see DurationSheet.tsx).
const DURATION_OPTIONS_S = [15 * 60, 25 * 60, 30 * 60, 45 * 60, 60 * 60, 90 * 60, 120 * 60];

function parseTime(value: string): { hour: number; minuteIndex: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hour = match ? Math.min(23, parseInt(match[1], 10)) : 9;
  const minute = match ? parseInt(match[2], 10) : 0;
  // Snaps an off-grid minute onto the nearest wheel stop, the same
  // defensive snap GoalReminderControl.tsx applies -- a plan could have been
  // written by a future surface with a finer step, and the wheel still has
  // to land somewhere valid.
  const minuteIndex = MINUTE_VALUES.reduce(
    (best, v, i) => (Math.abs(v - minute) < Math.abs(MINUTE_VALUES[best] - minute) ? i : best),
    0,
  );
  return { hour, minuteIndex };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "At the start time" / "10 min before" / "1 hour before" -- shared by the
 * chips themselves and by the collapsed summary, so the two can never
 * describe the same value differently. */
export function leadLabel(minutes: number): string {
  if (minutes === 0) return 'At start';
  if (minutes === 60) return '1 hour before';
  return `${minutes} min before`;
}

type OpenGroup = 'time' | 'label' | 'duration' | 'note' | null;

export function SessionReminderForm({
  visible,
  onClose,
  dateKey,
  initial,
  error,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  /** The day this plan belongs to, 'YYYY-MM-DD'. Fixed for the lifetime of
   * the form: you got here by tapping a specific day, so re-offering a date
   * picker would be asking a question that was already answered. Moving a
   * plan to another day is a delete + re-add from that day, which is both
   * rarer and clearer than a date field buried in this sheet. */
  dateKey: string;
  /** Present when editing an existing plan; absent when creating one. */
  initial?: ScheduledSession;
  error: string | null;
  onSubmit: (input: ScheduledSessionInput) => void;
}) {
  const color = useTheme();
  const customLabels = useSettingsStore((s) => s.customLabels);
  const themeMode = useSettingsStore((s) => s.themeMode);
  // Read here rather than threaded through: the quiet-hours warning below is
  // this form's own business and DaySheet has no reason to know about it --
  // the same "a control reads its own store slice" shape
  // GoalReminderControl.tsx uses for exactly the same warning.
  const quietHoursEnabled = useSettingsStore((s) => s.quietHoursEnabled);
  const quietStart = useSettingsStore((s) => s.quietStart);
  const quietEnd = useSettingsStore((s) => s.quietEnd);

  const [time, setTime] = React.useState(initial?.time ?? DEFAULT_TIME);
  const [leadMinutes, setLeadMinutes] = React.useState(initial?.leadMinutes ?? DEFAULT_LEAD);
  const [topic, setTopic] = React.useState<string | null>(initial?.topic ?? null);
  const [plannedS, setPlannedS] = React.useState<number | undefined>(initial?.plannedS);
  const [note, setNote] = React.useState(initial?.note ?? '');
  // Accordion, not independent toggles: at most one group open is what
  // actually keeps this sheet short (see FormDisclosure.tsx's header). Start
  // time opens by default because it is the one field with no useful
  // default -- everything else has a sensible one the summary already shows.
  const [open, setOpen] = React.useState<OpenGroup>('time');
  const [wheelActive, setWheelActive] = React.useState(false);
  // Every release path below (onDragEnd, onTouchEnd/-Cancel, toggle) depends
  // on an event actually arriving. This timer is the backstop for when one
  // doesn't -- realistically, the app being backgrounded mid-drag by an
  // incoming call or a control-center swipe, where RN makes no promise of a
  // synthetic touch-end. Without it a single dropped release leaves this
  // `size="large"` sheet scrollEnabled={false} for good, with Save/Cancel
  // below the fold and unreachable: the "the time picker froze the screen"
  // report. Mirrors DurationSheet.tsx's lock/unlock pair, which is why this
  // is the only wheel-in-sheet call site that lacked one.
  const wheelSafetyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWheelSafetyTimer = () => {
    if (wheelSafetyTimer.current) {
      clearTimeout(wheelSafetyTimer.current);
      wheelSafetyTimer.current = null;
    }
  };
  const lockSheetScroll = () => {
    setWheelActive(true);
    clearWheelSafetyTimer();
    wheelSafetyTimer.current = setTimeout(() => setWheelActive(false), WHEEL_LOCK_SAFETY_MS);
  };
  const unlockSheetScroll = () => {
    clearWheelSafetyTimer();
    setWheelActive(false);
  };
  React.useEffect(() => clearWheelSafetyTimer, []);

  const { hour, minuteIndex } = parseTime(time);
  const choices = allLabelChoices(customLabels, themeMode);
  const resolvedTopic = topic ? resolveTopic(topic, customLabels, themeMode) : null;
  // An edit whose plan targets a since-deleted custom label: keep that id
  // selectable so re-saving doesn't silently retag the plan at whatever chip
  // happens to be first -- same orphan handling GoalForm.tsx does.
  const orphanId = topic && !choices.some((ch) => ch.id === topic) ? topic : null;

  const toggle = (group: Exclude<OpenGroup, null>) => {
    // Closing whichever group is open releases the sheet's scroll lock
    // unconditionally: a WheelPicker that unmounts mid-drag never fires its
    // own onDragEnd, which would otherwise leave the sheet permanently
    // unscrollable (the stuck-lock class of bug WheelPicker's
    // onDragStart/onDragEnd contract exists to prevent).
    unlockSheetScroll();
    setOpen((current) => (current === group ? null : group));
  };

  const inQuietHours = reminderFallsInQuietHours(
    { date: dateKey, time, leadMinutes },
    { quietHoursEnabled, quietStart, quietEnd },
  );

  const handleSubmit = () => {
    const trimmed = note.trim();
    onSubmit({
      date: dateKey,
      time,
      topic,
      leadMinutes,
      plannedS,
      note: trimmed ? trimmed : undefined,
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`${initial ? 'Edit' : 'Schedule'} session · ${dayKeyToDate(dateKey).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })}`}
      size="large"
      scrollEnabled={!wheelActive}
      // Wheels in the body -- see Sheet.tsx's dragBodyToDismiss.
      dragBodyToDismiss={false}
    >
      <View style={styles.form}>
        <FormDisclosure
          label="Start time"
          summary={formatClockTime(time)}
          open={open === 'time'}
          onToggle={() => toggle('time')}
          color={color}
        >
          <View
            style={styles.wheelRow}
            onTouchStart={() => lockSheetScroll()}
            onTouchEnd={() => unlockSheetScroll()}
            onTouchCancel={() => unlockSheetScroll()}
          >
            {/* Same three-way gesture handoff GoalForm's own wheels use:
                onTouchStart claims the gesture early, onTouchEnd/-Cancel
                release it for a tap that never became a drag, and onDragEnd
                is the guaranteed release once a wheel captures the drag.
                styles.wheelRow's alignSelf:'center' is load-bearing for the
                same reason it is there -- see GoalForm.tsx's long comment on
                the touch-capturing dead margin a merely-centered row leaves. */}
            <WheelPicker
              labels={HOUR_LABELS}
              selectedIndex={hour}
              onChange={(i) => setTime(formatTime(i, MINUTE_VALUES[minuteIndex]))}
              onDragStart={() => lockSheetScroll()}
              onDragEnd={() => unlockSheetScroll()}
              accessibilityLabel="Session start time, hour"
            />
            <WheelPicker
              labels={MINUTE_LABELS}
              selectedIndex={minuteIndex}
              onChange={(i) => setTime(formatTime(hour, MINUTE_VALUES[i]))}
              onDragStart={() => lockSheetScroll()}
              onDragEnd={() => unlockSheetScroll()}
              accessibilityLabel="Session start time, minute"
            />
          </View>
        </FormDisclosure>

        {/* Not a disclosure: six small chips are already a one-line answer,
            and this is the field the whole feature is named after -- hiding
            it behind a tap would be hiding the point. */}
        <Text style={[styles.label, { color: color.textDim }]}>Remind me</Text>
        <View style={styles.chipRow}>
          {LEAD_MINUTE_OPTIONS.map((minutes) => {
            const active = leadMinutes === minutes;
            return (
              <AnimatedPressable
                key={minutes}
                onPress={() => setLeadMinutes(minutes)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={leadLabel(minutes)}
                style={[
                  styles.chip,
                  { borderColor: withAlpha(color.accent, 0.4) },
                  active && { backgroundColor: color.accent, borderColor: color.accent },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? color.accentText : color.textDim }]}>
                  {leadLabel(minutes)}
                </Text>
              </AnimatedPressable>
            );
          })}
        </View>

        {inQuietHours ? (
          // Named up front rather than discovered later: the whole failure
          // this warns about is a reminder that silently never arrives. Same
          // warning, same wording shape, as GoalReminderControl.tsx's.
          <Text style={[styles.hint, { color: color.danger }]}>
            This reminder lands inside your quiet hours and won't be sent. Change quiet hours in Settings &gt;
            Notifications, or pick a different lead time.
          </Text>
        ) : null}

        <FormDisclosure
          label="Label"
          summary={resolvedTopic?.label ?? (orphanId ? 'Deleted label' : 'None')}
          open={open === 'label'}
          onToggle={() => toggle('label')}
          color={color}
        >
          <View style={styles.chipRow}>
            <TopicChip
              label="No label"
              swatchColor={color.textDim}
              activeTextColor={color.bg}
              active={topic === null}
              onPress={() => setTopic(null)}
              color={color}
            />
            {choices.map((choice) => (
              <TopicChip
                key={choice.id}
                label={choice.label}
                swatchColor={choice.color}
                // allLabelChoices already measured this per choice
                // (customLabels.ts's readableTextColor) -- reused rather
                // than re-derived, same as every other chip row in the app.
                activeTextColor={choice.textColor}
                active={topic === choice.id}
                onPress={() => setTopic(choice.id)}
                color={color}
              />
            ))}
            {orphanId ? (
              <TopicChip
                label="Deleted label"
                swatchColor={color.textDim}
                activeTextColor={color.bg}
                active={topic === orphanId}
                onPress={() => setTopic(orphanId)}
                color={color}
              />
            ) : null}
          </View>
        </FormDisclosure>

        <FormDisclosure
          label="Planned length"
          summary={plannedS ? formatDuration(plannedS) : 'Not set'}
          open={open === 'duration'}
          onToggle={() => toggle('duration')}
          color={color}
        >
          <View style={styles.chipRow}>
            <AnimatedPressable
              onPress={() => setPlannedS(undefined)}
              accessibilityRole="button"
              accessibilityState={{ selected: plannedS === undefined }}
              accessibilityLabel="No planned length"
              style={[
                styles.chip,
                { borderColor: withAlpha(color.accent, 0.4) },
                plannedS === undefined && { backgroundColor: color.accent, borderColor: color.accent },
              ]}
            >
              <Text style={[styles.chipText, { color: plannedS === undefined ? color.accentText : color.textDim }]}>
                Not set
              </Text>
            </AnimatedPressable>
            {DURATION_OPTIONS_S.map((seconds) => {
              const active = plannedS === seconds;
              return (
                <AnimatedPressable
                  key={seconds}
                  onPress={() => setPlannedS(seconds)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={formatDuration(seconds)}
                  style={[
                    styles.chip,
                    { borderColor: withAlpha(color.accent, 0.4) },
                    active && { backgroundColor: color.accent, borderColor: color.accent },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? color.accentText : color.textDim }]}>
                    {formatDuration(seconds)}
                  </Text>
                </AnimatedPressable>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: color.textDim }]}>
            A note to yourself -- the box's own timer is still set at the box.
          </Text>
        </FormDisclosure>

        <FormDisclosure
          label="Note"
          summary={note.trim() ? note.trim() : 'None'}
          open={open === 'note'}
          onToggle={() => toggle('note')}
          color={color}
        >
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What's this session for?"
            placeholderTextColor={color.textDim}
            maxLength={MAX_NOTE_LENGTH}
            accessibilityLabel="Session note"
            style={[styles.input, { color: color.text, borderColor: withAlpha(color.textDim, 0.4) }]}
          />
        </FormDisclosure>

        {error ? <Text style={[styles.hint, { color: color.danger }]}>{error}</Text> : null}

        <View style={styles.actions}>
          <Button label={initial ? 'Save session' : 'Add session'} onPress={handleSubmit} color={color} />
          <Button label="Cancel" variant="outline" onPress={onClose} color={color} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm },
  label: { ...typeScale.label },
  hint: { ...typeScale.caption, fontWeight: '400' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5 },
  chipText: { ...typeScale.label },
  // alignSelf:'center' is the fix, not justifyContent -- see the wheelRow
  // View's own comment above, and GoalForm.tsx's longer version of it.
  wheelRow: { flexDirection: 'row', justifyContent: 'center', alignSelf: 'center', gap: spacing.sm },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, ...typeScale.body },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
