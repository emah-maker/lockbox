// App.tsx -- entry point. Navigation is a trivial hand-rolled tab switcher (no
// react-navigation dependency) since four flat screens don't need a router:
// Dashboard, Stats, Calendar, Settings. The active tab itself now lives in
// useNav.ts (not local useState) so a screen/sheet on one tab can switch to
// another and hand it a bit of context to act on -- see useNav's own header
// comment.
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import DashboardScreen from './src/screens/DashboardScreen';
import StatsScreen from './src/screens/StatsScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { useStore } from './src/store/useStore';
import { useSettingsStore } from './src/store/useSettingsStore';
import { useGoalsStore } from './src/store/useGoalsStore';
import { useTheme } from './src/theme/useTheme';
import { isCallObserverAvailable } from './modules/call-observer';
import { getLaunchReason, onBackgroundWake } from './modules/background-wake';
import { useAuthStore } from './src/auth/useAuthStore';
import { startSettingsSyncBridge } from './src/sync/settingsSyncBridge';
import { startSessionsSyncBridge } from './src/sync/sessionsSyncBridge';
import { startGoalsSyncBridge } from './src/sync/goalsSyncBridge';
import { useBatteryStore } from './src/battery/useBatteryStore';
import { startBatterySampling } from './src/battery/batterySamplingBridge';
import { ensureNotificationSetup } from './src/goals/goalNotifications';
import { startGoalNotificationBridge } from './src/goals/goalNotificationWatch';
import { AnimatedPressable } from './src/ui/AnimatedPressable';
import { StatusStrip } from './src/ui/StatusStrip';
import { useReducedMotion, configureLayoutAnimation } from './src/ui/useReducedMotion';
import { typeScale } from './src/theme/tokens';
import { useNav, Tab } from './src/nav/useNav';

