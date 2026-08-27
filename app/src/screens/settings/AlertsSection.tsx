// AlertsSection.tsx -- the settings hub's "Alerts" sheet. Covers both
// call-detection alerting (whether the box gets pinged on an incoming call,
// plus the callDetectionAvailable dev-client-build caveat and the
// last-alert-sent caption) and auto-connect (whether the app tries to
// reconnect to the box on launch) -- the two toggles that used to sit
// together under SettingsScreen.tsx's old "App behaviors" Section. Folded
// into one "Alerts" sheet rather than splitting auto-connect out into its
// own hub row, since neither the hub's category list nor NavIntent's
// settingsSection union carved out a separate slot for it, and it's still a
// connectivity *notification* behavior in the same family as call alerts.
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Switch } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { Section, Row, captionStyle } from '../SettingsPrimitives';

export function AlertsSection({
  color,
  autoConnect,
  setAutoConnect,
  callAlertsEnabled,
  setCallAlertsEnabled,
  callDetectionAvailable,
  lastAlert,
}: {
  color: ReturnType<typeof useTheme>;
  autoConnect: boolean;
  setAutoConnect: (v: boolean) => void;
  callAlertsEnabled: boolean;
  setCallAlertsEnabled: (v: boolean) => void;
  callDetectionAvailable: boolean;
  lastAlert: string | null;
}) {
  return (
    <Section title="Alerts" color={color}>
      <Row label="Auto-connect to box" color={color}>
        <Switch value={autoConnect} onValueChange={setAutoConnect} accessibilityLabel="Auto-connect to box" />
      </Row>
      <Row label="Alert box on incoming calls" color={color}>
        <Switch
          value={callAlertsEnabled}
          onValueChange={setCallAlertsEnabled}
          accessibilityLabel="Alert box on incoming calls"
        />
      </Row>
      {callAlertsEnabled && !callDetectionAvailable ? (
        <Text style={[styles.subtitle, { color: color.danger }]}>
          Call detection isn't available in this build -- it needs a dev-client build (npx expo prebuild +
          run:ios), not Expo Go, so calls won't be seen yet.
        </Text>
      ) : null}
      {lastAlert ? <Text style={[styles.subtitle, { color: color.textDim }]}>Last alert sent: {lastAlert}</Text> : null}
    </Section>
  );
}

/** One-line hub summary for the Alerts row. */
export function alertsSummary(callAlertsEnabled: boolean): string {
  return callAlertsEnabled ? 'On' : 'Off';
}

const styles = StyleSheet.create({
  subtitle: captionStyle,
});
