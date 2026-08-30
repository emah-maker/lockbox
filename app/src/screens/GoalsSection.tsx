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
// One goal's own row moved to GoalRow.tsx once this file crossed the
// 500-line guideline -- see that file's header. This file keeps the list,
// the form sheet, and every mutation.
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
import { Text, StyleSheet, Alert } from 'react-native';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useTheme } from '../theme/useTheme';
import { Goal } from '../goals/goals';
import { computeGoalProgress } from '../goals/goalProgress';
import { Section, Button } from './SettingsPrimitives';
import { GoalForm, GoalFormValues } from './GoalForm';
import { Sheet } from '../ui/Sheet';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { typeScale } from '../theme/tokens';
import { GoalsEmptyState } from './stats/GoalsEmptyState';
import { GoalRow, describeTopic } from './GoalRow';



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
  // Bumped on every openForm() call, and folded into GoalForm's `key` below.
  // The goal id alone can't distinguish two consecutive NEW-goal opens (both
  // key to 'new'), so a second "New goal" would reuse the first one's still-
  // mounted instance and show its leftover values -- the same staleness the
  // key exists to prevent for edits. See that key's own comment.
  const [formSeq, setFormSeq] = React.useState(0);
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
    setFormSeq((n) => n + 1);
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
        notifyTimes: values.notifyTimes,
        notifyDays: values.notifyDays,
        notifyOnlyIfBehind: values.notifyOnlyIfBehind,
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
        // `[]`/`undefined` map to an explicit null clear, same GoalPatch
        // convention the two fields above use -- the form always submits
        // every field, so an empty list means "the user removed every
        // reminder time", not "leave unchanged".
        notifyTimes: values.notifyTimes.length > 0 ? values.notifyTimes : null,
        notifyDays: values.notifyDays ?? null,
        notifyOnlyIfBehind: values.notifyOnlyIfBehind,
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
        // Wheels in the body -- see Sheet.tsx's dragBodyToDismiss.
        dragBodyToDismiss={false}
      >
        {/* key IS the fix here, not decoration: Sheet passes `children` to
            its own <Modal> unconditionally (see this file's own comment on
            `autoOpenCreate` above), so GoalForm's component instance -- and
            every bit of useState it seeds from `initial` on mount (topic,
            period, days/hours/minutes, weekday chips, reminder times/days,
            "only if behind") -- normally survives across DIFFERENT
            `openForm` calls with no reset in between, since GoalForm has no
            effect that re-derives its state when `initial` changes on an
            already-mounted instance. Without this key, editing goal A, then
            (with or without cancelling first) editing goal B shows B's
            title/submit-label but A's leftover field values -- including A's
            target/reminder wheel positions -- until every field happens to
            be re-touched by hand; saving that unexamined would silently
            overwrite B with A's numbers. Keying on the goal id (not the
            `editingGoal` object itself, which useMemo/filter above can hand
            back as a new reference on unrelated store churn) forces exactly
            the remount needed on a REAL identity change.

            `formSeq` covers what the id alone can't: two consecutive NEW
            goals both key to 'new', so creating one, reopening, and creating
            another would reuse the first's instance and its leftover wheel
            positions. Bumping the sequence on every openForm() makes a fresh
            form the guarantee on every open, rather than something that only
            holds when Sheet's exit animation happened to run to completion
            (Sheet only unmounts on a `finished` spring -- close and reopen
            quickly and the instance never went away at all). */}
        <GoalForm
          key={`${editingGoal?.id ?? 'new'}-${formSeq}`}
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

const styles = StyleSheet.create({
  caption: { fontSize: 12, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
});
