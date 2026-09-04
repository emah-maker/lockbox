// CalendarStreaksSheet.tsx -- per-goal toggle picker for "which goals'
// streaks show on the calendar" (Goal Streaks feature). Ports the same
// `Sheet` + row-of-choices pattern LabelPickerSheet.tsx already established
// for a picker reached from CalendarScreen.tsx, but MULTI-select (any subset
// of active goals) rather than that sheet's single-pick-and-close shape --
// each row toggles independently and the sheet stays open, since there is no
// single "the" answer here the way there is for "which label is this
// session tagged with".
//
// Deliberately dumb: this component receives the already-resolved
// `visibleIds` (screens/calendar/monthGrid.ts's resolveCalendarStreakGoalIds
// has already turned the stored `null`/array preference into a concrete
// set) and a plain `onToggle` callback -- it doesn't read useSettingsStore
// or useGoalsStore itself, so it can't drift from whatever CalendarScreen.tsx
// decided "visible" means.
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Sheet } from '../Sheet';
import { AnimatedPressable } from '../AnimatedPressable';
import { ThemeColors } from '../../theme/theme';
import { typeScale } from '../../theme/tokens';
import { withAlpha } from '../../theme/color';
import { Goal } from '../../goals/goals';
import { resolveTopic } from '../../stats/customLabels';
import type { CustomLabel } from '../../stats/customLabels';
import type { ThemeMode } from '../../theme/theme';

export function CalendarStreaksSheet({
  visible,
  goals,
  visibleIds,
  customLabels,
  themeMode,
  theme,
  onClose,
  onToggle,
}: {
  visible: boolean;
  /** Active (non-archived) goals only -- CalendarScreen.tsx already filters
   * before handing this list down, same as it does for every other
   * per-goal calendar computation. */
  goals: Goal[];
  /** The already-resolved effective set (monthGrid.ts's
   * resolveCalendarStreakGoalIds), not the raw stored preference -- so a
   * goal shown here as "on" is always actually a goal whose dot is drawn on
   * the grid right now, never a stale id the resolver would have dropped. */
  visibleIds: Set<string>;
  customLabels: CustomLabel[];
  themeMode: ThemeMode;
  theme: ThemeColors;
  onClose: () => void;
  onToggle: (goalId: string) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Calendar streaks">
      {goals.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textDim }]}>
          Add a goal (Manage goals, on the Stats tab) to show its streak here.
        </Text>
      ) : (
        <View style={styles.list}>
          {goals.map((goal) => {
            const resolved = goal.topic === null ? null : resolveTopic(goal.topic, customLabels, themeMode);
            const name = goal.topic === null ? 'All focus time' : resolved?.label ?? 'Deleted label';
            const swatch = goal.topic === null ? theme.accent : resolved?.color ?? theme.textDim;
            const on = visibleIds.has(goal.id);
            return (
              <AnimatedPressable
                key={goal.id}
                style={styles.row}
                onPress={() => onToggle(goal.id)}
                accessibilityRole="switch"
                accessibilityLabel={`Show ${name} streak on the calendar`}
                accessibilityState={{ checked: on }}
              >
                <View style={[styles.dot, { backgroundColor: swatch }]} />
                <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>
                  {name}
                </Text>
                <View
                  style={[
                    styles.checkbox,
                    { borderColor: on ? theme.accent : withAlpha(theme.textDim, 0.5), backgroundColor: on ? theme.accent : 'transparent' },
                  ]}
                >
                  {on ? <Feather name="check" size={13} color={theme.accentText} /> : null}
                </View>
              </AnimatedPressable>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: {
    ...typeScale.body,
    paddingVertical: 20,
    textAlign: 'center',
  },
  list: { marginBottom: 4 },
  // Same 12px vertical padding as LabelPickerSheet.tsx's own row -- lands at
  // the 44pt minimum touch target for the same reason that file's comment
  // gives.
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowLabel: {
    fontSize: 15,
    flex: 1,
    letterSpacing: typeScale.body.letterSpacing,
    lineHeight: typeScale.body.lineHeight,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
