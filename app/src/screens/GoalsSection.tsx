// GoalsSection.tsx -- the "Focus goals" section of StatsScreen, split into
// its own file the same way CustomLabelsSection.tsx already sits beside it
// (and OverridePressSection.tsx/ServoAngleSection.tsx beside
// SettingsScreen.tsx) so StatsScreen.tsx stays under this project's 500-line
// file guideline.
//
// Lives on Stats, not Settings, for the same reason CustomLabelsSection does:
// a goal is only meaningful next to the session data it's measured against
// (useStore.sessions -- the trend/heatmap/by-topic cards just above are
// computed from the exact same array), so the progress bars sit one card away
// from the numbers that move them rather than one tab away.
//
// This file owns render only. Every mutation delegates straight to
// useGoalsStore's addGoal/updateGoal/archiveGoal, which in turn delegate to
// goals/goals.ts's pure helpers -- there is deliberately NO validation,
// clamping, or cap check duplicated here beyond the wheels' own selectable
// ranges (see PERIOD_MAX_HOURS below for why even those are derived from the
// store's own constants rather than typed out). Invalid input surfaces as the
// thrown Error's own `message`, rendered inline, exactly the way
// CustomLabelsSection.tsx renders createCustomLabel's "Label name is
// required." string.
//
// The add/edit form itself lives in GoalForm.tsx -- same 500-line-guideline
// split, and the same one-form-for-create-and-edit reasoning documented in
// that file's header.
import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
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
import { GoalForm } from './GoalForm';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { AnimatedFill } from '../ui/AnimatedFill';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { typeScale } from '../theme/tokens';

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
  /** Lets StatsScreen's ScrollView surrender the vertical drag while a
   * finger is down on one of the H/M wheels -- two nested vertical scrollers
   * competing for the same gesture is why a wheel swipe would otherwise just
   * scroll the whole screen. Same contract (and same reasoning) as
   * DashboardScreen.tsx's own lockOuterScroll/unlockOuterScroll pair, except
   * the ScrollView lives in the parent here, so the flag has to travel up
   * as a callback instead of staying local state. */
  onWheelActiveChange,
}: {
  color: ReturnType<typeof useTheme>;
  onWheelActiveChange: (active: boolean) => void;
}) {
  const sessions = useStore((s) => s.sessions);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const goals = useGoalsStore((s) => s.goals);
  const addGoal = useGoalsStore((s) => s.addGoal);
  const updateGoal = useGoalsStore((s) => s.updateGoal);
  const archiveGoal = useGoalsStore((s) => s.archiveGoal);
  const reducedMotion = useReducedMotion();

  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Archived goals are tombstones, not removals (see Goal.archived in
  // goals.ts) -- filtered out here so a "deleted" goal never renders while
  // its tombstone is still propagating. computeGoalProgress filters them
  // out on its own side too; both are needed, since this list also drives
  // the rows themselves, not just their progress lookups.
  const visible = React.useMemo(() => goals.filter((g) => !g.archived), [goals]);
  // Date.now() is read here rather than passed in from StatsScreen because a
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

  const openForm = (id: string | null) => {
    configureLayoutAnimation(reducedMotion);
    setError(null);
    setEditingId(id);
    setAdding(id === null);
  };
  const closeForm = () => {
    configureLayoutAnimation(reducedMotion);
    setError(null);
    setEditingId(null);
    setAdding(false);
  };

  const handleCreate = (topic: string | null, period: GoalPeriod, targetS: number) => {
    try {
      addGoal(topic, period, targetS);
      closeForm();
    } catch (e: any) {
      setError(e?.message ?? 'Could not create that goal.');
    }
  };

  const handleSave = (id: string, topic: string | null, period: GoalPeriod, targetS: number) => {
    try {
      updateGoal(id, { topic, period, targetS });
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
      subtitle="Set a daily or weekly target -- for one label, or for all your focus time"
      color={color}
    >
      {visible.length === 0 && !adding ? (
        <Text style={[styles.caption, { color: color.textDim }]}>
          No goals yet. Add one to track how much of your target you've hit this day or week.
        </Text>
      ) : null}

      {visible.map((goal) =>
        editingId === goal.id ? (
          <GoalForm
            key={goal.id}
            initial={goal}
            customLabels={customLabels}
            themeMode={themeMode}
            color={color}
            error={error}
            submitLabel="Save goal"
            onSubmit={(topic, period, targetS) => handleSave(goal.id, topic, period, targetS)}
            onCancel={closeForm}
            onWheelActiveChange={onWheelActiveChange}
          />
        ) : (
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
        ),
      )}

      {adding ? (
        <GoalForm
          customLabels={customLabels}
          themeMode={themeMode}
          color={color}
          error={error}
          submitLabel="Add goal"
          onSubmit={handleCreate}
          onCancel={closeForm}
          onWheelActiveChange={onWheelActiveChange}
        />
      ) : (
        // Hidden while a row is being edited so there's never a second form
        // one tap away from the one already open -- both would write through
        // the same `error` slot below and read as one form's message
        // appearing under the other.
        editingId === null && <Button label="New goal" variant="outline" onPress={() => openForm(null)} color={color} />
      )}

      {/* The form owns its own error slot while open; this one covers the
          delete path, which has no form to render into. */}
      {error && !adding && editingId === null ? (
        <Text style={[styles.caption, { color: color.danger }]}>{error}</Text>
      ) : null}
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
  const window = goalWindow(goal.period, Date.now());

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
          <Text style={[styles.periodTagText, { color: color.textDim }]}>
            {goal.period === 'daily' ? 'Daily' : 'Weekly'}
          </Text>
        </View>
      </View>

      <View style={[styles.track, { backgroundColor: withAlpha(color.textDim, 0.22) }]}>
        <AnimatedFill axis="width" toValue={fillPct} style={styles.fill} color={barColor} />
        {targetPct !== null ? (
          // Over target: the bar is full, so the target line itself is what
          // carries "how far past" -- see barGeometry's comment.
          <View style={[styles.targetMark, { left: `${targetPct}%`, backgroundColor: color.bg }]} />
        ) : null}
      </View>

      <View style={styles.goalMetaRow}>
        <Text style={[styles.caption, { color: color.textDim }]}>
          {formatDuration(focusS)} of {formatDuration(goal.targetS)}
          {met ? '' : ` · ${formatDuration(result?.remainingS ?? goal.targetS)} to go`}
        </Text>
        <Text style={[styles.caption, { color: met ? color.accent : color.textDim, fontWeight: '700' }]}>
          {percent}%
        </Text>
      </View>

      <View style={styles.goalActions}>
        <Text style={[styles.caption, { color: color.textDim, flex: 1 }]}>
          {/* The window's own date range, so "this week" is never ambiguous
              about which week -- goalWindow is Sunday-start, matching
              CalendarScreen's grid (see goalProgress.ts's weeklyWindow). */}
          {goal.period === 'daily'
            ? new Date(window.startMs).toLocaleDateString(undefined, { weekday: 'long' })
            : `Week of ${new Date(window.startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
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
  periodTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  periodTagText: { ...typeScale.caption },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  fill: { height: '100%', borderRadius: 4 },
  // 2px notch punched in the theme's page background color, so it reads as a
  // gap in the bar at the target line rather than as another colored segment.
  targetMark: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  goalMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  goalActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 2 },
});
