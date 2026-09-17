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
//
// A password-only account has no native picker/sheet to reauthenticate
// with, so deleteAccount() throws PasswordRequiredError as its FIRST
// response rather than a failure -- this reveals an inline password field
// and retries as deleteAccount(password) once one is entered. That's a
// normal, expected step for this account type, not an error, so it must
// never surface through deleteError the way a real failure does.
//
// The other outcome this must distinguish is AccountDataWipedError: cloud
// data was already deleted but removing the sign-in itself then failed, so
// this can't share the generic "please try again" message, which would
// falsely imply nothing happened.
import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useAuthStore, AccountDataWipedError, PasswordRequiredError } from '../../auth/useAuthStore';
import { useTheme } from '../../theme/useTheme';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { Button, Section, captionStyle } from '../SettingsPrimitives';
import { EmailPasswordFields } from './EmailPasswordFields';

// Firebase reports a wrong password as auth/invalid-credential on projects
// with Email Enumeration Protection (this one); auth/wrong-password is the
// older pre-protection code, matched too so this stays correct if that
// setting is ever turned off. Used ONLY in the delete-reauth path below --
// see attemptDelete's catch for why naming this one case is safe when
// spec §4 otherwise requires a generic message.
const WRONG_PASSWORD_CODES = new Set(['auth/invalid-credential', 'auth/wrong-password']);

// Session history is now DELETED, not retained-but-orphaned. It used to be
// the latter, and firestoreSync.ts's deleteAllUserData changed that -- it
// deletes users/{uid} first precisely to open the window firestore.rules
// requires for a session delete (App Store Review Guideline 5.1.1(v) asks for
// the account AND its data, and a session topic is free text a user typed).
// Wording kept in step with the dashboard's own confirm copy
// (website/js/accountDelete.js) and with website/privacy.html's "Deleting
// your account" section; a destructive confirm that promises data SURVIVES
// when it does not is the worst kind of stale copy to leave standing.
const DELETE_COPY =
  'This permanently deletes your account and its cloud data: profile, settings, custom labels, ' +
  'focus goals, linked devices, scheduled sessions, and your focus session history. Local stats ' +
  'on this phone, and the box itself, are unaffected. This cannot be undone.';

export function DangerZoneSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const syncing = useAuthStore((s) => s.syncing);

  const [busy, setBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  // Revealed by a PasswordRequiredError response (see header comment) rather
  // than shown up front -- most accounts have a native picker/sheet and
  // never need this field at all.
  const [passwordRequired, setPasswordRequired] = React.useState(false);
  const [deletePassword, setDeletePassword] = React.useState('');

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  // Shared by the Alert's own destructive action (first attempt, no
  // password) and the inline password form's "Confirm delete" (the retry,
  // once PasswordRequiredError has revealed it) -- one flow, two entry
  // points, rather than duplicating the try/catch below.
  const attemptDelete = async (password?: string) => {
    setBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount(password);
      // Success unmounts this component (AccountSection swaps to
      // SignedOutAccount) -- nothing left to reset here.
    } catch (e) {
      if (e instanceof PasswordRequiredError) {
        // Not a failure -- see header comment. Reveal the password field
        // instead of setDeleteError.
        setPasswordRequired(true);
      } else if (e instanceof AccountDataWipedError) {
        // Honest, distinct message: unlike the generic case below, cloud
        // data really is already gone. The account itself is still signed
        // in, so retrying Delete account is the correct next step
        // (deleteAllUserData is a no-op the second time).
        setDeleteError(
          'Your cloud data was deleted, but we could not finish removing your account. ' +
            'Please try Delete account again.',
        );
      } else if (password !== undefined && WRONG_PASSWORD_CODES.has((e as any)?.code)) {
        // The one documented exception to the generic-message rule below,
        // and only inside the password-reauth path (`password !== undefined`)
        // so an OAuth deletion can never reach it. Naming this case leaks
        // nothing: the user is already signed in as this account, so unlike a
        // signed-out sign-in form there is no account-existence to disclose.
        // It earns the exception because the generic copy makes a typo look
        // identical to a network or server failure -- and "please try again"
        // invites retrying the same wrong password indefinitely, which is the
        // one retry that can never succeed. The password field stays revealed,
        // so correcting it is the obvious next step.
        setDeleteError('Incorrect password. Please try again.');
      } else {
        // Generic message only (spec §4) -- never interpolate the
        // underlying error in case a future failure mode ever carries more
        // than a plain string message.
        setDeleteError('Could not delete account. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert('Delete account?', DELETE_COPY, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete account', style: 'destructive', onPress: () => attemptDelete() },
    ]);
  };

  const cancelPasswordPrompt = () => {
    setPasswordRequired(false);
    setDeletePassword('');
    setDeleteError(null);
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
      {passwordRequired ? (
        <View style={styles.passwordForm}>
          <Text style={[styles.subtitle, { color: color.textDim }]}>
            This account signs in with a password. Enter it to confirm account deletion.
          </Text>
          <EmailPasswordFields
            password={deletePassword}
            onChangePassword={setDeletePassword}
            editable={!busy}
            color={color}
          />
          <View style={styles.chipRow}>
            <Button
              label="Confirm delete"
              onPress={() => attemptDelete(deletePassword)}
              disabled={busy || !deletePassword}
              loading={busy}
              color={color}
              variant="outline"
            />
            <Button label="Cancel" onPress={cancelPasswordPrompt} disabled={busy} color={color} variant="outline" />
          </View>
        </View>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  subtitle: captionStyle,
  deleteRow: { marginTop: 4 },
  passwordForm: { gap: 8, marginTop: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
