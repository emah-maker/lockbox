// Unit tests for goalProgress.ts's pure progress computation: window
// boundaries (daily + weekly, including exact-edge sessions), topic
// matching (built-in/custom/null/untagged), archived-goal exclusion, and
// the unclamped ratio when a goal is exceeded. Run with `npm test`.
import { computeGoalProgress, goalWindow } from './goalProgress';
import { Goal } from './goals';
import { LoggedSession } from '../stats/sessionHistory';

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

const session = (startedAt: number, actualS: number, topic?: string): LoggedSession => ({
  startedAt,
  plannedS: actualS,
  actualS,
  outcome: 'completed',
  topic,
});

// Wed 2024-01-10 12:00:00 local time. 2024-01-10 is a Wednesday; the
// Sunday-start week containing it runs 2024-01-07 (Sun) 00:00 through
// 2024-01-14 (Sun) 00:00.
const NOW = new Date(2024, 0, 10, 12, 0, 0).getTime();
const DAY_START = new Date(2024, 0, 10, 0, 0, 0).getTime();
const DAY_END = new Date(2024, 0, 11, 0, 0, 0).getTime();
const WEEK_START = new Date(2024, 0, 7, 0, 0, 0).getTime(); // Sunday
const WEEK_END = new Date(2024, 0, 14, 0, 0, 0).getTime(); // next Sunday

describe('goalWindow', () => {
  it('computes the daily window as local midnight to next local midnight', () => {
    expect(goalWindow('daily', NOW)).toEqual({ startMs: DAY_START, endMs: DAY_END });
  });

  it('computes the weekly window as Sunday-start (matches CalendarScreen.tsx/focusStats.js convention)', () => {
    expect(goalWindow('weekly', NOW)).toEqual({ startMs: WEEK_START, endMs: WEEK_END });
  });
});

describe('computeGoalProgress -- daily window boundaries', () => {
  it('counts a session exactly at the window start', () => {
    const [p] = computeGoalProgress([goal({ targetS: 3600 })], [session(DAY_START, 100)], NOW);
    expect(p.focusS).toBe(100);
  });

  it('excludes a session exactly at the window end (belongs to the next day)', () => {
    const [p] = computeGoalProgress([goal({ targetS: 3600 })], [session(DAY_END, 100)], NOW);
    expect(p.focusS).toBe(0);
  });

  it('excludes a session one ms before the window start (belongs to the previous day)', () => {
    const [p] = computeGoalProgress([goal({ targetS: 3600 })], [session(DAY_START - 1, 100)], NOW);
    expect(p.focusS).toBe(0);
  });

  it('counts a session one ms before the window end', () => {
    const [p] = computeGoalProgress([goal({ targetS: 3600 })], [session(DAY_END - 1, 100)], NOW);
    expect(p.focusS).toBe(100);
  });
});

describe('computeGoalProgress -- weekly window boundaries', () => {
  it('counts a session exactly at the window start (Sunday midnight)', () => {
    const [p] = computeGoalProgress([goal({ period: 'weekly', targetS: 36000 })], [session(WEEK_START, 100)], NOW);
    expect(p.focusS).toBe(100);
  });

  it('excludes a session exactly at the window end (next Sunday midnight)', () => {
    const [p] = computeGoalProgress([goal({ period: 'weekly', targetS: 36000 })], [session(WEEK_END, 100)], NOW);
    expect(p.focusS).toBe(0);
  });

  it('excludes a session one ms before the window start', () => {
    const [p] = computeGoalProgress([goal({ period: 'weekly', targetS: 36000 })], [session(WEEK_START - 1, 100)], NOW);
    expect(p.focusS).toBe(0);
  });

  it('counts a session one ms before the window end', () => {
    const [p] = computeGoalProgress([goal({ period: 'weekly', targetS: 36000 })], [session(WEEK_END - 1, 100)], NOW);
    expect(p.focusS).toBe(100);
  });
});

