// Unit tests for goalNotifications.ts. Split the same way the module itself
// is:
//   - goalNotificationRequests is exercised directly -- it's pure, so no
//     mock of 'expo-notifications' is needed for that describe block at all.
//   - requestGoalNotificationPermission/syncGoalNotifications need
//     'expo-notifications' mocked (there's no native module registered
//     under jest), so every native entry point this module calls is
//     replaced with a jest.fn() the tests can control and assert against.
// Run with `npm test`.
import { goalNotificationRequests, requestGoalNotificationPermission, syncGoalNotifications } from './goalNotifications';
import { Goal } from './goals';

const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockGetAllScheduledNotificationsAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn();

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' },
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getAllScheduledNotificationsAsync: (...args: unknown[]) => mockGetAllScheduledNotificationsAsync(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancelScheduledNotificationAsync(...args),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
}));

const goal = (overrides: Partial<Goal>): Goal => ({
  id: 'goal:a',
  topic: null,
  period: 'daily',
  targetS: 3600,
  createdAt: 0,
  updatedAt: 0,
  archived: false,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermissionsAsync.mockResolvedValue({ granted: false });
  mockRequestPermissionsAsync.mockResolvedValue({ granted: true });
  mockGetAllScheduledNotificationsAsync.mockResolvedValue([]);
  mockCancelScheduledNotificationAsync.mockResolvedValue(undefined);
  mockScheduleNotificationAsync.mockResolvedValue('native-id');
});

describe('goalNotificationRequests (pure -- no native module involved)', () => {
  it('returns [] when notify is not true', () => {
    expect(goalNotificationRequests(goal({ notify: false, notifyAt: '09:00' }))).toEqual([]);
    expect(goalNotificationRequests(goal({ notifyAt: '09:00' }))).toEqual([]); // notify undefined
  });

  it('returns [] when notifyAt is unset, even if notify is true', () => {
    expect(goalNotificationRequests(goal({ notify: true }))).toEqual([]);
  });

  it('returns [] for a defensively-malformed notifyAt (should never happen via the normal write paths)', () => {
    expect(goalNotificationRequests(goal({ notify: true, notifyAt: '9:00' } as any))).toEqual([]);
    expect(goalNotificationRequests(goal({ notify: true, notifyAt: '24:00' } as any))).toEqual([]);
  });

  it('produces one daily-repeating trigger for an unrestricted daily goal', () => {
    const requests = goalNotificationRequests(goal({ period: 'daily', notify: true, notifyAt: '08:30' }));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      identifier: 'goal-notif:goal:a:daily',
      trigger: { kind: 'daily', hour: 8, minute: 30 },
    });
  });

  it('produces one weekly-repeating trigger PER selected weekday for a day-restricted daily goal', () => {
    const requests = goalNotificationRequests(goal({ period: 'daily', daysOfWeek: [1, 3, 5], notify: true, notifyAt: '07:00' }));
    expect(requests).toHaveLength(3);
    expect(requests.map((r) => r.trigger)).toEqual([
      { kind: 'weekly', weekday: 1, hour: 7, minute: 0 },
      { kind: 'weekly', weekday: 3, hour: 7, minute: 0 },
      { kind: 'weekly', weekday: 5, hour: 7, minute: 0 },
    ]);
    // Identifiers are distinct per weekday, so cancelling/rescheduling one
    // day never collides with another.
    expect(new Set(requests.map((r) => r.identifier)).size).toBe(3);
  });

  it('treats an empty daysOfWeek the same as "every day" (one daily trigger, not zero)', () => {
    const requests = goalNotificationRequests(goal({ period: 'daily', daysOfWeek: [], notify: true, notifyAt: '08:00' }));
    expect(requests).toHaveLength(1);
    expect(requests[0].trigger.kind).toBe('daily');
  });

  it('produces one Sunday weekly-repeating trigger for a weekly goal', () => {
    const requests = goalNotificationRequests(goal({ period: 'weekly', notify: true, notifyAt: '09:00' }));
    expect(requests).toHaveLength(1);
    expect(requests[0].trigger).toEqual({ kind: 'weekly', weekday: 0, hour: 9, minute: 0 });
  });

  it('produces one monthly-repeating trigger on the 1st for a monthly goal', () => {
    const requests = goalNotificationRequests(goal({ period: 'monthly', notify: true, notifyAt: '09:00' }));
    expect(requests).toHaveLength(1);
    expect(requests[0].trigger).toEqual({ kind: 'monthly', day: 1, hour: 9, minute: 0 });
  });

  it('includes non-empty, distinct title/body copy', () => {
    const [r] = goalNotificationRequests(goal({ notify: true, notifyAt: '09:00' }));
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.body.length).toBeGreaterThan(0);
  });

  it('mentions the goal topic in the body for a topic-specific goal, and stays generic for topic: null', () => {
    const [withTopic] = goalNotificationRequests(goal({ topic: 'work', notify: true, notifyAt: '09:00' }));
    expect(withTopic.body).toContain('work');
    const [allTopics] = goalNotificationRequests(goal({ topic: null, notify: true, notifyAt: '09:00' }));
    expect(allTopics.body).not.toContain('null');
  });

  it('produces distinct identifiers for two different goals with the same trigger shape', () => {
    const [a] = goalNotificationRequests(goal({ id: 'goal:a', notify: true, notifyAt: '09:00' }));
    const [b] = goalNotificationRequests(goal({ id: 'goal:b', notify: true, notifyAt: '09:00' }));
    expect(a.identifier).not.toBe(b.identifier);
  });
});

