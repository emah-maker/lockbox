// Unit tests for useSettingsStore.ts's hydrate/persist contract for the
// three fields that most recently landed: the account-syncable
// `excludedTopicKeys` (verified against the same touchpoints customLabels
// already has -- hydrate, persist, applyRemoteSettings, resetSyncableSettings),
// and the local-only, per-device `calendarStreakGoalIds` (verified for the
// `null` vs `[]` distinction and for surviving a corrupted stored value --
// see sanitizeCalendarStreakGoalIds's own comment on why that matters:
// screens/calendar/monthGrid.ts's resolveCalendarStreakGoalIds unconditionally
// `.filter()`s whatever it is handed once it isn't `null`).
//
// Exercises the real AsyncStorage-backed storage.ts (mocked by
// jest.setup.js), same as useGoalsStore.test.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettingsStore } from './useSettingsStore';

const KEY = (k: string) => 'phonebox:' + k;

beforeEach(async () => {
  await AsyncStorage.clear();
  useSettingsStore.setState({
    hydrated: false,
    themeMode: 'dark',
    accent: 'mint',
    callAlertsEnabled: true,
    customLabels: [],
    excludedTopicKeys: [],
    settingsUpdatedAt: 0,
    calendarStreakGoalIds: null,
  });
});

describe('calendarStreakGoalIds persistence', () => {
  it('defaults to null (every active goal) when storage is empty', async () => {
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().calendarStreakGoalIds).toBeNull();
  });

  it('keeps null and [] distinguishable through a full hydrate cycle', async () => {
    useSettingsStore.getState().setCalendarStreakGoalIds([]);
    useSettingsStore.setState({ hydrated: false });
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().calendarStreakGoalIds).toEqual([]);

    useSettingsStore.getState().setCalendarStreakGoalIds(null);
    useSettingsStore.setState({ hydrated: false });
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().calendarStreakGoalIds).toBeNull();

    useSettingsStore.getState().setCalendarStreakGoalIds(['g1', 'g2']);
    useSettingsStore.setState({ hydrated: false });
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().calendarStreakGoalIds).toEqual(['g1', 'g2']);
  });

  it('falls back to null (not a crash-prone shape) when the stored value is corrupted', async () => {
    // Before the fix, storage.ts's generic corrupt-value guard opted out
    // entirely for this field (its default is `null`, which reads as "no
    // shape to compare against" -- see storage.ts's own comment), so any of
    // these malformed values reached the store completely unchecked. Every
    // one of them would have blown up screens/calendar/monthGrid.ts's
    // resolveCalendarStreakGoalIds, which calls `.filter()` unconditionally
    // once the value isn't `null`.
    await AsyncStorage.setItem(KEY('calendarStreakGoalIds'), JSON.stringify(42));
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().calendarStreakGoalIds).toBeNull();

    useSettingsStore.setState({ hydrated: false });
    await AsyncStorage.setItem(KEY('calendarStreakGoalIds'), JSON.stringify({ foo: 'bar' }));
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().calendarStreakGoalIds).toBeNull();

    useSettingsStore.setState({ hydrated: false });
    await AsyncStorage.setItem(KEY('calendarStreakGoalIds'), JSON.stringify('not-an-array'));
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().calendarStreakGoalIds).toBeNull();
  });

  it('drops non-string entries from an otherwise-real array instead of carrying them through', async () => {
    useSettingsStore.setState({ hydrated: false });
    await AsyncStorage.setItem(KEY('calendarStreakGoalIds'), JSON.stringify(['g1', 42, null, 'g2']));
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().calendarStreakGoalIds).toEqual(['g1', 'g2']);
  });

  it('is not reset by resetSyncableSettings (local-only, device view preference)', () => {
    useSettingsStore.getState().setCalendarStreakGoalIds(['g1']);
    useSettingsStore.getState().resetSyncableSettings();
    expect(useSettingsStore.getState().calendarStreakGoalIds).toEqual(['g1']);
  });

  it('is not touched by applyRemoteSettings (local-only, device view preference)', () => {
    useSettingsStore.getState().setCalendarStreakGoalIds(['g1']);
    useSettingsStore.getState().applyRemoteSettings(
      {
        themeMode: 'light',
        accent: 'sky',
        callAlertsEnabled: false,
        customLabels: [],
        excludedTopicKeys: [],
      },
      123,
    );
    expect(useSettingsStore.getState().calendarStreakGoalIds).toEqual(['g1']);
  });
});

describe('excludedTopicKeys sync touchpoints', () => {
  it('round-trips through hydrate', async () => {
    useSettingsStore.getState().setTopicKeyExcluded('work', true);
    useSettingsStore.setState({ hydrated: false });
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().excludedTopicKeys).toEqual(['work']);
  });

  it('bumps settingsUpdatedAt on a local change, so a toggle is pushed on the next sync', () => {
    useSettingsStore.setState({ settingsUpdatedAt: 0 });
    useSettingsStore.getState().setTopicKeyExcluded('study', true);
    expect(useSettingsStore.getState().settingsUpdatedAt).toBeGreaterThan(0);
  });

  it('is restored by applyRemoteSettings (account-syncable)', () => {
    useSettingsStore.getState().applyRemoteSettings(
      {
        themeMode: 'dark',
        accent: 'mint',
        callAlertsEnabled: true,
        customLabels: [],
        excludedTopicKeys: ['reading', 'exercise'],
      },
      999,
    );
    expect(useSettingsStore.getState().excludedTopicKeys).toEqual(['reading', 'exercise']);
    expect(useSettingsStore.getState().settingsUpdatedAt).toBe(999);
  });

  it('is wiped by resetSyncableSettings (account-syncable, must not linger across accounts)', () => {
    useSettingsStore.getState().setTopicKeyExcluded('creative', true);
    useSettingsStore.getState().resetSyncableSettings();
    expect(useSettingsStore.getState().excludedTopicKeys).toEqual([]);
    expect(useSettingsStore.getState().settingsUpdatedAt).toBe(0);
  });
});
