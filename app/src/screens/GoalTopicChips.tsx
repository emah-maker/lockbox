// GoalTopicChips.tsx -- the goal form's "which label does this goal count"
// chip row, plus the two small pure helpers that go with it (the
// all-focus-time sentinel and the orphaned-label name lookup).
//
// Split out of GoalForm.tsx, which crossed this project's 500-line file
// guideline once the reminder controls grew. This is a clean seam: the chip
// row is the one part of that form with no connection to the target wheels,
// the period selector, or the reminder schedule -- it only answers "which
// topic", and it answers it the same way TopicPicker.tsx's chip row does
// elsewhere in the app.
import { View, Text, StyleSheet } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { goalTopicLabel } from '../goals/goalTopicDisplay';
import type { ResolvedTopic } from '../stats/customLabels';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { typeScale } from '../theme/tokens';

// Sentinel for the "all focus time" choice in the topic chip row. A goal's
// own `topic: null` is what actually gets stored (goals.ts) -- this exists
// only because a chip needs a non-null React key/id to be selectable, and
// reusing the empty string would collide with goals.ts's own
// "Goal topic is required." rejection of a falsy string.
export const ALL_TOPICS_ID = '__all__';

/** Maps a chip selection back to what actually gets stored: the sentinel
 * becomes `null` (goals.ts's "all focus time"), everything else passes
 * through as the raw topic id. Module-private on purpose -- the sentinel
 * exists only for this form's chip state, so nothing outside this file
 * (GoalsSection included) should ever have to know the string. */
export function topicIdToStored(topicId: string): string | null {
  return topicId === ALL_TOPICS_ID ? null : topicId;
}

/** Label for the extra chip kept for a goal whose topic isn't in
 * allLabelChoices -- a since-deleted saved custom label, or a one-time
 * free-text tag typed into DashboardScreen's TopicPicker. resolveTopic
 * returns null only for the former (it falls back to the raw string for the
 * latter, see stats/customLabels.ts).
 *
 * That is exactly stats/customLabels.ts's goalTopicLabel, minus its
 * `topic === null` branch, which cannot happen here (an orphan chip only
 * exists for a topic the goal actually names) -- so this is a named alias
 * for the shared version rather than a fifth copy of the same two lines. It
 * keeps the name the chips and website/js/goalForm.js's orphanOptionLabel
 * both use for the concept. */
export const orphanLabel: (
  topic: string,
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'],
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'],
) => string = goalTopicLabel;

/**
 * The catalog half of a topic chip row: one TopicChip per resolved choice.
 *
 * Both topic pickers -- GoalFormGroups.tsx's goal-topic group and
 * calendar/SessionReminderForm.tsx's label field -- wrap this in their own
 * leading chip ("All focus time" / "No label") and their own trailing orphan
 * chip, which is where they genuinely differ. The map between them was
 * identical, down to the comment explaining why `choice.textColor` is reused
 * rather than re-measured.
 */
export function TopicChoiceChips({
  choices,
  selectedId,
  onSelect,
  color,
}: {
  choices: ResolvedTopic[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  color: ReturnType<typeof useTheme>;
}) {
  return (
    <>
      {choices.map((choice) => (
        <TopicChip
          key={choice.id}
          label={choice.label}
          swatchColor={choice.color}
          // allLabelChoices already measured this per choice
          // (customLabels.ts's readableTextColor) -- reused rather than
          // re-derived, same as every other chip row in the app.
          activeTextColor={choice.textColor}
          active={selectedId === choice.id}
          onPress={() => onSelect(choice.id)}
          color={color}
        />
      ))}
    </>
  );
}

/** One selectable topic chip. Same pill shape/fill-when-active model as
 * TopicPicker.tsx's chip row -- reused as the label-choice model rather than
 * inventing a second picker, so "which label does this apply to" looks the
 * same whether you're tagging a session or aiming a goal. Carries a small
 * swatch too, since a goal's own row above is identified by that color. */
export function TopicChip({
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
      <Text style={[styles.topicChipText, { color: active ? activeTextColor : color.text }]} numberOfLines={1}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  topicChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5 },
  // maxWidth caps a long custom label/free-typed tag so it can't stretch
  // this chip past the sheet's width -- numberOfLines alone only stops it
  // wrapping, not growing wide in the first place.
  topicChipText: { ...typeScale.label, maxWidth: 160 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
});
