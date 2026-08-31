// Unit tests for goalStreakHistory.ts's pure best-streak/window-history/
// day-status helpers. Run with `npm test` (jest-expo), same convention as
// goalStreak.test.ts (whose `goal`/`session`/NOW/DAY_MS fixtures this file
// mirrors, rather than importing, so each test file stays independently
// readable -- same "small fixture, not a shared test-utils import" choice
// goalProgress.test.ts and goalStreak.test.ts already made independently of
// each other).
import { computeBestGoalStreak, goalWindowHistory, goalDayStatuses } from './goalStreakHistory';
import { Goal } from '../goals/goals';
import { LoggedSession } from './sessionHistory';
import type { CustomLabel } from './customLabels';

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

// Wed 2024-01-10 12:00:00 local time, same anchor as goalStreak.test.ts/
// goalProgress.test.ts.
const NOW = new Date(2024, 0, 10, 12, 0, 0).getTime();
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

describe('computeBestGoalStreak', () => {
  it('returns 0 for an archived goal', () => {
    const g = goal({ archived: true, targetS: 100 });
    expect(computeBestGoalStreak(g, [session(NOW, 200)], NOW)).toBe(0);
  });

  it('returns 0 for empty sessions', () => {
    const g = goal({ targetS: 100 });
    expect(computeBestGoalStreak(g, [], NOW)).toBe(0);
  });

  it('matches the live streak when there is only ever been one run', () => {
    const g = goal({ targetS: 100, period: 'daily' });
    const sessions = [
      session(NOW, 200),
      session(NOW - DAY_MS, 150),
      session(NOW - 2 * DAY_MS, 120),
    ];
    expect(computeBestGoalStreak(g, sessions, NOW)).toBe(3);
  });

  it('remembers a longer PAST run even after it has since broken', () => {
    const g = goal({ targetS: 100, period: 'daily' });
    const sessions = [
      // Today: a fresh, currently-live 1-day streak.
      session(NOW, 200),
      // Yesterday: missed -- breaks the run that includes today.
      session(NOW - DAY_MS, 1),
      // A 4-day run further back, met on each of these days.
      session(NOW - 2 * DAY_MS, 200),
      session(NOW - 3 * DAY_MS, 200),
      session(NOW - 4 * DAY_MS, 200),
      session(NOW - 5 * DAY_MS, 200),
      // Broken again before that run.
      session(NOW - 6 * DAY_MS, 1),
    ];
    // Live streak (computeGoalStreak) would read 1; best must still read 4.
    expect(computeBestGoalStreak(g, sessions, NOW)).toBe(4);
  });

  it('does not let an unfinished current window reset the running count', () => {
    const g = goal({ targetS: 100, period: 'daily' });
    const sessions = [
      session(NOW, 10), // today, not met yet -- window still open
      session(NOW - DAY_MS, 150),
      session(NOW - 2 * DAY_MS, 150),
    ];
    expect(computeBestGoalStreak(g, sessions, NOW)).toBe(2);
  });

  it('skips off days for a day-restricted goal without resetting the run', () => {
    // NOW is a Wednesday (getDay() === 3).
    const g = goal({ targetS: 100, period: 'daily', daysOfWeek: [3] });
    const sessions = [
      session(NOW, 200), // today, Wed, met
      session(NOW - DAY_MS, 5), // Tue, off day -- ignored regardless of value
      session(NOW - WEEK_MS, 200), // last Wed, met
      session(NOW - 2 * WEEK_MS, 200), // Wed before that, met
    ];
    expect(computeBestGoalStreak(g, sessions, NOW)).toBe(3);
  });

  it('walks backward through monthly windows too', () => {
    const g = goal({ targetS: 100, period: 'monthly' });
    const sessions = [
      session(new Date(2024, 0, 5).getTime(), 200), // Jan 2024, met
      session(new Date(2023, 11, 5).getTime(), 200), // Dec 2023, met
      session(new Date(2023, 10, 5).getTime(), 1), // Nov 2023, missed
      session(new Date(2023, 9, 5).getTime(), 200), // Oct 2023, met
      session(new Date(2023, 8, 5).getTime(), 200), // Sep 2023, met
      session(new Date(2023, 7, 5).getTime(), 200), // Aug 2023, met
    ];
    // A 2-window run (Jan/Dec) and a 3-window run (Oct/Sep/Aug) -- best is 3.
    expect(computeBestGoalStreak(g, sessions, NOW)).toBe(3);
  });

  it('applies excludeFromTotals label filtering the same way computeGoalStreak does', () => {
    const g = goal({ targetS: 100 });
    const sleepLabel: CustomLabel = { id: 'custom:sleep', name: 'Sleep', color: '#334155', excludeFromTotals: true };
    expect(computeBestGoalStreak(g, [session(NOW, 200, 'custom:sleep')], NOW, [sleepLabel])).toBe(0);
  });

  // Same truncation bug as goalStreak.test.ts's identical case: the walk used
  // to count every calendar step (off days included) against
  // MAX_BEST_STREAK_WINDOWS (60), so a once-a-week goal's real 10-Wednesday
  // best streak (63 days back) got silently cut short at 9.
  it('does not truncate a once-a-week goal best streak that spans more than MAX_BEST_STREAK_WINDOWS calendar days', () => {
    const g = goal({ targetS: 100, period: 'daily', daysOfWeek: [3] }); // Wednesdays only, NOW is a Wed
    const sessions: LoggedSession[] = [];
    for (let week = 0; week < 10; week++) {
      sessions.push(session(NOW - week * WEEK_MS, 200)); // 10 consecutive Wednesdays, all met
    }
    expect(computeBestGoalStreak(g, sessions, NOW)).toBe(10);
  });
});

