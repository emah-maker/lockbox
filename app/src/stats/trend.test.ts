// Unit tests for the pure trend helpers. Run with `npm test` (jest-expo).
import { lastNDays, lastNDaysHeatmap, bestDay } from './trend';
import { LoggedSession } from './sessionHistory';
import { CustomLabel } from './customLabels';

// Wednesday, noon local time, so days both before and after in the window
// stay inside the same month.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime(); // 2026-07-15
const DAY_MS = 86400000;

function sessionOnDaysAgo(daysAgo: number, actualS: number, topic?: string): LoggedSession {
  return {
    startedAt: NOW - daysAgo * DAY_MS,
    plannedS: actualS,
    actualS,
    outcome: 'completed',
    topic,
  };
}

const SLEEP_LABEL: CustomLabel[] = [{ id: 'custom:sleep', name: 'Sleep', color: '#123456', excludeFromTotals: true }];

describe('lastNDays', () => {
  it('returns `days` entries, oldest first, ending on today', () => {
    const totals = lastNDays([], 7, NOW);
    expect(totals).toHaveLength(7);
    expect(totals[6].key).toBe('2026-07-15');
    expect(totals[0].key).toBe('2026-07-09');
  });

  it('buckets each session under its own day', () => {
    const sessions = [sessionOnDaysAgo(0, 300), sessionOnDaysAgo(1, 100), sessionOnDaysAgo(1, 50)];
    const totals = lastNDays(sessions, 7, NOW);
    expect(totals[6].focusS).toBe(300); // today
    expect(totals[5].focusS).toBe(150); // yesterday
    expect(totals[4].focusS).toBe(0);
  });

  it('labels days with a single weekday initial', () => {
    const totals = lastNDays([], 7, NOW);
    // 2026-07-15 is a Wednesday
    expect(totals[6].label).toBe('W');
  });

  it('ignores sessions outside the window', () => {
    const totals = lastNDays([sessionOnDaysAgo(30, 999)], 7, NOW);
    expect(totals.reduce((sum, d) => sum + d.focusS, 0)).toBe(0);
  });

  it('excludes a session tagged with an excludeFromTotals label from its day\'s total', () => {
    const sessions = [sessionOnDaysAgo(0, 300, 'work'), sessionOnDaysAgo(0, 28800, 'custom:sleep')];
    const totals = lastNDays(sessions, 7, NOW, SLEEP_LABEL);
    expect(totals[6].focusS).toBe(300);
  });

  it('omitting labels counts everything, same as before this parameter existed', () => {
    const sessions = [sessionOnDaysAgo(0, 300, 'custom:sleep')];
    expect(lastNDays(sessions, 7, NOW)[6].focusS).toBe(300);
  });
});

describe('bestDay', () => {
  it('returns null on an empty log', () => {
    expect(bestDay([])).toBeNull();
  });

  it('picks the day with the highest total focus time, across all history', () => {
    const sessions = [
      sessionOnDaysAgo(60, 500), // outside lastNDays' 7-day window, but bestDay looks at everything
      sessionOnDaysAgo(1, 100),
      sessionOnDaysAgo(1, 50),
    ];
    const best = bestDay(sessions);
    expect(best?.focusS).toBe(500);
  });

  it('sums same-day sessions before comparing', () => {
    const sessions = [sessionOnDaysAgo(1, 100), sessionOnDaysAgo(1, 50), sessionOnDaysAgo(2, 120)];
    const best = bestDay(sessions);
    expect(best?.focusS).toBe(150); // day 1's 100+50 beats day 2's 120
  });
});

// The Home ring's baseline (screens/home/idleRingState.ts) passes a narrower
// window than every pre-existing bestDay caller (the Stats "Fun facts" card,
// which always wants 'all') -- these cover that windowed path specifically,
// on top of the unwindowed-default coverage above.
describe('bestDay with a window', () => {
  it('defaults to \'all\' -- unchanged behavior for every pre-existing caller', () => {
    const sessions = [sessionOnDaysAgo(60, 500), sessionOnDaysAgo(1, 100)];
    const best = bestDay(sessions, undefined, NOW);
    expect(best?.focusS).toBe(500); // the 60-days-ago session still wins, same as the plain bestDay() tests above
  });

  it('a \'week\' window excludes an older, bigger day', () => {
    const sessions = [sessionOnDaysAgo(60, 500), sessionOnDaysAgo(1, 100)];
    const best = bestDay(sessions, 'week', NOW);
    expect(best?.focusS).toBe(100); // the 500 day is outside the trailing 7-day window
  });

  it('a \'year\' window includes a day \'week\' would have excluded', () => {
    const sessions = [sessionOnDaysAgo(60, 500), sessionOnDaysAgo(1, 100)];
    const best = bestDay(sessions, 'year', NOW);
    expect(best?.focusS).toBe(500); // 60 days ago is well within the trailing 365-day window
  });

  it('returns null when the window contains no sessions', () => {
    const sessions = [sessionOnDaysAgo(60, 500)];
    expect(bestDay(sessions, 'week', NOW)).toBeNull();
  });

  it('excludes an excludeFromTotals label\'s time so a day of pure "Sleep" is never the best day', () => {
    const sessions = [sessionOnDaysAgo(0, 28800, 'custom:sleep'), sessionOnDaysAgo(1, 100, 'work')];
    const best = bestDay(sessions, 'all', NOW, SLEEP_LABEL);
    expect(best?.focusS).toBe(100);
  });
});

describe('lastNDaysHeatmap', () => {
  it('returns 35 entries, oldest first, ending on today', () => {
    const days = lastNDaysHeatmap([], NOW);
    expect(days).toHaveLength(35);
    expect(days[34].key).toBe('2026-07-15');
    expect(days[0].key).toBe('2026-06-11');
  });

  it('gives an empty day level 0 and the busiest day level 4', () => {
    const sessions = [sessionOnDaysAgo(0, 1000), sessionOnDaysAgo(1, 10)];
    const days = lastNDaysHeatmap(sessions, NOW);
    expect(days[34].level).toBe(4); // today, the busiest day in the window
    expect(days[33].level).toBe(1); // yesterday, a small fraction of the max
    expect(days[32].level).toBe(0); // no session at all
  });

  it('is unaffected by sessions outside the 35-day window', () => {
    const days = lastNDaysHeatmap([sessionOnDaysAgo(100, 999)], NOW);
    expect(days.every((d) => d.focusS === 0 && d.level === 0)).toBe(true);
  });

  it('excludes an excludeFromTotals label from every cell\'s total/level', () => {
    const sessions = [sessionOnDaysAgo(0, 28800, 'custom:sleep')];
    const days = lastNDaysHeatmap(sessions, NOW, SLEEP_LABEL);
    expect(days[34]).toMatchObject({ focusS: 0, level: 0 });
  });
});
