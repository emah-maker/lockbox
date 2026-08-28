// Unit tests for monthGrid.ts's pure grid/summary/streak/goal-marker math.
// Matches stats/sessionHistory.test.ts's style: small local factories, fixed
// `nowMs`/dates instead of racing the real clock. Run with `npm test`.
import {
  buildGrid,
  computeMonthSummary,
  computeStreak,
  computeStreakRuns,
  goalsMetOnDay,
  monthHeatLevels,
  startOfMonth,
} from './monthGrid';
import { dayKey, groupByDay, LoggedSession } from '../../stats/sessionHistory';
import { Goal } from '../../goals/goals';

const session = (startedAt: number, actualS: number, topic?: string): LoggedSession => ({
  startedAt,
  plannedS: actualS,
  actualS,
  outcome: 'completed',
  topic,
});

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

describe('buildGrid', () => {
  it('pads leading cells so day 1 lands on its real weekday', () => {
    // Feb 2024: the 1st is a Thursday (weekday 4).
    const grid = buildGrid(new Date(2024, 1, 1));
    expect(grid.slice(0, 4)).toEqual([null, null, null, null]);
    expect(grid[4]).toEqual(new Date(2024, 1, 1));
  });

  it('pads the trailing partial week to a multiple of 7', () => {
    const grid = buildGrid(new Date(2024, 1, 1));
    expect(grid.length % 7).toBe(0);
  });
});

describe('computeStreak', () => {
  // Wed 2024-01-10.
  const TODAY = new Date(2024, 0, 10, 9, 0, 0).getTime();
  const dayMs = (offset: number) => new Date(2024, 0, 10 + offset, 12, 0, 0).getTime();

  it('counts back from today when today already has a session', () => {
    const byDay = groupByDay([
      session(dayMs(0), 100),
      session(dayMs(-1), 100),
      session(dayMs(-2), 100),
    ]);
    expect(computeStreak(byDay, TODAY)).toBe(3);
  });

  it('does not break the streak when today has no session yet, but does not count today either', () => {
    const byDay = groupByDay([session(dayMs(-1), 100), session(dayMs(-2), 100)]);
    expect(computeStreak(byDay, TODAY)).toBe(2);
  });

  it('stops at the first gap', () => {
    const byDay = groupByDay([session(dayMs(0), 100), session(dayMs(-2), 100)]);
    expect(computeStreak(byDay, TODAY)).toBe(1);
  });

  it('is 0 with no sessions at all', () => {
    expect(computeStreak(new Map(), TODAY)).toBe(0);
  });
});

describe('computeMonthSummary', () => {
  it('totals focus time and finds the best day only among the grid\'s own cells', () => {
    const jan1 = new Date(2024, 0, 1).getTime();
    const jan2 = new Date(2024, 0, 2).getTime();
    const dec31_2023 = new Date(2023, 11, 31).getTime(); // outside Jan 2024's grid range's real days
    const byDay = groupByDay([session(jan1, 100), session(jan2, 500), session(dec31_2023, 9999)]);
    const grid = buildGrid(startOfMonth(new Date(2024, 0, 1)));
    const summary = computeMonthSummary(grid, byDay, jan2);
    expect(summary.totalFocusS).toBe(600);
    expect(summary.bestDayKey).toBe('2024-01-02');
    expect(summary.bestDayFocusS).toBe(500);
  });

  it('reports streakDays independent of which month is displayed', () => {
    const nowMs = new Date(2024, 2, 15, 9, 0, 0).getTime(); // March, streak built in Jan
    const byDay = groupByDay([session(new Date(2024, 2, 15, 8).getTime(), 100)]);
    const grid = buildGrid(startOfMonth(new Date(2024, 0, 1))); // viewing January
    expect(computeMonthSummary(grid, byDay, nowMs).streakDays).toBe(1);
  });
});

describe('goalsMetOnDay', () => {
  it('reports a daily goal met on the exact day it was satisfied', () => {
    const day = new Date(2024, 0, 10, 12, 0, 0);
    const sessions = [session(new Date(2024, 0, 10, 8).getTime(), 3600, 'work')];
    const goals = [goal({ id: 'g1', topic: 'work', targetS: 3600 })];
    const met = goalsMetOnDay(goals, sessions, day);
    expect(met.map((r) => r.goalId)).toEqual(['g1']);
  });

  it('reports a weekly goal met on every day of the week it was satisfied, not just the day it finished', () => {
    // Sun 2024-01-07 through Sat 2024-01-13.
    const goals = [goal({ id: 'g1', topic: null, period: 'weekly', targetS: 3600 })];
    const sessions = [session(new Date(2024, 0, 12, 8).getTime(), 3600)]; // Friday
    const monday = new Date(2024, 0, 8, 12, 0, 0);
    const met = goalsMetOnDay(goals, sessions, monday);
    expect(met.map((r) => r.goalId)).toEqual(['g1']);
  });

  it('excludes an unmet goal', () => {
    const goals = [goal({ id: 'g1', targetS: 3600 })];
    const sessions = [session(new Date(2024, 0, 10, 8).getTime(), 100)];
    expect(goalsMetOnDay(goals, sessions, new Date(2024, 0, 10, 12))).toHaveLength(0);
  });

  it('excludes an archived goal', () => {
    const goals = [goal({ id: 'g1', targetS: 60, archived: true })];
    const sessions = [session(new Date(2024, 0, 10, 8).getTime(), 100)];
    expect(goalsMetOnDay(goals, sessions, new Date(2024, 0, 10, 12))).toHaveLength(0);
  });

  it('excludes a day-restricted daily goal on an off day, even if it was otherwise met', () => {
    // 2024-01-10 is a Wednesday (weekday 3). Restrict the goal to Mon/Fri (1, 5).
    const goals = [goal({ id: 'g1', targetS: 3600, daysOfWeek: [1, 5] })];
    const sessions = [session(new Date(2024, 0, 10, 8).getTime(), 3600)];
    expect(goalsMetOnDay(goals, sessions, new Date(2024, 0, 10, 12))).toHaveLength(0);
  });

  it('includes a day-restricted daily goal on a due day it met', () => {
    // 2024-01-12 is a Friday (weekday 5).
    const goals = [goal({ id: 'g1', targetS: 3600, daysOfWeek: [1, 5] })];
    const sessions = [session(new Date(2024, 0, 12, 8).getTime(), 3600)];
    expect(goalsMetOnDay(goals, sessions, new Date(2024, 0, 12, 12)).map((r) => r.goalId)).toEqual(['g1']);
  });
});

