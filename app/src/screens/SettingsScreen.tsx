// SettingsScreen.tsx -- app behaviors + box behaviors + appearance. The box
// behaviors (override presses / auto-open / sleep / brightness / screen flip
// / remote unlock / unlock when called) round-trip over BLE via
// useStore.pushBoxSettings, mirrored locally in useSettingsStore.boxSettings
// so this screen has something to show even before a connection is made.
import React from 'react';
import { View, Text, StyleSheet, Switch, ScrollView, Modal, Pressable, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore, CONN_LABELS } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAuthStore } from '../auth/useAuthStore';
import { useTheme } from '../theme/useTheme';
import { THEME_MODES, ACCENT_KEYS, ACCENT_LABELS, accentSwatch, ThemeMode, AccentKey } from '../theme/theme';
import { Section, Row, rowLabelStyle, captionStyle } from './SettingsPrimitives';
import { AccountSection } from './AccountSection';
import { OverridePressPicker, OverrideCustomEntry } from './OverridePressSection';
import { AngleCustomEntry } from './ServoAngleSection';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useReducedMotion } from '../ui/useReducedMotion';
import { typeScale, elevation, springs, overlay } from '../theme/tokens';
import { OVR_MIN, OVR_MAX } from './overridePresses';

// Mirrors Box-code/lib/lock_config.py -- keep OVR_MIN/OVR_MAX/OVR_STEP
// (overridePresses.ts) and SLEEP_OPTIONS/BRIGHT_OPTIONS below in lockstep
// with the firmware side. Override presses used to be a non-uniform
// 5/10/25/50 staircase (OVR_OPTIONS), then a flat-step slider (every option
// an equal-width slice of the track, fixing the staircase's "same drag
// distance, wildly different jump size" inconsistency) -- now a horizontal
// wheel picker (`OverridePressPicker`, `OverrideCustomEntry` in
// OverridePressSection.tsx) so scrubbing through values lands directly on
// one instead of dragging a thumb. OVR_MAX was 255 (a single NVM byte's
// ceiling) until raised to 500 (manager request) -- lock_settings.Settings
// now persists override_presses across 2 NVM bytes to fit; see that file's
// save()/_load() comments.
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
  const callAlertsEnabled = useSettingsStore((s) => s.callAlertsEnabled);
  const setCallAlertsEnabled = useSettingsStore((s) => s.setCallAlertsEnabled);
  const callDetectionAvailable = useStore((s) => s.callDetectionAvailable);
  const lastAlert = useStore((s) => s.lastAlert);
  const authUser = useAuthStore((s) => s.user);

  const [accountOpen, setAccountOpen] = React.useState(false);

  // Fixed green/red, matching DashboardScreen's connection dot -- see its
  // comment for why this can't just follow the accent/textDim theme colors.
  const connColor = conn === 'connected' ? c.success : c.danger;

  return (
    <>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.h1, { color: c.text, marginBottom: 0 }]}>Settings</Text>
          <View style={styles.headerActions}>
            <View style={styles.connBadge}>
              <View style={[styles.connDot, { backgroundColor: connColor }]} />
              <Text style={[styles.connText, { color: c.textDim }]}>{CONN_LABELS[conn]}</Text>
            </View>
            <AnimatedPressable
              onPress={() => setAccountOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={authUser ? 'Account, signed in' : 'Account, signed out'}
              hitSlop={8}
            >
              <Ionicons
                name={authUser ? 'person-circle' : 'person-circle-outline'}
                size={28}
                color={authUser ? c.accent : c.textDim}
              />
            </AnimatedPressable>
          </View>
        </View>

        <Section title="App behaviors" color={c}>
          <Row label="Auto-connect to box" color={c}>
            <Switch value={autoConnect} onValueChange={setAutoConnect} accessibilityLabel="Auto-connect to box" />
          </Row>
          <Row label="Alert box on incoming calls" color={c}>
            <Switch
              value={callAlertsEnabled}
              onValueChange={setCallAlertsEnabled}
              accessibilityLabel="Alert box on incoming calls"
            />
          </Row>
          {callAlertsEnabled && !callDetectionAvailable ? (
            <Text style={[styles.subtitle, { color: c.danger }]}>
              Call detection isn't available in this build -- it needs a dev-client build
              (npx expo prebuild + run:ios), not Expo Go, so calls won't be seen yet.
            </Text>
          ) : null}
          {lastAlert ? <Text style={[styles.subtitle, { color: c.textDim }]}>Last alert sent: {lastAlert}</Text> : null}
        </Section>

        <Section title="Box behaviors" subtitle={conn !== 'connected' ? 'Showing last-known values -- connect to change live' : undefined} color={c}>
          <Row label="Auto-open when done" color={c}>
            <Switch
              value={!!boxSettings.auto}
              onValueChange={(v) => pushBoxSettings({ auto: v ? 1 : 0 })}
              accessibilityLabel="Auto-open when done"
            />
          </Row>
          <OverridePressPicker
            value={boxSettings.ovr}
            onChange={(v) => pushBoxSettings({ ovr: v })}
            color={c}
          />
          <OverrideCustomEntry
            value={boxSettings.ovr}
            min={OVR_MIN}
            max={OVR_MAX}
            onChange={(v) => pushBoxSettings({ ovr: v })}
            color={c}
          />
          <PickerGroup
            label="Screen sleep"
            options={SLEEP_OPTIONS}
            value={boxSettings.sleep}
            format={(v) => `${v}s`}
            onSelect={(v) => pushBoxSettings({ sleep: v })}
            color={c}
          />
          <PickerGroup
            label="Brightness"
            options={BRIGHT_OPTIONS}
            value={boxSettings.bright}
            format={(v) => `${v}%`}
            onSelect={(v) => pushBoxSettings({ bright: v })}
            color={c}
          />
          <AngleCustomEntry
            label="Lock angle"
            value={boxSettings.langle}
            onChange={(v) => pushBoxSettings({ langle: v })}
            color={c}
          />
          <AngleCustomEntry
            label="Unlock angle"
            value={boxSettings.uangle}
            onChange={(v) => pushBoxSettings({ uangle: v })}
            color={c}
          />
          <Row label="Flip screen upside down" color={c}>
            <Switch
              value={!!boxSettings.flip}
              onValueChange={(v) => pushBoxSettings({ flip: v ? 1 : 0 })}
              accessibilityLabel="Flip screen upside down"
            />
          </Row>
          <Row label="Allow open/close from this phone" color={c}>
            <Switch
              value={!!boxSettings.unlk}
              onValueChange={(v) => pushBoxSettings({ unlk: v ? 1 : 0 })}
              accessibilityLabel="Allow open/close from this phone"
            />
          </Row>
          <Row label="Unlock box when called" color={c}>
            <Switch
              value={!!boxSettings.ucal}
              onValueChange={(v) => pushBoxSettings({ ucal: v ? 1 : 0 })}
              accessibilityLabel="Unlock box when called"
            />
          </Row>
        </Section>

        <Section
          title="Appearance"
          subtitle="Also sets the box's theme -- see Box behaviors above for connection state"
          color={c}
        >
          <Text style={[styles.label, { color: c.textDim, marginBottom: 8 }]}>Theme</Text>
          <View style={styles.chipRow}>
            {THEME_MODES.map((m: ThemeMode) => (
              <Chip
                key={m}
                active={themeMode === m}
                onPress={() => {
                  setThemeMode(m);
                  pushBoxSettings({ thm: THEME_MODES.indexOf(m) as 0 | 1 });
                }}
                color={c}
              >
                {m === 'dark' ? 'Dark' : 'Light'}
              </Chip>
            ))}
          </View>
          <Text style={[styles.label, { color: c.textDim, marginTop: 16, marginBottom: 8 }]}>
            Accent color
          </Text>
          <View style={styles.chipRow}>
            {ACCENT_KEYS.map((a: AccentKey) => (
              <Chip
                key={a}
                active={accent === a}
                onPress={() => {
                  setAccent(a);
                  pushBoxSettings({ acc: ACCENT_KEYS.indexOf(a) });
                }}
                color={c}
                swatch={accentSwatch(themeMode, a)}
              >
                {ACCENT_LABELS[a]}
              </Chip>
            ))}
          </View>
        </Section>
      </ScrollView>

      <AccountModal visible={accountOpen} onClose={() => setAccountOpen(false)} color={c} />
    </>
  );
}