const TABS: { key: Tab; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
  { key: 'dashboard', label: 'Home', icon: 'home' },
  { key: 'stats', label: 'Stats', icon: 'bar-chart-2' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

const SCREENS: Record<Tab, React.ComponentType> = {
  dashboard: DashboardScreen,
  stats: StatsScreen,
  calendar: CalendarScreen,
  settings: SettingsScreen,
};

export default function App() {
  const tab = useNav((s) => s.tab);
  const setTab = useNav((s) => s.setTab);
  const init = useStore((s) => s.init);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = useTheme();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    // one-time capability log so a dev build surfaces missing native linkage
    // (Expo Go / Android will report false; a dev-client iOS build reports
    // true) -- gated behind __DEV__ so these don't ship as production log
    // output (production readiness review, Low).
    if (__DEV__) {
      console.log('CallObserver available:', isCallObserverAvailable());
      console.log('Launch reason:', getLaunchReason());
    }
    init();
    // Focus-goals persistence has no BLE/box relationship (unlike
    // useSettingsStore's hydrate, which rides inside useStore.init()'s own
    // Promise.all above because boxSettings does) -- hydrated directly here
    // instead. Fire-and-forget, same as init() itself just above: nothing in
    // this file awaits either, and hydrate() itself no-ops past its first
    // call, so a re-render can't double-hydrate.
    useGoalsStore.getState().hydrate();
    // Battery sample log (task 2): hydrate the persisted log, then start the
    // BLE-status subscription that feeds it -- same "hydrate, then start the
    // bridge that writes to it" ordering as useSettingsStore/useGoalsStore's
    // own hydrate() calls above and startSettingsSyncBridge() below. Both
    // StatusStrip and Home's BatteryBadge now read this same shared store
    // instead of StatusStrip privately recording its own copy.
    useBatteryStore.getState().hydrate();
    startBatterySampling();

    // Account sign-in/sync (docs/rfcs/google-signin-cross-device-sync-architecture.md
    // §2.5, §4.3, §6). useAuthStore.init() runs wipeStaleSessionOnFreshInstall()
    // then initializeAuth() (via initFirebaseAuth()), in that order, before
    // attaching the auth-state listener -- so this must be kicked off here,
    // as early as possible, and nothing else in this file should import
    // firebase/auth directly. Entirely additive: nothing else in the app
    // waits on this or is gated by it (§6.1 -- not a sign-in gate).
    useAuthStore.getState().init().catch((e) => {
      // Non-fatal: sign-in/sync is additive (§6.1, not a gate) -- a failure
      // here (e.g. SecureStore unavailable) just means the account section
      // stays in its signed-out state; nothing else in the app depends on it.
      // init() handles its own failures now (it surfaces initError and leaves
      // the sign-in buttons operable so they can retry), so reaching this is
      // itself unexpected -- log it rather than swallowing it silently, which
      // is how a dead sign-in button came to have no diagnostic at all.
      console.warn('[App] useAuthStore.init() rejected:', e?.message ?? e);
    });
    startSettingsSyncBridge();
    startSessionsSyncBridge();
    startGoalsSyncBridge();

    // Goal reminders. ensureNotificationSetup() registers the foreground
    // presentation handler and the Android channel -- WITHOUT it a scheduled
    // reminder fires and is silently discarded, which is why per-goal
    // reminders appeared to do nothing at all. Called here (not only from
    // the scheduler) so a reminder arriving before the first goal mutation
    // of the session is still presentable. startGoalNotificationBridge()
    // then keeps the scheduled set in step with logged sessions and the
    // global notification prefs -- see that module's header for why goal
    // mutations alone are no longer a sufficient trigger.
    void ensureNotificationSetup();
    startGoalNotificationBridge();

    // Foundation module (app/modules/background-wake) fires this once, early,
    // on any cold launch the OS performed for a background reason --
    // regardless of which feature caused it (RFC §3.3). Feature B's use of
    // it: a 'ble-restoration' wake is also an opportunistic chance to drain
    // the box's pending session history before the process idles back to
    // background. useStore.connect() is reused verbatim (RFC §5.1) -- it
    // already no-ops if a connection is idle/connecting/connected, and its
    // existing connectById() -> handleHistory() path is exactly the drain
    // path this needs; no separate headless entry point required. A
    // 'voip-push' reason is left unhandled here -- that's Feature A's wake
    // reason, not implemented in this task.
    const sub = onBackgroundWake((reason) => {
      if (reason === 'ble-restoration') {
        useStore.getState().connect();
      }
    });
    return () => sub.remove();
  }, []);

  const Screen = SCREENS[tab];

  // Same configureLayoutAnimation-on-tab-change this app always had, just no
  // longer tied to the bottom tab bar's own tap handler: now that `tab`
  // lives in useNav (siblings call navigate() directly from Calendar/Stats/
  // Settings/Home to cross-link), a switch that arrives that way needs the
  // same animated transition a bar tap gets. Skipped on the very first
  // render -- there's no prior screen to animate away from at mount.
  const isFirstTabRender = useRef(true);
  useEffect(() => {
    if (isFirstTabRender.current) {
      isFirstTabRender.current = false;
      return;
    }
    configureLayoutAnimation(reducedMotion);
  }, [tab]);

  const selectTab = (next: Tab) => setTab(next);

  return (
    <SafeAreaProvider>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaView edges={['top']} style={{ backgroundColor: theme.surface }}>
          <StatusStrip />
        </SafeAreaView>
        <Screen />
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.surface }}>
          <View style={styles.tabBar}>
            {TABS.map((t) => {
              const active = t.key === tab;
              const color = active ? theme.accent : theme.textDim;
              return (
                <AnimatedPressable
                  key={t.key}
                  style={styles.tabBtn}
                  onPress={() => selectTab(t.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t.label}
                >
                  <Feather name={t.icon} size={20} color={color} />
                  <Text style={[styles.tabLabel, { color, fontWeight: active ? '700' : '500' }]}>
                    {t.label}
                  </Text>
                </AnimatedPressable>
              );
            })}
          </View>
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(127,127,127,0.2)',
  },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { ...typeScale.caption, marginTop: 2 },
});
