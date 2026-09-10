// DataPrivacySection.tsx -- Account page's "Data & privacy" subsection (spec
// §3): a plain, static statement of what this account stores in the cloud
// and what it doesn't -- no controls, just disclosure. Wording mirrors
// firestoreSync.ts's actual schema (profile email/displayName/photoURL,
// settings/app, goals/config, sessions); the sessions-retained-but-orphaned
// exception on deletion is spelled out in DangerZoneSection's delete copy
// instead of repeated here, since it only matters at deletion time.
//
// The text below is a summary, not the policy: the policy itself is linked
// from here (and from the Settings hub's About sheet, for the signed-out
// case) via SettingsPrimitives' shared PrivacyPolicyLink -- App Store Review
// Guideline 5.1.1(i) wants the actual document reachable from inside the app,
// not just a description of it.
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { Section, PrivacyPolicyLink, captionStyle } from '../SettingsPrimitives';

export function DataPrivacySection({ color }: { color: ReturnType<typeof useTheme> }) {
  return (
    <Section title="Data & privacy" color={color}>
      <Text style={[styles.subtitle, { color: color.textDim }]}>
        Stored in the cloud: your profile (email, name, photo URL), app settings, focus goals, and
        session history -- so they follow you to another phone.{'\n\n'}
        Not stored: any raw sign-in token or credential. Firebase manages your session directly; this
        app never uploads it.
      </Text>
      <PrivacyPolicyLink color={color} />
    </Section>
  );
}

const styles = StyleSheet.create({ subtitle: captionStyle });
