// Unit tests for the pure idle-ring helpers. Run with `npm test` (jest-expo).
import {
  computeIdleRingProgress,
  ringBaselineWindowLabel,
  computeIdleRingState,
  computeDailyStreak,
  computeLongestDailyStreak,
  computeRollingAverageS,
  ringSourceKindLabel,
  RING_SOURCE_KINDS,
  type IdleRingInputs,
} from './idleRingState';
import type { LoggedSession } from '../../stats/sessionHistory';

/** Minimal LoggedSession fixture -- only the fields the helpers under test
 * actually read (startedAt, actualS); plannedS/outcome are filled with
 * "a plain completed session" defaults since every helper here is
 * indifferent to them. */
function session(startedAt: number, actualS = 600): LoggedSession {
  return { startedAt, plannedS: actualS, actualS, outcome: 'completed' };
}

// A fixed "now" (local time) so every streak/rolling-average test below is
// pinned to an exact calendar day instead of racing the real clock -- same
// convention stats/trend.ts's own callers use `nowMs` for.
const NOW = new Date(2024, 0, 10, 12, 0, 0).getTime(); // Wed Jan 10 2024, noon
function daysAgo(n: number): number {
  const d = new Date(NOW);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 9, 0, 0).getTime();
}

// A full IdleRingInputs with every field neutralized -- each
// computeIdleRingState test below overrides only the fields its own source
// actually reads, per idleRingState.ts's own "each source only reads its own
// slice of IdleRingInputs" contract.
function baseInputs(overrides: Partial<IdleRingInputs>): IdleRingInputs {
  return {
    ringSource: 'auto',
    todayFocusS: 0,
    dailyGoalTargetS: null,
    baselineFocusS: 0,
    weeklyGoalRatio: null,
    chosenGoalRatio: null,
    chosenGoalName: null,
    rollingAverageS: 0,
    streakCurrent: 0,
    streakLongest: 0,
    ...overrides,
  };
}

describe('computeIdleRingProgress', () => {
  it('reads as empty on a day with no focus time yet, even with a goal set', () => {
    expect(computeIdleRingProgress(0, 1800, 3600)).toEqual({ progress: 0, source: 'empty' });
  });

  it('reads as empty on a day with no focus time yet, with only a baseline', () => {
    expect(computeIdleRingProgress(0, null, 3600)).toEqual({ progress: 0, source: 'empty' });
  });

  it('reads as empty on a negative focus total (defensive)', () => {
    expect(computeIdleRingProgress(-5, null, 3600)).toEqual({ progress: 0, source: 'empty' });
  });

  it('reports goal progress under target', () => {
    expect(computeIdleRingProgress(900, 1800, 0)).toEqual({ progress: 0.5, source: 'goal' });
  });

  it('reports goal progress exactly at target (met)', () => {
    expect(computeIdleRingProgress(1800, 1800, 0)).toEqual({ progress: 1, source: 'goal' });
  });

  it('reports goal progress past target, uncapped', () => {
    expect(computeIdleRingProgress(3600, 1800, 0)).toEqual({ progress: 2, source: 'goal' });
  });

  it('falls back to the baseline when no goal is set', () => {
    expect(computeIdleRingProgress(500, null, 1000)).toEqual({ progress: 0.5, source: 'baseline' });
  });

  it('a goal target of exactly 0 is treated the same as no goal (falls to baseline)', () => {
    expect(computeIdleRingProgress(500, 0, 1000)).toEqual({ progress: 0.5, source: 'baseline' });
  });

  it('guards the baseline divide-by-zero when there is no goal and no baseline history', () => {
    expect(computeIdleRingProgress(500, null, 0)).toEqual({ progress: 0, source: 'baseline' });
  });

  it('guards a negative baseline the same way (defensive)', () => {
    expect(computeIdleRingProgress(500, null, -10)).toEqual({ progress: 0, source: 'baseline' });
  });
});

describe('ringBaselineWindowLabel', () => {
  it('labels every window', () => {
    expect(ringBaselineWindowLabel('week')).toBe('this week');
    expect(ringBaselineWindowLabel('month')).toBe('this month');
    expect(ringBaselineWindowLabel('year')).toBe('this year');
    expect(ringBaselineWindowLabel('all')).toBe('all time');
  });
});

describe('ringSourceKindLabel', () => {
  it('labels every ring source with a non-empty string', () => {
    for (const k of RING_SOURCE_KINDS) {
      expect(typeof ringSourceKindLabel(k)).toBe('string');
      expect(ringSourceKindLabel(k).length).toBeGreaterThan(0);
    }
  });
});

