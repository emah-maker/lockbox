// GoalsEmptyState.tsx -- the real "no goals yet" state, shared by both goal
// surfaces (GoalsProgressView.tsx's Stats "Goals" period and
// GoalsSection.tsx's Settings/ManageSheet section), which used to disagree
// with each other: GoalsProgressView had a caption + a small outlined
// "Add a goal" button, GoalsSection had a bare caption with NO button at all
// (relying on the unconditional "New goal" button rendered right after it --
// which duplicated the CTA once a goal existed, exactly backwards from what
// an empty state needs). This replaces both.
//
// Built from AnimatedPressable directly rather than widening
// SettingsPrimitives' Button -- that component is sized and styled for
// ordinary settings rows used all over that screen, and this button is
// deliberately much bigger/more prominent (a real empty-state CTA, not a row
// action); changing Button's sizing for this one caller would ripple into
// every other row that uses it.
import { View, Text, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/color';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { typeScale } from '../../theme/tokens';
import { GoalRing } from './GoalRing';

const GRAPHIC_SIZE = 104;
const GRAPHIC_SIZE_COMPACT = 88;

export function GoalsEmptyState({
  onAddGoal,
  color,
  compact,
}: {
  onAddGoal: () => void;
  color: ReturnType<typeof useTheme>;
  /** Trims the graphic and vertical padding for the Sheet-hosted context
   * (GoalsSection is mounted inside ManageSheet/Settings' own "Goals"
   * Sheet, which already spends height on its own header chrome) --
   * GoalsProgressView renders this full-size, since it owns a whole
   * flex:1 region of the Goals period with nothing else competing for it. */
  compact?: boolean;
}) {
  const size = compact ? GRAPHIC_SIZE_COMPACT : GRAPHIC_SIZE;
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {/* ratio: 0 -- an intentionally empty ring rather than a random
          illustration, so this reads as "the same progress ring every real
          goal card will show you, just not filled in yet" instead of a
          one-off graphic unrelated to the rest of this screen. */}
      <GoalRing ratio={0} color={color.accent} trackColor={withAlpha(color.textDim, 0.2)} size={size} strokeWidth={8}>
        <Feather name="target" size={size * 0.34} color={withAlpha(color.textDim, 0.6)} />
      </GoalRing>
      <Text style={[styles.heading, { color: color.text }]}>No goals yet</Text>
      <Text style={[styles.caption, { color: color.textDim }]}>
        Set a daily, weekly, or monthly target to see your progress here.
      </Text>
      <AnimatedPressable
        style={[styles.cta, { backgroundColor: color.accent }]}
        onPress={onAddGoal}
        accessibilityRole="button"
        accessibilityLabel="Start adding goals"
      >
        <Text style={[styles.ctaText, { color: color.accentText }]}>Start adding goals</Text>
      </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  wrapCompact: { paddingVertical: 12, gap: 8 },
  heading: { ...typeScale.sectionTitle, marginTop: 4 },
  caption: { ...typeScale.body, textAlign: 'center', maxWidth: 260 },
  cta: {
    alignSelf: 'center',
    minHeight: 56,
    paddingHorizontal: 28,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  ctaText: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
});
