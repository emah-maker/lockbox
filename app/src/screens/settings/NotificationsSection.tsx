// NotificationsSection.tsx -- the settings hub's "Notifications" sheet: the
// global controls that sit ABOVE every individual goal's own reminder
// settings (which live in the goal form, GoalReminderControl.tsx).
//
// Three things, in the order a user actually needs them:
//   1. Permission status. A reminder that silently never arrives because
//      the OS permission was denied is indistinguishable from a broken app,
//      so this says so plainly and offers the prompt where one is still
//      possible. Read once on open and after a request -- never polled.
//   2. A master switch, so reminders can be silenced wholesale without
//      editing (or losing) any goal's own reminder configuration.
//   3. Quiet hours, a window in which no reminder is sent at all.
//
// Reads its own store slice rather than taking props (same shape
// RingBaselineSection.tsx uses, and for the same reason: SettingsScreen
// would otherwise thread six more prop pairs through for one sheet). The
// prefs themselves are per-device and deliberately not account-synced --
// see useSettingsStore's own field comments.
import React from 'react';
import { View, Text, StyleSheet, Switch, Linking } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getGoalNotificationPermission, requestGoalNotificationPermission } from '../../goals/goalNotifications';
import { Section, Row, rowLabelStyle, captionStyle, Button } from '../SettingsPrimitives';
import { WheelPicker } from '../../ui/WheelPicker';
import { typeScale, spacing } from '../../theme/tokens';

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
// Quiet-hours boundaries snap to the same 5-minute grid every other minute
// wheel in this app uses (the Dashboard's lock duration, a goal's target, a
// reminder time), so the app never has two different minute conventions.
const MINUTE_VALUES = Array.from({ length: 12 }, (_, i) => i * 5);
const MINUTE_LABELS = MINUTE_VALUES.map((m) => String(m).padStart(2, '0'));

type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable' | 'checking';

function parse(value: string): { hour: number; minuteIndex: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  const hour = m ? Math.min(23, parseInt(m[1], 10)) : 0;
  const minute = m ? parseInt(m[2], 10) : 0;
  const minuteIndex = MINUTE_VALUES.reduce(
    (best, v, i) => (Math.abs(v - minute) < Math.abs(MINUTE_VALUES[best] - minute) ? i : best),
    0,
  );
  return { hour, minuteIndex };
}

