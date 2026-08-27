// SignedOutAccount.tsx -- Account page's signed-out state (design doc §6.2):
// explanation text, Sign in with Google/Apple, and the pendingLink
// cross-provider conflict prompt (accountLinking.ts). Moved out of the old
// (pre-restructure) AccountSection.tsx unchanged in behavior.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuthStore } from '../../auth/useAuthStore';
import { useTheme } from '../../theme/useTheme';
import { Button, captionStyle } from '../SettingsPrimitives';

export function SignedOutAccount({ color, ready }: { color: ReturnType<typeof useTheme>; ready: boolean }) {
  const syncError = useAuthStore((s) => s.syncError);
  const pendingLink = useAuthStore((s) => s.pendingLink);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);

  const [busy, setBusy] = React.useState(false);
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
      // Same "generic message only" discipline as the rest of this file
      // (design doc §5 checklist item 3) -- these thrown messages are
      // static, credential-free strings (e.g. "Google Sign-In was
      // cancelled."), never the underlying token/credential. A plain
      // cancellation isn't worth surfacing as an error. AccountExistsError's
      // own message is generic/credential-free too (see accountLinking.ts)
      // -- pendingLink (rendered below) carries the "sign in with your
      // other provider" prompt, so it isn't duplicated here.
      const msg = typeof e?.message === 'string' ? e.message : 'Could not sign in. Please try again.';
      if (!/cancel/i.test(msg) && e?.name !== 'AccountExistsError') setSignInError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
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
  );
}

const styles = StyleSheet.create({
  subtitle: captionStyle,
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
