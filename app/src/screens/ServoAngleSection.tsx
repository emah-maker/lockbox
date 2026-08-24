// ServoAngleSection.tsx -- the Settings screen's lock-angle/unlock-angle
// controls. Same open/draft/error TextInput pattern as OverridePressSection's
// OverrideCustomEntry (a typable numberpad field, not a slider/wheel -- there
// is no separate quick-picker for a servo angle to fall back to here).
//
// keyboardType stays 'number-pad' per the explicit ask for a numberpad entry
// field, but this range is signed ([-90, 90]) and neither 'number-pad' nor
// 'numeric' expose a minus key on iOS -- so a small +/- toggle sits beside
// the field instead of switching to a keyboard type that still couldn't
// reach negative values.
import React from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Button, rowLabelStyle, captionStyle } from './SettingsPrimitives';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { clampServoAngle } from './servoAngle';

export function AngleCustomEntry({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: ReturnType<typeof useTheme>;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [negative, setNegative] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!open) {
    return (
      <View style={{ marginTop: 12 }}>
        <Text style={[styles.label, { color: color.textDim, marginBottom: 4 }]}>{label}</Text>
        <AnimatedPressable
          onPress={() => {
            setDraft(String(Math.abs(value)));
            setNegative(value < 0);
            setError(null);
            setOpen(true);
          }}
        >
          <Text style={[styles.customLink, { color: color.accent }]}>{value}° -- tap to change</Text>
        </AnimatedPressable>
      </View>
    );
  }

  const commit = () => {
    const magnitude = Math.round(Number(draft));
    if (!draft.trim() || !Number.isFinite(magnitude)) {
      setError('Enter a whole number.');
      return;
    }
    onChange(clampServoAngle(negative ? -magnitude : magnitude));
    setOpen(false);
  };

  return (
    <View style={{ marginTop: 12, gap: 6 }}>
      <Text style={[styles.label, { color: color.textDim }]}>{label}</Text>
      <View style={styles.customRow}>
        <AnimatedPressable
          onPress={() => setNegative((n) => !n)}
          style={[styles.signBtn, { borderColor: color.textDim }]}
          accessibilityRole="button"
          accessibilityLabel={negative ? 'Negative angle -- tap for positive' : 'Positive angle -- tap for negative'}
        >
          <Text style={[styles.signText, { color: color.text }]}>{negative ? '−' : '+'}</Text>
        </AnimatedPressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          keyboardType="number-pad"
          autoFocus
          style={[styles.customInput, { color: color.text, borderColor: color.textDim }]}
          accessibilityLabel={`${label}, degrees`}
        />
        <Button label="Set" onPress={commit} color={color} />
        <AnimatedPressable onPress={() => setOpen(false)}>
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
  customLink: { fontSize: 13, fontWeight: '600' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, minWidth: 60, textAlign: 'center' },
  signBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  signText: { fontSize: 18, fontWeight: '700' },
});
