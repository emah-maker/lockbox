// App.tsx -- entry point. Navigation is a trivial hand-rolled tab switcher (no
// react-navigation dependency) since four flat screens don't need a router:
// Dashboard, Stats, Calendar, Settings.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, LayoutAnimation } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import DashboardScreen from './src/screens/DashboardScreen';
import StatsScreen from './src/screens/StatsScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { useStore } from './src/store/useStore';
import { useSettingsStore } from './src/store/useSettingsStore';
import { useTheme } from './src/theme/useTheme';
import { isCallObserverAvailable } from './modules/call-observer';
import { getLaunchReason, onBackgroundWake } from './modules/background-wake';
import { useAuthStore } from './src/auth/useAuthStore';
import { startSettingsSyncBridge } from './src/sync/settingsSyncBridge';
import { startSessionsSyncBridge } from './src/sync/sessionsSyncBridge';
import { AnimatedPressable } from './src/ui/AnimatedPressable';

type Tab = 'dashboard' | 'stats' | 'calendar' | 'settings';

const TABS: { key: Tab; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
  { key: 'dashboard', label: 'Focus', icon: 'target' },
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
  const [tab, setTab] = useState<Tab>('dashboard');
  const init = useStore((s) => s.init);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = useTheme();

  useEffect(() => {
    // one-time capability log so a dev build surfaces missing native linkage
    // (Expo Go / Android will report false; a dev-client iOS build reports true)
    console.log('CallObserver available:', isCallObserverAvailable());
    console.log('Launch reason:', getLaunchReason());
    init();

    // Account sign-in/sync (docs/rfcs/google-signin-cross-device-sync-architecture.md
    // §2.5, §4.3, §6). useAuthStore.init() runs wipeStaleSessionOnFreshInstall()
    // then initializeAuth() (via initFirebaseAuth()), in that order, before
    // attaching the auth-state listener -- so this must be kicked off here,
    // as early as possible, and nothing else in this file should import
    // firebase/auth directly. Entirely additive: nothing else in the app
    // waits on this or is gated by it (§6.1 -- not a sign-in gate).
    useAuthStore.getState().init().catch(() => {
      // Non-fatal: sign-in/sync is additive (§6.1, not a gate) -- a failure
      // here (e.g. SecureStore unavailable) just means the account section
      // stays in its signed-out state; nothing else in the app depends on it.
    });
    startSettingsSyncBridge();
    startSessionsSyncBridge();

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

  const selectTab = (next: Tab) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTab(next);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Screen />
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.surface }}>
          <View style={styles.tabBar}>
            {TABS.map((t) => {
              const active = t.key === tab;
              const color = active ? theme.accent : theme.textDim;
              return (
                <AnimatedPressable key={t.key} style={styles.tabBtn} onPress={() => selectTab(t.key)}>
                  <Feather name={t.icon} size={20} color={color} />
                  <Text style={{ color, fontWeight: active ? '700' : '500', marginTop: 2, fontSize: 12 }}>
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
});
