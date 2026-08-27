// Unit tests for goalStreak.ts's pure streak/on-pace helpers. Run with
// `npm test` (jest-expo), same convention as goalProgress.test.ts.
import { computeGoalStreak, isGoalOnPace } from './goalStreak';
import { Goal } from '../goals/goals';
import { goalWindow } from '../goals/goalProgress';
import { LoggedSession } from './sessionHistory';

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

// Wed 2024-01-10 12:00:00 local time, same anchor as goalProgress.test.ts.
const NOW = new Date(2024, 0, 10, 12, 0, 0).getTime();
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

describe('computeGoalStreak', () => {
  it('returns 0 for an archived goal', () => {
    const g = goal({ archived: true, targetS: 100 });
    expect(computeGoalStreak(g, [session(NOW, 1000)], NOW)).toBe(0);
  });

  it('returns 0 when no window (including the current one) is met', () => {
    const g = goal({ targetS: 3600 });
    expect(computeGoalStreak(g, [session(NOW, 100)], NOW)).toBe(0);
  });

  it('counts the current window if already met, even mid-window', () => {
    const g = goal({ targetS: 100 });
    expect(computeGoalStreak(g, [session(NOW, 200)], NOW)).toBe(1);
  });

  it('keeps walking backward through consecutive met daily windows', () => {
    const g = goal({ targetS: 100, period: 'daily' });
    const sessions = [
      session(NOW, 200), // today, met
      session(NOW - DAY_MS, 150), // yesterday, met
      session(NOW - 2 * DAY_MS, 120), // 2 days ago, met
      session(NOW - 3 * DAY_MS, 10), // 3 days ago, NOT met -- streak stops here
    ];
    expect(computeGoalStreak(g, sessions, NOW)).toBe(3);
  });

  it('does not break the streak on an unfinished current window, and still counts prior met days', () => {
    const g = goal({ targetS: 100, period: 'daily' });
    const sessions = [
      session(NOW, 10), // today, not met yet (window still open)
      session(NOW - DAY_MS, 150), // yesterday, met
      session(NOW - 2 * DAY_MS, 200), // 2 days ago, met
    ];
    expect(computeGoalStreak(g, sessions, NOW)).toBe(2);
  });

  it('only counts sessions matching the goal topic', () => {
    const g = goal({ targetS: 100, topic: 'work' });
    const sessions = [session(NOW, 200, 'study')];
    expect(computeGoalStreak(g, sessions, NOW)).toBe(0);
  });

  it('walks backward through monthly windows too', () => {
    const g = goal({ targetS: 100, period: 'monthly' });
    // This month (Jan 2024) and last month (Dec 2023) both met; the month
    // before that (Nov 2023) is not.
    const sessions = [
      session(new Date(2024, 0, 5).getTime(), 200), // Jan 2024
      session(new Date(2023, 11, 5).getTime(), 200), // Dec 2023
      session(new Date(2023, 10, 5).getTime(), 1), // Nov 2023, not met
    ];
    expect(computeGoalStreak(g, sessions, NOW)).toBe(2);
  });

  describe('with a session-count target (Goal.targetSessions)', () => {
    it('is not met on a window where the focus time target is hit but the session count is not', () => {
      const g = goal({ targetS: 50, targetSessions: 2 });
      // One long session clears the 50s focus target but there's only 1
      // session, short of the 2-session target -- combined `met` (mirroring
      // GoalProgressResult.met) must be false.
      expect(computeGoalStreak(g, [session(NOW, 200)], NOW)).toBe(0);
    });

    it('is met once both the focus time AND session count targets are hit', () => {
      const g = goal({ targetS: 50, targetSessions: 2 });
      const sessions = [session(NOW, 60), session(NOW + 1000, 60)];
      expect(computeGoalStreak(g, sessions, NOW)).toBe(1);
    });
  });

  describe('with a day-of-week restriction (Goal.daysOfWeek)', () => {
    // NOW is a Wednesday (getDay() === 3).
    it('skips off days entirely -- they neither count toward nor break the streak', () => {
      const g = goal({ targetS: 100, period: 'daily', daysOfWeek: [3] }); // Wednesdays only
      const sessions = [
        session(NOW, 200), // today, Wed, met
        session(NOW - DAY_MS, 5), // yesterday, Tue -- an off day, would fail if it counted
        session(NOW - WEEK_MS, 200), // last Wednesday, met
      ];
      expect(computeGoalStreak(g, sessions, NOW)).toBe(2);
    });

    it('does not count an off day even if it happens to have enough focus time logged', () => {
      const g = goal({ targetS: 100, period: 'daily', daysOfWeek: [3] }); // Wednesdays only
      const sessions = [
        session(NOW, 200), // today, Wed, met
        session(NOW - DAY_MS, 999), // yesterday, Tue -- off day, ignored regardless
        session(NOW - WEEK_MS, 1), // last Wednesday, NOT met -- streak stops here
      ];
      expect(computeGoalStreak(g, sessions, NOW)).toBe(1);
    });
  });
});

describe('isGoalOnPace', () => {
  it('is always true once met', () => {
    const window = goalWindow('daily', NOW);
    expect(isGoalOnPace(0.1, true, window, NOW)).toBe(true);
  });

  it('is true right at the start of the window regardless of ratio', () => {
    const window = goalWindow('daily', NOW);
    expect(isGoalOnPace(0, false, window, window.startMs)).toBe(true);
  });

  it('is true when the banked ratio is ahead of the elapsed fraction', () => {
    const window = goalWindow('daily', NOW); // local midnight .. next midnight
    const quarterIn = window.startMs + (window.endMs - window.startMs) / 4;
    expect(isGoalOnPace(0.5, false, window, quarterIn)).toBe(true);
  });

  it('is false when the banked ratio has fallen behind the elapsed fraction', () => {
    const window = goalWindow('daily', NOW);
    const threeQuartersIn = window.startMs + (3 * (window.endMs - window.startMs)) / 4;
    expect(isGoalOnPace(0.1, false, window, threeQuartersIn)).toBe(false);
  });
});
