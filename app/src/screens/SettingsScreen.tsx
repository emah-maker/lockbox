// SettingsScreen.tsx -- app behaviors + box behaviors + appearance. The box
// behaviors (override presses / auto-open / sleep / brightness / remote
// unlock) round-trip over BLE via useStore.pushBoxSettings, mirrored locally
// in useSettingsStore.boxSettings so this screen has something to show even
// before a connection is made.
import React from 'react';
import { View, Text, StyleSheet, Switch, Pressable, ScrollView } from 'react-native';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/useTheme';
import { THEME_MODES, ACCENT_KEYS, ACCENT_LABELS, ThemeMode, AccentKey } from '../theme/theme';

// Mirrors Box-code/lib/lock_config.py -- keep these ranges in lockstep with
// OVR_MIN/OVR_MAX/OVR_STEP/SLEEP_OPTIONS/BRIGHT_OPTIONS on the firmware side.
const OVR_MIN = 10;
const OVR_MAX = 100;
const OVR_STEP = 10;
const SLEEP_OPTIONS = [10, 20, 30, 60];
const BRIGHT_OPTIONS = [10, 30, 50, 70, 100];

export default function SettingsScreen() {
  const c = useTheme();
  const autoConnect = useStore((s) => s.autoConnect);
  const setAutoConnect = useStore((s) => s.setAutoConnect);
  const pushBoxSettings = useStore((s) => s.pushBoxSettings);
  const conn = useStore((s) => s.conn);

  const boxSettings = useSettingsStore((s) => s.boxSettings);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const accent = useSettingsStore((s) => s.accent);
  const setAccent = useSettingsStore((s) => s.setAccent);

  const stepOverride = (dir: 1 | -1) => {
    const next = Math.max(OVR_MIN, Math.min(OVR_MAX, boxSettings.ovr + dir * OVR_STEP));
    pushBoxSettings({ ovr: next });
  };
  const cycleOption = (options: number[], current: number, dir: 1 | -1) => {
    const i = options.indexOf(current);
    const next = options[Math.max(0, Math.min(options.length - 1, (i < 0 ? 0 : i) + dir))];
    return next;
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.h1, { color: c.text }]}>Settings</Text>

      <Section title="App behaviors" color={c}>
        <Row label="Auto-connect to box" color={c}>
          <Switch value={autoConnect} onValueChange={setAutoConnect} />
        </Row>
      </Section>

      <Section title="Box behaviors" subtitle={conn !== 'connected' ? 'Showing last-known values -- connect to change live' : undefined} color={c}>
        <Row label="Auto-open when done" color={c}>
          <Switch
            value={!!boxSettings.auto}
            onValueChange={(v) => pushBoxSettings({ auto: v ? 1 : 0 })}
          />
        </Row>
        <StepperRow
          label="Override presses"
          value={String(boxSettings.ovr)}
          onMinus={() => stepOverride(-1)}
          onPlus={() => stepOverride(1)}
          color={c}
        />
        <StepperRow
          label="Screen sleep"
          value={`${boxSettings.sleep}s`}
          onMinus={() => pushBoxSettings({ sleep: cycleOption(SLEEP_OPTIONS, boxSettings.sleep, -1) })}
          onPlus={() => pushBoxSettings({ sleep: cycleOption(SLEEP_OPTIONS, boxSettings.sleep, 1) })}
          color={c}
        />
        <StepperRow
          label="Brightness"
          value={`${boxSettings.bright}%`}
          onMinus={() => pushBoxSettings({ bright: cycleOption(BRIGHT_OPTIONS, boxSettings.bright, -1) })}
          onPlus={() => pushBoxSettings({ bright: cycleOption(BRIGHT_OPTIONS, boxSettings.bright, 1) })}
          color={c}
        />
        <Row label="Allow open/close from this phone" color={c}>
          <Switch
            value={!!boxSettings.unlk}
            onValueChange={(v) => pushBoxSettings({ unlk: v ? 1 : 0 })}
          />
        </Row>
      </Section>

      <Section title="Appearance" color={c}>
        <Text style={[styles.label, { color: c.textDim, marginBottom: 8 }]}>Theme</Text>
        <View style={styles.chipRow}>
          {THEME_MODES.map((m: ThemeMode) => (
            <Chip key={m} active={themeMode === m} onPress={() => setThemeMode(m)} color={c}>
              {m === 'dark' ? 'Dark' : 'Light'}
            </Chip>
          ))}
        </View>
        <Text style={[styles.label, { color: c.textDim, marginTop: 16, marginBottom: 8 }]}>
          Accent color
        </Text>
        <View style={styles.chipRow}>
          {ACCENT_KEYS.map((a: AccentKey) => (
            <Chip key={a} active={accent === a} onPress={() => setAccent(a)} color={c}>
              {ACCENT_LABELS[a]}
            </Chip>
          ))}
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({
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

function Row({
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

function StepperRow({
  label,
  value,
  onMinus,
  onPlus,
  color,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  color: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: color.text }]}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable style={[styles.stepBtn, { borderColor: color.textDim }]} onPress={onMinus}>
          <Text style={{ color: color.text, fontSize: 18 }}>-</Text>
        </Pressable>
        <Text style={[styles.stepValue, { color: color.text }]}>{value}</Text>
        <Pressable style={[styles.stepBtn, { borderColor: color.textDim }]} onPress={onPlus}>
          <Text style={{ color: color.text, fontSize: 18 }}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Chip({
  active,
  onPress,
  color,
  children,
}: {
  active: boolean;
  onPress: () => void;
  color: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? color.accent : 'transparent',
          borderColor: active ? color.accent : color.textDim,
        },
      ]}
    >
      <Text style={{ color: active ? color.accentText : color.text, fontWeight: '600' }}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 16 },
  h1: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2 },
  card: { borderRadius: 14, padding: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 15, flexShrink: 1, paddingRight: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { minWidth: 48, textAlign: 'center', fontSize: 15, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5 },
});