describe('goalWindowHistory', () => {
  it('returns [] for an archived goal', () => {
    const g = goal({ archived: true });
    expect(goalWindowHistory(g, [], NOW, NOW + 5 * DAY_MS)).toEqual([]);
  });

  it('returns [] for an empty/backwards range', () => {
    const g = goal({ targetS: 100 });
    expect(goalWindowHistory(g, [], NOW, NOW)).toEqual([]);
    expect(goalWindowHistory(g, [], NOW, NOW - DAY_MS)).toEqual([]);
  });

  it('produces one entry per day for a daily goal, each with the right met/dueOn', () => {
    const g = goal({ targetS: 100, period: 'daily' });
    const day0 = new Date(2024, 0, 1).getTime();
    const day4 = new Date(2024, 0, 5).getTime(); // exclusive end -> 4 days: Jan 1-4
    const sessions = [
      session(new Date(2024, 0, 1, 10).getTime(), 200), // met
      session(new Date(2024, 0, 2, 10).getTime(), 1), // not met
      // Jan 3: no sessions at all -- not met.
      session(new Date(2024, 0, 4, 10).getTime(), 500), // met
    ];
    const history = goalWindowHistory(g, sessions, day0, day4);
    expect(history).toHaveLength(4);
    expect(history.map((h) => h.met)).toEqual([true, false, false, true]);
    expect(history.every((h) => h.dueOn)).toBe(true);
    // Entries are contiguous and oldest-first.
    expect(history[0].startMs).toBe(day0);
    expect(history[1].startMs).toBe(history[0].endMs);
    expect(history[3].endMs).toBe(day4);
  });

  it('reports an off-day window as dueOn:false, met:false -- never a miss', () => {
    // Jan 1 2024 is a Monday; restrict to Wednesdays only (getDay() === 3).
    const g = goal({ targetS: 100, period: 'daily', daysOfWeek: [3] });
    const from = new Date(2024, 0, 1).getTime();
    const to = new Date(2024, 0, 8).getTime(); // Jan 1 - Jan 7, one full week
    // Even a huge session on an off day must not flip dueOn to true.
    const sessions = [session(new Date(2024, 0, 1, 10).getTime(), 999999)];
    const history = goalWindowHistory(g, sessions, from, to);
    expect(history).toHaveLength(7);
    const wednesday = history.find((h) => new Date(h.startMs).getDay() === 3)!;
    expect(wednesday.dueOn).toBe(true);
    expect(wednesday.met).toBe(false); // due, but no session landed on it
    for (const entry of history) {
      if (new Date(entry.startMs).getDay() !== 3) {
        expect(entry.dueOn).toBe(false);
        expect(entry.met).toBe(false);
      }
    }
  });

  it('produces one entry per week for a weekly goal spanning a multi-week range', () => {
    const g = goal({ targetS: 100, period: 'weekly' });
    const from = new Date(2024, 0, 1).getTime(); // Mon Jan 1 2024
    const to = new Date(2024, 0, 22).getTime(); // 3 Sunday-start weeks later
    const history = goalWindowHistory(g, [session(new Date(2024, 0, 3).getTime(), 200)], from, to);
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history.length).toBeLessThanOrEqual(4); // Jan 1 doesn't fall on a Sunday, so the range can straddle a partial week
    expect(history.filter((h) => h.met)).toHaveLength(1);
  });

  it('produces one entry per month for a monthly goal, respecting short/long months (DST-ish boundary)', () => {
    const g = goal({ targetS: 100, period: 'monthly' });
    // Spans Jan (31d), Feb 2024 (29d, leap year), and into March -- exercises
    // monthlyWindow's own Date-overflow rollover the same way
    // goalProgress.test.ts's monthly tests do.
    const from = new Date(2024, 0, 1).getTime();
    const to = new Date(2024, 2, 1).getTime();
    const history = goalWindowHistory(g, [session(new Date(2024, 1, 15).getTime(), 200)], from, to);
    expect(history).toHaveLength(2);
    expect(history[0].startMs).toBe(new Date(2024, 0, 1).getTime());
    expect(history[0].endMs).toBe(new Date(2024, 1, 1).getTime());
    expect(history[1].endMs).toBe(new Date(2024, 2, 1).getTime());
    expect(history.map((h) => h.met)).toEqual([false, true]);
  });

  it('applies excludeFromTotals label filtering', () => {
    const g = goal({ targetS: 100, period: 'daily' });
    const sleepLabel: CustomLabel = { id: 'custom:sleep', name: 'Sleep', color: '#334155', excludeFromTotals: true };
    const from = new Date(2024, 0, 1).getTime();
    const to = new Date(2024, 0, 2).getTime();
    const history = goalWindowHistory(
      g,
      [session(new Date(2024, 0, 1, 10).getTime(), 200, 'custom:sleep')],
      from,
      to,
      [sleepLabel],
    );
    expect(history[0].met).toBe(false);
  });
});