describe('computeGoalProgress -- topic matching', () => {
  it('a topic: null goal counts every session in-window regardless of topic, including untagged', () => {
    const sessions = [session(NOW, 100, 'work'), session(NOW, 200, 'custom:abc'), session(NOW, 300, undefined)];
    const [p] = computeGoalProgress([goal({ topic: null, targetS: 3600 })], sessions, NOW);
    expect(p.focusS).toBe(600);
  });

  it('a built-in-topic goal only counts sessions with that exact topic string', () => {
    const sessions = [session(NOW, 100, 'work'), session(NOW, 200, 'study')];
    const [p] = computeGoalProgress([goal({ topic: 'work', targetS: 3600 })], sessions, NOW);
    expect(p.focusS).toBe(100);
  });

  it('a custom:-topic goal matches only that exact custom label id, raw string compare', () => {
    const sessions = [session(NOW, 100, 'custom:abc'), session(NOW, 200, 'custom:xyz')];
    const [p] = computeGoalProgress([goal({ topic: 'custom:abc', targetS: 3600 })], sessions, NOW);
    expect(p.focusS).toBe(100);
  });

  it('a custom:-topic goal still matches sessions tagged with a since-deleted custom label id (no resolution against a live catalog)', () => {
    // There is no CustomLabel catalog passed in at all -- proof that matching
    // is purely a raw-string compare, per the contract's explicit requirement.
    const sessions = [session(NOW, 100, 'custom:deleted-label')];
    const [p] = computeGoalProgress([goal({ topic: 'custom:deleted-label', targetS: 3600 })], sessions, NOW);
    expect(p.focusS).toBe(100);
  });

  it('an untagged session never counts toward a topic-specific goal', () => {
    const sessions = [session(NOW, 100, undefined)];
    const [p] = computeGoalProgress([goal({ topic: 'work', targetS: 3600 })], sessions, NOW);
    expect(p.focusS).toBe(0);
  });
});

describe('computeGoalProgress -- output shape and archived exclusion', () => {
  it('returns remainingS, ratio, and met for a partially-met goal', () => {
    const [p] = computeGoalProgress([goal({ targetS: 1000 })], [session(NOW, 400)], NOW);
    expect(p).toMatchObject({ goalId: 'goal:a', period: 'daily', targetS: 1000, focusS: 400, remainingS: 600, ratio: 0.4, met: false });
  });

  it('reports met: true and remainingS: 0 exactly at target', () => {
    const [p] = computeGoalProgress([goal({ targetS: 1000 })], [session(NOW, 1000)], NOW);
    expect(p).toMatchObject({ remainingS: 0, ratio: 1, met: true });
  });

  it('leaves ratio unclamped above 1 when a goal is exceeded, while remainingS floors at 0', () => {
    const [p] = computeGoalProgress([goal({ targetS: 1000 })], [session(NOW, 1800)], NOW);
    expect(p.ratio).toBe(1.8);
    expect(p.remainingS).toBe(0);
    expect(p.met).toBe(true);
  });

  it('excludes archived goals from the result entirely', () => {
    const goals = [goal({ id: 'goal:live' }), goal({ id: 'goal:gone', archived: true })];
    const result = computeGoalProgress(goals, [session(NOW, 100)], NOW);
    expect(result.map((p) => p.goalId)).toEqual(['goal:live']);
  });

  it('computes independent progress per goal in input order', () => {
    const goals = [goal({ id: 'goal:a', topic: 'work', targetS: 1000 }), goal({ id: 'goal:b', topic: 'study', targetS: 2000 })];
    const sessions = [session(NOW, 100, 'work'), session(NOW, 200, 'study')];
    const result = computeGoalProgress(goals, sessions, NOW);
    expect(result.map((p) => p.goalId)).toEqual(['goal:a', 'goal:b']);
    expect(result[0].focusS).toBe(100);
    expect(result[1].focusS).toBe(200);
  });
});
