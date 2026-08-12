// Unit tests for sessionHistory.ts's pure retag transform. The storage-backed
// wrappers (retagSession, appendSessions, etc.) aren't unit-tested here, same
// as the rest of this file -- only the pure logic is. Run with `npm test`.
import { applyTopicUpdate, buildLoggedSessions, filterByWindow, LoggedSession } from './sessionHistory';
import type { HistoryEntry } from '../ble/protocol';

const session = (startedAt: number, plannedS: number, actualS: number, topic?: string): LoggedSession => ({
  startedAt,
  plannedS,
  actualS,
  outcome: 'completed',
  topic,
});

describe('applyTopicUpdate', () => {
  it('retags only the session matching the startedAt+plannedS+actualS triple', () => {
    const sessions = [session(1, 60, 60, 'work'), session(2, 120, 120, 'study')];
    const next = applyTopicUpdate(sessions, { startedAt: 2, plannedS: 120, actualS: 120 }, 'custom:abc');
    expect(next[0].topic).toBe('work');
    expect(next[1].topic).toBe('custom:abc');
  });

  it('clears a tag when given undefined', () => {
    const sessions = [session(1, 60, 60, 'work')];
    const next = applyTopicUpdate(sessions, { startedAt: 1, plannedS: 60, actualS: 60 }, undefined);
    expect(next[0].topic).toBeUndefined();
  });

  it('leaves the array unchanged (a same-length copy) when no session matches', () => {
    const sessions = [session(1, 60, 60, 'work')];
    const next = applyTopicUpdate(sessions, { startedAt: 999, plannedS: 1, actualS: 1 }, 'study');
    expect(next).toEqual(sessions);
    expect(next).not.toBe(sessions);
  });

  it('does not mutate the input array', () => {
    const sessions = [session(1, 60, 60, 'work')];
    applyTopicUpdate(sessions, { startedAt: 1, plannedS: 60, actualS: 60 }, 'study');
    expect(sessions[0].topic).toBe('work');
  });
});

const entry = (p: number, a: number, c: 0 | 1, t: number): HistoryEntry => ({ p, a, c, t });

describe('buildLoggedSessions', () => {
  it('discards entries under 60 actual seconds', () => {
    const { sessions } = buildLoggedSessions([entry(60, 59, 1, 1000), entry(60, 60, 1, 2000)], null, 5000);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].actualS).toBe(60);
  });

  it('keeps a 60-second entry exactly at the threshold', () => {
    const { sessions } = buildLoggedSessions([entry(60, 60, 1, 1000)], null, 5000);
    expect(sessions).toHaveLength(1);
  });

  it('matches a pending tag to the entry whose window contains it and reports it consumed', () => {
    // entry ends at t=1000s (started at 940s); tag applied at 995s falls inside.
    const pending = { topic: 'work', at: 995_000 };
    const { sessions, consumedPendingTopic } = buildLoggedSessions([entry(60, 60, 1, 1000)], pending, 5000);
    expect(consumedPendingTopic).toBe(true);
    expect(sessions[0].topic).toBe('work');
  });

  it('does not consume a pending tag whose timestamp falls outside every surviving entry (and outside slack)', () => {
    const pending = { topic: 'work', at: 500_000 };
    const { sessions, consumedPendingTopic } = buildLoggedSessions([entry(60, 60, 1, 1000)], pending, 5000);
    expect(consumedPendingTopic).toBe(false);
    expect(sessions[0].topic).toBeUndefined();
  });

  it('never lets a discarded sub-60s entry consume the pending tag', () => {
    // The tag's timestamp falls inside the short (discarded) entry's window only.
    const pending = { topic: 'work', at: 995_000 };
    const { sessions, consumedPendingTopic } = buildLoggedSessions([entry(60, 30, 1, 1000)], pending, 5000);
    expect(sessions).toHaveLength(0);
    expect(consumedPendingTopic).toBe(false);
  });

  it('matches a tag applied before the session started, within preSlackMs', () => {
    // entry starts at t=940s; tag applied 30s before that, with a 120s pre-window.
    const pending = { topic: 'work', at: 910_000 };
    const { sessions, consumedPendingTopic } = buildLoggedSessions(
      [entry(60, 60, 1, 1000)],
      pending,
      5000,
      120_000,
    );
    expect(consumedPendingTopic).toBe(true);
    expect(sessions[0].topic).toBe('work');
  });

  it('does not match a pre-session tag applied earlier than preSlackMs allows', () => {
    const pending = { topic: 'work', at: 500_000 };
    const { sessions, consumedPendingTopic } = buildLoggedSessions(
      [entry(60, 60, 1, 1000)],
      pending,
      5000,
      120_000,
    );
    expect(consumedPendingTopic).toBe(false);
    expect(sessions[0].topic).toBeUndefined();
  });
});

describe('filterByWindow', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime(); // Jun 15 2026, noon local

  const at = (daysAgo: number): LoggedSession => session(now - daysAgo * 86_400_000, 60, 60);

  it('"all" returns every session unfiltered', () => {
    const sessions = [at(0), at(10), at(400)];
    expect(filterByWindow(sessions, 'all', now)).toEqual(sessions);
  });

  it('"day" keeps only sessions from today', () => {
    const sessions = [at(0), at(1)];
    expect(filterByWindow(sessions, 'day', now)).toEqual([sessions[0]]);
  });

  it('"week" keeps the trailing 7 calendar days including today, excludes the 8th day back', () => {
    const sessions = [at(0), at(6), at(7)];
    expect(filterByWindow(sessions, 'week', now)).toEqual([sessions[0], sessions[1]]);
  });

  it('"month" keeps the trailing 30 calendar days including today, excludes the 31st day back', () => {
    const sessions = [at(0), at(29), at(30)];
    expect(filterByWindow(sessions, 'month', now)).toEqual([sessions[0], sessions[1]]);
  });
});
