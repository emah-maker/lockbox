// reminders.test.ts -- the rules that decide whether a reminder is pushed
// and to whom. These are the pieces worth testing without Firestore: the
// duplicate-suppression that stops a phone getting the same reminder twice,
// and the staleness window that stops a reminder arriving hours after the
// session it was about.
import { chunk, isSendable, reminderContent, shortDuration, tokensForReminder } from './reminders';
import type { PushTokenDoc, RemoteScheduledSession } from './reminders';

const NOW = 1_800_000_000_000;
const GRACE = 2 * 60 * 60 * 1000;

const plan = (over: Partial<RemoteScheduledSession> = {}): RemoteScheduledSession => ({
  fireAtMs: NOW - 1000,
  timeLabel: '9:00 AM',
  leadMinutes: 10,
  done: false,
  notifiedAt: null,
  ...over,
});

describe('isSendable', () => {
  it('sends a reminder whose moment has just passed', () => {
    expect(isSendable(plan(), NOW, GRACE)).toBe(true);
  });

  it('refuses one that is not due yet', () => {
    expect(isSendable(plan({ fireAtMs: NOW + 1000 }), NOW, GRACE)).toBe(false);
  });

  // The whole point of the grace window: after an outage, a reminder for a
  // session that already came and went has nothing useful left to say.
  it('refuses one that is older than the grace window', () => {
    expect(isSendable(plan({ fireAtMs: NOW - GRACE - 1 }), NOW, GRACE)).toBe(false);
    expect(isSendable(plan({ fireAtMs: NOW - GRACE }), NOW, GRACE)).toBe(true);
  });

  it('refuses one already handled, or ticked done', () => {
    expect(isSendable(plan({ notifiedAt: NOW - 500 }), NOW, GRACE)).toBe(false);
    expect(isSendable(plan({ done: true }), NOW, GRACE)).toBe(false);
  });

  // A document with a broken shape must not be able to make the sender push
  // something absurd -- the query already filters, this is the backstop.
  it('refuses a malformed document rather than pushing garbage', () => {
    expect(isSendable(plan({ fireAtMs: NaN }), NOW, GRACE)).toBe(false);
    expect(isSendable(plan({ fireAtMs: 'soon' as unknown as number }), NOW, GRACE)).toBe(false);
    expect(isSendable(plan({ timeLabel: '' }), NOW, GRACE)).toBe(false);
  });
});

describe('tokensForReminder', () => {
  const expo = (id: string, covers: string[] = []): PushTokenDoc => ({
    transport: 'expo',
    token: id,
    localReminderIds: covers,
  });

  // The duplicate-suppression contract: a phone that already holds this plan
  // as a local notification must not also be pushed to.
  it('skips a device that already has this plan scheduled locally', () => {
    const tokens = [expo('phone', ['plan-1', 'plan-2']), expo('tablet', ['plan-9'])];
    expect(tokensForReminder('plan-1', tokens).map((t) => t.token)).toEqual(['tablet']);
  });

  // A browser has no local scheduling of its own, which is exactly why a
  // plan created on the dashboard needs this path to reach anything.
  it('always includes a token that covers nothing', () => {
    const web: PushTokenDoc = { transport: 'webpush', token: 'browser' };
    expect(tokensForReminder('plan-1', [web])).toHaveLength(1);
  });

  // Safe direction: a token doc written before localReminderIds existed
  // still gets pushed to. A duplicate is annoying; a reminder that never
  // arrives is the failure this feature exists to prevent.
  it('treats a missing coverage list as covering nothing', () => {
    const legacy: PushTokenDoc = { transport: 'expo', token: 'old-build' };
    expect(tokensForReminder('plan-1', [legacy])).toHaveLength(1);
  });

  it('drops a half-written token document instead of addressing an empty string', () => {
    const broken = { transport: 'expo', token: '' } as PushTokenDoc;
    expect(tokensForReminder('plan-1', [broken, expo('good')]).map((t) => t.token)).toEqual(['good']);
  });
});

describe('reminderContent', () => {
  // The lead time is the reason this copy can't just say "time to focus":
  // the notification arrives before the session, so it has to say when.
  it('names the lead time and the start time', () => {
    const c = reminderContent(plan({ leadMinutes: 10, timeLabel: '9:00 AM' }));
    expect(c.title).toBe('Focus session in 10 min');
    expect(c.body).toContain('Starts at 9:00 AM');
  });

  it('reads differently when there is no lead at all', () => {
    const c = reminderContent(plan({ leadMinutes: 0 }));
    expect(c.title).toBe('Focus session now');
    expect(c.body).toContain('Starting at');
  });

  it('says "1 hour" rather than "60 min"', () => {
    expect(reminderContent(plan({ leadMinutes: 60 })).title).toBe('Focus session in 1 hour');
  });

  it("leads with the user's own note, and mentions a planned length", () => {
    const c = reminderContent(plan({ note: 'thesis ch. 3', plannedS: 45 * 60 }));
    expect(c.body.startsWith('thesis ch. 3 -- ')).toBe(true);
    expect(c.body).toContain('(45m)');
  });
});

describe('shortDuration', () => {
  it('matches the phrasing the clients use', () => {
    expect(shortDuration(45 * 60)).toBe('45m');
    expect(shortDuration(60 * 60)).toBe('1h');
    expect(shortDuration(80 * 60)).toBe('1h 20m');
    // Never "0m" -- a sub-minute plan still reads as a real duration.
    expect(shortDuration(20)).toBe('1m');
  });
});

describe('chunk', () => {
  it('splits into runs of at most the given size, keeping order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });
});