// Bottom-sheet presentation for the Account section -- same spring/scrim
// pattern as CalendarScreen.tsx's LabelPickerModal (shared `springs.default`
// token, useReducedMotion-gated), so this app's one sheet-modal precedent
// stays in one place instead of forking a second animation style. The sheet
// itself is c.bg (not c.surface) so AccountSection's own Section card still
// reads as a raised surface inside it, matching how it looked inline before.
const SHEET_TRAVEL = 56;
const BACKDROP_OPACITY = 0.4;
const SHEET_SPRING = { ...springs.default, useNativeDriver: true };

function AccountModal({
  visible,
  onClose,
  color,
}: {
  visible: boolean;
  onClose: () => void;
  color: ReturnType<typeof useTheme>;
}) {
  const reduceMotion = useReducedMotion();
  const [presented, setPresented] = React.useState(visible);
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;
  const sheetY = React.useRef(new Animated.Value(SHEET_TRAVEL)).current;

  React.useEffect(() => {
    if (visible) {
      setPresented(true);
      if (reduceMotion) {
        backdropOpacity.setValue(BACKDROP_OPACITY);
        sheetY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.spring(backdropOpacity, { toValue: BACKDROP_OPACITY, ...SHEET_SPRING }),
        Animated.spring(sheetY, { toValue: 0, ...SHEET_SPRING }),
      ]).start();
      return;
    }
    if (reduceMotion) {
      backdropOpacity.setValue(0);
      sheetY.setValue(SHEET_TRAVEL);
      setPresented(false);
      return;
    }
    Animated.parallel([
      Animated.spring(sheetY, { toValue: SHEET_TRAVEL, ...SHEET_SPRING }),
      Animated.spring(backdropOpacity, { toValue: 0, ...SHEET_SPRING }),
    ]).start(({ finished }) => {
      if (finished) setPresented(false);
    });
  }, [visible, reduceMotion, backdropOpacity, sheetY]);

  const sheetOpacity = backdropOpacity.interpolate({
    inputRange: [0, BACKDROP_OPACITY],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={presented} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[modalStyles.scrim, { opacity: backdropOpacity }]}>
        <Pressable style={modalStyles.scrimTouch} onPress={onClose} />
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[modalStyles.sheetLayer, { opacity: sheetOpacity, transform: [{ translateY: sheetY }] }]}
      >
        <Pressable style={[modalStyles.sheet, { backgroundColor: color.bg }]} onPress={() => {}}>
          <AnimatedPressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={modalStyles.closeButton}
            hitSlop={8}
          >
            <Ionicons name="close" size={22} color={color.textDim} />
          </AnimatedPressable>
          <AccountSection color={color} />
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: overlay.scrim },
  scrimTouch: { flex: 1 },
  sheetLayer: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingTop: 12,
    maxHeight: '80%',
    ...elevation.card,
  },
  closeButton: { alignSelf: 'flex-end', marginBottom: 4 },
});

// A row of Chips for a small fixed set of options (e.g. Sleep/Brightness) --
// every valid value is visible and one tap direct-sets it, unlike the old
// +/- stepper which hid the option list behind repeated presses.
function PickerGroup({
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

function Chip({
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

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  connBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connText: { ...typeScale.label },
  h1: { ...typeScale.title, marginBottom: 4 },
  // label/subtitle now come from SettingsPrimitives.tsx (rowLabelStyle/
  // captionStyle) -- previously duplicated here byte-for-byte.
  subtitle: captionStyle,
  label: rowLabelStyle,
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  chipSwatch: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
});