// July 2024: July 1 is a Monday (weekday 1), 31 days -- so buildGrid pads
// exactly 1 leading null (index 0, June 30) and 3 trailing nulls (indices
// 32-34, Aug 1-3), with July 1..31 at grid indices 1..31. Chosen deliberately
// over a month that pads only one side, so the same fixture can exercise
// both a leading-padding boundary and a trailing-padding boundary.
const JULY_GRID = buildGrid(startOfMonth(new Date(2024, 6, 1)));
const july = (day: number) => new Date(2024, 6, day).getTime();

describe('monthHeatLevels', () => {
  it('is level 0 everywhere in an empty month', () => {
    const levels = monthHeatLevels(JULY_GRID, new Map());
    for (const date of JULY_GRID) {
      if (!date) continue;
      expect(levels.get(dayKey(date.getTime()))).toBe(0);
    }
  });

  it('puts a single busy day at level 4 and leaves every other day at 0', () => {
    const byDay = groupByDay([session(july(10), 1000)]);
    const levels = monthHeatLevels(JULY_GRID, byDay);
    expect(levels.get(dayKey(july(10)))).toBe(4);
    expect(levels.get(dayKey(july(11)))).toBe(0);
    expect(levels.get(dayKey(july(1)))).toBe(0);
  });

  it('puts every day tied for the month max at level 4', () => {
    const byDay = groupByDay([session(july(5), 500), session(july(20), 500)]);
    const levels = monthHeatLevels(JULY_GRID, byDay);
    expect(levels.get(dayKey(july(5)))).toBe(4);
    expect(levels.get(dayKey(july(20)))).toBe(4);
  });

  it('buckets a mid-range day (relative to the month max) onto an intermediate level', () => {
    // ratio 300/1000 = 0.3, which is > 0.25 and <= 0.5 -> level 2.
    const byDay = groupByDay([session(july(5), 1000), session(july(12), 300)]);
    const levels = monthHeatLevels(JULY_GRID, byDay);
    expect(levels.get(dayKey(july(5)))).toBe(4);
    expect(levels.get(dayKey(july(12)))).toBe(2);
  });
});

describe('computeStreakRuns', () => {
  it('returns no runs when nothing in the month has focus time', () => {
    expect(computeStreakRuns(JULY_GRID, new Map())).toEqual([]);
  });

  it('does not let a run cross the leading or trailing null padding', () => {
    // July 1 (grid index 1) sits right after the single leading null (index
    // 0); July 31 (grid index 31) sits right before the trailing nulls
    // (index 32+). Neither isolated day should merge with its null neighbor.
    const byDay = groupByDay([session(july(1), 100), session(july(31), 100)]);
    const runs = computeStreakRuns(JULY_GRID, byDay);
    expect(runs).toEqual([
      { startIndex: 1, endIndex: 1, length: 1 },
      { startIndex: 31, endIndex: 31, length: 1 },
    ]);
  });

  it('reports two separate runs within the same month', () => {
    const byDay = groupByDay([
      session(july(5), 100),
      session(july(6), 100),
      session(july(7), 100),
      session(july(20), 100),
      session(july(21), 100),
      session(july(22), 100),
    ]);
    const runs = computeStreakRuns(JULY_GRID, byDay);
    expect(runs).toEqual([
      { startIndex: 5, endIndex: 7, length: 3 },
      { startIndex: 20, endIndex: 22, length: 3 },
    ]);
  });

  it('reports a length-1 run for an isolated day with no adjacent focus', () => {
    const byDay = groupByDay([session(july(15), 100)]);
    const runs = computeStreakRuns(JULY_GRID, byDay);
    expect(runs).toEqual([{ startIndex: 15, endIndex: 15, length: 1 }]);
  });

  it('reports a run that touches the last day of the month without extending into trailing padding', () => {
    const byDay = groupByDay([session(july(30), 100), session(july(31), 100)]);
    const runs = computeStreakRuns(JULY_GRID, byDay);
    expect(runs).toEqual([{ startIndex: 30, endIndex: 31, length: 2 }]);
  });
});
