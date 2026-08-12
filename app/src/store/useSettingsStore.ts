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
import { CustomLabel, createCustomLabel, renameCustomLabel as renameCustomLabelIn, deleteCustomLabel as deleteCustomLabelIn } from '../stats/customLabels';

// Mirrors the firmware's own defaults (Box-code/lib/lock_config.py /
// lock_settings.py) so the Settings screen shows sane values before the
// first successful connection.
const DEFAULT_BOX_SETTINGS: Settings = { ovr: 25, auto: 1, sleep: 20, bright: 50, unlk: 0, ucal: 0, thm: 0, acc: 0 };

// The account-syncable fields, per
// docs/rfcs/google-signin-cross-device-sync-architecture.md §3.1/§4.2 --
// cross-device last-write-wins settings, distinct from boxSettings (the
// per-physical-box BLE mirror, which is never account state -- see §3.1's
// "deliberate scoping decision"). customLabels joined this set so a user's
// custom focus-label catalog follows them to a new device the same way
// their theme/accent/toggles already do.
export interface SyncableSettings {
  themeMode: ThemeMode;
  accent: AccentKey;
  callAlertsEnabled: boolean;
  customLabels: CustomLabel[];
}

interface SettingsState {
  hydrated: boolean;
  themeMode: ThemeMode;
  accent: AccentKey;
  callAlertsEnabled: boolean;
  customLabels: CustomLabel[];
  boxSettings: Settings;
  // Epoch ms of the last local change to any of the SyncableSettings
  // fields -- compared against Firestore's settings/app.updatedAt for the
  // two-way last-write-wins merge (sync/firestoreSync.ts).
  settingsUpdatedAt: number;

  hydrate: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentKey) => void;
  setCallAlertsEnabled: (on: boolean) => void;
  setBoxSettings: (patch: Partial<Settings>) => void;
  addCustomLabel: (name: string, color: string) => void;
  renameCustomLabel: (id: string, name: string) => void;
  removeCustomLabel: (id: string) => void;
  /** Applied when a remote Firestore settings/app doc is newer than the
   * local copy (LWW pull) -- does not itself trigger a remote push.
   * `updatedAt` is the remote doc's own timestamp, preserved as-is so a
   * later comparison against another device's copy stays correct. */
  applyRemoteSettings: (remote: SyncableSettings, updatedAt: number) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  hydrated: false,
  themeMode: 'dark',
  accent: 'mint',
  callAlertsEnabled: true,
  customLabels: [],
  boxSettings: DEFAULT_BOX_SETTINGS,
  settingsUpdatedAt: 0,

  hydrate: async () => {
    if (get().hydrated) return;
    const [themeMode, accent, callAlertsEnabled, customLabels, boxSettings, settingsUpdatedAt] =
      await Promise.all([
        getJSON<ThemeMode>('themeMode', 'dark'),
        getJSON<AccentKey>('accent', 'mint'),
        getJSON<boolean>('callAlertsEnabled', true),
        getJSON<CustomLabel[]>('customLabels', []),
        getJSON<Settings>('boxSettings', DEFAULT_BOX_SETTINGS),
        getJSON<number>('settingsUpdatedAt', 0),
      ]);
    set({
      hydrated: true,
      themeMode,
      accent,
      callAlertsEnabled,
      customLabels,
      boxSettings,
      settingsUpdatedAt,
    });
  },

  setThemeMode: (mode) => {
    const settingsUpdatedAt = Date.now();
    set({ themeMode: mode, settingsUpdatedAt });
    setJSON('themeMode', mode);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  setAccent: (accent) => {
    const settingsUpdatedAt = Date.now();
    set({ accent, settingsUpdatedAt });
    setJSON('accent', accent);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  setCallAlertsEnabled: (on) => {
    const settingsUpdatedAt = Date.now();
    set({ callAlertsEnabled: on, settingsUpdatedAt });
    setJSON('callAlertsEnabled', on);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  setBoxSettings: (patch) => {
    // Deliberately not part of settingsUpdatedAt/sync -- boxSettings is the
    // per-physical-box BLE mirror, not account-level state (§3.1).
    const next = { ...get().boxSettings, ...patch };
    set({ boxSettings: next });
    setJSON('boxSettings', next);
  },

  addCustomLabel: (name, color) => {
    const customLabels = createCustomLabel(get().customLabels, name, color);
    const settingsUpdatedAt = Date.now();
    set({ customLabels, settingsUpdatedAt });
    setJSON('customLabels', customLabels);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  renameCustomLabel: (id, name) => {
    const customLabels = renameCustomLabelIn(get().customLabels, id, name);
    const settingsUpdatedAt = Date.now();
    set({ customLabels, settingsUpdatedAt });
    setJSON('customLabels', customLabels);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  removeCustomLabel: (id) => {
    const customLabels = deleteCustomLabelIn(get().customLabels, id);
    const settingsUpdatedAt = Date.now();
    set({ customLabels, settingsUpdatedAt });
    setJSON('customLabels', customLabels);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  applyRemoteSettings: (remote, updatedAt) => {
    set({ ...remote, settingsUpdatedAt: updatedAt });
    setJSON('themeMode', remote.themeMode);
    setJSON('accent', remote.accent);
    setJSON('callAlertsEnabled', remote.callAlertsEnabled);
    setJSON('customLabels', remote.customLabels);
    setJSON('settingsUpdatedAt', updatedAt);
  },
}));
