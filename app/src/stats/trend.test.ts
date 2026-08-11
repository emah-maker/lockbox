// Unit tests for the pure trend helpers. Run with `npm test` (jest-expo).
import { lastNDays, bestDay } from './trend';
import { LoggedSession } from './sessionHistory';

// Wednesday, noon local time, so days both before and after in the window
// stay inside the same month.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime(); // 2026-07-15
const DAY_MS = 86400000;

function sessionOnDaysAgo(daysAgo: number, actualS: number): LoggedSession {
  return {
    startedAt: NOW - daysAgo * DAY_MS,
    plannedS: actualS,
    actualS,
    outcome: 'completed',
  };
}

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
