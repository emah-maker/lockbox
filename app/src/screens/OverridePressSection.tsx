// OverridePressSection.tsx -- the Settings screen's "Override presses"
// control: a horizontal Apple Clock-style wheel plus its custom-number escape
// hatch. Split out of SettingsScreen.tsx (which was pushing past this
// project's 500-line file guideline) the same way CustomLabelsSection.tsx
// already sits beside SettingsScreen.tsx for its own feature area, rather
// than growing that screen file further.
import React from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Button, rowLabelStyle, captionStyle } from './SettingsPrimitives';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { WheelPicker } from '../ui/WheelPicker';
import { hitSlop, typeScale } from '../theme/tokens';
import { OVR_LABELS, overridePressIndex, overridePressValue } from './overridePresses';

// Horizontal Apple Clock-style wheel for Override presses (WheelPicker.tsx,
// `orientation="horizontal"` -- otherwise the same drag/momentum-snap/
// VoiceOver behavior as the Dashboard's vertical duration wheels). Renders
// inside SettingsScreen's own vertical ScrollView, but unlike the Dashboard's
// vertical-in-vertical wheels there's no scroll-axis conflict to guard
// against here (this wheel's axis is horizontal, orthogonal to the screen
// scroll), so it doesn't need the onDragStart/onDragEnd outer-scroll lock
// DashboardScreen's wheels do.
export function OverridePressPicker({
  value,
  onChange,
  color,
}: {
  value: number;
  onChange: (v: number) => void;
  color: ReturnType<typeof useTheme>;
}) {
  // OverrideCustomEntry (below) can commit any integer in [OVR_MIN, OVR_MAX],
  // not just multiples of OVR_STEP -- overridePressIndex clamps defensively
  // so an off-grid value (e.g. a custom "137") still resolves to an in-range
  // index (nearest step, "135") instead of an out-of-bounds one; same "app
  // clamps too" belt-and-suspenders as clampLockSeconds. The wheel then
  // highlights that nearest step while the caption below keeps showing the
  // real `value`, the same gap a stepped picker next to a free-text field
  // always has (like this app's minute wheel showing ":05" for an
  // externally-set ":07").
  const selectedIndex = overridePressIndex(value);
  return (
    <View>
      <Text style={[styles.label, { color: color.textDim, marginBottom: 8 }]}>Override presses</Text>
      <WheelPicker
        orientation="horizontal"
        labels={OVR_LABELS}
        selectedIndex={selectedIndex}
        onChange={(i) => onChange(overridePressValue(i))}
        itemSize={56}
        crossAxisSize={48}
        itemTextStyle={styles.overrideWheelText}
        accessibilityLabel="Override presses"
      />
      <Text style={[styles.subtitle, { color: color.textDim, marginTop: 4 }]}>
        {value} presses to force-unlock
      </Text>
    </View>
  );
}

// Escape hatch below the Override-presses wheel: the wheel is a fast way to
// scrub to a round-ish number, but landing on an arbitrary exact value still
// means dragging through however many of the ~100 steps separate it from the
// current one. Cross-platform by construction (unlike Alert.prompt, which is
// iOS-only) -- same TextInput pattern as CustomLabelsSection's label-name
// field. Clamped to [min, max] here too, not just relying on the box's own
// clamp in apply_ble_settings_json -- same "app clamps too" belt-and-
// suspenders as clampLockSeconds.
export function OverrideCustomEntry({
  value,
  min,
  max,
  onChange,
  color,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  color: ReturnType<typeof useTheme>;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  if (!open) {
    return (
      <AnimatedPressable
        onPress={() => {
          setDraft(String(value));
          setError(null);
          setOpen(true);
        }}
        style={{ marginTop: 4 }}
        // Neither pressable in this file announced as a button, and both are
        // 13-15px text runs well under the ~44pt minimum tap target.
        accessibilityRole="button"
        accessibilityLabel="Enter a custom number of override presses"
        hitSlop={hitSlop.text}
      >
        <Text style={[styles.customLink, { color: color.accent }]}>Enter a custom number...</Text>
      </AnimatedPressable>
    );
  }

  const commit = () => {
    const n = Math.round(Number(draft));
    if (!draft.trim() || !Number.isFinite(n)) {
      setError('Enter a whole number.');
      return;
    }
    onChange(Math.max(min, Math.min(max, n)));
    setOpen(false);
  };

  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      <View style={styles.customRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          keyboardType="number-pad"
          autoFocus
          style={[styles.customInput, { color: color.text, borderColor: color.textDim }]}
        />
        <Button label="Set" onPress={commit} color={color} />
        <AnimatedPressable
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Cancel custom number entry"
          hitSlop={hitSlop.text}
        >
          <Text style={{ color: color.textDim }}>Cancel</Text>
        </AnimatedPressable>
      </View>
      {error ? <Text style={[styles.subtitle, { color: color.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: rowLabelStyle,
  subtitle: captionStyle,
  // Sized down from WheelPicker's default typeScale.title (28px, meant for
  // the Dashboard's much larger duration wheels) to fit this compact
  // Settings row -- still an existing token, not a new magic size.
  overrideWheelText: { ...typeScale.sectionTitle },
  customLink: { fontSize: 13, fontWeight: '600', lineHeight: 17 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minWidth: 70, textAlign: 'center' },
});