function format(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 'HH:MM' rendered in the device's own 12h/24h preference -- same helper
 * shape (and reason) as GoalRow.tsx's and GoalReminderControl.tsx's. */
function display(value: string): string {
  const [h, m] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** One labelled hour+minute wheel pair. Both quiet-hours boundaries need
 * exactly this, so it's a local component rather than the same JSX twice. */
function TimeWheels({
  label,
  value,
  onChange,
  onWheelActiveChange,
  color,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onWheelActiveChange: (active: boolean) => void;
  color: ReturnType<typeof useTheme>;
}) {
  const { hour, minuteIndex } = parse(value);
  return (
    <View style={styles.wheelBlock}>
      <Text style={[styles.label, { color: color.textDim }]}>
        {label}: {display(value)}
      </Text>
      <View
        style={styles.wheelRow}
        onTouchStart={() => onWheelActiveChange(true)}
        onTouchEnd={() => onWheelActiveChange(false)}
        onTouchCancel={() => onWheelActiveChange(false)}
      >
        <WheelPicker
          labels={HOUR_LABELS}
          selectedIndex={hour}
          onChange={(i) => onChange(format(i, MINUTE_VALUES[minuteIndex]))}
          onDragStart={() => onWheelActiveChange(true)}
          onDragEnd={() => onWheelActiveChange(false)}
          accessibilityLabel={`${label}, hour`}
        />
        <WheelPicker
          labels={MINUTE_LABELS}
          selectedIndex={minuteIndex}
          onChange={(i) => onChange(format(hour, MINUTE_VALUES[i]))}
          onDragStart={() => onWheelActiveChange(true)}
          onDragEnd={() => onWheelActiveChange(false)}
          accessibilityLabel={`${label}, minute`}
        />
      </View>
    </View>
  );
}

export function NotificationsSection({
  color,
  onWheelActiveChange,
}: {
  color: ReturnType<typeof useTheme>;
  /** Forwarded to the enclosing Sheet's `scrollEnabled`, the same "outer
   * scroll yields to an inner wheel drag" contract every other
   * WheelPicker-inside-a-Sheet call site in this app uses. */
  onWheelActiveChange: (active: boolean) => void;
}) {
  const enabled = useSettingsStore((s) => s.notificationsEnabled);
  const setEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const quietOn = useSettingsStore((s) => s.quietHoursEnabled);
  const setQuietOn = useSettingsStore((s) => s.setQuietHoursEnabled);
  const quietStart = useSettingsStore((s) => s.quietStart);
  const quietEnd = useSettingsStore((s) => s.quietEnd);
  const setQuietHours = useSettingsStore((s) => s.setQuietHours);

  const [permission, setPermission] = React.useState<PermissionState>('checking');

  // Checked once on mount, not polled: the only ways this changes are the
  // in-app request below (which updates it directly) and a trip to the OS
  // settings app, after which this sheet is re-mounted anyway.
  React.useEffect(() => {
    let alive = true;
    getGoalNotificationPermission().then((p) => {
      if (alive) setPermission(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  const askPermission = async () => {
    const granted = await requestGoalNotificationPermission();
    setPermission(granted ? 'granted' : 'denied');
  };

  return (
    <Section
      title="Notifications"
      subtitle="Global controls for goal reminders -- each goal still has its own times"
      color={color}
    >
      {permission === 'denied' ? (
        <>
          <Text style={[styles.caption, { color: color.danger }]}>
            Notifications are turned off for Phone Box in your system settings, so no reminder can be delivered.
          </Text>
          <Button label="Open system settings" variant="outline" onPress={() => Linking.openSettings()} color={color} />
        </>
      ) : null}
      {permission === 'undetermined' ? (
        <>
          <Text style={[styles.caption, { color: color.textDim }]}>
            Phone Box hasn't been allowed to send notifications yet.
          </Text>
          <Button label="Allow notifications" onPress={askPermission} color={color} />
        </>
      ) : null}
      {permission === 'unavailable' ? (
        <Text style={[styles.caption, { color: color.textDim }]}>
          This build can't send notifications -- reminders need a dev-client build, not Expo Go.
        </Text>
      ) : null}

      <Row label="Goal reminders" color={color}>
        <Switch value={enabled} onValueChange={setEnabled} accessibilityLabel="Goal reminders" />
      </Row>
      {!enabled ? (
        // Says what the switch actually did: nothing was erased, and every
        // goal's own reminder times come back untouched when it's flipped
        // on again.
        <Text style={[styles.caption, { color: color.textDim }]}>
          All goal reminders are paused. Each goal keeps its own reminder times for when you turn this back on.
        </Text>
      ) : null}

      <Row label="Quiet hours" color={color}>
        <Switch
          value={quietOn}
          onValueChange={setQuietOn}
          disabled={!enabled}
          accessibilityLabel="Quiet hours"
        />
      </Row>
      {enabled && quietOn ? (
        <>
          <Text style={[styles.caption, { color: color.textDim }]}>
            No reminder is sent between {display(quietStart)} and {display(quietEnd)}. A reminder that falls inside
            this window is skipped, not moved -- the goal form flags any of its times that this affects.
          </Text>
          <TimeWheels
            label="From"
            value={quietStart}
            onChange={(next) => setQuietHours(next, quietEnd)}
            onWheelActiveChange={onWheelActiveChange}
            color={color}
          />
          <TimeWheels
            label="Until"
            value={quietEnd}
            onChange={(next) => setQuietHours(quietStart, next)}
            onWheelActiveChange={onWheelActiveChange}
            color={color}
          />
          {quietStart === quietEnd ? (
            <Text style={[styles.caption, { color: color.danger }]}>
              Start and end are the same, so quiet hours currently do nothing. Set them apart to silence a real
              window.
            </Text>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}

/** One-line hub summary for the Notifications row. */
export function notificationsSummary(enabled: boolean, quietOn: boolean): string {
  if (!enabled) return 'Paused';
  return quietOn ? 'On, quiet hours set' : 'On';
}

const styles = StyleSheet.create({
  label: rowLabelStyle,
  caption: captionStyle,
  wheelBlock: { gap: spacing.xs, marginTop: spacing.xs },
  wheelRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
});