describe('requestGoalNotificationPermission', () => {
  it('returns true without prompting when already granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: true });
    const result = await requestGoalNotificationPermission();
    expect(result).toBe(true);
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('prompts and returns the result when not yet granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false });
    mockRequestPermissionsAsync.mockResolvedValue({ granted: true });
    const result = await requestGoalNotificationPermission();
    expect(result).toBe(true);
    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns false when the user denies', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false });
    mockRequestPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await requestGoalNotificationPermission()).toBe(false);
  });

  it('degrades to false instead of throwing when the native module errors (Expo Go / simulator / no capability)', async () => {
    mockGetPermissionsAsync.mockRejectedValue(new Error('no native module'));
    await expect(requestGoalNotificationPermission()).resolves.toBe(false);
  });

  it('degrades to false when requestPermissionsAsync itself throws', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false });
    mockRequestPermissionsAsync.mockRejectedValue(new Error('boom'));
    await expect(requestGoalNotificationPermission()).resolves.toBe(false);
  });
});

describe('syncGoalNotifications', () => {
  it('cancels every previously-scheduled goal notification (matching the module prefix) on every call', async () => {
    mockGetAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'goal-notif:goal:old:daily' },
      { identifier: 'goal-notif:goal:old2:weekly:0' },
      { identifier: 'some-other-feature:unrelated' },
    ]);
    await syncGoalNotifications([]);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('goal-notif:goal:old:daily');
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('goal-notif:goal:old2:weekly:0');
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalledWith('some-other-feature:unrelated');
  });

  it('never prompts for permission when no goal currently wants a reminder', async () => {
    await syncGoalNotifications([goal({ notify: false }), goal({ id: 'goal:b' })]);
    expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('excludes archived goals from the reschedule even if they still carry notify:true', async () => {
    await syncGoalNotifications([goal({ notify: true, notifyAt: '09:00', archived: true })]);
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('requests permission and schedules when at least one goal wants a reminder and permission is granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: true });
    await syncGoalNotifications([goal({ notify: true, notifyAt: '09:00' })]);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const call = mockScheduleNotificationAsync.mock.calls[0][0];
    expect(call.identifier).toBe('goal-notif:goal:a:daily');
    expect(call.trigger).toEqual({ type: 'daily', hour: 9, minute: 0 });
  });

  it('converts a weekday-restricted daily goal\'s 0=Sun..6=Sat descriptor to expo-notifications\' 1=Sun..7=Sat at the scheduling boundary', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: true });
    await syncGoalNotifications([goal({ daysOfWeek: [0, 6], notify: true, notifyAt: '09:00' })]);
    const triggers = mockScheduleNotificationAsync.mock.calls.map((c) => c[0].trigger);
    expect(triggers).toEqual(
      expect.arrayContaining([
        { type: 'weekly', weekday: 1, hour: 9, minute: 0 }, // Sunday (0) -> expo's 1
        { type: 'weekly', weekday: 7, hour: 9, minute: 0 }, // Saturday (6) -> expo's 7
      ]),
    );
  });

  it('does not schedule anything when permission is denied, but still performs the cancel pass', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false });
    mockRequestPermissionsAsync.mockResolvedValue({ granted: false });
    await syncGoalNotifications([goal({ notify: true, notifyAt: '09:00' })]);
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockGetAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('schedules independent requests for multiple goals', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: true });
    await syncGoalNotifications([
      goal({ id: 'goal:a', notify: true, notifyAt: '09:00' }),
      goal({ id: 'goal:b', period: 'weekly', notify: true, notifyAt: '10:00' }),
    ]);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('never throws even when every native call fails', async () => {
    mockGetAllScheduledNotificationsAsync.mockRejectedValue(new Error('no native module'));
    mockGetPermissionsAsync.mockRejectedValue(new Error('no native module'));
    await expect(syncGoalNotifications([goal({ notify: true, notifyAt: '09:00' })])).resolves.toBeUndefined();
  });

  it('one goal failing to schedule does not prevent the others from being scheduled', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: true });
    mockScheduleNotificationAsync.mockRejectedValueOnce(new Error('platform rejected this trigger')).mockResolvedValue('ok');
    await expect(
      syncGoalNotifications([
        goal({ id: 'goal:a', notify: true, notifyAt: '09:00' }),
        goal({ id: 'goal:b', notify: true, notifyAt: '10:00' }),
      ]),
    ).resolves.toBeUndefined();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});
