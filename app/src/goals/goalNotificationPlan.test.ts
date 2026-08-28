// Unit tests for goalReminders.ts + goalNotificationPlan.ts -- the two pure
// modules behind goal reminders. Neither imports expo-notifications, so this
// file needs no native mock at all (unlike goalNotifications.test.ts, which
// covers the scheduling boundary). Run with `npm test`.
import { Goal } from './goals';
import {
  goalNotifyTimes,
  goalNotifyDays,
  normalizeNotifyTimes,
  sanitizeNotifyTimes,
  sanitizeNotifyDays,
  notifyTimeToMinutes,
  MAX_NOTIFY_TIMES,
} from './goalReminders';
import {
  goalNotificationRequests,
  planGoalNotifications,
  allowedNotifyTimes,
  isInQuietHours,
  type NotificationPrefs,
} from './goalNotificationPlan';

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

const prefs = (overrides: Partial<NotificationPrefs> = {}): NotificationPrefs => ({
  enabled: true,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  ...overrides,
});

describe('goalNotifyTimes', () => {
  it('reads a multi-time list, canonicalized (sorted + deduped)', () => {
    expect(goalNotifyTimes(goal({ notifyTimes: ['18:00', '09:00', '18:00'] }))).toEqual(['09:00', '18:00']);
  });

  it('falls back to the legacy single notifyAt when no list is present -- the pre-multi-time and website-dashboard shape', () => {
    expect(goalNotifyTimes(goal({ notifyAt: '07:30' }))).toEqual(['07:30']);
  });

  it('prefers the list over the legacy field when both exist', () => {
    expect(goalNotifyTimes(goal({ notifyAt: '07:30', notifyTimes: ['12:00'] }))).toEqual(['12:00']);
  });

  it('returns [] for nothing configured, and drops a malformed time rather than returning it', () => {
    expect(goalNotifyTimes(goal({}))).toEqual([]);
    expect(goalNotifyTimes(goal({ notifyAt: '9:00' } as Partial<Goal>))).toEqual([]);
    expect(goalNotifyTimes(goal({ notifyTimes: ['24:00', '10:00'] }))).toEqual(['10:00']);
  });

  it('does not consult `notify` -- "which times are configured" is a separate question from "are reminders on"', () => {
    expect(goalNotifyTimes(goal({ notify: false, notifyAt: '09:00' }))).toEqual(['09:00']);
  });
});

describe('goalNotifyDays', () => {
  it('prefers an explicit notifyDays over the goal\'s own daysOfWeek', () => {
    expect(goalNotifyDays(goal({ daysOfWeek: [1, 2, 3], notifyDays: [0, 6] }))).toEqual([0, 6]);
  });

  it('defaults a daily goal to its own daysOfWeek restriction, so a Mon/Wed/Fri goal never nudges on a Tuesday', () => {
    expect(goalNotifyDays(goal({ period: 'daily', daysOfWeek: [5, 1, 3] }))).toEqual([1, 3, 5]);
  });

  it('is null (no weekday restriction) for an unrestricted daily goal and for weekly/monthly goals', () => {
    expect(goalNotifyDays(goal({ period: 'daily' }))).toBeNull();
    expect(goalNotifyDays(goal({ period: 'weekly', daysOfWeek: [1] }))).toBeNull();
    expect(goalNotifyDays(goal({ period: 'monthly' }))).toBeNull();
  });
});

describe('normalize/sanitize helpers', () => {
  it('normalizeNotifyTimes canonicalizes and collapses an empty result to undefined', () => {
    expect(normalizeNotifyTimes(['20:00', '08:00', '08:00'])).toEqual(['08:00', '20:00']);
    expect(normalizeNotifyTimes([])).toBeUndefined();
    expect(normalizeNotifyTimes(undefined)).toBeUndefined();
  });

  it('normalizeNotifyTimes caps at MAX_NOTIFY_TIMES, keeping the EARLIEST times', () => {
    const many = ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00'];
    const kept = normalizeNotifyTimes(many);
    expect(kept).toHaveLength(MAX_NOTIFY_TIMES);
    expect(kept![0]).toBe('01:00');
    expect(kept).not.toContain('08:00');
  });

  it('sanitize* drop untrusted junk entry-by-entry instead of rejecting everything', () => {
    expect(sanitizeNotifyTimes(['09:00', 42, null, '99:99', '17:30'])).toEqual(['09:00', '17:30']);
    expect(sanitizeNotifyTimes('nope')).toBeUndefined();
    expect(sanitizeNotifyDays([1, 9, -1, 'x', 3, 3])).toEqual([1, 3]);
    expect(sanitizeNotifyDays({})).toBeUndefined();
  });

  it('notifyTimeToMinutes converts, and rejects a malformed time', () => {
    expect(notifyTimeToMinutes('00:00')).toBe(0);
    expect(notifyTimeToMinutes('09:30')).toBe(570);
    expect(notifyTimeToMinutes('23:59')).toBe(1439);
    expect(notifyTimeToMinutes('9:30')).toBeNull();
  });
});

