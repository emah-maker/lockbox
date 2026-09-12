// SettingsScreen.tsx -- Settings hub. Used to be one long vertical stack of
// every control (account, app behaviors, box behaviors, appearance) in its
// own always-open card -- "scroll down less, screens just pop up" turned
// that into a short list of tappable category rows, each opening its full
// controls in a Sheet (src/ui/Sheet.tsx). The hub itself is meant to fit one
// screen with little or no scrolling; the heavy per-category content that
// used to live inline here now lives in src/screens/settings/*.tsx (Box
// behavior, Appearance, Alerts) or in the existing AccountSection/
// GoalsSection/CustomLabelsSection components, mounted unchanged inside
// their own sheet exactly the way AccountSection used to be mounted inside
// this file's old AccountModal (same "sheet body is c.bg, the mounted
// Section's own card still reads as a raised surface inside it" reasoning --
// see git history for that original comment).
//
// Goals and Custom labels used to live on StatsScreen instead of here (see
// GoalsSection.tsx/CustomLabelsSection.tsx's own header comments for why --
// that reasoning is unchanged, they're still computed from
// useStore.sessions). They're mounted here too now, unchanged, because
// Calendar/Stats deep-link into this hub's sheets via useNav's
// `settingsSection` intent rather than scrolling to an inline section.
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useAuthStore } from '../auth/useAuthStore';
import { useTheme } from '../theme/useTheme';
import { Sheet } from '../ui/Sheet';
import { useNav } from '../nav/useNav';
import { DisclosureRow } from './SettingsPrimitives';
import { AccountSection } from './AccountSection';
import { GoalsSection } from './GoalsSection';
import { CustomLabelsSection } from './CustomLabelsSection';
import { BoxBehaviorSection, boxBehaviorSummary } from './settings/BoxBehaviorSection';
import { AppearanceSection, appearanceSummary } from './settings/AppearanceSection';
import { AlertsSection, alertsSummary } from './settings/AlertsSection';
import { NotificationsSection, notificationsSummary } from './settings/NotificationsSection';
import { RingBaselineSection, ringBaselineSummary } from './settings/RingBaselineSection';
import { AboutSection, aboutSummary } from './settings/AboutSection';
import { typeScale, elevation, radius } from '../theme/tokens';
import { withAlpha } from '../theme/color';

type SheetKey =
  | 'account'
  | 'goals'
  | 'labels'
  | 'box'
  | 'appearance'
  | 'alerts'
  | 'notifications'
  | 'ringBaseline'
  | 'about';

