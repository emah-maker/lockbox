// settingsSyncBridge.test.ts -- which useSettingsStore changes reach
// Firestore, and which must not.
//
// The "must not" half is the whole reason this file exists, and it is the
// same class of hazard scheduledSessionsSyncBridge.test.ts documents for
// plans. pushSettingsPatch is an unconditional whole-document setDoc of
// whatever the store currently holds, so any emission this bridge mistakes
// for a user edit does not merely waste a write -- it overwrites the
// account's real cloud settings with whatever happens to be in memory.
//
// The case that made that concrete: signing in runs
// sync/localDataOwner.ts's clearLocalAccountData, which resets the five
// syncable fields to their defaults and zeroes the doc clock so a previous
// (or no) account's preferences can't blend into the one signing in. It runs
// while ALREADY authenticated as the new uid, and zustand notifies
// synchronously -- so that wipe arrived here as an ordinary change and
// pushed `{...defaults, updatedAt: 0}` over settings the account may have
// held for months, before firestoreSync's own two-way merge had read a
// single byte of the server's copy. Both sides then agreed on the defaults
// and there was nothing left to restore them from.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setJSON } from '../storage/storage';
import { pushSettingsPatch } from './firestoreSync';
import { useSettingsStore } from '../store/useSettingsStore';
import { SYNCABLE_SETTINGS_DEFAULTS } from '../store/settingsPersistence';
import { startSettingsSyncBridge } from './settingsSyncBridge';

jest.mock('./firestoreSync', () => ({ pushSettingsPatch: jest.fn(async () => {}) }));

// syncCommon's isSignedIn() is this bridge's own early-out, and every
// scenario below is about a device that HAS an account to push to -- which
// is exactly what makes the wipe dangerous rather than harmless.
jest.mock('../auth/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: (globalThis as any).__signedIn ? { uid: 'uid-a' } : null }),
}));

const pushMock = pushSettingsPatch as jest.MockedFunction<typeof pushSettingsPatch>;

beforeEach(async () => {
  await AsyncStorage.clear();
  (globalThis as any).__signedIn = true;
  // Back to a freshly-installed, never-synced device. This itself emits, so
  // the mock is cleared afterwards rather than before.
  useSettingsStore.setState({ ...SYNCABLE_SETTINGS_DEFAULTS, settingsUpdatedAt: 0, localWrites: 0 });
  jest.clearAllMocks();
  startSettingsSyncBridge(); // idempotent; the first test starts it
});

describe('what gets pushed', () => {
  it('pushes a theme change', () => {
    useSettingsStore.getState().setThemeMode('light');
    expect(pushMock).toHaveBeenCalled();
  });

  it('pushes a new custom label', () => {
    useSettingsStore.getState().addCustomLabel('Thesis', '#ff0000');
    expect(pushMock).toHaveBeenCalled();
  });

  it('pushes a topic exclusion', () => {
    useSettingsStore.getState().setTopicKeyExcluded('study', true);
    expect(pushMock).toHaveBeenCalled();
  });

  it('does not push a device-local preference', () => {
    // boxSettings is the per-physical-box BLE mirror and autoSyncEnabled is a
    // per-installation choice -- neither is account state (§3.1), and neither
    // is in the pushed document at all.
    useSettingsStore.getState().setBoxSettings({ bright: 80 });
    useSettingsStore.getState().setAutoSyncEnabled(false);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does not push while signed out', () => {
    (globalThis as any).__signedIn = false;
    useSettingsStore.getState().setAccent('violet');
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('what must NOT get pushed', () => {
  // The data-loss case. A user tries the app signed out, picks an accent they
  // like, then signs in to an account that already has settings -- set from
  // the dashboard or from their other phone. ensureLocalDataScopedTo sees
  // storage tagged with no uid, wipes it, and this bridge used to mirror that
  // wipe straight into users/{uid}/settings/app.
  it('does not push the wipe that signing in performs', () => {
    useSettingsStore.getState().setAccent('violet');
    pushMock.mockClear();

    useSettingsStore.getState().resetSyncableSettings();

    expect(pushMock).not.toHaveBeenCalled();
  });

  // A pulled document is not a local edit. syncSettingsTwoWay has already
  // decided the remote side won; echoing it back is at best a redundant
  // whole-document write, and it re-stamps a clock this device did not set.
  it('does not push a remote settings doc straight back at the server', () => {
    useSettingsStore
      .getState()
      .applyRemoteSettings({ ...SYNCABLE_SETTINGS_DEFAULTS, themeMode: 'light' }, 1_700_000_000_000);

    expect(pushMock).not.toHaveBeenCalled();
  });

  // Opening the app is not an edit either -- the same property
  // scheduledSessionsSyncBridge.test.ts pins for plans. Hydration replaces
  // the syncable fields with whatever is on disk, which looks identical to a
  // user having just set them.
  it('does not push on hydration', async () => {
    // Through the app's own writer, so the key prefix storage.ts owns stays
    // its business rather than being restated here.
    await setJSON('accent', 'violet');
    useSettingsStore.setState({ hydrated: false });

    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().accent).toBe('violet');
    expect(pushMock).not.toHaveBeenCalled();
  });
});
