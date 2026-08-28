// GoalsSection.tsx -- the "Focus goals" section, mounted inside a Sheet from
// both SettingsScreen.tsx and StatsScreen's ManageSheet.tsx (see those
// files) -- split into its own file the same way CustomLabelsSection.tsx
// sits beside it, so neither host screen has to inline this much control
// surface. Computed off useStore.sessions (same as CustomLabelsSection's own
// reasoning for its own data) rather than owning any session data itself.
//
// The add/edit form (GoalForm.tsx) is no longer swapped in for a row's own
// face -- it's mounted in this file's own nested popup Sheet (manager brief:
// a form must never grow the page/sheet it's opened from as an inline
// block). GoalsSection is therefore ALREADY mounted inside its callers' own
// Sheet (Settings' "Goals" sheet, StatsScreen's "Manage" sheet) -- opening a
// second Sheet on top of that for the form is an ordinary nested-Modal
// stack, not a re-implementation of Sheet itself; the two are independent
// native presentations, so the form's own WheelPickers dragging never
// competes with the OUTER Sheet's scroll the way it used to when the form
// rendered inline inside it.
//
// This file owns render only. Every mutation delegates straight to
// useGoalsStore's addGoal/updateGoal/archiveGoal, which in turn delegate to
// goals/goals.ts's pure helpers -- there is deliberately NO validation,
// clamping, or cap check duplicated here (GoalForm.tsx's own header
// explains why even its wheels' selectable ranges are derived from the
// store's own constants rather than typed out). Invalid input surfaces as
// the thrown Error's own `message`, rendered inline, exactly the way
// CustomLabelsSection.tsx renders createCustomLabel's "Label name is
// required." string.
import React from 'react';
import { Animated, View, Text, StyleSheet, Alert } from 'react-native';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { formatDuration } from '../stats/stats';
import { resolveTopic } from '../stats/customLabels';
import { Goal, GoalPeriod } from '../goals/goals';
import { computeGoalProgress, goalWindow, GoalProgressResult } from '../goals/goalProgress';
import { Section, Button } from './SettingsPrimitives';
import { GoalForm, GoalFormValues } from './GoalForm';
import { Sheet } from '../ui/Sheet';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { AnimatedFill } from '../ui/AnimatedFill';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { typeScale } from '../theme/tokens';
import { GoalsEmptyState } from './stats/GoalsEmptyState';
import { PeriodIcon, useMetCelebration } from './stats/goalVisuals';

const PERIOD_LABEL: Record<GoalPeriod, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Compact "Mon, Wed, Fri" summary for a day-restricted daily goal's
 * daysOfWeek -- `null` when there's nothing to show (unset, empty, or the
 * "every weekday selected" case GoalForm.tsx already collapses to
 * `undefined` on submit, kept here as a defensive second check since a
 * goal edited from the dashboard could in principle still carry a literal
 * 7-long array). */
function weekdayRestrictionLabel(goal: Goal): string | null {
  const days = goal.daysOfWeek;
  if (!days || days.length === 0 || days.length >= 7) return null;
  return days.map((d) => WEEKDAY_SHORT[d] ?? '?').join(', ');
}

/** 'HH:MM' -> a locale-formatted time string ("9:00 AM") for the row's own
 * reminder caption -- goes through a real `Date` (today's date, irrelevant
 * here) rather than hand-formatting AM/PM so this follows the device's own
 * 12h/24h preference the same way any other displayed time in the OS does. */
