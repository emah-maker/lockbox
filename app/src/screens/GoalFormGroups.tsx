// GoalFormGroups.tsx -- the goal form's four OPTIONAL field groups, each in
// a ui/FormDisclosure that shows a one-line summary of its current value and
// expands in place: which label the goal counts, which weekdays it applies
// to, an optional session count, and the whole reminder schedule.
//
// Split out of GoalForm.tsx once that file crossed this project's 500-line
// guideline -- the same seam GoalFormExtras.tsx, GoalReminderControl.tsx and
// GoalTopicChips.tsx were each split along, and a clean one: GoalForm keeps
// the two fields every goal must answer (period and target) plus the
// submit/cancel actions, and this file owns everything that is optional.
//
// It also owns the ACCORDION state, which is the point of the whole
// arrangement (see GoalForm.tsx's LAYOUT note): at most one group open at a
// time is what keeps the form short, and a collapsed group is unmounted, so
// its chips and wheels cost nothing. Keeping that state here rather than
// lifting it to GoalForm means the parent has no notion of "which group is
// open" to keep in sync -- there is nothing above this component that has
// any use for it.
//
// Owns no validation and no persistence, same discipline as every other
// piece of this form: every value is uncommitted form state that GoalForm
// collects and hands to goals.ts (via useGoalsStore) on submit.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { allLabelChoices } from '../stats/customLabels';
import { GoalPeriod, MAX_TARGET_SESSIONS } from '../goals/goals';
import { FormDisclosure } from '../ui/FormDisclosure';
import { formatClockTime } from '../ui/time';
import { WeekdayChips, SessionTargetControl, weekdaySummary } from './GoalFormExtras';
import { GoalReminderControl } from './GoalReminderControl';
import { ALL_TOPICS_ID, orphanLabel, TopicChip, TopicChoiceChips } from './GoalTopicChips';
import { spacing } from '../theme/tokens';
import { WheelLockPhase } from '../ui/WheelPicker';

/** Which group is expanded. `null` -- nothing open -- is the resting state,
 * including on mount: a new goal's required fields are already visible above
 * this, and an edit should open showing what the goal IS (the summaries)
 * rather than one arbitrary field's controls. */
type OpenGroup = 'topic' | 'days' | 'sessions' | 'reminders' | null;

