// sessionReminderPlan.test.ts -- which planned sessions become pending OS
// notifications. Every assertion here is about the DECISION (scheduled or
// not, in what order, with what identifier), never about the rendered body
// text: that runs through ui/time.ts's Intl formatting, which is
// locale-dependent, and pinning it would assert the runner's locale rather
// than this module's behavior.
import {
  MAX_SESSION_REMINDERS,
  SESSION_NOTIF_ID_PREFIX,
  fireTimeOfDay,
  planSessionReminders,
  reminderFallsInQuietHours,
} from './sessionReminderPlan';
import { reminderFireMs, type ScheduledSession } from './scheduledSessions';
import type { NotificationPrefs } from '../goals/goalNotificationPlan';

const PREFS: NotificationPrefs = {
  enabled: true,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
};

// Every case here is anchored to a fixed LOCAL wall clock, so the same
// assertions hold in any timezone the suite happens to run in.
const NOW = new Date(2026, 8, 1, 8, 0, 0, 0).getTime();

const plan = (over: Partial<ScheduledSession> = {}): ScheduledSession => ({
  id: 'sched_1',
  date: '2026-09-01',
  time: '10:00',
  topic: null,
  leadMinutes: 10,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('planSessionReminders', () => {
  it('schedules an upcoming plan at leadMinutes before its start', () => {
    const item = plan();
    const [request] = planSessionReminders([item], PREFS, NOW);
    expect(request.fireAtMs).toBe(reminderFireMs(item));
    expect(request.identifier.startsWith(SESSION_NOTIF_ID_PREFIX)).toBe(true);
  });

  // The identifier has to move with the fire time, or an edited plan would
  // collide with its own still-pending schedule on a reconcile that hasn't
  // cancelled yet.
  it('gives an edited plan a different identifier', () => {
    const [before] = planSessionReminders([plan()], PREFS, NOW);
    const [after] = planSessionReminders([plan({ time: '11:00' })], PREFS, NOW);
    expect(after.identifier).not.toBe(before.identifier);
  });

  it('drops a plan whose reminder has already passed', () => {
    // 08:00 start, 10 min lead -> fires 07:50, which is before NOW (08:00).
    expect(planSessionReminders([plan({ time: '08:00' })], PREFS, NOW)).toEqual([]);
  });

  // Exactly-now is treated as past. A reminder scheduled for the current
  // instant either races the OS or is delivered immediately, and neither is
  // what "remind me at 10:00" meant.
  it('drops a plan whose reminder is due exactly now', () => {
    expect(planSessionReminders([plan({ time: '08:10' })], PREFS, NOW)).toEqual([]);
  });

  it('drops a plan that has been ticked done', () => {
    expect(planSessionReminders([plan({ done: true })], PREFS, NOW)).toEqual([]);
  });

  it('drops a malformed plan rather than scheduling something arbitrary', () => {
    expect(planSessionReminders([plan({ time: 'noon' })], PREFS, NOW)).toEqual([]);
  });

  it('plans nothing at all when the global switch is off', () => {
    expect(planSessionReminders([plan()], { ...PREFS, enabled: false }, NOW)).toEqual([]);
  });

  // The quiet-hours check has to run against the REMINDER's time of day, not
  // the session's: this session starts at 07:10 (outside quiet hours) but
  // its reminder fires at 06:40 (inside a 22:00-07:00 window).
  it('drops a reminder that lands in quiet hours even when the session does not', () => {
    const earlyNow = new Date(2026, 8, 1, 5, 0, 0, 0).getTime();
    const item = plan({ time: '07:10', leadMinutes: 30 });
    const quiet = { ...PREFS, quietHoursEnabled: true };
    expect(planSessionReminders([item], quiet, earlyNow)).toEqual([]);
    expect(planSessionReminders([item], PREFS, earlyNow)).toHaveLength(1);
  });

  it('keeps the SOONEST plans, in order, up to the cap', () => {
    // One plan per day for well over the cap, deliberately built
    // latest-first so both the sort and the slice are doing real work: a
    // naive `slice(0, N)` before sorting would keep the FURTHEST-out
    // reminders, which is precisely the wrong half to spend iOS's
    // 64-pending budget on.
    const count = MAX_SESSION_REMINDERS + 8;
    const many = Array.from({ length: count }, (_, i) => {
      const d = new Date(2026, 8, 2 + (count - 1 - i)); // descending dates
      return plan({
        id: `sched_${i}`,
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      });
    });

    const requests = planSessionReminders(many, PREFS, NOW);
    const soonestFirst = many.map(reminderFireMs).sort((a, b) => a - b);

    expect(requests).toHaveLength(MAX_SESSION_REMINDERS);
    expect(requests.map((r) => r.fireAtMs)).toEqual(soonestFirst.slice(0, MAX_SESSION_REMINDERS));
  });
});

describe('fireTimeOfDay', () => {
  it('reports the local wall clock of an absolute moment', () => {
    expect(fireTimeOfDay(new Date(2026, 8, 1, 6, 5, 0, 0).getTime())).toBe('06:05');
  });
});

describe('reminderFallsInQuietHours', () => {
  const quiet = { quietHoursEnabled: true, quietStart: '22:00', quietEnd: '07:00' };

  it('matches the drop the planner would make, so the form can warn first', () => {
    expect(reminderFallsInQuietHours({ date: '2026-09-01', time: '07:10', leadMinutes: 30 }, quiet)).toBe(true);
    expect(reminderFallsInQuietHours({ date: '2026-09-01', time: '07:10', leadMinutes: 0 }, quiet)).toBe(false);
  });

  it('is false when quiet hours are off, and for an unparseable plan', () => {
    expect(
      reminderFallsInQuietHours({ date: '2026-09-01', time: '23:00', leadMinutes: 0 }, { ...quiet, quietHoursEnabled: false }),
    ).toBe(false);
    expect(reminderFallsInQuietHours({ date: 'nope', time: '23:00', leadMinutes: 0 }, quiet)).toBe(false);
  });
});
