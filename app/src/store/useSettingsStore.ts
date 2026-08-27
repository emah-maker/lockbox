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
const DEFAULT_BOX_SETTINGS: Settings = { ovr: 25, auto: 1, sleep: 20, bright: 50, unlk: 0, ucal: 0, thm: 0, acc: 0, flip: 0, langle: 45, uangle: 0 };

// Defaults for the four account-syncable fields -- what a signed-out device
// (or a brand-new account) should show, and what sync/localDataOwner.ts
// resets local storage to on sign-out/account-switch so no prior account's
// preferences linger on the device.
const SYNCABLE_SETTINGS_DEFAULTS: SyncableSettings = {
  themeMode: 'dark',
  accent: 'mint',
  callAlertsEnabled: true,
  customLabels: [],
};

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
  // Local-only per-device preference (Account page §3): whether
  // useAuthStore.init's onAuthStateChanged handler should auto-trigger
  // syncNow() on sign-in/auth-state change. Deliberately NOT a
  // SyncableSettings field and NOT touched by resetSyncableSettings below --
  // unlike themeMode/accent/etc. (which represent "what the user wants
  // right now" and should follow them to every device), whether THIS device
  // should auto-sync is closer in nature to boxSettings' per-physical-device
  // scoping (§3.1's "deliberate scoping decision", extended here to a
  // per-installation UI preference rather than a per-box one): switching or
  // signing out of an account on this device must not silently flip a
  // preference the user set for this device back to its default. The
  // manual "Sync now" button is never gated by this -- see useAuthStore.
  autoSyncEnabled: boolean;

  hydrate: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentKey) => void;
  setCallAlertsEnabled: (on: boolean) => void;
  setBoxSettings: (patch: Partial<Settings>) => void;
  setAutoSyncEnabled: (on: boolean) => void;
  addCustomLabel: (name: string, color: string) => void;
  renameCustomLabel: (id: string, name: string) => void;
  removeCustomLabel: (id: string) => void;
  /** Applied when a remote Firestore settings/app doc is newer than the
   * local copy (LWW pull) -- does not itself trigger a remote push.
   * `updatedAt` is the remote doc's own timestamp, preserved as-is so a
   * later comparison against another device's copy stays correct. */
  applyRemoteSettings: (remote: SyncableSettings, updatedAt: number) => void;
  /** Resets the four account-syncable fields to their defaults and zeroes
   * settingsUpdatedAt, so a signed-out device carries no prior account's
   * preferences into whichever account (or none) signs in next -- see
   * sync/localDataOwner.ts. Leaves boxSettings, autoSyncEnabled, and
   * hydrated untouched -- autoSyncEnabled is a per-device preference, not
   * account state (see its own field comment above), so a sign-out/
   * account-switch on this device must not silently re-enable (or disable)
   * it against the user's own choice for this installation. */
  resetSyncableSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  hydrated: false,
  ...SYNCABLE_SETTINGS_DEFAULTS,
  boxSettings: DEFAULT_BOX_SETTINGS,
  settingsUpdatedAt: 0,
  autoSyncEnabled: true,

  hydrate: async () => {
    if (get().hydrated) return;
    const [themeMode, accent, callAlertsEnabled, customLabels, boxSettings, settingsUpdatedAt, autoSyncEnabled] =
      await Promise.all([
        getJSON<ThemeMode>('themeMode', SYNCABLE_SETTINGS_DEFAULTS.themeMode),
        getJSON<AccentKey>('accent', SYNCABLE_SETTINGS_DEFAULTS.accent),
        getJSON<boolean>('callAlertsEnabled', SYNCABLE_SETTINGS_DEFAULTS.callAlertsEnabled),
        getJSON<CustomLabel[]>('customLabels', SYNCABLE_SETTINGS_DEFAULTS.customLabels),
        getJSON<Settings>('boxSettings', DEFAULT_BOX_SETTINGS),
        getJSON<number>('settingsUpdatedAt', 0),
        getJSON<boolean>('autoSyncEnabled', true),
      ]);
    set({
      hydrated: true,
      themeMode,
      accent,
      callAlertsEnabled,
      customLabels,
      boxSettings,
      settingsUpdatedAt,
      autoSyncEnabled,
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

  setAutoSyncEnabled: (on) => {
    // Deliberately not part of settingsUpdatedAt/sync, same reasoning as
    // setBoxSettings above -- see this field's own interface comment.
    set({ autoSyncEnabled: on });
    setJSON('autoSyncEnabled', on);
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

  resetSyncableSettings: () => {
    set({ ...SYNCABLE_SETTINGS_DEFAULTS, settingsUpdatedAt: 0 });
    setJSON('themeMode', SYNCABLE_SETTINGS_DEFAULTS.themeMode);
    setJSON('accent', SYNCABLE_SETTINGS_DEFAULTS.accent);
    setJSON('callAlertsEnabled', SYNCABLE_SETTINGS_DEFAULTS.callAlertsEnabled);
    setJSON('customLabels', SYNCABLE_SETTINGS_DEFAULTS.customLabels);
    setJSON('settingsUpdatedAt', 0);
  },
}));
