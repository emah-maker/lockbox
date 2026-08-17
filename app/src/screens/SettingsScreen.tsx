// SettingsScreen.tsx -- app behaviors + box behaviors + appearance. The box
// behaviors (override presses / auto-open / sleep / brightness / remote
// unlock / unlock when called) round-trip over BLE via
// useStore.pushBoxSettings, mirrored locally in useSettingsStore.boxSettings
// so this screen has something to show even before a connection is made.
import React from 'react';
import { View, Text, StyleSheet, Switch, ScrollView, TextInput, Alert } from 'react-native';
import { useStore, CONN_LABELS } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAuthStore } from '../auth/useAuthStore';
import { useTheme } from '../theme/useTheme';
import { THEME_MODES, ACCENT_KEYS, ACCENT_LABELS, accentSwatch, ThemeMode, AccentKey } from '../theme/theme';
import { CustomLabelsSection } from './CustomLabelsSection';
import { Button, Section, SliderRow } from './SettingsPrimitives';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { typeScale } from '../theme/tokens';

// Mirrors Box-code/lib/lock_config.py -- keep these ranges in lockstep with
// OVR_MIN/OVR_MAX/OVR_STEP and SLEEP_OPTIONS/BRIGHT_OPTIONS on the firmware
// side. Override presses used to be a non-uniform 5/10/25/50 staircase
// (OVR_OPTIONS) -- a slider gives every option an equal-width slice of the
// track regardless of value, so the staircase made the same-size drag
// distance mean a tiny nudge near one end and a huge jump near the other,
// which read as "inconsistent". A flat step fixes that at the source.
// OVR_MAX was 255 (a single NVM byte's ceiling) until raised to 500 (manager
// request) -- lock_settings.Settings now persists override_presses across 2
// NVM bytes to fit; see that file's save()/_load() comments.
const OVR_MIN = 5;
const OVR_MAX = 500;
const OVR_STEP = 5;
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

  // Fixed green/red, matching DashboardScreen's connection dot -- see its
  // comment for why this can't just follow the accent/textDim theme colors.
  const connColor = conn === 'connected' ? c.success : c.danger;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.h1, { color: c.text, marginBottom: 0 }]}>Settings</Text>
        <View style={styles.connBadge}>
          <View style={[styles.connDot, { backgroundColor: connColor }]} />
          <Text style={[styles.connText, { color: c.textDim }]}>{CONN_LABELS[conn]}</Text>
        </View>
      </View>

      <Section title="App behaviors" color={c}>
        <Row label="Auto-connect to box" color={c}>
          <Switch value={autoConnect} onValueChange={setAutoConnect} />
        </Row>
      </Section>

      <AccountSection color={c} />

      <Section title="Box behaviors" subtitle={conn !== 'connected' ? 'Showing last-known values -- connect to change live' : undefined} color={c}>
        <Row label="Auto-open when done" color={c}>
          <Switch
            value={!!boxSettings.auto}
            onValueChange={(v) => pushBoxSettings({ auto: v ? 1 : 0 })}
          />
        </Row>
        <SliderRow
          label="Override presses"
          value={boxSettings.ovr}
          min={OVR_MIN}
          max={OVR_MAX}
          step={OVR_STEP}
          onChange={(v) => pushBoxSettings({ ovr: v })}
          caption={(v) => `${v} presses to force-unlock`}
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
        <Row label="Allow open/close from this phone" color={c}>
          <Switch
            value={!!boxSettings.unlk}
            onValueChange={(v) => pushBoxSettings({ unlk: v ? 1 : 0 })}
          />
        </Row>
        <Row label="Unlock box when called" color={c}>
          <Switch
            value={!!boxSettings.ucal}
            onValueChange={(v) => pushBoxSettings({ ucal: v ? 1 : 0 })}
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

      <CustomLabelsSection color={c} />
    </ScrollView>
  );
}

