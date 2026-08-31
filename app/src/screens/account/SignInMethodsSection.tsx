// SignInMethodsSection.tsx -- Account page's sign-in-method status (spec
// §1): one chip per linked provider (accountDisplay.ts's providerLabel maps
// any id besides google.com/apple.com to "Other" rather than dropping it), a
// "Link" action for each supported provider NOT yet linked (Apple gated on
// AppleAuthentication.isAvailableAsync(), same runtime check
// SignedOutAccount.tsx uses), a "Remove" action per linked provider gated on
// accountDisplay.ts's canUnlink (never leave the account with zero sign-in
// methods) and confirmed via a native Alert first, and the account-created/
// last-sign-in dates straight off useAuthStore's AccountUser.
import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuthStore } from '../../auth/useAuthStore';
import type { AuthProviderKind } from '../../auth/accountLinking';
import {
  providerLabel,
  canUnlink,
  unlinkedProviders,
  formatShortDate,
  providerActionErrorMessage,
} from '../../auth/accountDisplay';
import { useTheme } from '../../theme/useTheme';
import { Button, Row, Section, captionStyle } from '../SettingsPrimitives';

const PROVIDER_NAME: Record<AuthProviderKind, string> = { google: 'Google', apple: 'Apple' };

export function SignInMethodsSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const user = useAuthStore((s) => s.user);
  const linkProvider = useAuthStore((s) => s.linkProvider);
  const unlinkProvider = useAuthStore((s) => s.unlinkProvider);

  const [busyProvider, setBusyProvider] = React.useState<AuthProviderKind | null>(null);
  const [error, setError] = React.useState<string | null>(null);
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

  if (!user) return null;

  const handleLink = async (provider: AuthProviderKind) => {
    setBusyProvider(provider);
    setError(null);
    try {
      await linkProvider(provider);
    } catch (e: any) {
      // The cancel check and the "is this message safe to render" judgement
      // both live in providerActionErrorMessage now -- it returns null for a
      // user-initiated cancel, so there is nothing to suppress here. This
      // used to pass `e.message` as the fallback, which handed the raw SDK
      // string straight back for any code the mapping didn't cover.
      setError(providerActionErrorMessage(e, 'Could not link account. Please try again.'));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleUnlink = (provider: AuthProviderKind) => {
    Alert.alert(
      `Remove ${PROVIDER_NAME[provider]}?`,
      `You'll no longer be able to sign in with ${PROVIDER_NAME[provider]}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyProvider(provider);
            setError(null);
            try {
              await unlinkProvider(provider);
            } catch (e: any) {
              setError(providerActionErrorMessage(e, 'Could not remove that sign-in method. Please try again.'));
            } finally {
              setBusyProvider(null);
            }
          },
        },
      ],
    );
  };

  const linked = user.linkedProviders;
  const eligibleToUnlink = canUnlink(user.providerIds);
  // Apple must only be offered where it's actually available (spec §1) --
  // Google has no equivalent runtime-availability check.
  const notLinked = unlinkedProviders(linked).filter((p) => p !== 'apple' || appleAvailable);
  const createdLabel = formatShortDate(user.creationTime);
  const lastSignInLabel = formatShortDate(user.lastSignInTime);

  return (
    <Section title={linked.length > 1 ? 'Linked sign-in methods' : 'Sign-in method'} color={color}>
      <View style={styles.chipRow}>
        {user.providerIds.map((id) => (
          <View key={id} style={[styles.chip, { borderColor: color.textDim }]}>
            <Text style={[styles.chipText, { color: color.text }]}>{providerLabel(id)}</Text>
          </View>
        ))}
      </View>

      {error ? <Text style={[styles.subtitle, { color: color.danger }]}>{error}</Text> : null}

      {linked.map((provider) =>
        eligibleToUnlink ? (
          <Row key={provider} label={`Remove ${PROVIDER_NAME[provider]}`} color={color}>
            <Button
              label="Remove"
              onPress={() => handleUnlink(provider)}
              disabled={busyProvider !== null}
              loading={busyProvider === provider}
              color={color}
              variant="outline"
            />
          </Row>
        ) : null,
      )}

      {notLinked.length > 0 ? (
        <View style={styles.chipRow}>
          {notLinked.map((provider) => (
            <Button
              key={provider}
              label={`Link ${PROVIDER_NAME[provider]}`}
              onPress={() => handleLink(provider)}
              disabled={busyProvider !== null}
              loading={busyProvider === provider}
              color={color}
              variant="outline"
              icon={
                <Ionicons
                  name={provider === 'google' ? 'logo-google' : 'logo-apple'}
                  size={16}
                  color={color.text}
                />
              }
            />
          ))}
        </View>
      ) : null}

      <Row label="Account created" color={color}>
        <Text style={[styles.subtitle, { color: color.textDim }]}>{createdLabel ?? '--'}</Text>
      </Row>
      <Row label="Last sign-in" color={color}>
        <Text style={[styles.subtitle, { color: color.textDim }]}>{lastSignInLabel ?? '--'}</Text>
      </Row>
    </Section>
  );
}

const styles = StyleSheet.create({
  subtitle: captionStyle,
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 13, fontWeight: '600' },
});
