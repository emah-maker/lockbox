// DataPrivacySection.tsx -- Account page's "Data & privacy" subsection (spec
// §3): a plain, static statement of what this account stores in the cloud
// and what it doesn't -- no controls, just disclosure. Wording mirrors
// firestoreSync.ts's actual schema (profile email/displayName/photoURL,
// settings/app, goals/config, sessions); the sessions-retained-but-orphaned
// exception on deletion is spelled out in DangerZoneSection's delete copy
// instead of repeated here, since it only matters at deletion time.
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { Section, captionStyle } from '../SettingsPrimitives';

export function DataPrivacySection({ color }: { color: ReturnType<typeof useTheme> }) {
  return (
    <Section title="Data & privacy" color={color}>
      <Text style={[styles.subtitle, { color: color.textDim }]}>
        Stored in the cloud: your profile (email, name, photo URL), app settings, focus goals, and
        session history -- so they follow you to another phone.{'\n\n'}
        Not stored: any raw sign-in token or credential. Firebase manages your session directly; this
        app never uploads it.
      </Text>
    </Section>
  );
}

const styles = StyleSheet.create({ subtitle: captionStyle });