// Account section (design doc §6): optional, additive -- never a gate. Reads
// straight off useAuthStore's `user` (display-safe fields only: uid, email,
// displayName, photoURL) for on-screen display; nothing here is ever passed
// to console.*/analytics (design doc §5 checklist items 3-4).
function AccountSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const user = useAuthStore((s) => s.user);
  const syncing = useAuthStore((s) => s.syncing);
  const syncError = useAuthStore((s) => s.syncError);
  const lastSyncedAt = useAuthStore((s) => s.lastSyncedAt);
  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const syncNow = useAuthStore((s) => s.syncNow);

  const [busy, setBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
    } catch {
      // useAuthStore.signIn/googleAuth already swallow/surface errors without
      // logging the underlying credential -- a failed/cancelled sign-in just
      // leaves the user signed out, nothing further to do here.
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and removes your synced settings and device list from the cloud. Local stats on this phone, and the box itself, are unaffected. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setDeleteError(null);
            try {
              await deleteAccount();
            } catch {
              // Generic message only -- never interpolate the underlying error
              // (design doc §5 checklist item 3: no token/PII in any surfaced
              // string). Most likely cause: the re-authentication step was
              // cancelled: safe to just let the user retry.
              setDeleteError('Could not delete account. Please try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Section title="Account" color={color}>
      {user ? (
        <>
          <Row label={user.displayName ?? user.email ?? 'Signed in'} color={color}>
            <Text style={[styles.subtitle, { color: color.textDim }]}>
              {lastSyncedAt ? `Synced ${formatRelative(lastSyncedAt)}` : 'Not synced yet'}
            </Text>
          </Row>
          {user.displayName && user.email ? (
            <Text style={[styles.subtitle, { color: color.textDim }]}>{user.email}</Text>
          ) : null}
          {syncError ? <Text style={[styles.subtitle, { color: color.danger }]}>{syncError}</Text> : null}
          {deleteError ? <Text style={[styles.subtitle, { color: color.danger }]}>{deleteError}</Text> : null}
          <View style={styles.chipRow}>
            <Button
              label={syncing ? 'Syncing...' : 'Sync now'}
              onPress={syncNow}
              disabled={syncing || busy}
              loading={syncing || busy}
              color={color}
            />
            <Button label="Sign out" onPress={handleSignOut} disabled={busy} loading={busy} color={color} variant="outline" />
          </View>
          <AnimatedPressable onPress={handleDeleteAccount} disabled={busy} style={{ marginTop: 12 }}>
            <Text style={[styles.subtitle, { color: color.danger }]}>Delete account</Text>
          </AnimatedPressable>
        </>
      ) : (
        <>
          <Text style={[styles.subtitle, { color: color.textDim, marginBottom: 8 }]}>
            Back up your stats and settings, and sync them to another phone. Optional -- the box works
            fully without this.
          </Text>
          {syncError ? <Text style={[styles.subtitle, { color: color.danger }]}>{syncError}</Text> : null}
          <Button label="Sign in with Google" onPress={handleSignIn} disabled={busy} loading={busy} color={color} />
        </>
      )}
    </Section>
  );
}

/** "5m ago" / "3h ago" / "2d ago" -- the small non-blocking sync caption §6.3 asks for. */
function formatRelative(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
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

// Escape hatch below the Override-presses slider: the slider is a fast way
// to pick a round-ish number, but has no way to land on an arbitrary exact
// value without a lot of dragging. Cross-platform by construction (unlike
// Alert.prompt, which is iOS-only) -- same TextInput pattern as
// CustomLabelsSection's label-name field. Clamped to [min, max] here too,
// not just relying on the box's own clamp in apply_ble_settings_json --
// same "app clamps too" belt-and-suspenders as clampLockSeconds.
function OverrideCustomEntry({
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
        <AnimatedPressable onPress={() => setOpen(false)}>
          <Text style={{ color: color.textDim }}>Cancel</Text>
        </AnimatedPressable>
      </View>
      {error ? <Text style={[styles.subtitle, { color: color.danger }]}>{error}</Text> : null}
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
  connBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connText: { ...typeScale.label },
  h1: { ...typeScale.title, marginBottom: 4 },
  subtitle: { fontSize: 12, marginTop: 2, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: {
    fontSize: 15,
    flexShrink: 1,
    paddingRight: 12,
    letterSpacing: typeScale.sectionTitle.letterSpacing,
    lineHeight: typeScale.sectionTitle.lineHeight,
  },
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
  customLink: { fontSize: 13, fontWeight: '600' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, minWidth: 70, textAlign: 'center' },
});
