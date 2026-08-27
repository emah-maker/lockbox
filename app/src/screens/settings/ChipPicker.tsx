// ChipPicker.tsx -- the Chip selector and the PickerGroup row it builds a
// small fixed-option-set control from (e.g. Screen sleep / Brightness).
// Moved out of SettingsScreen.tsx (which used to own both as private
// helpers) once BoxBehaviorSection.tsx and AppearanceSection.tsx both needed
// them for the same "small set of mutually-exclusive options as chips"
// shape -- rather than duplicate either into two files, or grow
// SettingsPrimitives.tsx (already near this project's 500-line guideline)
// with two more exports, they live here as their own reusable pair.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { rowLabelStyle } from '../SettingsPrimitives';

export function Chip({
  active,
  onPress,
  color,
  swatch,
  children,
}: {
  active: boolean;
  onPress: () => void;
  color: ReturnType<typeof useTheme>;
  /** Hex color for an accent option -- renders as a small dot so the picker
   * shows the actual hue instead of asking the user to picture it from a
   * name. Omitted for non-color chips (e.g. the dark/light Theme row). */
  swatch?: string;
  children: React.ReactNode;
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? color.accent : 'transparent',
          borderColor: active ? color.accent : color.textDim,
        },
      ]}
    >
      {swatch && (
        <View
          style={[
            styles.chipSwatch,
            { backgroundColor: swatch, borderColor: active ? color.accentText : color.textDim },
          ]}
        />
      )}
      <Text style={{ color: active ? color.accentText : color.text, fontWeight: '600' }}>{children}</Text>
    </AnimatedPressable>
  );
}

// A row of Chips for a small fixed set of options (e.g. Sleep/Brightness) --
// every valid value is visible and one tap direct-sets it, unlike a +/-
// stepper which hides the option list behind repeated presses.
export function PickerGroup({
  label,
  options,
  value,
  format,
  onSelect,
  color,
}: {
  label: string;
  options: number[];
  value: number;
  format: (v: number) => string;
  onSelect: (v: number) => void;
  color: ReturnType<typeof useTheme>;
}) {
  return (
    <View>
      <Text style={[styles.label, { color: color.textDim, marginBottom: 8 }]}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((opt) => (
          <Chip key={opt} active={value === opt} onPress={() => onSelect(opt)} color={color}>
            {format(opt)}
          </Chip>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: rowLabelStyle,
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // paddingVertical 10 (was 8) so a chip's own tap target, combined with
    // its ~20px text line-height, clears the ~44pt minimum -- same pass as
    // SettingsPrimitives.tsx's Button/Row.
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  chipSwatch: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
});
