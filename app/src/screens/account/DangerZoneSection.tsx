// DangerZoneSection.tsx -- Account page's danger zone: Sign out, and Delete
// account with the spec §4 copy. The app's "two-step confirm" is its native
// Alert itself (spec §4: "app keeps its native Alert but must state
// consequences") -- unlike the web's typed "DELETE" step, a single
// Alert.alert with an explicit destructive action is this platform's
// equivalent, matching the pattern the pre-restructure AccountSection.tsx
// already used. Re-authentication (auth/requires-recent-login) is handled
// inside useAuthStore.deleteAccount's own retry-once wrapper -- this
// component only ever sees success or a single generic failure.
import React from 'react';
import { Text, StyleSheet, Alert } from 'react-native';
import { useAuthStore } from '../../auth/useAuthStore';
import { useTheme } from '../../theme/useTheme';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { Button, Section, captionStyle } from '../SettingsPrimitives';

const DELETE_COPY =
  "This permanently deletes your account and its cloud profile, settings, goals, and device list. " +
  'Your session history is retained on our servers but orphaned (unreadable by anyone) for data-' +
  'integrity reasons -- it is not visible anywhere once your account is gone. Local stats on this ' +
  'phone, and the box itself, are unaffected. This cannot be undone.';

export function DangerZoneSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const syncing = useAuthStore((s) => s.syncing);

  const [busy, setBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert('Delete account?', DELETE_COPY, [
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
            // Generic message only (spec §4) -- never interpolate the
            // underlying error in case a future failure mode ever carries
            // more than a plain string message.
            setDeleteError('Could not delete account. Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Section title="Danger zone" color={color}>
      {deleteError ? <Text style={[styles.subtitle, { color: color.danger }]}>{deleteError}</Text> : null}
      <Button
        label="Sign out"
        onPress={handleSignOut}
        disabled={busy || syncing}
        loading={busy}
        color={color}
        variant="outline"
      />
      <AnimatedPressable onPress={handleDeleteAccount} disabled={busy} style={styles.deleteRow}>
        <Text style={[styles.subtitle, { color: color.danger }]}>Delete account</Text>
      </AnimatedPressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  subtitle: captionStyle,
  deleteRow: { marginTop: 4 },
});