function formatNotifyAt(notifyAt: string): string {
  const [h, m] = notifyAt.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Progress bar geometry for one goal, handling the over-target case
 * explicitly instead of letting a >100% ratio silently saturate at a full
 * bar (goalProgress.ts leaves `ratio` deliberately unclamped for exactly
 * this reason -- see GoalProgressResult.ratio's own comment).
 *
 * The trick: the track's full width represents max(1, ratio), so an
 * over-target goal fills the bar completely AND grows a target marker that
 * slides leftward as the overshoot grows -- 180% of target reads as a full
 * bar with the marker sitting at 55% of its width, i.e. you can see how far
 * past the line you went. Under target, the marker sits at the far end
 * (where it's redundant with the track's own end) and is not drawn. */
function barGeometry(ratio: number): { fillPct: number; targetPct: number | null } {
  // A non-finite ratio can't happen through this UI (targetS is bounded well
  // away from 0 by goals.ts's MIN_TARGET_S), but the array is also fed by
  // sanitizeRemoteGoals from another device/the dashboard, so this stays
  // defensive rather than trusting arithmetic on remote data.
  if (!Number.isFinite(ratio) || ratio <= 0) return { fillPct: 0, targetPct: null };
  const denom = Math.max(1, ratio);
  return {
    fillPct: (ratio / denom) * 100,
    targetPct: ratio > 1 ? (1 / denom) * 100 : null,
  };
}

export function GoalsSection({
  color,
  /** Still accepted and still fired on every wheel drag start/end, exactly
   * as before -- kept for callers that already wire it to their OWN
   * outer Sheet's `scrollEnabled` (SettingsScreen.tsx, StatsScreen's
   * ManageSheet.tsx both do), even though the wheels themselves now live
   * inside THIS file's own nested form Sheet rather than directly in
   * whatever scroll container the caller provides. That nested Sheet is a
   * separate native presentation layered on top, so the caller's own
   * scroll no longer actually competes with a wheel drag for the same
   * gesture the way it did before the form moved into its own popup -- but
   * changing this component's public contract for that reason would be a
   * breaking change for two call sites this task doesn't own, for a
   * caller-side optimization (skip re-rendering on a signal that no longer
   * does anything for it) that isn't worth that cost. See this component's
   * own `formWheelActive` state below for what actually gates the nested
   * form Sheet's `scrollEnabled`. */
  onWheelActiveChange,
  autoOpenCreate,
}: {
  color: ReturnType<typeof useTheme>;
  onWheelActiveChange: (active: boolean) => void;
  /** Set by StatsScreen's ManageSheet when this section is reached via
   * GoalsProgressView's empty-state "Start adding goals" CTA rather than its
   * ordinary "Manage goals" button (see ManageSheet.tsx's own comment) --
   * opens straight into the create form (openForm(null) below) instead of
   * landing on this section's own "no goals yet" empty state, which used to
   * make that CTA a two-tap dead end: the first tap only got you to ANOTHER
   * identical "Start adding goals" button (below), not the form itself. */
  autoOpenCreate?: boolean;
}) {
  const sessions = useStore((s) => s.sessions);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const goals = useGoalsStore((s) => s.goals);
  const addGoal = useGoalsStore((s) => s.addGoal);
  const updateGoal = useGoalsStore((s) => s.updateGoal);
  const archiveGoal = useGoalsStore((s) => s.archiveGoal);
  const reducedMotion = useReducedMotion();

  // One sheet, two modes: `editingId === null` means the sheet (when open)
  // is creating a new goal; a real id means it's editing that goal. Replaces
  // the old adding/editingId pair (which used to pick which ROW to render a
  // form in place of) now that there's exactly one form popup regardless of
  // which goal (if any) it's editing.
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Gates the nested form Sheet's own `scrollEnabled` -- same
  // "wheel drag suspends the Sheet's own scroll" wiring
  // DurationSheet.tsx/SettingsScreen.tsx already use for a WheelPicker
  // inside a Sheet, just local to this component's own popup instead of a
  // caller's. Also forwarded to `onWheelActiveChange` (see that prop's own
  // comment) so an existing caller keeps seeing the identical signal it
  // always has.
  const [formWheelActive, setFormWheelActive] = React.useState(false);
  const onFormWheelActiveChange = (active: boolean) => {
    setFormWheelActive(active);
    onWheelActiveChange(active);
  };

  // Archived goals are tombstones, not removals (see Goal.archived in
  // goals.ts) -- filtered out here so a "deleted" goal never renders while
  // its tombstone is still propagating. computeGoalProgress filters them
  // out on its own side too; both are needed, since this list also drives
  // the rows themselves, not just their progress lookups.
  const visible = React.useMemo(() => goals.filter((g) => !g.archived), [goals]);
  // Date.now() is read here rather than passed in from the caller because a
  // goal's window boundary is a render-time fact, not a prop -- and this
  // recomputes on every sessions/goals change anyway, which is the only time
  // a bar can actually move.
  const progress = React.useMemo(
    () => computeGoalProgress(goals, sessions, Date.now()),
    [goals, sessions],
  );
  const progressById = React.useMemo(
    () => new Map(progress.map((p) => [p.goalId, p])),
    [progress],
  );
  const editingGoal = editingId !== null ? visible.find((g) => g.id === editingId) ?? null : null;

  const openForm = (id: string | null) => {
    configureLayoutAnimation(reducedMotion);
    setError(null);
    setEditingId(id);
    setFormOpen(true);
  };
  const closeForm = () => {
    configureLayoutAnimation(reducedMotion);
    setError(null);
    setFormOpen(false);
    setFormWheelActive(false);
    onWheelActiveChange(false);
  };

  // Fires openForm(null) on `autoOpenCreate`'s false->true edge, not merely
  // "the first time it's ever true" -- this component stays mounted for as
  // long as its host Sheet does (ui/Sheet.tsx passes `children` to Modal
  // unconditionally; only the modal's own OS-level visibility toggles), so a
  // ref that only guarded "has this ever fired" would silently do nothing on
  // a SECOND "Start adding goals" tap (cancel out of the form once, still no
  // goals, tap it again) since it would already be marking a stale true.
  // Tracking the previous prop value instead makes each rising edge count on
  // its own, matching StatsScreen's own manageSheetAutoCreate reset-on-close.
  const prevAutoOpenCreateRef = React.useRef(false);
  React.useEffect(() => {
    if (autoOpenCreate && !prevAutoOpenCreateRef.current) openForm(null);
    prevAutoOpenCreateRef.current = !!autoOpenCreate;
  }, [autoOpenCreate]);

  const handleCreate = (values: GoalFormValues) => {
    try {
      addGoal(values.topic, values.period, values.targetS, {
        daysOfWeek: values.daysOfWeek,
        targetSessions: values.targetSessions,
        notify: values.notify,
        notifyAt: values.notifyAt,
      });
      closeForm();
    } catch (e: any) {
      setError(e?.message ?? 'Could not create that goal.');
    }
  };

  const handleSave = (id: string, values: GoalFormValues) => {
    try {
      // Every extension field is submitted as a full replacement, not a
      // partial edit -- GoalForm always shows and hands back every field's
      // current value (see GoalFormValues' own comment), so an unset value
      // here means "the user cleared this", mapped to GoalPatch's own
      // explicit-`null`-clears convention (goals.ts), not "leave unchanged".
      updateGoal(id, {
        topic: values.topic,
        period: values.period,
        targetS: values.targetS,
        daysOfWeek: values.daysOfWeek ?? null,
        targetSessions: values.targetSessions ?? null,
        notify: values.notify,
        notifyAt: values.notifyAt ?? null,
      });
      closeForm();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save that goal.');
    }
  };

  const handleDelete = (goal: Goal) => {
    // Same confirm-then-act shape as CustomLabelsSection's own delete, and
    // the copy says what actually happens: archiveGoal writes a tombstone,
    // so the session history the goal was measured against is untouched.
    Alert.alert(
      'Delete goal?',
      `${describeTopic(goal.topic, customLabels, themeMode)} will stop being tracked. Your logged sessions are not affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            try {
              archiveGoal(goal.id);
            } catch (e: any) {
              setError(e?.message ?? 'Could not delete that goal.');
            }
          },
        },
      ],
    );
  };

  return (
    <Section
      title="Focus goals"
      subtitle="Set a daily, weekly, or monthly target -- for one label, or for all your focus time"
      color={color}
    >
      {visible.length === 0 ? (
        // Real empty state (task brief: the plain caption here used to have
        // NO button of its own, while the unconditional "New goal" Button
        // right after it -- now suppressed below -- was the only CTA,
        // meaning it stuck around unnecessarily once a goal existed too.
        // GoalsEmptyState carries its own "Start adding goals" CTA, shared
        // with GoalsProgressView.tsx's identical empty case; `compact` trims
        // its graphic/padding for this Sheet-hosted context (Section is
        // already inside Settings' or ManageSheet's own Sheet chrome).
        <GoalsEmptyState onAddGoal={() => openForm(null)} color={color} compact />
      ) : (
        <>
          {visible.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              result={progressById.get(goal.id)}
              customLabels={customLabels}
              themeMode={themeMode}
              color={color}
              onEdit={() => openForm(goal.id)}
              onDelete={() => handleDelete(goal)}
            />
          ))}

          {/* Suppressed while the list is empty -- GoalsEmptyState's own CTA
              above is the only "add a goal" affordance in that case, so this
              doesn't duplicate it (the exact problem the task brief flagged:
              this used to render unconditionally alongside a caption with no
              button of its own). */}
          <Button label="New goal" variant="outline" onPress={() => openForm(null)} color={color} />
        </>
      )}

      {/* The form's own Sheet carries its own error slot (below) -- this
          one only ever covers the delete path, which has no form open to
          render an error into. */}
      {error && !formOpen ? <Text style={[styles.caption, { color: color.danger }]}>{error}</Text> : null}

      <Sheet
        visible={formOpen}
        onClose={closeForm}
        title={editingGoal ? 'Edit goal' : 'New goal'}
        size="large"
        scrollEnabled={!formWheelActive}
      >
        <GoalForm
          initial={editingGoal ?? undefined}
          customLabels={customLabels}
          themeMode={themeMode}
          color={color}
          error={error}
          submitLabel={editingGoal ? 'Save goal' : 'Add goal'}
          onSubmit={(values) => (editingGoal ? handleSave(editingGoal.id, values) : handleCreate(values))}
          onCancel={closeForm}
          onWheelActiveChange={onFormWheelActiveChange}
        />
      </Sheet>
    </Section>
  );
}

/** Display name for a goal's stored topic string. `null` is the "all focus
 * time" goal; anything else goes through resolveTopic so a built-in key, a
 * live custom label, and a one-time free-text tag all render the same way
 * they do everywhere else (see stats/customLabels.ts). resolveTopic returns
 * null only for a since-deleted saved custom label -- a goal aimed at one
 * keeps working (goalProgress.ts matches on the raw id), so it gets an
 * explicit "Deleted label" name rather than an empty row. */
function describeTopic(
  topic: string | null,
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'],
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'],
): string {
  if (topic === null) return 'All focus time';
  return resolveTopic(topic, customLabels, themeMode)?.label ?? 'Deleted label';
}

function topicSwatchColor(
  topic: string | null,
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'],
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'],
  color: ReturnType<typeof useTheme>,
): string {
  if (topic === null) return color.accent;
  return resolveTopic(topic, customLabels, themeMode)?.color ?? color.textDim;
}

function GoalRow({
  goal,
  result,
  customLabels,
  themeMode,
  color,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  result: GoalProgressResult | undefined;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  color: ReturnType<typeof useTheme>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // `result` should always be present (computeGoalProgress covers every
  // non-archived goal, and this row only renders for those), but a goal
  // archived between the two memos would drop out -- fall back to a zeroed
  // reading rather than crashing on undefined.
  const focusS = result?.focusS ?? 0;
  const ratio = result?.ratio ?? 0;
  const met = result?.met ?? false;
  const { fillPct, targetPct } = barGeometry(ratio);
  const name = describeTopic(goal.topic, customLabels, themeMode);
  const swatch = topicSwatchColor(goal.topic, customLabels, themeMode, color);
  const barColor = met ? color.accent : swatch;
  const percent = Math.round(ratio * 100);
  const reducedMotion = useReducedMotion();
  // "This goal's target was just met" -- a one-shot pulse on the percent
  // readout, layered on top of this row's own fill/percent rather than
  // replacing anything (see useMetCelebration's own header comment for why
  // this is deliberately a different trigger from GoalsProgressView's
  // highlightAnim).
  const metPulse = useMetCelebration(met, reducedMotion);
  const window = goalWindow(goal.period, Date.now());
  const restriction = weekdayRestrictionLabel(goal);
  // Compact secondary caption -- restriction / session-count target /
  // reminder -- joined into one line rather than three stacked rows, per
  // this task's own "minimize vertical scrolling" constraint. `null`
  // entries (nothing to show for that piece) are filtered out, so a plain
  // time-only, unrestricted, silent goal shows no second caption at all.
  const extraBits = [
    restriction,
    result?.targetSessions !== undefined ? `${result.sessionCount}/${result.targetSessions} sessions` : null,
    goal.notify && goal.notifyAt ? `Reminder ${formatNotifyAt(goal.notifyAt)}` : null,
  ].filter((s): s is string => s !== null);

  return (
    <View
      style={styles.goalRow}
      accessible
      accessibilityLabel={`${name}, ${goal.period} goal, ${formatDuration(focusS)} of ${formatDuration(goal.targetS)}, ${percent} percent`}
    >
      <View style={styles.goalHead}>
        <View style={[styles.swatch, { backgroundColor: swatch }]} />
        <Text style={[styles.goalName, { color: color.text }]} numberOfLines={1}>
          {name}
        </Text>
        <View style={[styles.periodTag, { backgroundColor: withAlpha(color.textDim, 0.18) }]}>
          <PeriodIcon period={goal.period} size={11} color={color.textDim} />
          <Text style={[styles.periodTagText, { color: color.textDim }]}>{PERIOD_LABEL[goal.period]}</Text>
        </View>
      </View>

      {extraBits.length > 0 ? (
        <Text style={[styles.caption, { color: color.textDim }]} numberOfLines={1}>
          {extraBits.join(' · ')}
        </Text>
      ) : null}

      <View style={[styles.track, { backgroundColor: withAlpha(color.textDim, 0.22) }]}>
        <AnimatedFill axis="width" toValue={fillPct} style={styles.fill} color={barColor} />
        {targetPct !== null ? (
          // Over target: the bar is full, so the target line itself is what
          // carries "how far past" -- see barGeometry's comment.
          <View style={[styles.targetMark, { left: `${targetPct}%`, backgroundColor: color.bg }]} />
        ) : null}
      </View>

      {/* Restructured (task brief) rather than truncated, so no number is
          ever lost: this row used to concatenate up to three durations on
          the left ("5h 30m of 8h · 2h 30m to go") against a percent on the
          right, with no numberOfLines/flexShrink/flex on either -- a long
          combination overran the row's width with nothing to stop it. Row A
          keeps the always-present "{focus} of {target}" (flexShrink so it's
          the side that gives, capped to one line) beside the percent
          (flexShrink:0, so it's never the side that gets clipped); the
          remaining-time phrase drops to its own Row B instead of fighting
          the percent for the same line. */}
      <View style={styles.goalMetaRow}>
        <Text style={[styles.caption, { color: color.textDim, flexShrink: 1 }]} numberOfLines={1}>
          {formatDuration(focusS)} of {formatDuration(goal.targetS)}
        </Text>
        <Animated.Text
          style={[
            styles.caption,
            { color: met ? color.accent : color.textDim, fontWeight: '700', flexShrink: 0, transform: [{ scale: metPulse }] },
          ]}
        >
          {percent}%
        </Animated.Text>
      </View>
      {!met ? (
        <Text style={[styles.caption, { color: color.textDim }]} numberOfLines={1}>
          {formatDuration(result?.remainingS ?? goal.targetS)} to go
        </Text>
      ) : null}

      <View style={styles.goalActions}>
        <Text style={[styles.caption, { color: color.textDim, flex: 1 }]} numberOfLines={1} ellipsizeMode="tail">
          {/* The window's own date range, so "this week"/"this month" is
              never ambiguous about which one -- goalWindow is Sunday-start
              for weekly (matching CalendarScreen's grid, see
              goalProgress.ts's weeklyWindow) and calendar-month for
              monthly. flex:1 without numberOfLines used to let this wrap
              onto a second line and misalign the Edit/Delete pressables
              beside it -- capped to one line + tail ellipsis instead. */}
          {goal.period === 'daily'
            ? new Date(window.startMs).toLocaleDateString(undefined, { weekday: 'long' })
            : goal.period === 'weekly'
              ? `Week of ${new Date(window.startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
              : new Date(window.startMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </Text>
        <AnimatedPressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${name} goal`}>
          <Text style={[styles.rowAction, { color: color.accent }]}>Edit</Text>
        </AnimatedPressable>
        <AnimatedPressable onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Delete ${name} goal`}>
          <Text style={[styles.rowAction, { color: color.danger }]}>Delete</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  caption: { fontSize: 12, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  rowAction: { letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
  goalRow: { gap: 6 },
  goalHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalName: { fontSize: 15, fontWeight: '600', flex: 1, letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 20 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  periodTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  periodTagText: { ...typeScale.caption },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  fill: { height: '100%', borderRadius: 4 },
  // 2px notch punched in the theme's page background color, so it reads as a
  // gap in the bar at the target line rather than as another colored segment.
  targetMark: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  goalMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  goalActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 2 },
});
