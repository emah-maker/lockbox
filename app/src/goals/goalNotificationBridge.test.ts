// Unit tests for goalNotificationBridge.ts's resync TRIGGERS -- when a
// re-plan happens, not what gets planned (that's goalNotificationPlan.ts,
// exercised by goalNotifications.test.ts). Mocks './goalNotifications'
// entirely (rather than 'expo-notifications' the way that file does) since
// this module only cares whether syncGoalNotifications gets CALLED, never
// how it talks to the native module.
import { useSettingsStore } from '../store/useSettingsStore';
import { resyncGoalNotifications, startGoalNotificationPrefsWatch } from './goalNotificationBridge';

const mockSync = jest.fn();
jest.mock('./goalNotifications', () => ({
  syncGoalNotifications: (...args: unknown[]) => mockSync(...args),
}));

const baseSettings = {
  customLabels: [] as unknown[],
  excludedTopicKeys: [] as string[],
  notificationsEnabled: true,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  useSettingsStore.setState(baseSettings as any);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('startGoalNotificationPrefsWatch', () => {
  it('resyncs when a notification pref changes (baseline, pre-existing behavior)', () => {
    const teardown = startGoalNotificationPrefsWatch();
    resyncGoalNotifications([]); // seed latestGoals via the public API
    mockSync.mockClear();

    useSettingsStore.setState({ notificationsEnabled: false } as any);
    jest.advanceTimersByTime(1000);

    expect(mockSync).toHaveBeenCalledTimes(1);
    teardown();
  });

  // The bug: readProgress (this file) folds customLabels/excludedTopicKeys
  // into every goal's `met` snapshot specifically so a notifyOnlyIfBehind
  // reminder reacts to a label/topic exclusion (see that function's own
  // comment) -- but the watch this function installs used to compare only
  // the four notification prefs, so flipping CustomLabelsSection.tsx's
  // "Counts toward totals" switch changed nothing it was watching. A
  // reminder already scheduled off the pre-exclusion progress kept running
  // unchanged until some UNRELATED trigger (a new session landing, a goal
  // edit, or an actual prefs change) happened to resync next.
  it('resyncs when excludedTopicKeys changes, even though no notification pref changed', () => {
    const teardown = startGoalNotificationPrefsWatch();
    resyncGoalNotifications([]);
    mockSync.mockClear();

    useSettingsStore.setState({ excludedTopicKeys: ['work'] } as any);
    jest.advanceTimersByTime(1000);

    expect(mockSync).toHaveBeenCalledTimes(1);
    teardown();
  });

  it('resyncs when customLabels changes (a label\'s excludeFromTotals flips), even though no notification pref changed', () => {
    const teardown = startGoalNotificationPrefsWatch();
    resyncGoalNotifications([]);
    mockSync.mockClear();

    useSettingsStore.setState({
      customLabels: [{ id: 'custom:sleep', name: 'Sleep', color: '#123456', excludeFromTotals: true }],
    } as any);
    jest.advanceTimersByTime(1000);

    expect(mockSync).toHaveBeenCalledTimes(1);
    teardown();
  });

  it('does not resync for an unrelated settings emission (no watched field actually changed)', () => {
    const teardown = startGoalNotificationPrefsWatch();
    resyncGoalNotifications([]);
    mockSync.mockClear();

    useSettingsStore.setState({ themeMode: 'light' } as any);
    jest.advanceTimersByTime(1000);

    expect(mockSync).not.toHaveBeenCalled();
    teardown();
  });
});

describe('resyncGoalNotifications', () => {
  it('reads the current customLabels/excludedTopicKeys at call time and forwards them to syncGoalNotifications', () => {
    useSettingsStore.setState({
      customLabels: [{ id: 'custom:sleep', name: 'Sleep', color: '#123456', excludeFromTotals: true }],
      excludedTopicKeys: ['work'],
    } as any);

    resyncGoalNotifications([]);

    expect(mockSync).toHaveBeenCalledTimes(1);
    const [, , , customLabelsArg] = mockSync.mock.calls[0];
    expect(customLabelsArg).toEqual([{ id: 'custom:sleep', name: 'Sleep', color: '#123456', excludeFromTotals: true }]);
  });
});
