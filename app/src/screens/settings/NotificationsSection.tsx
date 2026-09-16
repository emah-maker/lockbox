// NotificationsSection.tsx -- the settings hub's "Notifications" sheet: the
// global controls that sit ABOVE every individual reminder's own settings --
// a goal's (the goal form, GoalReminderControl.tsx) and a scheduled
// session's (the calendar, screens/calendar/SessionReminderForm.tsx). Both
// features read the same four prefs written here (see their respective
// planners, goalNotificationPlan.ts and schedule/sessionReminderPlan.ts), so
// the copy below is deliberately about "reminders", not about goals: a
// switch labelled for one of the two would silently silence the other.
//
// Three things, in the order a user actually needs them:
//   1. Permission status. A reminder that silently never arrives because
//      the OS permission was denied is indistinguishable from a broken app,
//      so this says so plainly and offers the prompt where one is still
//      possible. Read once on open and after a request -- never polled.
//   2. A master switch, so reminders can be silenced wholesale without
//      editing (or losing) any goal's -- or any planned session's -- own
//      reminder configuration.
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
import { ClockWheels } from '../../ui/ClockWheels';
import { WheelLockPhase } from '../../ui/WheelPicker';
import { formatClockTime } from '../../ui/time';
import { spacing } from '../../theme/tokens';

type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable' | 'checking';

// A quiet-hours boundary that hasn't been set yet reads as midnight, not as
// the 9am a reminder time defaults to -- the one thing the local parse() this
// file used to own did differently from the other two copies, and the reason
// ClockWheels takes `fallback` as a prop instead of hardcoding one.
const QUIET_HOURS_FALLBACK = '00:00';

/** One labelled time-of-day picker. Both quiet-hours boundaries need exactly
 * this, so it's a local component rather than the same JSX twice.
 *
 * The wheels themselves (and the 24h -> AM/PM change, and the wheel row's
 * touch/drag handoff with the enclosing Sheet) all live in ui/ClockWheels.tsx
 * now; what's left here is the label and the value plumbing. */
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
  onWheelActiveChange: (active: boolean, phase?: WheelLockPhase) => void;
  color: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.wheelBlock}>
      <Text style={[styles.label, { color: color.textDim }]}>
        {label}: {formatClockTime(value)}
      </Text>
      <ClockWheels
        value={value}
        onChange={onChange}
        onWheelActiveChange={onWheelActiveChange}
        accessibilityPrefix={label}
        fallback={QUIET_HOURS_FALLBACK}
      />
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
   * WheelPicker-inside-a-Sheet call site in this app uses. Implement it with
   * useWheelScrollLock (WheelPicker.tsx) so the `phase` is honored -- a
   * caller that ignores it re-enables its own scroll in the middle of any
   * drag longer than 600ms. */
  onWheelActiveChange: (active: boolean, phase?: WheelLockPhase) => void;
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
      subtitle="Global controls for every reminder -- goals and planned sessions keep their own times"
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

      <Row label="All reminders" color={color}>
        <Switch value={enabled} onValueChange={setEnabled} accessibilityLabel="All reminders" />
      </Row>
      {!enabled ? (
        // Says what the switch actually did, and to WHAT: nothing was
        // erased, and every goal's reminder times and every planned
        // session's lead time come back untouched when it's flipped on
        // again. Naming both is the point -- this switch reaches further
        // than its old "Goal reminders" label admitted.
        <Text style={[styles.caption, { color: color.textDim }]}>
          Goal reminders and planned-session reminders are both paused. Each one keeps its own times for when you turn
          this back on.
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
            No reminder is sent between {formatClockTime(quietStart)} and {formatClockTime(quietEnd)}. A reminder that falls inside
            this window is skipped, not moved -- the goal form and the schedule-a-session form each flag any of their
            own times that this affects.
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
});