describe('goalDayStatuses', () => {
  it('excludes archived goals', () => {
    const g = goal({ archived: true, targetS: 100 });
    expect(goalDayStatuses([g], [session(NOW, 200)], new Date(NOW))).toEqual([]);
  });

  it('reports met/dueOn per goal for the day', () => {
    const metGoal = goal({ id: 'goal:met', targetS: 100 });
    const missedGoal = goal({ id: 'goal:missed', targetS: 100 });
    const sessions = [session(NOW, 200, undefined)];
    // Both goals are topic:null (all focus time), so the one session counts
    // toward both -- met the 100s target, so both should read met:true here;
    // give the "missed" one a higher target to actually miss it.
    const missedGoalHighTarget = { ...missedGoal, targetS: 10000 };
    const statuses = goalDayStatuses([metGoal, missedGoalHighTarget], sessions, new Date(NOW));
    expect(statuses).toEqual(
      expect.arrayContaining([
        { goalId: 'goal:met', dueOn: true, met: true },
        { goalId: 'goal:missed', dueOn: true, met: false },
      ]),
    );
  });

  it('reports dueOn:false and met:false for an off-day goal, never a miss', () => {
    // NOW is a Wednesday (getDay() === 3); restrict the goal to Tuesdays.
    const g = goal({ targetS: 100, period: 'daily', daysOfWeek: [2] });
    const statuses = goalDayStatuses([g], [session(NOW, 999999)], new Date(NOW));
    expect(statuses).toEqual([{ goalId: g.id, dueOn: false, met: false }]);
  });

  it('reports the same status on every day of a weekly goal window', () => {
    const g = goal({ id: 'goal:w', period: 'weekly', targetS: 100 });
    const sessions = [session(NOW, 200)];
    const mondayThisWeek = new Date(NOW);
    mondayThisWeek.setDate(mondayThisWeek.getDate() - mondayThisWeek.getDay() + 1);
    const [monday] = goalDayStatuses([g], sessions, mondayThisWeek);
    const [today] = goalDayStatuses([g], sessions, new Date(NOW));
    expect(monday).toEqual(today);
    expect(monday.met).toBe(true);
  });

  it('returns [] for an empty goal list', () => {
    expect(goalDayStatuses([], [session(NOW, 200)], new Date(NOW))).toEqual([]);
  });
});
