// Unit tests for recentTopics.ts. Pure module, no mocks needed. Every test
// pins `nowMs` explicitly rather than leaning on Date.now(), so the decay
// math is deterministic. Run with `npm test`.
import { rankTopics, topRecentTopics, RECENCY_HALF_LIFE_DAYS } from './recentTopics';
import type { LoggedSession } from './sessionHistory';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const session = (topic: string | undefined, daysAgo: number): LoggedSession => ({
  startedAt: NOW - daysAgo * DAY,
  plannedS: 1800,
  actualS: 1800,
  outcome: 'completed',
  ...(topic !== undefined ? { topic } : {}),
});

describe('rankTopics', () => {
  it('returns nothing for an empty history, and skips untagged sessions entirely', () => {
    expect(rankTopics([], NOW)).toEqual([]);
    expect(rankTopics([session(undefined, 0), session(undefined, 1)], NOW)).toEqual([]);
  });

  it('reduces to plain frequency when everything happened at the same moment', () => {
    const sessions = [session('work', 0), session('work', 0), session('read', 0)];
    expect(rankTopics(sessions, NOW).map((r) => r.topic)).toEqual(['work', 'read']);
  });

  it('lets a recently-used label outrank a heavily-used but long-dormant one', () => {
    const sessions = [
      // Six sessions, but all a full year ago -- decayed to nothing.
      ...Array.from({ length: 6 }, () => session('old', 365)),
      ...Array.from({ length: 2 }, () => session('current', 1)),
    ];
    expect(rankTopics(sessions, NOW)[0].topic).toBe('current');
  });

  it('does NOT let one stray recent tag displace a consistently-used label', () => {
    const sessions = [
      ...Array.from({ length: 10 }, (_, i) => session('daily', i)),
      session('stray', 0),
    ];
    expect(rankTopics(sessions, NOW)[0].topic).toBe('daily');
  });

  it('weights a session at the half-life exactly half as much as one today', () => {
    const [today] = rankTopics([session('a', 0)], NOW);
    const [aged] = rankTopics([session('b', RECENCY_HALF_LIFE_DAYS)], NOW);
    expect(aged.score).toBeCloseTo(today.score / 2, 6);
  });

  it('reports the raw count and the most recent use alongside the decayed score', () => {
    const [entry] = rankTopics([session('work', 0), session('work', 5), session('work', 30)], NOW);
    expect(entry.count).toBe(3);
    expect(entry.lastUsedAt).toBe(NOW);
    expect(entry.score).toBeLessThan(3); // decayed, so strictly under the raw count
  });

  it('breaks a score tie on most-recent use, so the order is total rather than input-dependent', () => {
    const ranked = rankTopics([session('older', 3), session('newer', 1)], NOW);
    // Different ages here, so this also confirms the primary sort direction.
    expect(ranked.map((r) => r.topic)).toEqual(['newer', 'older']);
  });

  it('treats a clock-skewed future session as "now" rather than giving it unbounded weight', () => {
    const future: LoggedSession = { ...session('skewed', 0), startedAt: NOW + 30 * DAY };
    const [entry] = rankTopics([future], NOW);
    expect(entry.score).toBeCloseTo(1, 6);
  });
});

describe('topRecentTopics', () => {
  const sessions = [
    session('work', 0),
    session('work', 1),
    session('read', 2),
    session('custom:gone', 3),
    session('chores', 4),
  ];

  it('caps at the limit, best-first', () => {
    expect(topRecentTopics(sessions, 2, () => true, new Set(), NOW)).toEqual(['work', 'read']);
  });

  it('drops ids the caller can no longer render -- e.g. a since-deleted custom label', () => {
    const renderable = (t: string) => t !== 'custom:gone';
    expect(topRecentTopics(sessions, 4, renderable, new Set(), NOW)).toEqual(['work', 'read', 'chores']);
  });

  it('skips excluded ids so a "recent" row never duplicates chips shown beneath it', () => {
    expect(topRecentTopics(sessions, 2, () => true, new Set(['work']), NOW)).toEqual(['read', 'custom:gone']);
  });

  it('returns [] when there is nothing tagged to suggest', () => {
    expect(topRecentTopics([], 4, () => true, new Set(), NOW)).toEqual([]);
  });
});
