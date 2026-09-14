// SignedOutAccount.tsx -- Account page's signed-out state (design doc §6.2):
// explanation text, Sign in with Google/Apple/email+password, and the
// pendingLink cross-provider conflict prompt (accountLinking.ts). Moved out
// of the old (pre-restructure) AccountSection.tsx unchanged in behavior.
//
// The email/password form below the two provider buttons covers three modes
// in place (sign in / create account / forgot password) rather than as
// separate screens -- accountLinking.ts's AuthProviderKind now includes
// 'password' alongside 'google'/'apple', and pendingLink.candidateProviders
// (replacing the old single linkWithProvider) can name it as one of the ways
// to prove ownership of a conflicting account.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuthStore } from '../../auth/useAuthStore';
import { signInErrorMessage } from '../../auth/accountDisplay';
import type { AuthProviderKind } from '../../auth/accountLinking';
import { useTheme } from '../../theme/useTheme';
import { Button, captionStyle } from '../SettingsPrimitives';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { hitSlop, typeScale } from '../../theme/tokens';
import { EmailPasswordFields, validateEmailPassword, isValidEmail } from './EmailPasswordFields';
import { useAppleAuthAvailable } from './useAppleAuthAvailable';

type EmailAuthMode = 'signIn' | 'createAccount' | 'forgotPassword';

const EMAIL_SUBMIT_LABEL: Record<EmailAuthMode, string> = {
  signIn: 'Sign in',
  createAccount: 'Create account',
  forgotPassword: 'Send reset link',
};

// Natural-language phrase for pendingLink's candidateProviders below, e.g.
// "Apple" or "Apple or your email and password" -- deliberately not just the
// bare noun ("Email") for 'password' here, since "Sign in with Email" reads
// like a button label dropped into a sentence, not prose.
const CANDIDATE_PROVIDER_COPY: Record<AuthProviderKind, string> = {
  google: 'Google',
  apple: 'Apple',
  password: 'your email and password',
};

/** candidateProviders is never empty (accountLinking.ts always offers at
 * least the one other provider the attempted sign-in wasn't) and in practice
 * never longer than 2 (three provider kinds total, minus whichever was just
 * attempted) -- the 3+ Oxford-comma branch is defensive, not reachable today. */
