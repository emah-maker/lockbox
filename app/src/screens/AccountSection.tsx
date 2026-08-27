// AccountSection.tsx -- the Settings screen's "Account" section, split into
// its own file so SettingsScreen.tsx stays under this project's 500-line
// file guideline (same reasoning as CustomLabelsSection.tsx/
// OverridePressSection.tsx/ServoAngleSection.tsx already sitting beside it).
// Account section (design doc §6): optional, additive -- never a gate. Reads
// straight off useAuthStore's `user` (display-safe fields only: uid, email,
// displayName, photoURL) for on-screen display; nothing here is ever passed
// to console.*/analytics (design doc §5 checklist items 3-4).
import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuthStore } from '../auth/useAuthStore';
import { useTheme } from '../theme/useTheme';
import { Button, Row, Section, captionStyle } from './SettingsPrimitives';
import { AnimatedPressable } from '../ui/AnimatedPressable';

export function AccountSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const ready = useAuthStore((s) => s.ready);
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
              disabled={busy || !ready}
              loading={busy}
              color={color}
              icon={<Ionicons name="logo-google" size={16} color={color.accentText} />}
            />
            {appleAvailable ? (
              <Button
                label="Sign in with Apple"
                onPress={() => handleSignIn(signInWithApple)}
                disabled={busy || !ready}
                loading={busy}
                color={color}
                variant="outline"
                icon={<Ionicons name="logo-apple" size={16} color={color.text} />}
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

const styles = StyleSheet.create({
  subtitle: captionStyle,
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