export function GoalFormGroups({
  period,
  topicId,
  onTopicChange,
  /** The goal being edited, if any -- used only to keep a since-deleted
   * custom label selectable (see `orphanId` below). Passed as the raw topic
   * rather than the whole Goal so this component needs nothing else from it. */
  initialTopic,
  daysOfWeek,
  onDaysOfWeekChange,
  targetSessions,
  onTargetSessionsChange,
  notify,
  onNotifyChange,
  notifyTimes,
  onNotifyTimesChange,
  notifyDays,
  onNotifyDaysChange,
  notifyOnlyIfBehind,
  onNotifyOnlyIfBehindChange,
  customLabels,
  themeMode,
  color,
  onWheelActiveChange,
}: {
  period: GoalPeriod;
  topicId: string;
  onTopicChange: (topicId: string) => void;
  initialTopic?: string | null;
  daysOfWeek: number[];
  onDaysOfWeekChange: (days: number[]) => void;
  targetSessions: number | undefined;
  onTargetSessionsChange: (value: number | undefined) => void;
  notify: boolean;
  onNotifyChange: (value: boolean) => void;
  notifyTimes: string[];
  onNotifyTimesChange: (times: string[]) => void;
  notifyDays: number[] | undefined;
  onNotifyDaysChange: (days: number[] | undefined) => void;
  notifyOnlyIfBehind: boolean;
  onNotifyOnlyIfBehindChange: (value: boolean) => void;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  color: ReturnType<typeof useTheme>;
  onWheelActiveChange: (active: boolean, phase?: WheelLockPhase) => void;
}) {
  const [openGroup, setOpenGroup] = React.useState<OpenGroup>(null);

  const toggleGroup = (group: Exclude<OpenGroup, null>) => {
    // Collapsing a group unmounts whatever wheels it held, and a WheelPicker
    // that disappears mid-drag never fires its own onDragEnd -- release the
    // enclosing Sheet's scroll lock unconditionally, the same stuck-lock
    // guard GoalReminderControl.tsx's own closePicker applies.
    onWheelActiveChange(false);
    setOpenGroup((current) => (current === group ? null : group));
  };

  const choices = allLabelChoices(customLabels, themeMode);
  // An edit whose goal targets a since-deleted custom label: keep that id
  // selectable so re-saving the goal doesn't silently retarget it at
  // whatever chip happens to be first. resolveTopic returns null for it, so
  // it would otherwise have no chip at all.
  const orphanId =
    initialTopic && initialTopic !== ALL_TOPICS_ID && !choices.some((ch) => ch.id === initialTopic)
      ? initialTopic
      : null;

  // Each group's collapsed summary. These are the ONLY reading of those
  // fields while collapsed, so each has to be a real answer -- see
  // FormDisclosure.tsx's `summary` doc comment.
  const topicSummary =
    topicId === ALL_TOPICS_ID
      ? 'All focus time'
      : choices.find((ch) => ch.id === topicId)?.label ?? orphanLabel(topicId, customLabels, themeMode);
  const sessionSummary =
    targetSessions === undefined ? 'Off' : `${targetSessions} ${targetSessions === 1 ? 'session' : 'sessions'}`;
  // Only the first time is spelled out. A goal can carry several
  // (goalReminders.ts's MAX_NOTIFY_TIMES) and listing them all would push
  // the summary past the width it has -- the count says "there are more",
  // and expanding shows every chip.
  const reminderSummary =
    !notify || notifyTimes.length === 0
      ? 'Off'
      : notifyTimes.length === 1
        ? formatClockTime(notifyTimes[0])
        : `${formatClockTime(notifyTimes[0])} +${notifyTimes.length - 1} more`;

  return (
    <View style={styles.groups}>
      <FormDisclosure
        label="Counts"
        summary={topicSummary}
        open={openGroup === 'topic'}
        onToggle={() => toggleGroup('topic')}
        color={color}
      >
        <View style={styles.chipRow}>
          <TopicChip
            label="All focus time"
            swatchColor={color.accent}
            // No ResolvedTopic to read a measured `textColor` from -- but the
            // swatch IS the theme accent, which accentText was contrast-tuned
            // against (see theme.ts's per-mode accent audit).
            activeTextColor={color.accentText}
            active={topicId === ALL_TOPICS_ID}
            onPress={() => onTopicChange(ALL_TOPICS_ID)}
            color={color}
          />
          <TopicChoiceChips choices={choices} selectedId={topicId} onSelect={onTopicChange} color={color} />
          {orphanId ? (
            <TopicChip
              label={orphanLabel(orphanId, customLabels, themeMode)}
              swatchColor={color.textDim}
              activeTextColor={color.bg}
              active={topicId === orphanId}
              onPress={() => onTopicChange(orphanId)}
              color={color}
            />
          ) : null}
        </View>
      </FormDisclosure>

      {/* Weekday restriction is only meaningful for a daily goal -- a
          weekly/monthly goal's window already spans its whole period, so
          "which days count" has no meaning for either (goalProgress.ts's
          isGoalDueOn treats it the same way). The whole group is absent, not
          merely disabled, for those periods: a summary row reading "Every
          day" beside a control that can't change it would be stating
          something that isn't a choice.

          A stale `openGroup === 'days'` left behind by switching period away
          from daily is harmless -- toggleGroup replaces it on the next tap
          of any other group, and nothing renders for it meanwhile. */}
      {period === 'daily' ? (
        <FormDisclosure
          label="Active days"
          summary={weekdaySummary(daysOfWeek)}
          open={openGroup === 'days'}
          onToggle={() => toggleGroup('days')}
          color={color}
        >
          <WeekdayChips selected={daysOfWeek} onChange={onDaysOfWeekChange} color={color} />
        </FormDisclosure>
      ) : null}

      <FormDisclosure
        label="Session count"
        summary={sessionSummary}
        open={openGroup === 'sessions'}
        onToggle={() => toggleGroup('sessions')}
        color={color}
      >
        <SessionTargetControl
          value={targetSessions}
          onChange={onTargetSessionsChange}
          max={MAX_TARGET_SESSIONS}
          color={color}
        />
      </FormDisclosure>

      <FormDisclosure
        label="Reminders"
        summary={reminderSummary}
        open={openGroup === 'reminders'}
        onToggle={() => toggleGroup('reminders')}
        color={color}
      >
        <GoalReminderControl
          notify={notify}
          times={notifyTimes}
          days={notifyDays}
          onlyIfBehind={notifyOnlyIfBehind}
          onNotifyChange={onNotifyChange}
          onTimesChange={onNotifyTimesChange}
          onDaysChange={onNotifyDaysChange}
          onOnlyIfBehindChange={onNotifyOnlyIfBehindChange}
          onWheelActiveChange={onWheelActiveChange}
          color={color}
        />
      </FormDisclosure>
    </View>
  );
}

const styles = StyleSheet.create({
  // A little air above the first row: these are a distinct band of optional
  // settings under the two required fields, and reading as one list rather
  // than as more of the same stack is what makes the split legible.
  groups: { gap: 6, marginTop: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