describe('isInQuietHours', () => {
  it('handles an ordinary same-day range, inclusive of start and exclusive of end', () => {
    expect(isInQuietHours('09:00', '09:00', '17:00')).toBe(true);
    expect(isInQuietHours('12:00', '09:00', '17:00')).toBe(true);
    expect(isInQuietHours('17:00', '09:00', '17:00')).toBe(false);
    expect(isInQuietHours('08:59', '09:00', '17:00')).toBe(false);
  });

  it('handles a range that WRAPS past midnight -- the usual quiet-hours shape', () => {
    expect(isInQuietHours('23:00', '22:00', '07:00')).toBe(true);
    expect(isInQuietHours('03:00', '22:00', '07:00')).toBe(true);
    expect(isInQuietHours('06:59', '22:00', '07:00')).toBe(true);
    expect(isInQuietHours('07:00', '22:00', '07:00')).toBe(false);
    expect(isInQuietHours('12:00', '22:00', '07:00')).toBe(false);
  });

  it('treats a degenerate start === end range as NO quiet hours, never as an all-day silence', () => {
    expect(isInQuietHours('12:00', '09:00', '09:00')).toBe(false);
    expect(isInQuietHours('09:00', '09:00', '09:00')).toBe(false);
  });
});

describe('allowedNotifyTimes', () => {
  it('passes every time through when quiet hours are off', () => {
    const g = goal({ notifyTimes: ['06:00', '23:00'] });
    expect(allowedNotifyTimes(g, prefs())).toEqual(['06:00', '23:00']);
  });

  it('filters out only the times inside the quiet range', () => {
    const g = goal({ notifyTimes: ['06:00', '09:00', '23:00'] });
    expect(allowedNotifyTimes(g, prefs({ quietHoursEnabled: true }))).toEqual(['09:00']);
  });
});

