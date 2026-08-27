// GoalForm.tsx -- the add/edit form for one focus goal, split out of
// GoalsSection.tsx so both stay under this project's 500-line file guideline
// (the same reason GoalsSection.tsx itself sits beside StatsScreen.tsx rather
// than inside it). The "flexible goals" extension controls (weekday chips,
// session-count stepper, notify toggle + reminder-time wheels) are split
// again into GoalFormExtras.tsx for the same reason -- see that file's own
// header.
//
// One form serves BOTH create and edit: a goal's editable surface (topic,
// period, target, and now the four extension fields) is exactly its
// creatable surface, so a second copy would only be two places to keep the
// wheel/chip behavior in sync. GoalsSection mounts it inside its own popup
// Sheet (manager brief: a form must never grow the page it's opened from
// inline) for both create and edit, rather than swapping a row's own face
// out the way the pre-Sheet version of this form used to.
//
// Owns no persistence and no validation: it hands a GoalFormValues snapshot
// to its `onSubmit` and renders whatever `error` its parent passes back down
// -- goals/goals.ts is the only authority on whether those values are
// acceptable. The one thing encoded here is the wheels' own SELECTABLE
// range, and even that is derived from goals.ts's constants (see
// PERIOD_MAX_HOURS below).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { allLabelChoices, resolveTopic } from '../stats/customLabels';
import { Goal, GoalPeriod, MAX_DAILY_TARGET_S, MAX_WEEKLY_TARGET_S, MAX_MONTHLY_TARGET_S, MAX_TARGET_SESSIONS } from '../goals/goals';
import { Button } from './SettingsPrimitives';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { WheelPicker } from '../ui/WheelPicker';
import { WeekdayChips, SessionTargetControl, NotifyControl } from './GoalFormExtras';
import { typeScale } from '../theme/tokens';

// The wheels' selectable hour range is DERIVED from goals.ts's own bounds
// rather than typed out as 24/168/744, so raising e.g. MAX_MONTHLY_TARGET_S
// there can never leave this picker silently unable to express a target the
// store would happily accept (the same "keep these numbers identical on
// both surfaces" hazard goals.ts's own MAX_GOALS comment warns about, one
// layer up). Minutes reuse DashboardScreen's 5-minute step so setting "2h
// 30m" here feels identical to setting a lock duration there.
const MINUTE_STEP = 5;
const MINUTE_VALUES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const MINUTE_LABELS = MINUTE_VALUES.map((m) => `${String(m).padStart(2, '0')}m`);
const PERIOD_MAX_HOURS: Record<GoalPeriod, number> = {
  daily: Math.floor(MAX_DAILY_TARGET_S / 3600),
  weekly: Math.floor(MAX_WEEKLY_TARGET_S / 3600),
  monthly: Math.floor(MAX_MONTHLY_TARGET_S / 3600),
};
function hourLabelsFor(period: GoalPeriod): string[] {
  return Array.from({ length: PERIOD_MAX_HOURS[period] + 1 }, (_, i) => `${i}h`);
}

