// FormDisclosure.tsx -- a collapsible field group for a form inside a Sheet:
// a tappable row showing the field's LABEL and a one-line summary of its
// CURRENT VALUE, expanding to the real control underneath.
//
// Exists because this app's two biggest forms (the goal form, and the
// calendar's schedule-a-session form) each had every optional control
// mounted at once, stacked vertically, in a sheet -- so the thing you
// actually came to set was buried under controls you weren't using, and the
// sheet ran off the bottom of the screen. That's the "too cluttered"
// complaint the goal form's redesign is answering, and it's the same shape
// SettingsScreen.tsx already solved for its own hub with SettingsPrimitives'
// DisclosureRow: label on the left, current value on the right, the real
// control one tap away.
//
// Deliberately NOT DisclosureRow itself, even though the collapsed rows look
// alike. That component navigates -- it opens a whole Sheet, and its
// chevron points forward to say so. This one expands IN PLACE inside the
// form it belongs to, which is the right model for a field whose value is
// part of the form you're already filling in: pushing each optional field
// into its own nested sheet would mean three modal layers deep to set a
// reminder time. The chevron rotates down/up accordingly, and the summary is
// what carries the value while collapsed.
//
// Owns no state: `open` and `onToggle` come from the parent, so a form can
// run its groups as an accordion (at most one open, which is what actually
// keeps the sheet short) rather than letting every group be opened at once
// -- which would just rebuild the wall of controls this replaces.
import React from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/color';
import { AnimatedPressable } from './AnimatedPressable';
import { useReducedMotion } from './useReducedMotion';
import { spacing, radius, typeScale } from '../theme/tokens';

const CHEVRON_DURATION = 160;

export function FormDisclosure({
  label,
  summary,
  open,
  onToggle,
  color,
  children,
}: {
  label: string;
  /** One-line reading of the field's current value -- "Every day", "Off",
   * "9:00 AM + 1 more". Shown while collapsed, and this is the ONLY place
   * that value is visible then, so it has to be a real answer rather than a
   * placeholder: a group summarized as "Not set" when it is in fact set is
   * worse than no summary at all. */
  summary: string;
  open: boolean;
  onToggle: () => void;
  color: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  // The chevron is the only always-visible signal of this group's state, so
  // it rotates rather than swapping glyphs -- one continuous element the eye
  // can follow. Native-driven (transform only) and skipped entirely under
  // reduced motion, same contract as every other animation in this app.
  const spin = React.useRef(new Animated.Value(open ? 1 : 0)).current;
  // Tracks the last `open` this effect actually acted on, so the MOUNT pass
  // is skipped: `spin` is already seeded to the right end of the range
  // above, and animating from a value to itself would still schedule a frame
  // of Animated updates for nothing (and, in tests, an update outside act()).
  // Only a real change animates.
  const animatedFor = React.useRef(open);
  React.useEffect(() => {
    if (animatedFor.current === open) return;
    animatedFor.current = open;
    const to = open ? 1 : 0;
    if (reducedMotion) {
      spin.setValue(to);
      return;
    }
    Animated.timing(spin, {
      toValue: to,
      duration: CHEVRON_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, reducedMotion, spin]);
  // Unmount-only, deliberately its own effect rather than a cleanup on the
  // one above. A chevron timing left running when this group unmounts --
  // collapsing a group inside the goal form, closing the sheet that holds it
  // -- keeps scheduling Animated frames against a detached node for the rest
  // of its duration. Under Jest that outlives the environment itself and
  // prints a torn-down-environment stack for every mount, which is noise that
  // buries whatever a real failure would have said.
  //
  // Not folded into the effect above because that effect's cleanup runs on
  // every dependency change, not just unmount: flipping reduced motion
  // mid-rotation would then stop the timing and hit that effect's
  // `animatedFor.current === open` early return, parking the chevron
  // halfway. An unmount-only effect stops exactly what needs stopping and
  // changes nothing while the component is still on screen.
  React.useEffect(() => () => spin.stopAnimation(), [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={[styles.group, { borderColor: withAlpha(color.textDim, 0.25) }]}>
      <AnimatedPressable
        onPress={onToggle}
        accessibilityRole="button"
        // `expanded` is what tells VoiceOver/TalkBack this row reveals
        // content rather than navigating away -- without it this announces
        // identically to DisclosureRow, which does navigate.
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}, ${summary}`}
        accessibilityHint={open ? 'Collapses this section' : 'Expands this section'}
        style={styles.header}
      >
        <Text style={[styles.label, { color: color.text }]} numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.right}>
          <Text style={[styles.summary, { color: color.textDim }]} numberOfLines={1}>
            {summary}
          </Text>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Feather name="chevron-down" size={18} color={color.textDim} />
          </Animated.View>
        </View>
      </AnimatedPressable>

      {/* Unmounted, not merely hidden, while collapsed. That is the point of
          the whole component: GoalReminderControl's two 200pt WheelPickers
          (and its own header's note about why they can't stay mounted) cost
          real layout and real Animated interpolations even when nobody is
          looking at them. */}
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  // 44pt min so a collapsed row is a comfortable tap target on its own --
  // the same floor DisclosureRow's own comment sets for the settings hub.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  label: { ...typeScale.label, flexShrink: 0 },
  // flexShrink on the summary (not the label): when both are long, the
  // VALUE is what truncates, because a row whose LABEL is cut off no longer
  // says which field it is.
  right: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  summary: { ...typeScale.caption, fontWeight: '400', flexShrink: 1 },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
});
