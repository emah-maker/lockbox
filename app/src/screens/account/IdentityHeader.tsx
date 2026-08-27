// IdentityHeader.tsx -- Account page identity header (spec §1's "Signed in
// as" line): displayName, falling back to email, falling back to "Signed
// in", the plain email line, and an "Email not verified" note when
// user.emailVerified is false (Apple private-relay addresses are left
// as-is, never resolved -- spec §1). No avatar/image loading -- this app has
// no image-loading path anywhere else (photoURL is carried on AccountUser
// but never rendered), and adding one just for this header would be new
// surface area the spec didn't ask for.
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import type { AccountUser } from '../../auth/useAuthStore';
import { useTheme } from '../../theme/useTheme';
import { captionStyle } from '../SettingsPrimitives';
import { typeScale } from '../../theme/tokens';

export function IdentityHeader({ user, color }: { user: AccountUser; color: ReturnType<typeof useTheme> }) {
  const name = user.displayName ?? user.email ?? 'Signed in';
  return (
    <View>
      <Text style={[styles.name, { color: color.text }]}>{name}</Text>
      {user.email ? <Text style={[styles.subtitle, { color: color.textDim }]}>{user.email}</Text> : null}
      {user.email && !user.emailVerified ? (
        <Text style={[styles.subtitle, { color: color.warn }]}>Email not verified</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  name: { ...typeScale.sectionTitle },
  subtitle: { ...captionStyle, marginTop: 4 },
});
