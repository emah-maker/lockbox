// DemoModeSection.tsx -- the settings hub's "Demo mode" sheet: one switch
// that points the whole app at a simulated box (ble/DemoBoxClient.ts)
// instead of the radio.
//
// Visible, labelled, and off by default, rather than hidden behind a gesture
// or a build flag. Two reasons, both deliberate (see
// docs/handoff/demo-mode-handoff.md):
//
//   * It must exist in the store build. This is what App Review uses to
//     exercise a hardware feature they have no hardware for -- the same
//     reason the call diagnostics panel in AlertsSection.tsx is not
//     __DEV__-gated. Gating it would compile out the exact thing Apple asked
//     for from the exact build they run.
//   * A reviewer following a one-line note must FIND it. A secret gesture
//     they miss is another 2.1(a) rejection, and Apple dislikes
//     functionality reachable only by secret.
//
// The cost of being visible is that any tester can turn it on, so the copy
// below says plainly what it does, and ui/StatusStrip.tsx keeps a banner on
// screen for as long as it is on -- nobody should be able to mistake a demo
// session for a real one.
import { Switch, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { Section, Row, captionStyle } from '../SettingsPrimitives';

export function DemoModeSection({
  color,
  demoMode,
  setDemoMode,
}: {
  color: ReturnType<typeof useTheme>;
  demoMode: boolean;
  /** useStore's setDemoMode -- persists the flag AND swaps the BLE client
   * over, which is why this is the store action rather than
   * useSettingsStore's plain setter. */
  setDemoMode: (on: boolean) => Promise<void>;
}) {
  return (
    <Section title="Demo mode" color={color}>
      <Row label="Use a simulated box" color={color}>
        <Switch
          value={demoMode}
          // Fire-and-forget with a catch, the same convention every other
          // box command in this app uses: the action already handles its own
          // connect/disconnect failures, and a Switch has nothing to do with
          // a rejected promise but drop it.
          onValueChange={(on) => {
            void setDemoMode(on).catch(() => {});
          }}
          accessibilityLabel="Use a simulated box"
        />
      </Row>
      <Text style={[styles.caption, { color: color.textDim }]}>
        Runs the app against a simulated Phone Box, so you can start a lock, watch it count down and see
        the finished session appear in your history without the hardware. No Bluetooth needed.
      </Text>
      <Text style={[styles.caption, { color: color.textDim }]}>
        Demo locks run faster than real time so a session finishes in about a minute. Sessions recorded in
        demo mode are marked DEMO in your history and stay on this device -- they are never uploaded to
        your account.
      </Text>
      {demoMode ? (
        <Text style={[styles.caption, { color: color.warn }]}>
          Demo mode is on. Turn it off to connect to a real box again.
        </Text>
      ) : null}
    </Section>
  );
}

/** One-line hub summary for the Demo mode row. */
export function demoModeSummary(demoMode: boolean): string {
  return demoMode ? 'On' : 'Off';
}

const styles = StyleSheet.create({
  caption: captionStyle,
});
