// LabelPickerSheet.tsx -- retag/untag picker for one past session. Ports
// CalendarScreen.tsx's former hand-rolled LabelPickerModal onto the shared
// `Sheet` primitive (src/ui/Sheet.tsx) instead of its own bespoke
// Modal+Animated scrim/spring, now that Sheet exists to own that motion in
// one place. Presented from within DaySheet.tsx, stacked on top of it (two
// RN Modals stacking is the normal way to layer a picker over a detail sheet
// -- there is no single-Modal alternative without Sheet itself supporting
// nested content panes, which its contract doesn't).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Sheet } from '../Sheet';
import { AnimatedPressable } from '../AnimatedPressable';
import { ThemeColors } from '../../theme/theme';
import { typeScale } from '../../theme/tokens';
import { ResolvedTopic } from '../../stats/customLabels';

export function LabelPickerSheet({
  visible,
  choices,
  current,
  theme,
  onClose,
  onPick,
  onClear,
}: {
  visible: boolean;
  choices: ResolvedTopic[];
  current: string | undefined;
  theme: ThemeColors;
  onClose: () => void;
  onPick: (id: string) => void;
  onClear?: () => void;
}) {
  return (
    // No ScrollView wrapper here -- Sheet's own body is already one
    // (Sheet.tsx's `styles.body`), and nesting a second vertical scroller
    // inside it is exactly the "two scrollers fighting over one gesture"
    // problem Sheet's own swipe-to-dismiss comment calls out. This list
    // scrolls for free as part of the sheet's body.
    <Sheet visible={visible} onClose={onClose} title="Tag this session" size="large">
      <View style={styles.list}>
        {choices.map((choice) => (
          <AnimatedPressable key={choice.id} style={styles.row} onPress={() => onPick(choice.id)}>
            <View style={[styles.dot, { backgroundColor: choice.color }]} />
            <Text style={[styles.rowLabel, { color: theme.text }]}>{choice.label}</Text>
            {current === choice.id && <Feather name="check" size={16} color={theme.accent} />}
          </AnimatedPressable>
        ))}
      </View>
      {onClear && (
        <AnimatedPressable style={styles.row} onPress={onClear}>
          <Text style={[styles.rowLabel, { color: theme.danger }]}>Clear tag</Text>
        </AnimatedPressable>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowLabel: {
    fontSize: 15,
    flex: 1,
    letterSpacing: typeScale.body.letterSpacing,
    lineHeight: typeScale.body.lineHeight,
  },
});
