// Unit tests for goalProgress.ts's pure progress computation: window
// boundaries (daily + weekly + monthly, including exact-edge sessions),
// topic matching (built-in/custom/null/untagged), archived-goal exclusion,
// the unclamped ratio when a goal is exceeded, and the flexible-goals
// extension (daysOfWeek/dueToday, targetSessions/sessionCount/sessionsMet,
// and the combined `met`). Run with `npm test`.
import { computeGoalProgress, goalDisplayPercent, goalWindow, isGoalDueOn } from './goalProgress';
import { Goal } from './goals';
import { LoggedSession } from '../stats/sessionHistory';
import { CustomLabel } from '../stats/customLabels';

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
const MONTH_START = new Date(2024, 0, 1, 0, 0, 0).getTime(); // Jan 1
const MONTH_END = new Date(2024, 1, 1, 0, 0, 0).getTime(); // Feb 1

describe('goalWindow', () => {
  it('computes the daily window as local midnight to next local midnight', () => {
    expect(goalWindow('daily', NOW)).toEqual({ startMs: DAY_START, endMs: DAY_END });
  });

  it('computes the weekly window as Sunday-start (matches CalendarScreen.tsx/focusStats.js convention)', () => {
    expect(goalWindow('weekly', NOW)).toEqual({ startMs: WEEK_START, endMs: WEEK_END });
  });

  it('computes the monthly window as the 1st of the month through the 1st of the next month', () => {
    expect(goalWindow('monthly', NOW)).toEqual({ startMs: MONTH_START, endMs: MONTH_END });
  });

  it('rolls the monthly window over into January of the next year for a December `nowMs`', () => {
    const decemberNow = new Date(2024, 11, 15).getTime();
    expect(goalWindow('monthly', decemberNow)).toEqual({
      startMs: new Date(2024, 11, 1).getTime(),
      endMs: new Date(2025, 0, 1).getTime(),
    });
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

describe('computeGoalProgress -- monthly window boundaries', () => {
  it('counts a session exactly at the window start (the 1st, midnight)', () => {
    const [p] = computeGoalProgress([goal({ period: 'monthly', targetS: 100000 })], [session(MONTH_START, 100)], NOW);
    expect(p.focusS).toBe(100);
  });

  it('excludes a session exactly at the window end (the 1st of next month)', () => {
    const [p] = computeGoalProgress([goal({ period: 'monthly', targetS: 100000 })], [session(MONTH_END, 100)], NOW);
    expect(p.focusS).toBe(0);
  });

  it('excludes a session one ms before the window start', () => {
    const [p] = computeGoalProgress([goal({ period: 'monthly', targetS: 100000 })], [session(MONTH_START - 1, 100)], NOW);
    expect(p.focusS).toBe(0);
  });

  it('counts a session one ms before the window end', () => {
    const [p] = computeGoalProgress([goal({ period: 'monthly', targetS: 100000 })], [session(MONTH_END - 1, 100)], NOW);
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

describe('computeGoalProgress -- excludeFromTotals labels', () => {
  const sleepLabel: CustomLabel[] = [{ id: 'custom:sleep', name: 'Sleep', color: '#123456', excludeFromTotals: true }];

  it('an excluded label never advances an all-focus (topic: null) goal', () => {
    const sessions = [session(NOW, 100, 'work'), session(NOW, 28800, 'custom:sleep')];
    const [p] = computeGoalProgress([goal({ topic: null, targetS: 3600 })], sessions, NOW, sleepLabel);
    expect(p.focusS).toBe(100);
    expect(p.sessionCount).toBe(1);
  });

  it('an excluded label does not advance a goal explicitly aimed at that same label id', () => {
    const sessions = [session(NOW, 28800, 'custom:sleep')];
    const [p] = computeGoalProgress([goal({ topic: 'custom:sleep', targetS: 3600 })], sessions, NOW, sleepLabel);
    expect(p.focusS).toBe(0);
    expect(p.sessionCount).toBe(0);
  });

  it('omitting labels counts everything, same as before this parameter existed', () => {
    const sessions = [session(NOW, 28800, 'custom:sleep')];
    const [p] = computeGoalProgress([goal({ topic: null, targetS: 3600 })], sessions, NOW);
    expect(p.focusS).toBe(28800);
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

  it('guards against divide-by-zero: an invalid (0) targetS computes ratio: 0, not NaN/Infinity', () => {
    const [p] = computeGoalProgress([goal({ targetS: 0 })], [session(NOW, 400)], NOW);
    expect(p.ratio).toBe(0);
    expect(Number.isNaN(p.ratio)).toBe(false);
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

// NOW is a Wednesday (2024-01-10, Date#getDay() === 3).
describe('isGoalDueOn / dueToday -- day-restricted daily goals', () => {
  it('is always true for a daily goal with no daysOfWeek restriction', () => {
    expect(isGoalDueOn(goal({ period: 'daily' }), NOW)).toBe(true);
    expect(isGoalDueOn(goal({ period: 'daily', daysOfWeek: [] }), NOW)).toBe(true);
  });

  it('is always true for weekly/monthly goals, even ones that happen to carry a stray daysOfWeek', () => {
    expect(isGoalDueOn(goal({ period: 'weekly' }), NOW)).toBe(true);
    expect(isGoalDueOn(goal({ period: 'monthly' }), NOW)).toBe(true);
    expect(isGoalDueOn({ ...goal({ period: 'weekly' }), daysOfWeek: [0] } as Goal, NOW)).toBe(true);
  });

  it('is true only on a selected weekday for a day-restricted daily goal', () => {
    const mondayWednesdayFriday = goal({ period: 'daily', daysOfWeek: [1, 3, 5] });
    expect(isGoalDueOn(mondayWednesdayFriday, NOW)).toBe(true); // Wednesday
    const tuesdayThursday = goal({ period: 'daily', daysOfWeek: [2, 4] });
    expect(isGoalDueOn(tuesdayThursday, NOW)).toBe(false); // Wednesday is not selected
  });

  it('computeGoalProgress reports dueToday: true for an ordinary goal and reflects isGoalDueOn for a restricted one', () => {
    const [ordinary] = computeGoalProgress([goal({ period: 'daily' })], [], NOW);
    expect(ordinary.dueToday).toBe(true);

    const [dueOffDay] = computeGoalProgress([goal({ period: 'daily', daysOfWeek: [2, 4] })], [], NOW);
    expect(dueOffDay.dueToday).toBe(false);

    const [dueOnDay] = computeGoalProgress([goal({ period: 'daily', daysOfWeek: [1, 3, 5] })], [], NOW);
    expect(dueOnDay.dueToday).toBe(true);
  });

  it('still counts a session logged on an off day toward focusS/sessionCount -- dueToday only flags the day, it never excludes real progress', () => {
    const offDayGoal = goal({ period: 'daily', daysOfWeek: [2, 4], targetS: 1000 }); // Wednesday is not selected
    const [p] = computeGoalProgress([offDayGoal], [session(NOW, 500)], NOW);
    expect(p.dueToday).toBe(false);
    expect(p.focusS).toBe(500);
  });
});

describe('computeGoalProgress -- session-count target (targetSessions/sessionCount/sessionsMet) and combined `met`', () => {
  it('always reports sessionCount, even for a goal with no targetSessions', () => {
    const [p] = computeGoalProgress([goal({})], [session(NOW, 100), session(NOW, 200)], NOW);
    expect(p.sessionCount).toBe(2);
    expect(p.targetSessions).toBeUndefined();
    expect(p.sessionsMet).toBeUndefined();
  });

  it('only counts topic-matching, in-window sessions toward sessionCount, same filter as focusS', () => {
    const sessions = [session(NOW, 100, 'work'), session(NOW, 200, 'study'), session(DAY_END, 300, 'work')];
    const [p] = computeGoalProgress([goal({ topic: 'work' })], sessions, NOW);
    expect(p.sessionCount).toBe(1);
  });

  it('reports targetSessions and sessionsMet when the goal has a session-count target', () => {
    const withTarget = goal({ targetSessions: 2, targetS: 100 });
    const [under] = computeGoalProgress([withTarget], [session(NOW, 1000)], NOW); // 1 session, time target already met
    expect(under.targetSessions).toBe(2);
    expect(under.sessionsMet).toBe(false);
    expect(under.met).toBe(false); // time is met but the session count isn't -- met requires BOTH

    const [atTarget] = computeGoalProgress([withTarget], [session(NOW, 1000), session(NOW, 1000)], NOW);
    expect(atTarget.sessionsMet).toBe(true);
    expect(atTarget.met).toBe(true);
  });

  it('a time-only goal (no targetSessions) keeps the pre-extension met semantics exactly: met iff focusS >= targetS', () => {
    const [p] = computeGoalProgress([goal({ targetS: 1000 })], [session(NOW, 1000)], NOW);
    expect(p.met).toBe(true);
    expect(p.sessionsMet).toBeUndefined();
  });

  it('met is false when the time target is met but the session-count target is not, and vice versa', () => {
    const g = goal({ targetS: 100, targetSessions: 3 });
    const timeMetOnly = computeGoalProgress([g], [session(NOW, 500)], NOW)[0]; // 1 session well over the time target
    expect(timeMetOnly.met).toBe(false);

    const sessionsMetOnly = computeGoalProgress([g], [session(NOW, 1), session(NOW, 1), session(NOW, 1)], NOW)[0]; // 3 tiny sessions
    expect(sessionsMetOnly.sessionsMet).toBe(true);
    expect(sessionsMetOnly.met).toBe(false); // time target still not met
  });
});

// Bug this covers: a goal at 7h15m of a 25m target had its ratio (17.4,
// deliberately unclamped -- see the "leaves ratio unclamped above 1" test
// above) printed AS-IS on the Manage-goals row, the Goals-ring card, and the
// Home Today card, reading "1741%" beside a bar/ring that was already
// (correctly) capped at a single full lap. goalDisplayPercent is the one
// clamped, display-safe conversion every one of those three call sites now
// goes through instead of re-deriving its own `Math.round(ratio * 100)`.
describe('goalDisplayPercent', () => {
  it('caps a wildly-over-target ratio at 100, matching an already-full bar/ring', () => {
    // The reported case: 7h15m (26100s) of focus against a 25m (1500s) daily
    // target -- ratio 17.4, i.e. 1740%/"1741%" if left unclamped and rounded.
    const ratio = 26100 / 1500;
    expect(goalDisplayPercent(ratio)).toBe(100);
  });

  it('reports 100 exactly at target', () => {
    expect(goalDisplayPercent(1)).toBe(100);
  });

  it('reports 0 for zero progress', () => {
    expect(goalDisplayPercent(0)).toBe(0);
  });

  it('guards against a non-finite ratio (e.g. from an upstream divide-by-zero), showing 0 rather than NaN%/Infinity%', () => {
    expect(goalDisplayPercent(NaN)).toBe(0);
    expect(goalDisplayPercent(Infinity)).toBe(0);
    expect(goalDisplayPercent(-Infinity)).toBe(0);
  });

  it('leaves an under-target ratio exactly as before -- the Solidworks 15m-of-25m case', () => {
    expect(goalDisplayPercent(15 / 25)).toBe(60);
  });
});
