// useSettingsStore.ts -- pure local preferences: theme, the call-alert
// toggle, and the box-settings mirror (protocol.ts Settings). These load once
// via hydrate() (called from useStore.init) and persist through storage.ts.
// useStore is the only thing that talks to the box over BLE; it calls
// setBoxSettings() after a read/write so this mirror stays in sync (see
// useStore.ts afterConnected / pushBoxSettings).
import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/storage';
import { ThemeMode, AccentKey } from '../theme/theme';
import type { Settings } from '../ble/protocol';

// Mirrors the firmware's own defaults (Box-code/lib/lock_config.py /
// lock_settings.py) so the Settings screen shows sane values before the
// first successful connection.
const DEFAULT_BOX_SETTINGS: Settings = { ovr: 25, auto: 1, sleep: 20, bright: 50, unlk: 0, ucal: 0 };

interface SettingsState {
  hydrated: boolean;
  themeMode: ThemeMode;
  accent: AccentKey;
  callAlertsEnabled: boolean;
  advancedStatsEnabled: boolean;
  boxSettings: Settings;

  hydrate: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentKey) => void;
  setCallAlertsEnabled: (on: boolean) => void;
  setAdvancedStatsEnabled: (on: boolean) => void;
  setBoxSettings: (patch: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  hydrated: false,
  themeMode: 'dark',
  accent: 'mint',
  callAlertsEnabled: true,
  advancedStatsEnabled: false,
  boxSettings: DEFAULT_BOX_SETTINGS,

  hydrate: async () => {
    if (get().hydrated) return;
    const [themeMode, accent, callAlertsEnabled, advancedStatsEnabled, boxSettings] = await Promise.all([
      getJSON<ThemeMode>('themeMode', 'dark'),
      getJSON<AccentKey>('accent', 'mint'),
      getJSON<boolean>('callAlertsEnabled', true),
      getJSON<boolean>('advancedStatsEnabled', false),
      getJSON<Settings>('boxSettings', DEFAULT_BOX_SETTINGS),
    ]);
    set({ hydrated: true, themeMode, accent, callAlertsEnabled, advancedStatsEnabled, boxSettings });
  },

  setThemeMode: (mode) => {
    set({ themeMode: mode });
    setJSON('themeMode', mode);
  },

  setAccent: (accent) => {
    set({ accent });
    setJSON('accent', accent);
  },

  setCallAlertsEnabled: (on) => {
    set({ callAlertsEnabled: on });
    setJSON('callAlertsEnabled', on);
  },

  setAdvancedStatsEnabled: (on) => {
    set({ advancedStatsEnabled: on });
    setJSON('advancedStatsEnabled', on);
  },

  setBoxSettings: (patch) => {
    const next = { ...get().boxSettings, ...patch };
    set({ boxSettings: next });
    setJSON('boxSettings', next);
  },
}));
