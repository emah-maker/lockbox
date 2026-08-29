// GoalRow.tsx -- one focus goal's row in GoalsSection's list: name, period
// tag, the secondary caption (weekday restriction / session count /
// reminders), the progress bar, and the Edit/Delete actions.
//
// Split out of GoalsSection.tsx, which crossed this project's 500-line file
// guideline once a goal's reminders became a list rather than a single time.
// The split follows the boundary that was already implicit there:
// GoalsSection owns the SECTION (the list, the form sheet, every mutation),
// and this file owns the presentation of a single goal. Nothing here
// mutates -- every action is a callback prop, same contract GoalsSection's
// own header describes for itself.
//
// describeTopic is exported because GoalsSection needs the same display name
// for its delete-confirmation copy; everything else here is module-private.
import React from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { formatDuration } from '../stats/stats';
import { resolveTopic } from '../stats/customLabels';
import { Goal, GoalPeriod } from '../goals/goals';
import { goalWindow, GoalProgressResult } from '../goals/goalProgress';
import { goalNotifyTimes } from '../goals/goalReminders';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { AnimatedFill } from '../ui/AnimatedFill';
import { useReducedMotion } from '../ui/useReducedMotion';
import { typeScale } from '../theme/tokens';
import { PeriodIcon, useMetCelebration } from './stats/goalVisuals';

const PERIOD_LABEL: Record<GoalPeriod, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Lifts a 12px caption-sized text action up to a comfortable tap target
// without changing the row's visual layout.
const ROW_ACTION_HIT_SLOP = { top: 12, bottom: 12, left: 8, right: 8 };


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

/** The row's reminder caption -- "Reminder 9:00 AM" or "Reminders 9:00 AM,
 * 5:30 PM" -- or null when this goal has none to show (reminders off, or no
 * usable time configured). */
function reminderLabel(goal: Goal): string | null {
  if (!goal.notify) return null;
  const times = goalNotifyTimes(goal);
  if (times.length === 0) return null;
  return `${times.length === 1 ? 'Reminder' : 'Reminders'} ${times.map(formatNotifyAt).join(', ')}`;
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


/** Display name for a goal's stored topic string. `null` is the "all focus
 * time" goal; anything else goes through resolveTopic so a built-in key, a
 * live custom label, and a one-time free-text tag all render the same way
 * they do everywhere else (see stats/customLabels.ts). resolveTopic returns
 * null only for a since-deleted saved custom label -- a goal aimed at one
 * keeps working (goalProgress.ts matches on the raw id), so it gets an
 * explicit "Deleted label" name rather than an empty row. */
export function describeTopic(
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


export function GoalRow({
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
    // Every reminder time, not just the first -- a goal can carry several
    // now, and a row claiming a single "Reminder 9:00 AM" for a goal that
    // also nudges at 5pm would be actively wrong. Read through
    // goalNotifyTimes so a goal still carrying only the legacy `notifyAt`
    // (written before multi-time reminders, or by the website dashboard)
    // renders identically to one with a real list.
    reminderLabel(goal),
  ].filter((s): s is string => s !== null);

  return (
    <View style={styles.goalRow}>
      {/* The `accessible` summary is scoped to the READ-ONLY part of the row,
          not the whole row. It used to sit on the outer View, which on iOS
          collapses everything under it into one a11y element -- so the
          Edit/Delete buttons at the bottom (already labelled) could not be
          reached by VoiceOver at all, i.e. a screen-reader user had no way to
          edit or delete a goal. This wrapper repeats `gap` so the visual
          layout is byte-identical to the flat version. */}
      <View
        style={styles.goalSummary}
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
          <View style={[styles.targetMark, { left: `${targetPct}%`, backgroundColor: color.surface }]} />
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
      </View>

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
        {/* hitSlop on both: `rowAction` is a 12px caption line (~17px tall),
            well under the ~44pt minimum touch target, and these sit at the
            bottom edge of a card where a near-miss is easy. */}
        <AnimatedPressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${name} goal`}
          hitSlop={ROW_ACTION_HIT_SLOP}
        >
          <Text style={[styles.rowAction, { color: color.accent }]}>Edit</Text>
        </AnimatedPressable>
        <AnimatedPressable
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${name} goal`}
          accessibilityHint="Asks for confirmation before deleting"
          hitSlop={ROW_ACTION_HIT_SLOP}
        >
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
  // Same gap as goalRow itself -- see the a11y wrapper's comment above.
  goalSummary: { gap: 6 },
  goalHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalName: { fontSize: 15, fontWeight: '600', flex: 1, letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 20 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  periodTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  periodTagText: { ...typeScale.caption },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  fill: { height: '100%', borderRadius: 4 },
  // 2px notch punched in the color of the CARD this row sits on, so it reads
  // as a gap in the bar at the target line rather than as another colored
  // segment. Used to be `color.bg` (the page background), but every GoalRow
  // renders inside SettingsPrimitives' `Section`, whose fill is `surface` --
  // so the notch was a visibly grey stripe on a white card in light mode.
  targetMark: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  goalMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  goalActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 2 },
});
