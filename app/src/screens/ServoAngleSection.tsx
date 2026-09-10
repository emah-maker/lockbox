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
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import {
  NumberEntryRow,
  readWholeNumberDraft,
  WHOLE_NUMBER_ERROR,
  rowLabelStyle,
} from './SettingsPrimitives';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { clampServoAngle } from './servoAngle';
import { hitSlop } from '../theme/tokens';

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
          // Was announced as plain text, so there was no way to tell a screen
          // reader this angle readout is the control that changes it.
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${value} degrees. Tap to change.`}
          hitSlop={hitSlop.text}
        >
          <Text style={[styles.customLink, { color: color.accent }]}>{value}° -- tap to change</Text>
        </AnimatedPressable>
      </View>
    );
  }

  const commit = () => {
    const magnitude = readWholeNumberDraft(draft);
    if (magnitude === null) {
      setError(WHOLE_NUMBER_ERROR);
      return;
    }
    onChange(clampServoAngle(negative ? -magnitude : magnitude));
    setOpen(false);
  };

  return (
    <View style={{ marginTop: 12, gap: 6 }}>
      <Text style={[styles.label, { color: color.textDim }]}>{label}</Text>
      <NumberEntryRow
        draft={draft}
        onChangeDraft={setDraft}
        onCommit={commit}
        onCancel={() => setOpen(false)}
        error={error}
        color={color}
        inputLabel={`${label}, degrees`}
        cancelLabel={`Cancel ${label} entry`}
        inputMinWidth={60}
        // The one thing the override editor has no equivalent of: neither
        // 'number-pad' nor 'numeric' exposes a minus key on iOS, and this
        // range is signed -- see this file's header.
        leading={
          <AnimatedPressable
            onPress={() => setNegative((n) => !n)}
            style={[styles.signBtn, { borderColor: color.textDim }]}
            accessibilityRole="button"
            accessibilityLabel={negative ? 'Negative angle -- tap for positive' : 'Positive angle -- tap for negative'}
            // 36x36 box; hitSlop takes it to the ~44pt minimum.
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Text style={[styles.signText, { color: color.text }]}>{negative ? '−' : '+'}</Text>
          </AnimatedPressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: rowLabelStyle,
  customLink: { fontSize: 13, fontWeight: '600', lineHeight: 17 },
  signBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  signText: { fontSize: 18, fontWeight: '700', lineHeight: 22 },
});
