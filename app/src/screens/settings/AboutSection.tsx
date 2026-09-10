// AboutSection.tsx -- the Settings hub's "About" sheet: what version this is,
// and the privacy policy link.
//
// Exists for App Store Review Guideline 5.1.1(i): an app that creates
// accounts and stores user data has to link its privacy policy from inside
// the app, somewhere easily accessible. The Account page's "Data & privacy"
// section renders the same link (see SettingsPrimitives' PrivacyPolicyLink),
// but that whole page only exists once you are signed in -- and signing in is
// optional here, so a reviewer (or a user) who never signs in would otherwise
// have nowhere to find it. This sheet is reachable in either state.
//
// The version line is the other half of why this is worth a sheet: TestFlight
// feedback is only actionable if a tester can say which build they were on,
// and expoConfig.version is the value App Store Connect shows next to it.
import { Text, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { useTheme } from '../../theme/useTheme';
import { Section, PrivacyPolicyLink, captionStyle } from '../SettingsPrimitives';

/** The app version as configured in app.json. Read once at module scope --
 * expoConfig is a build-time constant, not something that can change while
 * the app is running. Falls back rather than rendering "undefined" if the
 * manifest is ever unavailable (Expo Go edge cases, a bare test renderer). */
const APP_VERSION = Constants.expoConfig?.version ?? null;

/** Hub-row summary, same shape as boxBehaviorSummary/appearanceSummary/etc. */
export function aboutSummary(): string {
  return APP_VERSION ? `Version ${APP_VERSION}` : 'Version & privacy';
}

export function AboutSection({ color }: { color: ReturnType<typeof useTheme> }) {
  return (
    <Section title="About" color={color}>
      <Text style={[styles.subtitle, { color: color.textDim }]}>
        Phone Box{APP_VERSION ? ` \u2014 version ${APP_VERSION}` : ''}
        {'\n\n'}
        The box works on its own. This app is the optional companion: it shows your focus stats,
        keeps your goals, and lets an important call ring through while the box is locked.
      </Text>
      <PrivacyPolicyLink color={color} />
    </Section>
  );
}

const styles = StyleSheet.create({ subtitle: captionStyle });
