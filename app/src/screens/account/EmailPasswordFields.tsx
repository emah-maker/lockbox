// EmailPasswordFields.tsx -- shared email/password inputs for every form
// that collects them: SignedOutAccount's sign-in/create-account/forgot-
// password modes, SignInMethodsSection's inline "Link email" form, and
// DangerZoneSection's password-reauth field for deleteAccount(password).
// Pulled out once a second call site needed the exact same fields --
// particularly the textContentType/autoComplete values that make iOS
// Keychain/Android autofill offer to save or fill correctly, which is easy
// to get subtly wrong (or fix in one file and forget the others) if every
// form declares its own TextInputs. Each field renders only when its change
// handler is passed, so this one component covers a full sign-in/create
// pair, an email-only forgot-password field, and a password-only reauth
// field alike -- callers wrap it in their own <View style={{ gap: 8 }}>
// (a Fragment carries no layout of its own).
import { TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { typeScale } from '../../theme/tokens';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Firebase Auth's own floor -- createUserWithEmailAndPassword/updatePassword
// reject anything shorter with auth/weak-password, so checking client-side
// only saves a round trip, it doesn't relax what the server accepts.
const MIN_PASSWORD_LENGTH = 6;

/** Loose "looks like an email" check -- not RFC 5322, just enough to catch an
 * empty or obviously-mistyped field before round-tripping to Firebase, which
 * rejects anything this misses with its own auth/invalid-email regardless. */
export function isValidEmail(email: string): boolean {
  return EMAIL_SHAPE.test(email.trim());
}

/**
 * Client-side validation shared by SignedOutAccount's sign-in/create-account
 * submit and SignInMethodsSection's link-email submit. `confirmPassword` is
 * only checked when passed, so a caller with no confirm field (sign-in,
 * link) can omit it rather than passing undefined twice. Returns a short,
 * safe-to-render string, or null once the form is ready to submit -- these
 * are this app's own authored strings, never a raw SDK message, so they can
 * go straight into the same error slot each screen already renders through.
 */
export function validateEmailPassword(
  email: string,
  password: string,
  confirmPassword?: string,
): string | null {
  if (!isValidEmail(email)) return 'Enter a valid email address.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (confirmPassword !== undefined && password !== confirmPassword) return 'Passwords do not match.';
  return null;
}

export function EmailPasswordFields({
  email,
  onChangeEmail,
  password,
  onChangePassword,
  confirmPassword,
  onChangeConfirmPassword,
  newPassword,
  editable = true,
  color,
}: {
  /** Omitted for a password-only field (DangerZoneSection's delete-account
   * reauth) -- the account's email is already known there. */
  email?: string;
  onChangeEmail?: (v: string) => void;
  /** Omitted for an email-only field (SignedOutAccount's forgot-password mode). */
  password?: string;
  onChangePassword?: (v: string) => void;
  /** Only ever passed alongside `password` -- SignedOutAccount's
   * create-account mode is the one caller that wants a confirm field. */
  confirmPassword?: string;
  onChangeConfirmPassword?: (v: string) => void;
  /** True where a password is being SET (create account, link) rather than
   * an existing one being entered (sign in, delete reauth) -- what tells iOS
   * Keychain to offer generating/saving a new password instead of filling a
   * saved one. The confirm field below is always 'newPassword' regardless,
   * since it only ever appears alongside a password being set. */
  newPassword?: boolean;
  editable?: boolean;
  color: ReturnType<typeof useTheme>;
}) {
  return (
    <>
      {onChangeEmail ? (
        <TextInput
          value={email ?? ''}
          onChangeText={onChangeEmail}
          editable={editable}
          placeholder="Email"
          placeholderTextColor={color.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          style={[styles.input, { color: color.text, borderColor: color.textDim }]}
        />
      ) : null}
      {onChangePassword ? (
        <TextInput
          value={password ?? ''}
          onChangeText={onChangePassword}
          editable={editable}
          placeholder="Password"
          placeholderTextColor={color.textDim}
          secureTextEntry
          textContentType={newPassword ? 'newPassword' : 'password'}
          autoComplete={newPassword ? 'new-password' : 'password'}
          style={[styles.input, { color: color.text, borderColor: color.textDim }]}
        />
      ) : null}
      {onChangeConfirmPassword ? (
        <TextInput
          value={confirmPassword ?? ''}
          onChangeText={onChangeConfirmPassword}
          editable={editable}
          placeholder="Confirm password"
          placeholderTextColor={color.textDim}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          style={[styles.input, { color: color.text, borderColor: color.textDim }]}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    // lineHeight is left off deliberately -- on Android it mis-centers text
    // inside a TextInput's padding box (same reasoning as
    // CustomLabelsSection's own textInput style).
    letterSpacing: typeScale.sectionTitle.letterSpacing,
  },
});
