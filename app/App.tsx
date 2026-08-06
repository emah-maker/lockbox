// App.tsx -- entry point. Single-screen MVP (the dashboard). Navigation is kept
// trivial on purpose; add screens (settings mirror, pairing, schedule) as the
// roadmap progresses.
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import DashboardScreen from './src/screens/DashboardScreen';
import { isCallObserverAvailable } from './modules/call-observer';

export default function App() {
  useEffect(() => {
    // one-time capability log so a dev build surfaces missing native linkage
    // (Expo Go / Android will report false; a dev-client iOS build reports true)
    console.log('CallObserver available:', isCallObserverAvailable());
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <DashboardScreen />
    </SafeAreaProvider>
  );
}
