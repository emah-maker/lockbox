// Unit tests for localDataOwner.ts -- the account-boundary guard for
// Critical #1 in
// docs/production-readiness/production-readiness-review-phone-box-companion-app-2026-08-17.md.
// Exercises the real AsyncStorage-backed sessionHistory/useSettingsStore
// (AsyncStorage itself is mocked by jest.setup.js) rather than mocking them,
// since the whole point of this module is their interaction. Run with `npm test`.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearLocalAccountData, ensureLocalDataScopedTo, LOCAL_DATA_OWNER_KEY } from './localDataOwner';
import { appendSessions, loadSessions, LoggedSession } from '../stats/sessionHistory';
import { useSettingsStore } from '../store/useSettingsStore';
import { getJSON } from '../storage/storage';

const session = (startedAt: number): LoggedSession => ({
  startedAt,
  plannedS: 60,
  actualS: 60,
  outcome: 'completed',
});

beforeEach(async () => {
  await AsyncStorage.clear();
  useSettingsStore.setState({
    themeMode: 'dark',
    accent: 'mint',
    callAlertsEnabled: true,
    customLabels: [],
    settingsUpdatedAt: 0,
  });
});

describe('ensureLocalDataScopedTo', () => {
  it('tags untouched local storage with the first signed-in uid (nothing to wipe)', async () => {
    await ensureLocalDataScopedTo('uid-a');
    expect(await getJSON(LOCAL_DATA_OWNER_KEY, null)).toBe('uid-a');
  });

  it('does not clear local data on a second sync for the same uid', async () => {
    await ensureLocalDataScopedTo('uid-a');
    await appendSessions([session(1)]);
    useSettingsStore.getState().setAccent('coral');

    await ensureLocalDataScopedTo('uid-a');

    expect(await loadSessions()).toHaveLength(1);
    expect(useSettingsStore.getState().accent).toBe('coral');
  });

  it("wipes local session history and settings before merging a different uid's data in", async () => {
    await ensureLocalDataScopedTo('uid-a');
    await appendSessions([session(1)]);
    useSettingsStore.getState().setAccent('coral');
    useSettingsStore.getState().setCallAlertsEnabled(false);

    await ensureLocalDataScopedTo('uid-b');

    expect(await loadSessions()).toHaveLength(0);
    expect(useSettingsStore.getState().accent).toBe('mint');
    expect(useSettingsStore.getState().callAlertsEnabled).toBe(true);
    expect(await getJSON(LOCAL_DATA_OWNER_KEY, null)).toBe('uid-b');
  });

  it('wipes pre-existing untagged local data (an install predating this fix) before its first tagged sync', async () => {
    // Simulates an existing install's data from before LOCAL_DATA_OWNER_KEY
    // existed: real data present, but no owner tag yet.
    await appendSessions([session(1)]);
    useSettingsStore.getState().setAccent('coral');

    await ensureLocalDataScopedTo('uid-a');

    expect(await loadSessions()).toHaveLength(0);
    expect(useSettingsStore.getState().accent).toBe('mint');
    expect(await getJSON(LOCAL_DATA_OWNER_KEY, null)).toBe('uid-a');
  });
});

describe('clearLocalAccountData', () => {
  it('clears sessions, resets syncable settings to defaults, and un-tags the owner', async () => {
    await ensureLocalDataScopedTo('uid-a');
    await appendSessions([session(1)]);
    useSettingsStore.getState().setThemeMode('light');

    await clearLocalAccountData();

    expect(await loadSessions()).toHaveLength(0);
    expect(useSettingsStore.getState().themeMode).toBe('dark');
    expect(await getJSON(LOCAL_DATA_OWNER_KEY, null)).toBeNull();
  });

  it('does not touch boxSettings (per-device, not account state)', async () => {
    useSettingsStore.getState().setBoxSettings({ bright: 99 });

    await clearLocalAccountData();

    expect(useSettingsStore.getState().boxSettings.bright).toBe(99);
  });
});
