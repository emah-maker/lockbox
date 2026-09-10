// SignInMethodsSection.tsx -- Account page's sign-in-method status (spec
// §1): one chip per linked provider (accountDisplay.ts's providerLabel maps
// any id besides google.com/apple.com/password to "Other" rather than
// dropping it), a "Link" action for each supported provider NOT yet linked
// (Apple gated on useAppleAuthAvailable(), the same runtime check
// SignedOutAccount.tsx uses; linking email opens an inline form below
// instead of a one-tap action, since it needs typed credentials rather than
// a provider redirect), a "Remove" action per linked provider gated on
// accountDisplay.ts's canUnlink (never leave the account with zero sign-in
// methods) and confirmed via a native Alert first, and the account-created/
// last-sign-in dates straight off useAuthStore's AccountUser.
import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { EmailPasswordFields, validateEmailPassword } from './EmailPasswordFields';
import { useAppleAuthAvailable } from './useAppleAuthAvailable';

const PROVIDER_NAME: Record<AuthProviderKind, string> = { google: 'Google', apple: 'Apple', password: 'Email' };

export function SignInMethodsSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const user = useAuthStore((s) => s.user);
  const linkProvider = useAuthStore((s) => s.linkProvider);
  const unlinkProvider = useAuthStore((s) => s.unlinkProvider);
  const linkEmailPassword = useAuthStore((s) => s.linkEmailPassword);

  const [busyProvider, setBusyProvider] = React.useState<AuthProviderKind | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const appleAvailable = useAppleAuthAvailable();

  // The inline "Link email" form's own two fields -- kept separate from
  // busyProvider/error above only where the shape genuinely differs (a
  // typed credential pair instead of a one-tap redirect); it still shares
  // this section's single busyProvider/error slots below.
  const [linkEmailOpen, setLinkEmailOpen] = React.useState(false);
  const [linkEmail, setLinkEmail] = React.useState('');
  const [linkPassword, setLinkPassword] = React.useState('');

  if (!user) return null;

  const handleLink = async (provider: 'google' | 'apple') => {
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

  // Email can't go through handleLink/linkProvider above -- linking a
  // password needs a typed credential (linkEmailPassword), not a provider
  // redirect, so it gets its own submit handler and its own inline form
  // (rendered below) instead of a one-tap button.
  const handleLinkEmail = async () => {
    const validationError = validateEmailPassword(linkEmail, linkPassword);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusyProvider('password');
    setError(null);
    try {
      await linkEmailPassword(linkEmail, linkPassword);
      setLinkEmailOpen(false);
      setLinkEmail('');
      setLinkPassword('');
    } catch (e: any) {
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
  // Google and Email have no equivalent runtime-availability check.
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
          {notLinked
            // Hides the "Link Email" trigger once its own form (below) is
            // open, rather than showing both at once.
            .filter((provider) => provider !== 'password' || !linkEmailOpen)
            .map((provider) => (
              <Button
                key={provider}
                label={`Link ${PROVIDER_NAME[provider]}`}
                onPress={() => (provider === 'password' ? setLinkEmailOpen(true) : handleLink(provider))}
                disabled={busyProvider !== null}
                loading={busyProvider === provider}
                color={color}
                variant="outline"
                icon={
                  <Ionicons
                    name={provider === 'google' ? 'logo-google' : provider === 'apple' ? 'logo-apple' : 'mail-outline'}
                    size={16}
                    color={color.text}
                  />
                }
              />
            ))}
        </View>
      ) : null}

      {linkEmailOpen ? (
        <View style={styles.linkEmailForm}>
          <EmailPasswordFields
            email={linkEmail}
            onChangeEmail={setLinkEmail}
            password={linkPassword}
            onChangePassword={setLinkPassword}
            newPassword
            editable={busyProvider === null}
            color={color}
          />
          <View style={styles.chipRow}>
            <Button
              label="Link"
              onPress={handleLinkEmail}
              disabled={busyProvider !== null}
              loading={busyProvider === 'password'}
              color={color}
              variant="outline"
            />
            <Button
              label="Cancel"
              onPress={() => {
                setLinkEmailOpen(false);
                setLinkEmail('');
                setLinkPassword('');
                setError(null);
              }}
              disabled={busyProvider !== null}
              color={color}
              variant="outline"
            />
          </View>
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
  linkEmailForm: { gap: 8 },
});