describe('computeIdleRingState', () => {
  it("'auto' delegates to computeIdleRingProgress's own goal/baseline/empty math", () => {
    expect(computeIdleRingState(baseInputs({ ringSource: 'auto', todayFocusS: 900, dailyGoalTargetS: 1800 }))).toEqual(
      { progress: 0.5, source: 'goal' },
    );
    expect(computeIdleRingState(baseInputs({ ringSource: 'auto', todayFocusS: 0, dailyGoalTargetS: 1800 }))).toEqual({
      progress: 0,
      source: 'empty',
    });
  });

  it("'weeklyGoal' reports the given ratio, or empty when no such goal exists", () => {
    expect(computeIdleRingState(baseInputs({ ringSource: 'weeklyGoal', weeklyGoalRatio: 0.4 }))).toEqual({
      progress: 0.4,
      source: 'weeklyGoal',
    });
    expect(computeIdleRingState(baseInputs({ ringSource: 'weeklyGoal', weeklyGoalRatio: null }))).toEqual({
      progress: 0,
      source: 'empty',
    });
  });

  it("'chosenGoal' reports the given ratio + name, or empty when none is picked/found", () => {
    expect(
      computeIdleRingState(
        baseInputs({ ringSource: 'chosenGoal', chosenGoalRatio: 0.75, chosenGoalName: 'Reading' }),
      ),
    ).toEqual({ progress: 0.75, source: 'chosenGoal', chosenGoalName: 'Reading' });
    expect(
      computeIdleRingState(baseInputs({ ringSource: 'chosenGoal', chosenGoalRatio: null, chosenGoalName: 'Reading' })),
    ).toEqual({ progress: 0, source: 'empty' });
  });

  it("'rollingAverage' compares today against the average, guarding both the empty-today and no-history cases", () => {
    expect(
      computeIdleRingState(baseInputs({ ringSource: 'rollingAverage', todayFocusS: 600, rollingAverageS: 300 })),
    ).toEqual({ progress: 2, source: 'rollingAverage' });
    expect(computeIdleRingState(baseInputs({ ringSource: 'rollingAverage', todayFocusS: 0, rollingAverageS: 300 }))).toEqual(
      { progress: 0, source: 'empty' },
    );
    expect(
      computeIdleRingState(baseInputs({ ringSource: 'rollingAverage', todayFocusS: 600, rollingAverageS: 0 })),
    ).toEqual({ progress: 0, source: 'rollingAverage' });
  });

  it("'streak' reports current/longest, capping progress at 1 and starting a fresh record at a full ring", () => {
    expect(computeIdleRingState(baseInputs({ ringSource: 'streak', streakCurrent: 3, streakLongest: 5 }))).toEqual({
      progress: 0.6,
      source: 'streak',
      streak: { current: 3, longest: 5 },
    });
    expect(computeIdleRingState(baseInputs({ ringSource: 'streak', streakCurrent: 5, streakLongest: 5 }))).toEqual({
      progress: 1,
      source: 'streak',
      streak: { current: 5, longest: 5 },
    });
    expect(computeIdleRingState(baseInputs({ ringSource: 'streak', streakCurrent: 3, streakLongest: 0 }))).toEqual({
      progress: 1,
      source: 'streak',
      streak: { current: 3, longest: 0 },
    });
    expect(computeIdleRingState(baseInputs({ ringSource: 'streak', streakCurrent: 0, streakLongest: 0 }))).toEqual({
      progress: 0,
      source: 'empty',
    });
  });
});

describe('computeDailyStreak', () => {
  it('is 0 with no sessions at all', () => {
    expect(computeDailyStreak([], NOW)).toBe(0);
  });

  it('is 0 when today has no session yet, even if yesterday did', () => {
    expect(computeDailyStreak([session(daysAgo(1))], NOW)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const sessions = [session(daysAgo(0)), session(daysAgo(1)), session(daysAgo(2))];
    expect(computeDailyStreak(sessions, NOW)).toBe(3);
  });

  it('stops at the first missing day walking backward from today', () => {
    // today and yesterday logged, the day before that is a gap -- an older
    // session 4 days ago must not extend the streak past the gap.
    const sessions = [session(daysAgo(0)), session(daysAgo(1)), session(daysAgo(4))];
    expect(computeDailyStreak(sessions, NOW)).toBe(2);
  });
});

describe('computeLongestDailyStreak', () => {
  it('is 0 with no sessions at all', () => {
    expect(computeLongestDailyStreak([])).toBe(0);
  });

  it('is 1 for a single logged day', () => {
    expect(computeLongestDailyStreak([session(daysAgo(0))])).toBe(1);
  });

  it('finds the longest of several runs, not just the most recent one', () => {
    // A 3-day run (days 10-8 ago) and a separate, more recent 2-day run
    // (days 1-0 ago) with a gap at day 4-9 in between -- longest is the
    // 3-day run, even though it isn't the current one.
    const sessions = [
      session(daysAgo(10)),
      session(daysAgo(9)),
      session(daysAgo(8)),
      session(daysAgo(1)),
      session(daysAgo(0)),
    ];
    expect(computeLongestDailyStreak(sessions)).toBe(3);
  });

  it('carries a run correctly across a month boundary', () => {
    const jan31 = new Date(2024, 0, 31, 9, 0, 0).getTime();
    const feb1 = new Date(2024, 1, 1, 9, 0, 0).getTime();
    const feb2 = new Date(2024, 1, 2, 9, 0, 0).getTime();
    expect(computeLongestDailyStreak([session(jan31), session(feb1), session(feb2)])).toBe(3);
  });
});

describe('computeRollingAverageS', () => {
  it('is 0 with no prior history', () => {
    expect(computeRollingAverageS([], NOW)).toBe(0);
  });

  it('averages the 7 days before today, excluding today itself', () => {
    // 7 prior days at 600s each (sum 4200, average 600) -- today's own huge
    // session must not pull the average up, since it isn't one of the 7.
    const sessions = [1, 2, 3, 4, 5, 6, 7].map((n) => session(daysAgo(n), 600));
    sessions.push(session(daysAgo(0), 999999));
    expect(computeRollingAverageS(sessions, NOW)).toBe(600);
  });
});