function joinCandidateProviders(providers: AuthProviderKind[]): string {
  const names = providers.map((p) => CANDIDATE_PROVIDER_COPY[p]);
  if (names.length <= 1) return names[0] ?? 'your other sign-in method';
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}`;
}

export function SignedOutAccount({ color, ready }: { color: ReturnType<typeof useTheme>; ready: boolean }) {
  const syncError = useAuthStore((s) => s.syncError);
  const initError = useAuthStore((s) => s.initError);
  const pendingLink = useAuthStore((s) => s.pendingLink);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const createAccountWithEmail = useAuthStore((s) => s.createAccountWithEmail);
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);

  const [busy, setBusy] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);
  // Runtime capability check, shared with SignInMethodsSection's "Link
  // Apple" action -- see useAppleAuthAvailable.ts.
  const appleAvailable = useAppleAuthAvailable();

  const [emailMode, setEmailMode] = React.useState<EmailAuthMode>('signIn');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  // Deliberately neutral once true: Email Enumeration Protection means
  // Firebase's sendPasswordReset resolves the same way whether or not the
  // address has an account, so this can never honestly say more than "if
  // one exists" -- see the copy below.
  const [resetSent, setResetSent] = React.useState(false);

  const handleSignIn = async (signIn: () => Promise<void>) => {
    setBusy(true);
    setSignInError(null);
    try {
      await signIn();
    } catch (e: any) {
      // The raw error (e.name/e.code/e.message) is only ever logged, never
      // rendered -- signInErrorMessage (design doc §5 checklist item 3) maps
      // it to a short, credential-free string, or null for "don't show
      // anything" (a plain cancel, or AccountExistsError -- whose prompt
      // pendingLink, rendered below, already carries).
      console.warn('[SignedOutAccount] sign-in failed:', e?.name ?? e?.code ?? e?.message ?? e);
      setSignInError(signInErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Switching modes clears whatever the previous mode left behind (error,
  // reset confirmation, password fields) but keeps `email` -- retyping the
  // address you just entered to go from "sign in" to "forgot password" (or
  // back) would be a pointless tax on the one field every mode shares.
  const switchMode = (mode: EmailAuthMode) => {
    setEmailMode(mode);
    setSignInError(null);
    setResetSent(false);
    setPassword('');
    setConfirmPassword('');
  };

  const handlePasswordReset = async () => {
    setBusy(true);
    setSignInError(null);
    try {
      await sendPasswordReset(email);
      setResetSent(true);
    } catch (e: any) {
      console.warn('[SignedOutAccount] password reset failed:', e?.name ?? e?.code ?? e?.message ?? e);
      setSignInError(signInErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = () => {
    if (emailMode === 'forgotPassword') {
      if (!isValidEmail(email)) {
        setSignInError('Enter a valid email address.');
        return;
      }
      handlePasswordReset();
      return;
    }
    const validationError = validateEmailPassword(
      email,
      password,
      emailMode === 'createAccount' ? confirmPassword : undefined,
    );
    if (validationError) {
      setSignInError(validationError);
      return;
    }
    handleSignIn(() =>
      emailMode === 'createAccount' ? createAccountWithEmail(email, password) : signInWithEmail(email, password),
    );
  };

  return (
    <>
      <Text style={[styles.subtitle, { color: color.textDim, marginBottom: 8 }]}>
        Back up your stats and settings, and sync them to another phone. Optional -- the box works
        fully without this.
      </Text>
      {/* Every control below is gated on `ready`, which only flips once
          Firebase Auth reports its initial state -- up to useAuthStore's 10s
          watchdog, and on a cold start with a stored session it is not
          instant. Without this line that window is three dead grey buttons
          and no explanation, which is indistinguishable from the thing being
          broken; it is the shape of the report this whole flow keeps
          generating. Suppressed once initError is set, which says the same
          thing with more information. */}
      {!ready && !initError ? (
        <Text style={[styles.subtitle, { color: color.textDim }]}>Starting sign-in...</Text>
      ) : null}
      {initError ? <Text style={[styles.subtitle, { color: color.danger }]}>{initError}</Text> : null}
      {syncError ? <Text style={[styles.subtitle, { color: color.danger }]}>{syncError}</Text> : null}
      {signInError ? <Text style={[styles.subtitle, { color: color.danger }]}>{signInError}</Text> : null}
      {pendingLink ? (
        <Text style={[styles.subtitle, { color: color.danger, marginBottom: 8 }]}>
          {pendingLink.email ? `An account already exists for ${pendingLink.email}` : 'An account already exists for this email'}
          {' '}with a different sign-in method. Sign in with{' '}
          {joinCandidateProviders(pendingLink.candidateProviders)} to link your accounts.
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

      <Text style={[styles.subtitle, { color: color.textDim, marginTop: 12, marginBottom: 4 }]}>Or use email</Text>
      {emailMode === 'forgotPassword' && resetSent ? (
        <View style={styles.emailForm}>
          <Text style={[styles.subtitle, { color: color.text }]}>
            If an account exists for that address, a reset link is on its way.
          </Text>
          <ModeLink label="Back to sign in" onPress={() => switchMode('signIn')} color={color} />
        </View>
      ) : (
        <View style={styles.emailForm}>
          <EmailPasswordFields
            email={email}
            onChangeEmail={setEmail}
            password={emailMode === 'forgotPassword' ? undefined : password}
            onChangePassword={emailMode === 'forgotPassword' ? undefined : setPassword}
            confirmPassword={emailMode === 'createAccount' ? confirmPassword : undefined}
            onChangeConfirmPassword={emailMode === 'createAccount' ? setConfirmPassword : undefined}
            newPassword={emailMode === 'createAccount'}
            editable={!busy}
            color={color}
          />
          <Button
            label={EMAIL_SUBMIT_LABEL[emailMode]}
            onPress={handleEmailSubmit}
            disabled={busy || !ready}
            loading={busy}
            color={color}
          />
          <View style={styles.modeLinkRow}>
            {emailMode === 'signIn' ? (
              <>
                <ModeLink label="Create an account" onPress={() => switchMode('createAccount')} color={color} />
                <ModeLink label="Forgot password?" onPress={() => switchMode('forgotPassword')} color={color} />
              </>
            ) : (
              <ModeLink
                label={emailMode === 'createAccount' ? 'Already have an account? Sign in' : 'Back to sign in'}
                onPress={() => switchMode('signIn')}
                color={color}
              />
            )}
          </View>
        </View>
      )}
    </>
  );
}

// Small text-link mode toggle (Create an account / Forgot password? / Back
// to sign in) -- same AnimatedPressable + hitSlop.text shape CustomLabelsSection's
// Rename/Delete row actions use, so a bare text control still gets a real
// touch target and an accessibilityRole here too.
function ModeLink({
  label,
  onPress,
  color,
}: {
  label: string;
  onPress: () => void;
  color: ReturnType<typeof useTheme>;
}) {
  return (
    <AnimatedPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={hitSlop.text}>
      <Text style={[styles.modeLink, { color: color.accent }]}>{label}</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  subtitle: captionStyle,
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emailForm: { gap: 8 },
  modeLinkRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  modeLink: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: typeScale.body.letterSpacing,
    lineHeight: typeScale.body.lineHeight,
  },
});