export default function SettingsScreen() {
  const c = useTheme();
  const autoConnect = useStore((s) => s.autoConnect);
  const setAutoConnect = useStore((s) => s.setAutoConnect);
  const pushBoxSettings = useStore((s) => s.pushBoxSettings);
  const conn = useStore((s) => s.conn);
  const callDetectionAvailable = useStore((s) => s.callDetectionAvailable);
  const lastAlert = useStore((s) => s.lastAlert);

  const boxSettings = useSettingsStore((s) => s.boxSettings);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const accent = useSettingsStore((s) => s.accent);
  const setAccent = useSettingsStore((s) => s.setAccent);
  const callAlertsEnabled = useSettingsStore((s) => s.callAlertsEnabled);
  const setCallAlertsEnabled = useSettingsStore((s) => s.setCallAlertsEnabled);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const quietHoursEnabled = useSettingsStore((s) => s.quietHoursEnabled);
  const ringBaselineWindow = useSettingsStore((s) => s.ringBaselineWindow);
  const setRingBaselineWindow = useSettingsStore((s) => s.setRingBaselineWindow);
  const authUser = useAuthStore((s) => s.user);
  const goalCount = useGoalsStore((s) => s.goals.filter((g) => !g.archived).length);

  const [sheet, setSheet] = React.useState<SheetKey | null>(null);
  const closeSheet = () => setSheet(null);

  // GoalsSection's target/reminder wheels and NotificationsSection's
  // quiet-hours wheels are vertical scrollers -- same
  // ScrollView-surrenders-the-drag-to-the-wheel contract StatsScreen already
  // has for GoalsSection (see its own onWheelActiveChange comment), needed
  // again here since both sections are mounted inside this screen's own
  // sheets. One piece of state serves both: only one sheet is ever open.
  const [wheelActive, setWheelActive] = React.useState(false);
  const wheelSafetyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWheelActiveChange = (active: boolean) => {
    if (wheelSafetyTimer.current) {
      clearTimeout(wheelSafetyTimer.current);
      wheelSafetyTimer.current = null;
    }
    setWheelActive(active);
    if (active) {
      wheelSafetyTimer.current = setTimeout(() => setWheelActive(false), 600);
    }
  };
  // Bug fix: this timer used to outlive the screen -- switching tabs away
  // from Settings mid-drag (GoalsSection's target wheels, NotificationsSection's
  // quiet-hours wheels) left it armed, and it fired setWheelActive(false) on
  // an already-unmounted SettingsScreen 600ms later. Same cleanup StatsScreen
  // already has for its own identical wheelSafetyTimer -- this one was simply
  // missing it.
  React.useEffect(() => () => {
    if (wheelSafetyTimer.current) clearTimeout(wheelSafetyTimer.current);
  }, []);

  // Deep links (Stats/Calendar navigating here via useNav) land on a
  // specific sheet instead of a scroll position, since there's no longer a
  // fixed scroll offset per section to land on -- consumeIntent() both reads
  // and clears the pending intent, so this only ever fires once per
  // navigation, not on every re-render.
  React.useEffect(() => {
    const intent = useNav.getState().consumeIntent();
    if (intent?.settingsSection) setSheet(intent.settingsSection);
  }, []);

  const accountValue = authUser ? authUser.displayName ?? authUser.email ?? 'Signed in' : 'Not signed in';
  const goalsValue = goalCount === 0 ? 'None set' : `${goalCount} active`;
  const labelsValue = customLabels.length === 0 ? 'None yet' : `${customLabels.length} label${customLabels.length === 1 ? '' : 's'}`;
  const boxValue = boxBehaviorSummary(conn, boxSettings);
  const appearanceValue = appearanceSummary(themeMode, accent);
  const alertsValue = alertsSummary(callAlertsEnabled);
  const notificationsValue = notificationsSummary(notificationsEnabled, quietHoursEnabled);
  const ringBaselineValue = ringBaselineSummary(ringBaselineWindow);

  return (
    <>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.container}>
        <Text style={[styles.h1, { color: c.text }]}>Settings</Text>

        <View style={[styles.hubCard, { backgroundColor: c.surface }]}>
          <DisclosureRow
            label="Account"
            value={accountValue}
            onPress={() => setSheet('account')}
            color={c}
            icon={
              <Ionicons
                name={authUser ? 'person-circle' : 'person-circle-outline'}
                size={22}
                color={authUser ? c.accent : c.textDim}
              />
            }
          />
          <Divider color={c} />
          <DisclosureRow label="Goals" value={goalsValue} onPress={() => setSheet('goals')} color={c} />
          <Divider color={c} />
          <DisclosureRow label="Custom labels" value={labelsValue} onPress={() => setSheet('labels')} color={c} />
          <Divider color={c} />
          <DisclosureRow label="Box behavior" value={boxValue} onPress={() => setSheet('box')} color={c} />
          <Divider color={c} />
          <DisclosureRow label="Appearance" value={appearanceValue} onPress={() => setSheet('appearance')} color={c} />
          <Divider color={c} />
          <DisclosureRow label="Alerts" value={alertsValue} onPress={() => setSheet('alerts')} color={c} />
          <Divider color={c} />
          <DisclosureRow
            label="Notifications"
            value={notificationsValue}
            onPress={() => setSheet('notifications')}
            color={c}
          />
          <Divider color={c} />
          <DisclosureRow label="Focus ring" value={ringBaselineValue} onPress={() => setSheet('ringBaseline')} color={c} />
          <Divider color={c} />
          <DisclosureRow label="About" value={aboutSummary()} onPress={() => setSheet('about')} color={c} />
        </View>
      </ScrollView>

      {/* size="large" (was "auto") -- the Account page grew from one flat
          section into six (identity, sign-in methods, sync, account
          settings, data & privacy, danger zone); "auto"'s hug-content sizing
          left it either clipped or fighting its own ScrollView on shorter
          screens. */}
      <Sheet visible={sheet === 'account'} onClose={closeSheet} size="large">
        <AccountSection color={c} />
      </Sheet>

      {/* Sheet's own body already is a ScrollView (gated by its
          `scrollEnabled` prop) -- GoalsSection's H/M wheels need that outer
          scroll to yield mid-drag the same way DashboardScreen/StatsScreen's
          own ScrollView does for the identical component, so this passes
          `!wheelActive` straight through instead of nesting a second
          ScrollView inside Sheet's (which is what the pre-Sheet version of
          this file did, before Sheet grew this prop). */}
      <Sheet
        visible={sheet === 'goals'}
        onClose={closeSheet}
        size="large"
        scrollEnabled={!wheelActive}
        // GoalsSection's H/M wheels live in here; a body-drag dismiss would
        // capture their spin gesture before they ever saw it (Sheet.tsx).
        dragBodyToDismiss={false}
      >
        <GoalsSection color={c} onWheelActiveChange={onWheelActiveChange} />
      </Sheet>

      <Sheet visible={sheet === 'labels'} onClose={closeSheet} size="large">
        <CustomLabelsSection color={c} />
      </Sheet>

      <Sheet visible={sheet === 'box'} onClose={closeSheet} size="large">
        <BoxBehaviorSection color={c} conn={conn} boxSettings={boxSettings} pushBoxSettings={pushBoxSettings} />
      </Sheet>

      <Sheet visible={sheet === 'appearance'} onClose={closeSheet} size="auto">
        <AppearanceSection
          color={c}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          accent={accent}
          setAccent={setAccent}
          pushBoxSettings={pushBoxSettings}
        />
      </Sheet>

      <Sheet visible={sheet === 'alerts'} onClose={closeSheet} size="auto">
        <AlertsSection
          color={c}
          autoConnect={autoConnect}
          setAutoConnect={setAutoConnect}
          callAlertsEnabled={callAlertsEnabled}
          setCallAlertsEnabled={setCallAlertsEnabled}
          callDetectionAvailable={callDetectionAvailable}
          lastAlert={lastAlert}
        />
      </Sheet>

      {/* Its quiet-hours wheels are vertical scrollers inside this sheet's
          own scroller -- same `wheelActive` handoff the goals sheet above
          uses, for the identical reason. */}
      <Sheet
        visible={sheet === 'notifications'}
        onClose={closeSheet}
        size="large"
        scrollEnabled={!wheelActive}
        // Quiet-hours wheels, same as the goals sheet above.
        dragBodyToDismiss={false}
      >
        <NotificationsSection color={c} onWheelActiveChange={onWheelActiveChange} />
      </Sheet>

      <Sheet visible={sheet === 'about'} onClose={closeSheet} size="auto">
        <AboutSection color={c} />
      </Sheet>

      <Sheet visible={sheet === 'ringBaseline'} onClose={closeSheet} size="auto">
        <RingBaselineSection
          color={c}
          ringBaselineWindow={ringBaselineWindow}
          setRingBaselineWindow={setRingBaselineWindow}
        />
      </Sheet>
    </>
  );
}

// Hairline row separator inside the hub card -- withAlpha(textDim, 0.15)
// rather than a flat gray so it stays readable (if faint) in both themes,
// same alpha-over-theme-color approach as SliderRow's track background.
function Divider({ color }: { color: ReturnType<typeof useTheme> }) {
  return <View style={[styles.divider, { backgroundColor: withAlpha(color.textDim, 0.15) }]} />;
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 16 },
  h1: { ...typeScale.title, marginBottom: 4 },
  hubCard: { borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 4, ...elevation.card },
  divider: { height: 1 },
});
