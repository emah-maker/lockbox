// CallDiagnosticsPanel.tsx -- surfaces app/src/calls/callDiagnostics.ts inside
// the Alerts sheet.
//
// Deliberately NOT reactive. The workflow this serves is "lock the box, shut
// the app, make a call, come back and read what happened" -- by the time the
// panel is on screen the interesting moment has already passed, so a snapshot
// taken on mount plus an explicit Refresh is both sufficient and cheaper than
// subscribing a settings row to a counter that ticks once a second.
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { Button, Row, captionStyle } from '../SettingsPrimitives';
import {
  getCallDiagnostics,
  resetCallDiagnostics,
  CallDiagnostics,
  CallDiagEvent,
} from '../../calls/callDiagnostics';

/** Newest first, and only as many as are worth reading on a phone screen. */
const SHOWN_EVENTS = 8;

function agoLabel(at: number | null, now: number): string {
  if (at == null) return 'never';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function eventLabel(e: CallDiagEvent, now: number): string {
  const when = agoLabel(e.at, now);
  return e.detail ? `${when} - ${e.kind}: ${e.detail}` : `${when} - ${e.kind}`;
}

/** The whole reason this panel exists: turn `backgroundTicks` into a sentence,
 * so reading it doesn't depend on remembering what the number meant. */
export function wakeVerdict(diag: CallDiagnostics): { text: string; ok: boolean | null } {
  if (diag.backgroundTicks > 0) {
    return {
      text: `Background wake confirmed: ${diag.backgroundTicks} of ${diag.ticks} status ticks arrived while the app was closed. Alert-through can work with the phone in the box.`,
      ok: true,
    };
  }
  if (diag.ticks > 0) {
    return {
      text: 'No background wake seen yet. Lock the box, close the app for a minute, reopen and refresh. If this stays at zero, iOS is not resuming the app for box notifies and alert-through cannot work while the app is closed.',
      ok: false,
    };
  }
  return {
    text: 'No status ticks recorded yet -- connect to the box and start a lock.',
    ok: null,
  };
}

export function CallDiagnosticsPanel({ color }: { color: ReturnType<typeof useTheme> }) {
  const [snapshot, setSnapshot] = useState(() => ({ diag: getCallDiagnostics(), at: Date.now() }));
  const refresh = () => setSnapshot({ diag: getCallDiagnostics(), at: Date.now() });
  const { diag, at } = snapshot;
  const verdict = wakeVerdict(diag);
  const recent = diag.events.slice(-SHOWN_EVENTS).reverse();

  return (
    <View style={styles.panel}>
      <Text style={[styles.heading, { color: color.text }]}>Call detection diagnostics</Text>
      <Text
        style={[
          styles.caption,
          { color: verdict.ok === false ? color.danger : verdict.ok ? color.text : color.textDim },
        ]}
      >
        {verdict.text}
      </Text>

      <Row label="Status ticks seen" color={color}>
        <Text style={[styles.value, { color: color.textDim }]}>{diag.ticks}</Text>
      </Row>
      <Row label="...while app was closed" color={color}>
        <Text style={[styles.value, { color: color.textDim }]}>{diag.backgroundTicks}</Text>
      </Row>
      <Row label="Last tick" color={color}>
        <Text style={[styles.value, { color: color.textDim }]}>{agoLabel(diag.lastTickAt, at)}</Text>
      </Row>
      <Row label="Longest gap between ticks" color={color}>
        <Text style={[styles.value, { color: color.textDim }]}>
          {diag.maxGapMs > 0 ? `${Math.round(diag.maxGapMs / 1000)}s` : '-'}
        </Text>
      </Row>

      {recent.length > 0 ? (
        <View style={styles.log}>
          {recent.map((e, i) => (
            <Text key={`${e.at}-${e.kind}-${i}`} style={[styles.caption, { color: color.textDim }]}>
              {eventLabel(e, at)}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={[styles.caption, { color: color.textDim }]}>No call events logged yet.</Text>
      )}

      <View style={styles.actions}>
        <Button label="Refresh" onPress={refresh} color={color} variant="outline" />
        <Button
          label="Reset"
          onPress={() => {
            void resetCallDiagnostics().then(refresh);
          }}
          color={color}
          variant="outline"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 12, gap: 4 },
  heading: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  caption: captionStyle,
  value: { fontSize: 14, fontVariant: ['tabular-nums'] },
  log: { marginTop: 8, gap: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
