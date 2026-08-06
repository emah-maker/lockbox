// App.tsx -- entry point. Navigation is a trivial hand-rolled tab switcher (no
// react-navigation dependency) since three flat screens don't need a router:
// Dashboard, Calendar, Settings.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import DashboardScreen from './src/screens/DashboardScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { useStore } from './src/store/useStore';
import { useSettingsStore } from './src/store/useSettingsStore';
import { useTheme } from './src/theme/useTheme';
import { isCallObserverAvailable } from './modules/call-observer';

type Tab = 'dashboard' | 'calendar' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Focus' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'settings', label: 'Settings' },
];

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

  const Screen = tab === 'dashboard' ? DashboardScreen : tab === 'calendar' ? CalendarScreen : SettingsScreen;

  return (
    <SafeAreaProvider>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Screen />
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.surface }}>
          <View style={styles.tabBar}>
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <Pressable key={t.key} style={styles.tabBtn} onPress={() => setTab(t.key)}>
                  <Text style={{ color: active ? theme.accent : theme.textDim, fontWeight: active ? '700' : '500' }}>
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
