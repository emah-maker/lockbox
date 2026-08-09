// App.tsx -- entry point. Navigation is a trivial hand-rolled tab switcher (no
// react-navigation dependency) since four flat screens don't need a router:
// Dashboard, Stats, Calendar, Settings.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
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
    init();
  }, []);

  const Screen = SCREENS[tab];

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
                <Pressable key={t.key} style={styles.tabBtn} onPress={() => setTab(t.key)}>
                  <Feather name={t.icon} size={20} color={color} />
                  <Text style={{ color, fontWeight: active ? '700' : '500', marginTop: 2, fontSize: 12 }}>
                    {t.label}
                  </Text>
                </Pressable>
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
