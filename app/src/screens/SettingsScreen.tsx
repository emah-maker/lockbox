// SettingsScreen.tsx -- app behaviors + box behaviors + appearance. The box
// behaviors (override presses / auto-open / sleep / brightness / screen flip
// / remote unlock / unlock when called) round-trip over BLE via
// useStore.pushBoxSettings, mirrored locally in useSettingsStore.boxSettings
// so this screen has something to show even before a connection is made.
import React from 'react';
import { View, Text, StyleSheet, Switch, ScrollView, Alert } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useStore, CONN_LABELS } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAuthStore } from '../auth/useAuthStore';
import { useTheme } from '../theme/useTheme';
import { THEME_MODES, ACCENT_KEYS, ACCENT_LABELS, accentSwatch, ThemeMode, AccentKey } from '../theme/theme';
import { CustomLabelsSection } from './CustomLabelsSection';
import { Button, Section, rowLabelStyle, captionStyle } from './SettingsPrimitives';
import { OverridePressPicker, OverrideCustomEntry } from './OverridePressSection';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { typeScale } from '../theme/tokens';
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
          <Switch value={autoConnect} onValueChange={setAutoConnect} accessibilityLabel="Auto-connect to box" />
        </Row>
      </Section>

      <AccountSection color={c} />

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
  const pendingLink = useAuthStore((s) => s.pendingLink);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const syncNow = useAuthStore((s) => s.syncNow);

  const [busy, setBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [signInError, setSignInError] = React.useState<string | null>(null);
  // Runtime capability check (not Platform.OS): false on Android, and on iOS
  // devices/OS versions where Sign in with Apple isn't available -- keeps
  // the button from ever being shown somewhere it would just fail.
  const [appleAvailable, setAppleAvailable] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    AppleAuthentication.isAvailableAsync().then((available) => {
      if (!cancelled) setAppleAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignIn = async (signIn: () => Promise<void>) => {
    setBusy(true);
    setSignInError(null);
    try {
      await signIn();
    } catch (e: any) {
      // Same "generic message only" discipline as syncError/deleteError below
      // (design doc §5 checklist item 3 -- these thrown messages are static,
      // credential-free strings, e.g. "Google Sign-In was cancelled.", never
      // the underlying token/credential). A plain cancellation isn't worth
      // surfacing as an error -- tapping Cancel on the account picker is a
      // normal outcome, not a failure -- but every other failure previously
      // vanished silently here, unlike handleDeleteAccount's own catch below.
      // AccountExistsError's own message is generic/credential-free too
      // (see accountLinking.ts) -- pendingLink (rendered below) carries the
      // "sign in with your other provider" prompt, so it isn't duplicated here.
      const msg = typeof e?.message === 'string' ? e.message : 'Could not sign in. Please try again.';
      if (!/cancel/i.test(msg) && e?.name !== 'AccountExistsError') setSignInError(msg);
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
            {/* Gated on the store's `syncing` flag too, not just local `busy`
                -- signing out mid-sync used to be possible from here even
                though useAuthStore.syncNow's own in-flight promise was still
                running against the about-to-be-cleared user. */}
            <Button
              label="Sign out"
              onPress={handleSignOut}
              disabled={busy || syncing}
              loading={busy}
              color={color}
              variant="outline"
            />
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
          {signInError ? <Text style={[styles.subtitle, { color: color.danger }]}>{signInError}</Text> : null}
          {pendingLink ? (
            <Text style={[styles.subtitle, { color: color.danger, marginBottom: 8 }]}>
              {pendingLink.email ? `An account already exists for ${pendingLink.email}` : 'An account already exists for this email'}
              {' '}with a different sign-in method. Sign in with{' '}
              {pendingLink.linkWithProvider === 'google' ? 'Google' : 'Apple'} to link your accounts.
            </Text>
          ) : null}
          <View style={styles.chipRow}>
            <Button
              label="Sign in with Google"
              onPress={() => handleSignIn(signInWithGoogle)}
              disabled={busy}
              loading={busy}
              color={color}
            />
            {appleAvailable ? (
              <Button
                label="Sign in with Apple"
                onPress={() => handleSignIn(signInWithApple)}
                disabled={busy}
                loading={busy}
                color={color}
                variant="outline"
              />
            ) : null}
          </View>
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
  connBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connText: { ...typeScale.label },
  h1: { ...typeScale.title, marginBottom: 4 },
  // label/subtitle now come from SettingsPrimitives.tsx (rowLabelStyle/
  // captionStyle) -- previously duplicated here byte-for-byte.
  subtitle: captionStyle,
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