const PERIOD_OPTIONS: { key: GoalPeriod; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

// Every weekday selected is data-equivalent to Goal.daysOfWeek's own
// "undefined = every day" (see that field's comment in goals.ts) -- kept as
// its own constant so the "seed the chips as all-on for an unrestricted
// goal" and "an all-on submission collapses back to no restriction at all"
// reasoning below both read against the same literal array.
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

// Sentinel for the "all focus time" choice in the topic chip row. A goal's
// own `topic: null` is what actually gets stored (goals.ts) -- this exists
// only because a chip needs a non-null React key/id to be selectable, and
// reusing the empty string would collide with goals.ts's own
// "Goal topic is required." rejection of a falsy string.
const ALL_TOPICS_ID = '__all__';

/** Maps a chip selection back to what actually gets stored: the sentinel
 * becomes `null` (goals.ts's "all focus time"), everything else passes
 * through as the raw topic id. Module-private on purpose -- the sentinel
 * exists only for this form's chip state, so nothing outside this file
 * (GoalsSection included) should ever have to know the string. */
function topicIdToStored(topicId: string): string | null {
  return topicId === ALL_TOPICS_ID ? null : topicId;
}

/** Label for the extra chip kept for a goal whose topic isn't in
 * allLabelChoices -- a since-deleted saved custom label, or a one-time
 * free-text tag typed into DashboardScreen's TopicPicker. resolveTopic
 * returns null only for the former (it falls back to the raw string for the
 * latter, see stats/customLabels.ts), which is exactly the two-case split
 * GoalsSection's own describeTopic makes for the row. Kept local so this
 * module needs nothing from the section that mounts it -- the same
 * arrangement as website/js/goalForm.js's orphanOptionLabel. */
function orphanLabel(
  topic: string,
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'],
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'],
): string {
  return resolveTopic(topic, customLabels, themeMode)?.label ?? 'Deleted label';
}

/** What GoalForm hands back to its `onSubmit` -- a full snapshot of every
 * editable field, not a partial patch (the form always shows and submits
 * every field's current value, so there's nothing to distinguish
 * "untouched" from "explicitly set to its current value"). GoalsSection.tsx
 * is the one place that turns this into goals.ts's own createGoal/
 * updateGoal call shapes -- see that file's handleCreate/handleSave for how
 * `undefined` here maps to "no value" on create and to an explicit `null`
 * clear on update. */
export interface GoalFormValues {
  topic: string | null;
  period: GoalPeriod;
  targetS: number;
  /** Only meaningful when `period === 'daily'` -- always `undefined` for
   * any other period, and collapsed to `undefined` even for `daily` when
   * every weekday (or none) is selected, since both are data-equivalent to
   * "every day" (see ALL_WEEKDAYS above). */
  daysOfWeek?: number[];
  targetSessions?: number;
  notify: boolean;
  notifyAt?: string;
}

export /** The one form used for BOTH creating and editing a goal, rendered inside
 * GoalsSection's own popup Sheet either way -- an edit opens the SAME sheet
 * pre-filled from `initial`, rather than swapping a row's face out in place
 * (the pre-Sheet version of this form's own old behavior). Deliberately not
 * two near-identical forms: a goal's editable surface is exactly its
 * creatable surface, so a second copy would just be two places to keep the
 * wheel/chip/extension-control behavior in sync. */
function GoalForm({
  initial,
  customLabels,
  themeMode,
  color,
  error,
  submitLabel,
  onSubmit,
  onCancel,
  onWheelActiveChange,
}: {
  initial?: Goal;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  color: ReturnType<typeof useTheme>;
  error: string | null;
  submitLabel: string;
  onSubmit: (values: GoalFormValues) => void;
  onCancel: () => void;
  /** Fires while any of this form's WheelPickers (target duration, or the
   * reminder-time hour/minute inside NotifyControl) is actively being
   * dragged -- GoalsSection passes this straight through to its own popup
   * Sheet's `scrollEnabled` prop, the same "outer scroll yields to an inner
   * wheel drag" contract DurationSheet.tsx already applies for the
   * identical WheelPicker-inside-Sheet situation. */
  onWheelActiveChange: (active: boolean) => void;
}) {
  const [topicId, setTopicId] = React.useState<string>(initial?.topic ?? ALL_TOPICS_ID);
  const [period, setPeriod] = React.useState<GoalPeriod>(initial?.period ?? 'daily');
  const [hours, setHours] = React.useState(Math.floor((initial?.targetS ?? 1500) / 3600));
  const [minutes, setMinutes] = React.useState(() => {
    const m = Math.floor(((initial?.targetS ?? 1500) % 3600) / 60);
    // Snap an off-step minute value (a target set from the dashboard, which
    // has no 5-minute step) onto the nearest wheel stop, so the wheel never
    // displays a value it can't actually be parked on.
    return MINUTE_VALUES.reduce((best, v) => (Math.abs(v - m) < Math.abs(best - m) ? v : best), 0);
  });
  // Seeded as ALL_WEEKDAYS (every chip on) when the goal has no restriction
  // yet -- see ALL_WEEKDAYS's own comment for why that's the reading that
  // actually looks like "every day", rather than seeding an empty selection
  // that would look like nothing had been chosen at all.
  const [daysOfWeek, setDaysOfWeek] = React.useState<number[]>(
    initial?.daysOfWeek && initial.daysOfWeek.length > 0 ? initial.daysOfWeek : ALL_WEEKDAYS,
  );
  const [targetSessions, setTargetSessions] = React.useState<number | undefined>(initial?.targetSessions);
  const [notify, setNotify] = React.useState<boolean>(initial?.notify ?? false);
  const [notifyAt, setNotifyAt] = React.useState<string | undefined>(initial?.notifyAt);

  const hourLabels = hourLabelsFor(period);
  const targetS = hours * 3600 + minutes * 60;

  const selectPeriod = (next: GoalPeriod) => {
    setPeriod(next);
    // Clamp the hours wheel into the new period's own range (daily tops out
    // far below weekly/monthly). Only the wheel's *selectable* range -- goals.ts
    // is still the only thing that decides whether the resulting targetS is
    // acceptable, and an out-of-range target still surfaces its own thrown
    // message rather than being silently rounded down here.
    setHours((h) => Math.min(h, PERIOD_MAX_HOURS[next]));
  };

  const choices = allLabelChoices(customLabels, themeMode);
  // An edit whose goal targets a since-deleted custom label: keep that id
  // selectable so re-saving the goal doesn't silently retarget it at
  // whatever chip happens to be first. resolveTopic returns null for it, so
  // it would otherwise have no chip at all.
  const orphanId =
    initial?.topic && initial.topic !== ALL_TOPICS_ID && !choices.some((ch) => ch.id === initial.topic)
      ? initial.topic
      : null;

  const handleSubmit = () => {
    // Every weekday selected (or none) is "no restriction at all" --
    // collapsed to `undefined` here rather than left as a 7-long array, so
    // a goal that's never been restricted keeps reading that way after a
    // round-trip through this form (see ALL_WEEKDAYS's own comment).
    const restrictedDays =
      period === 'daily' && daysOfWeek.length > 0 && daysOfWeek.length < 7 ? daysOfWeek : undefined;
    onSubmit({
      topic: topicIdToStored(topicId),
      period,
      targetS,
      daysOfWeek: restrictedDays,
      targetSessions,
      notify,
      notifyAt,
    });
  };

  return (
    <View style={styles.form}>
      <Text style={[styles.formLabel, { color: color.textDim }]}>Count sessions labeled</Text>
      <View style={styles.chipRow}>
        <TopicChip
          label="All focus time"
          swatchColor={color.accent}
          // No ResolvedTopic to read a measured `textColor` from -- but the
          // swatch IS the theme accent, which accentText was contrast-tuned
          // against (see theme.ts's per-mode accent audit).
          activeTextColor={color.accentText}
          active={topicId === ALL_TOPICS_ID}
          onPress={() => setTopicId(ALL_TOPICS_ID)}
          color={color}
        />
        {choices.map((choice) => (
          <TopicChip
            key={choice.id}
            label={choice.label}
            swatchColor={choice.color}
            // allLabelChoices already measured this per choice (customLabels.ts's
            // readableTextColor) -- reused rather than re-derived, exactly as
            // TopicPicker.tsx's own chip row does.
            activeTextColor={choice.textColor}
            active={topicId === choice.id}
            onPress={() => setTopicId(choice.id)}
            color={color}
          />
        ))}
        {orphanId ? (
          <TopicChip
            label={orphanLabel(orphanId, customLabels, themeMode)}
            swatchColor={color.textDim}
            activeTextColor={color.bg}
            active={topicId === orphanId}
            onPress={() => setTopicId(orphanId)}
            color={color}
          />
        ) : null}
      </View>

      <Text style={[styles.formLabel, { color: color.textDim }]}>Every</Text>
      <View style={styles.chipRow}>
        {PERIOD_OPTIONS.map((opt) => (
          <AnimatedPressable
            key={opt.key}
            onPress={() => selectPeriod(opt.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: period === opt.key }}
            style={[
              styles.periodChip,
              { borderColor: withAlpha(color.accent, 0.4) },
              period === opt.key && { backgroundColor: color.accent, borderColor: color.accent },
            ]}
          >
            <Text style={[styles.periodChipText, { color: period === opt.key ? color.accentText : color.textDim }]}>
              {opt.label}
            </Text>
          </AnimatedPressable>
        ))}
      </View>

      {/* Weekday restriction is only meaningful for a daily goal -- a
          weekly/monthly goal's window already spans its whole period, so
          "which days count" has no meaning for either (goalProgress.ts's
          isGoalDueOn treats it the same way). Hidden rather than disabled
          when not applicable, so the form doesn't grow taller than it needs
          to for the common (unrestricted, or non-daily) case. */}
      {period === 'daily' ? (
        <>
          <Text style={[styles.formLabel, { color: color.textDim }]}>On these days</Text>
          <WeekdayChips selected={daysOfWeek} onChange={setDaysOfWeek} color={color} />
        </>
      ) : null}

      <Text style={[styles.formLabel, { color: color.textDim }]}>Target</Text>
      <View
        style={styles.wheelRow}
        onTouchStart={() => onWheelActiveChange(true)}
        onTouchEnd={() => onWheelActiveChange(false)}
        onTouchCancel={() => onWheelActiveChange(false)}
      >
        {/* Same three-way guard DashboardScreen.tsx uses: onTouchStart wins
            the gesture early, onTouchEnd/-Cancel release it for a tap that
            never became a drag, and onDragEnd is the guaranteed release once
            a wheel actually captures the drag (at which point this wrapping
            View stops receiving touch events at all). */}
        <WheelPicker
          labels={hourLabels}
          selectedIndex={Math.min(hours, hourLabels.length - 1)}
          onChange={(i) => setHours(i)}
          onDragStart={() => onWheelActiveChange(true)}
          onDragEnd={() => onWheelActiveChange(false)}
          accessibilityLabel="Goal target, hours"
        />
        <WheelPicker
          labels={MINUTE_LABELS}
          selectedIndex={Math.max(0, MINUTE_VALUES.indexOf(minutes))}
          onChange={(i) => setMinutes(MINUTE_VALUES[i])}
          onDragStart={() => onWheelActiveChange(true)}
          onDragEnd={() => onWheelActiveChange(false)}
          accessibilityLabel="Goal target, minutes"
        />
      </View>

      <SessionTargetControl value={targetSessions} onChange={setTargetSessions} max={MAX_TARGET_SESSIONS} color={color} />

      <NotifyControl
        notify={notify}
        notifyAt={notifyAt}
        onNotifyChange={setNotify}
        onNotifyAtChange={setNotifyAt}
        onWheelActiveChange={onWheelActiveChange}
        color={color}
      />

      {error ? <Text style={[styles.caption, { color: color.danger }]}>{error}</Text> : null}

      <View style={styles.formActions}>
        <Button
          label={submitLabel}
          // A 0h00m target is an inputs-not-valid-yet resting state, not an
          // in-flight one -- see SettingsPrimitives' Button `disabled` vs
          // `loading` comment. goals.ts still owns the real bound check
          // (MIN_TARGET_S), which is why every other out-of-range case is
          // left to surface as its thrown message instead of being disabled
          // away here.
          disabled={targetS <= 0}
          onPress={handleSubmit}
          color={color}
        />
        <Button label="Cancel" variant="outline" onPress={onCancel} color={color} />
      </View>
    </View>
  );
}

/** One selectable topic chip. Same pill shape/fill-when-active model as
 * TopicPicker.tsx's chip row -- reused as the label-choice model rather than
 * inventing a second picker, so "which label does this apply to" looks the
 * same whether you're tagging a session or aiming a goal. Carries a small
 * swatch too, since a goal's own row above is identified by that color. */
function TopicChip({
  label,
  swatchColor,
  activeTextColor,
  active,
  onPress,
  color,
}: {
  label: string;
  swatchColor: string;
  activeTextColor: string;
  active: boolean;
  onPress: () => void;
  color: ReturnType<typeof useTheme>;
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.topicChip, { borderColor: swatchColor }, active && { backgroundColor: swatchColor }]}
    >
      {/* Only while unfilled: once the chip's whole background IS the swatch
          color, a second dot in that same color is invisible anyway, and the
          filled pill already carries the identity. */}
      {active ? null : <View style={[styles.chipDot, { backgroundColor: swatchColor }]} />}
      <Text style={[styles.topicChipText, { color: active ? activeTextColor : color.text }]}>{label}</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 12, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  form: { gap: 10 },
  formLabel: { ...typeScale.label },
  formActions: { flexDirection: 'row', gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  topicChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5 },
  topicChipText: { ...typeScale.label },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  periodChip: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1.5 },
  periodChipText: { ...typeScale.label, fontWeight: '600' },
  wheelRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
});
