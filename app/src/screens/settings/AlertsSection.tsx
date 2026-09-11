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
import { useState } from 'react';
import { Pressable, Switch, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { Section, Row, captionStyle } from '../SettingsPrimitives';
import { CallDiagnosticsPanel } from './CallDiagnosticsPanel';

// How long the call-alerts row has to be held before the diagnostics panel
// appears. Long enough that nobody arrives there by fumbling a tap on the
// Switch beside it.
const DIAGNOSTICS_REVEAL_HOLD_MS = 1500;

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
  // The diagnostics panel ships in store builds too, rather than sitting
  // behind __DEV__: its whole point is `backgroundTicks`, and how often iOS
  // resumes a suspended app for a BLE notify is a property of a real
  // non-development install (see calls/callDiagnostics.ts). Gating it on
  // __DEV__ would delete it from exactly the builds worth measuring.
  //
  // So it is hidden instead. It is developer instrumentation -- a tick
  // counter and a raw event log -- and a TestFlight tester or an App Review
  // reader has no use for one in Settings.
  //
  // Reveal is deliberately not persisted. Collection runs regardless of
  // whether this is on screen; this state only uncovers the viewer, so
  // holding once per launch costs nothing and leaves no install with a
  // debug panel permanently showing.
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  return (
    <Section title="Alerts" color={color}>
      <Row label="Auto-connect to box" color={color}>
        <Switch value={autoConnect} onValueChange={setAutoConnect} accessibilityLabel="Auto-connect to box" />
      </Row>
      {/* accessible={false} so VoiceOver still lands on the Switch itself
          instead of announcing an unlabeled wrapper around it. */}
      <Pressable
        accessible={false}
        delayLongPress={DIAGNOSTICS_REVEAL_HOLD_MS}
        onLongPress={() => setShowDiagnostics(true)}
      >
        <Row label="Alert box on incoming calls" color={color}>
          <Switch
            value={callAlertsEnabled}
            onValueChange={setCallAlertsEnabled}
            accessibilityLabel="Alert box on incoming calls"
          />
        </Row>
      </Pressable>
      {callAlertsEnabled && !callDetectionAvailable ? (
        <Text style={[styles.subtitle, { color: color.danger }]}>
          {/* The build-recipe version of this is the useful one while
              developing and the wrong one to show a stranger: a released app
              telling someone to run `npx expo prebuild` reads as unfinished.
              Same condition, audience-appropriate wording. */}
          {__DEV__
            ? "Call detection isn't available in this build -- it needs a dev-client build (npx expo prebuild + run:ios), not Expo Go, so calls won't be seen yet."
            : "Call detection isn't available on this device, so the box won't light up for incoming calls."}
        </Text>
      ) : null}
      {lastAlert ? <Text style={[styles.subtitle, { color: color.textDim }]}>Last alert sent: {lastAlert}</Text> : null}
      {/* Kept unconditional rather than gated on callAlertsEnabled: the case
          this panel is for is the one where the user believes the feature is
          on and the box still never lit up. */}
      {showDiagnostics ? <CallDiagnosticsPanel color={color} /> : null}
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