describe('goalNotificationRequests', () => {
  it('plans nothing when the global master switch is off, however the goal is configured', () => {
    const g = goal({ notify: true, notifyTimes: ['09:00'] });
    expect(goalNotificationRequests(g, prefs({ enabled: false }))).toEqual([]);
  });

  it('plans nothing without notify, and nothing without a usable time', () => {
    expect(goalNotificationRequests(goal({ notifyTimes: ['09:00'] }))).toEqual([]);
    expect(goalNotificationRequests(goal({ notify: true }))).toEqual([]);
  });

  it('produces one request PER reminder time, each with its own identifier', () => {
    const requests = goalNotificationRequests(goal({ notify: true, notifyTimes: ['09:00', '17:30'] }));
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.identifier)).toEqual([
      'goal-notif:goal:a:daily:0900',
      'goal-notif:goal:a:daily:1730',
    ]);
    expect(requests.map((r) => r.trigger)).toEqual([
      { kind: 'daily', hour: 9, minute: 0 },
      { kind: 'daily', hour: 17, minute: 30 },
    ]);
  });

  it('multiplies reminder times by reminder weekdays, with collision-free identifiers', () => {
    const requests = goalNotificationRequests(
      goal({ notify: true, notifyTimes: ['09:00', '21:00'], notifyDays: [1, 4] }),
    );
    expect(requests).toHaveLength(4);
    expect(new Set(requests.map((r) => r.identifier)).size).toBe(4);
    expect(requests.map((r) => r.trigger)).toEqual([
      { kind: 'weekly', weekday: 1, hour: 9, minute: 0 },
      { kind: 'weekly', weekday: 4, hour: 9, minute: 0 },
      { kind: 'weekly', weekday: 1, hour: 21, minute: 0 },
      { kind: 'weekly', weekday: 4, hour: 21, minute: 0 },
    ]);
  });

  it('lets notifyDays override the goal\'s own daysOfWeek -- nudge on Sunday about a Mon-Fri goal', () => {
    const requests = goalNotificationRequests(
      goal({ notify: true, notifyAt: '19:00', daysOfWeek: [1, 2, 3, 4, 5], notifyDays: [0] }),
    );
    expect(requests.map((r) => r.trigger)).toEqual([{ kind: 'weekly', weekday: 0, hour: 19, minute: 0 }]);
  });

  it('drops the times inside quiet hours and keeps the rest', () => {
    const requests = goalNotificationRequests(
      goal({ notify: true, notifyTimes: ['06:00', '09:00'] }),
      prefs({ quietHoursEnabled: true }),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].trigger).toEqual({ kind: 'daily', hour: 9, minute: 0 });
  });

  it('plans nothing when EVERY configured time is inside quiet hours', () => {
    const requests = goalNotificationRequests(
      goal({ notify: true, notifyTimes: ['23:00', '05:00'] }),
      prefs({ quietHoursEnabled: true }),
    );
    expect(requests).toEqual([]);
  });

  it('skips a notifyOnlyIfBehind goal whose window is already met, but keeps an ordinary one', () => {
    const behindOnly = goal({ notify: true, notifyAt: '09:00', notifyOnlyIfBehind: true });
    expect(goalNotificationRequests(behindOnly, prefs(), { met: true, remainingS: 0 })).toEqual([]);
    expect(goalNotificationRequests(behindOnly, prefs(), { met: false, remainingS: 600 })).toHaveLength(1);

    const always = goal({ notify: true, notifyAt: '09:00' });
    expect(goalNotificationRequests(always, prefs(), { met: true, remainingS: 0 })).toHaveLength(1);
  });

  it('treats unknown progress as "not met", so a reminder is never silently lost', () => {
    const g = goal({ notify: true, notifyAt: '09:00', notifyOnlyIfBehind: true });
    expect(goalNotificationRequests(g, prefs(), undefined)).toHaveLength(1);
  });

  it('writes the remaining time into the body when progress is known', () => {
    const [req] = goalNotificationRequests(
      goal({ notify: true, notifyAt: '09:00' }),
      prefs(),
      { met: false, remainingS: 4800 },
    );
    expect(req.body).toContain('1h 20m');
    expect(req.body).toContain('your focus time');
  });

  it('falls back to the generic body with no progress snapshot', () => {
    const [req] = goalNotificationRequests(goal({ notify: true, notifyAt: '09:00' }));
    expect(req.body).toContain('Time to work toward');
  });

  it('uses the window-start day for an unrestricted weekly (Sunday) and monthly (the 1st) goal', () => {
    const weekly = goalNotificationRequests(goal({ period: 'weekly', targetS: 7200, notify: true, notifyAt: '08:00' }));
    expect(weekly.map((r) => r.trigger)).toEqual([{ kind: 'weekly', weekday: 0, hour: 8, minute: 0 }]);

    const monthly = goalNotificationRequests(goal({ period: 'monthly', targetS: 7200, notify: true, notifyAt: '08:00' }));
    expect(monthly.map((r) => r.trigger)).toEqual([{ kind: 'monthly', day: 1, hour: 8, minute: 0 }]);
  });
});

describe('planGoalNotifications', () => {
  it('excludes archived goals and looks each surviving goal\'s progress up by id', () => {
    const goals = [
      goal({ id: 'goal:a', notify: true, notifyAt: '09:00', notifyOnlyIfBehind: true }),
      goal({ id: 'goal:b', notify: true, notifyAt: '10:00', notifyOnlyIfBehind: true }),
      goal({ id: 'goal:c', notify: true, notifyAt: '11:00', archived: true }),
    ];
    const progress = new Map([
      ['goal:a', { met: true, remainingS: 0 }],
      ['goal:b', { met: false, remainingS: 900 }],
    ]);

    const requests = planGoalNotifications(goals, prefs(), progress);

    expect(requests.map((r) => r.identifier)).toEqual(['goal-notif:goal:b:daily:1000']);
  });
});
