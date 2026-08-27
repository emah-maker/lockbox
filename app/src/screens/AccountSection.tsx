// AccountSection.tsx -- thin composition root for the Settings screen's
// "Account" sheet (SheetKey 'account', useNav's settingsSection: 'account'
// deep link -- both entry points kept exactly as before, see
// SettingsScreen.tsx). Restructured from one flat section (design doc §6)
// into the fuller Account page the account-spec asks for: identity,
// sign-in methods, sync status, account settings, data & privacy, and a
// danger zone, each its own file under screens/account/ so no single file
// grows past this project's 500-line guideline. This file itself holds no
// business logic -- only which subsection renders when.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useAuthStore } from '../auth/useAuthStore';
import { useTheme } from '../theme/useTheme';
import { Section } from './SettingsPrimitives';
import { SignedOutAccount } from './account/SignedOutAccount';
import { IdentityHeader } from './account/IdentityHeader';
import { SignInMethodsSection } from './account/SignInMethodsSection';
import { SyncStatusSection } from './account/SyncStatusSection';
import { AccountSettingsSection } from './account/AccountSettingsSection';
import { DataPrivacySection } from './account/DataPrivacySection';
import { DangerZoneSection } from './account/DangerZoneSection';

export function AccountSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const ready = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return (
      <Section title="Account" color={color}>
        <SignedOutAccount color={color} ready={ready} />
      </Section>
    );
  }

  return (
    <View style={styles.page}>
      <Section title="Account" color={color}>
        <IdentityHeader user={user} color={color} />
      </Section>
      <SignInMethodsSection color={color} />
      <SyncStatusSection color={color} />
      <AccountSettingsSection color={color} />
      <DataPrivacySection color={color} />
      <DangerZoneSection color={color} />
    </View>
  );
}

const styles = StyleSheet.create({ page: { gap: 16 } });
