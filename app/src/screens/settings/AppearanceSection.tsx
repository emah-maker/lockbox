// AppearanceSection.tsx -- the settings hub's "Appearance" sheet: theme mode
// and accent color, both of which also push to the box over BLE (its own
// small onboard display follows the phone's theme/accent choice). Extracted
// out of SettingsScreen.tsx's previous inline "Appearance" Section the same
// way BoxBehaviorSection.tsx was, for the hub/sheet restructure.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { THEME_MODES, ACCENT_KEYS, ACCENT_LABELS, accentSwatch, ThemeMode, AccentKey } from '../../theme/theme';
import { Section, rowLabelStyle } from '../SettingsPrimitives';
import { Chip } from './ChipPicker';
import type { Settings } from '../../ble/protocol';

export function AppearanceSection({
  color,
  themeMode,
  setThemeMode,
  accent,
  setAccent,
  pushBoxSettings,
}: {
  color: ReturnType<typeof useTheme>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  accent: AccentKey;
  setAccent: (accent: AccentKey) => void;
  pushBoxSettings: (patch: Partial<Settings>) => void;
}) {
  return (
    <Section title="Appearance" subtitle="Also sets the box's own display theme" color={color}>
      <Text style={[styles.label, { color: color.textDim, marginBottom: 8 }]}>Theme</Text>
      <View style={styles.chipRow}>
        {THEME_MODES.map((m: ThemeMode) => (
          <Chip
            key={m}
            active={themeMode === m}
            onPress={() => {
              setThemeMode(m);
              pushBoxSettings({ thm: THEME_MODES.indexOf(m) as 0 | 1 });
            }}
            color={color}
          >
            {m === 'dark' ? 'Dark' : 'Light'}
          </Chip>
        ))}
      </View>
      <Text style={[styles.label, { color: color.textDim, marginTop: 16, marginBottom: 8 }]}>Accent color</Text>
      <View style={styles.chipRow}>
        {ACCENT_KEYS.map((a: AccentKey) => (
          <Chip
            key={a}
            active={accent === a}
            onPress={() => {
              setAccent(a);
              pushBoxSettings({ acc: ACCENT_KEYS.indexOf(a) });
            }}
            color={color}
            swatch={accentSwatch(themeMode, a)}
          >
            {ACCENT_LABELS[a]}
          </Chip>
        ))}
      </View>
    </Section>
  );
}

/** One-line hub summary for the Appearance row, e.g. "Dark · Mint". */
export function appearanceSummary(themeMode: ThemeMode, accent: AccentKey): string {
  return `${themeMode === 'dark' ? 'Dark' : 'Light'} · ${ACCENT_LABELS[accent]}`;
}

const styles = StyleSheet.create({
  label: rowLabelStyle,
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
