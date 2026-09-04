// DangerZoneSection.tsx -- Account page's danger zone: Sign out, and Delete
// account with the spec §4 copy. The app's "two-step confirm" is its native
// Alert itself (spec §4: "app keeps its native Alert but must state
// consequences") -- unlike the web's typed "DELETE" step, a single
// Alert.alert with an explicit destructive action is this platform's
// equivalent, matching the pattern the pre-restructure AccountSection.tsx
// already used. Re-authentication (auth/requires-recent-login) is handled
// inside useAuthStore.deleteAccount's own retry-once wrapper, and now runs
// BEFORE any data is touched -- a cancelled/failed picker aborts the whole
// flow untouched, and this component just sees the generic failure below.
// The one other outcome it must distinguish is AccountDataWipedError: cloud
// data was already deleted but removing the sign-in itself then failed, so
// this can't share the generic "please try again" message, which would
// falsely imply nothing happened.
import React from 'react';
import { Text, StyleSheet, Alert } from 'react-native';
import { useAuthStore, AccountDataWipedError } from '../../auth/useAuthStore';
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
          } catch (e) {
            if (e instanceof AccountDataWipedError) {
              // Honest, distinct message: unlike the generic case below,
              // cloud data really is already gone. The account itself is
              // still signed in, so retrying Delete account is the correct
              // next step (deleteAllUserData is a no-op the second time).
              setDeleteError(
                'Your cloud data was deleted, but we could not finish removing your account. ' +
                  'Please try Delete account again.',
              );
            } else {
              // Generic message only (spec §4) -- never interpolate the
              // underlying error in case a future failure mode ever carries
              // more than a plain string message.
              setDeleteError('Could not delete account. Please try again.');
            }
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
      {/* The single most destructive action in the app, and until now it
          carried no accessibilityRole (so VoiceOver announced it as plain
          text, not something you could activate), no hint that the Alert
          below is a confirmation step rather than the deletion itself, no
          disabled state, and a tap target the height of a 12px caption line
          (~15px, a third of the ~44pt minimum) sitting immediately under the
          Sign out button. hitSlop fixes the last of those without making
          this read as a big red button, which it deliberately is not. */}
      <AnimatedPressable
        onPress={handleDeleteAccount}
        disabled={busy}
        style={styles.deleteRow}
        accessibilityRole="button"
        accessibilityLabel="Delete account"
        accessibilityHint="Asks you to confirm before permanently deleting your account and cloud profile"
        accessibilityState={{ disabled: busy }}
        hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
      >
        <Text style={[styles.subtitle, { color: color.danger }]}>Delete account</Text>
      </AnimatedPressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  subtitle: captionStyle,
  deleteRow: { marginTop: 4 },
});
