// SettingsPrimitives.tsx -- small presentational building blocks shared
// between SettingsScreen.tsx and CustomLabelsSection.tsx. Split out here
// (rather than exported from SettingsScreen.tsx) so neither file has to
// import the other -- a two-file settings screen importing each other would
// be a circular dependency for no benefit.
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/color';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { typeScale, elevation, opacity } from '../theme/tokens';

export function Button({
  label,
  onPress,
  disabled,
  loading,
  color,
  variant = 'filled',
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  // Distinct from `disabled`: a button can be disabled simply because its
  // inputs aren't valid yet (e.g. CustomLabelsSection's "Add label" with no
  // name/color picked) -- that's a static, resting state, not a spinner-
  // worthy one. `loading` is for the narrower case of an actual in-flight
  // async action (sign-in, sync, sign-out below), where a spinner is the
  // right signal. Every disabled button used to show a spinner regardless
  // of which of these was true, which read as "Add label" being perpetually
  // stuck loading before you'd typed anything.
  loading?: boolean;
  color: ReturnType<typeof useTheme>;
  variant?: 'filled' | 'outline';
  // Optional leading glyph (e.g. Ionicons "logo-google"/"logo-apple" for the
  // sign-in buttons, manager request) -- every other Button call site omits
  // this and renders exactly as before.
  icon?: React.ReactNode;
}) {
  const filled = variant === 'filled';
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      // `label` is passed explicitly rather than left to RN's collect-the-
      // child-Text default: while `loading`, that Text is swapped out for an
      // ActivityIndicator, so the button announced itself as an unnamed
      // button at exactly the moment ("Signing in...", "Deleting...") a
      // screen-reader user most needs to know which one it is. `busy` is
      // what conveys the spinner itself.
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={[
        styles.button,
        filled
          ? { backgroundColor: color.accent, borderColor: color.accent }
          : { backgroundColor: 'transparent', borderColor: color.textDim },
        disabled ? { opacity: opacity.disabled } : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={filled ? color.accentText : color.text} />
      ) : (
        <View style={styles.buttonContent}>
          {icon}
          <Text style={[styles.buttonLabel, { color: filled ? color.accentText : color.text }]}>{label}</Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

// Generic "label on the left, control on the right" row -- shared by
// SettingsScreen.tsx's own rows and (via AccountSection.tsx) the Account
// section, so both read as the same list style.
export function Row({
  label,
  color,
  children,
}: {
  label: string;
  color: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: color.text }]}>{label}</Text>
      {children}
    </View>
  );
}

// Disclosure row for the Settings hub (SettingsScreen.tsx) -- label on the
// left, a one-line current-value summary and a chevron on the right, the
// whole row tappable to open that category's Sheet. Unlike Row above (which
// hosts an inline control, e.g. a Switch, and is still used inside each
// sheet's own content), this is the hub's own list-item shape: a summary
// string rather than a live control, since the control itself only exists
// once its sheet is open. min 44pt tall so the hub itself is comfortable to
// scan and tap even though its rows are denser than the old wall-of-controls
// screen this replaces.
export function DisclosureRow({
  label,
  value,
  onPress,
  color,
  icon,
  accessibilityLabel,
}: {
  label: string;
  /** One-line summary of the section's current state, e.g. "Dark · Mint" or
   * "3 labels" -- omitted (not empty-stringed) when there's nothing worth
   * summarizing yet, so the chevron doesn't sit next to an awkward blank. */
  value?: string;
  onPress: () => void;
  color: ReturnType<typeof useTheme>;
  /** Optional leading glyph (e.g. the account avatar icon) -- most hub rows
   * omit this and render as plain text + chevron. */
  icon?: React.ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
      style={styles.disclosureRow}
    >
      <View style={styles.disclosureLeft}>
        {icon}
        <Text style={[styles.label, { color: color.text }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.disclosureRight}>
        {value ? (
          <Text style={[styles.disclosureValue, { color: color.textDim }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={color.textDim} />
      </View>
    </AnimatedPressable>
  );
}

export function Section({
  title,
  subtitle,
  color,
  children,
}: {
  title: string;
  subtitle?: string;
  color: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: color.surface }]}>
      <Text style={[styles.h2, { color: color.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: color.textDim }]}>{subtitle}</Text> : null}
      <View style={{ gap: 12, marginTop: 8 }}>{children}</View>
    </View>
  );
}

const RUBBER_BAND_CONSTANT = 0.55;
export const rowLabelStyle = {
  fontSize: 15,
  flexShrink: 1 as const,
  paddingRight: 12,
  letterSpacing: typeScale.sectionTitle.letterSpacing,
  lineHeight: 20,
};
export const captionStyle = {
  fontSize: 12,
  marginTop: 2,
  letterSpacing: typeScale.caption.letterSpacing,
  lineHeight: typeScale.caption.lineHeight,
};

const styles = StyleSheet.create({
  h2: { ...typeScale.sectionTitle },
  subtitle: captionStyle,
  card: { borderRadius: 14, padding: 16, ...elevation.card },
  buttonLabel: { fontWeight: '600', letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    // paddingVertical 12 (was 10) so a filled/outline Button's tap target
    // clears the ~44pt minimum together with its text line-height, not just
    // its visual box (production readiness review-style pass, same
    // reasoning as SliderRow's hitSlop just below).
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  // minHeight 44 so every Row -- both a sheet's own Switch/value rows and
  // (via the shared object below) SliderRow's label/value line -- clears the
  // minimum comfortable touch target, now that the hub above it is denser.
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  label: rowLabelStyle,
  disclosureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 10,
  },
  disclosureLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  disclosureRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, marginLeft: 12 },
  disclosureValue: { fontSize: 14, flexShrink: 1, letterSpacing: typeScale.body.letterSpacing, lineHeight: 18 },
});
