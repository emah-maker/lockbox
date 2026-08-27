// Unit tests for goalTargetParts.ts's pure days/hours/minutes decomposition:
// which periods get a Days wheel, the exact-max boundary for weekly/monthly
// (where hours/minutes must be forced to 0), round-tripping an existing
// sub-day target with no precision loss, period-switch clamping (including
// a large monthly value collapsing down to weekly and then daily), and that
// no combination of parts can compose into a targetS above the period's own
// bound. Run with `npm test`.
import {
  PERIOD_MAX_HOURS,
  MINUTE_VALUES,
  showsDaysWheel,
  maxDaysFor,
  partsToTargetS,
  targetSToParts,
  clampPartsForPeriod,
  initialPartsFor,
} from './goalTargetParts';
import { Goal, MAX_WEEKLY_TARGET_S, MAX_MONTHLY_TARGET_S, MAX_DAILY_TARGET_S } from './goals';

describe('showsDaysWheel / maxDaysFor', () => {
  it('does not show a Days wheel for daily (24h, at the <=24h cutoff)', () => {
    expect(showsDaysWheel('daily')).toBe(false);
  });

  it('shows a Days wheel for weekly (168h) and monthly (744h)', () => {
    expect(showsDaysWheel('weekly')).toBe(true);
    expect(showsDaysWheel('monthly')).toBe(true);
  });

  it('derives the exact max day count from goals.ts bounds (7d weekly, 31d monthly)', () => {
    expect(maxDaysFor('weekly')).toBe(7);
    expect(maxDaysFor('monthly')).toBe(31);
  });

  it('PERIOD_MAX_HOURS matches goals.ts MAX_*_TARGET_S exactly', () => {
    expect(PERIOD_MAX_HOURS.daily).toBe(MAX_DAILY_TARGET_S / 3600);
    expect(PERIOD_MAX_HOURS.weekly).toBe(MAX_WEEKLY_TARGET_S / 3600);
    expect(PERIOD_MAX_HOURS.monthly).toBe(MAX_MONTHLY_TARGET_S / 3600);
  });
});

describe('partsToTargetS / targetSToParts round-trip', () => {
  it('round-trips an existing weekly "3h 30m" target with no precision loss', () => {
    const targetS = 3 * 3600 + 30 * 60;
    const parts = targetSToParts(targetS, 'weekly');
    expect(parts).toEqual({ days: 0, hours: 3, minutes: 30 });
    expect(partsToTargetS(parts)).toBe(targetS);
  });

  it('round-trips a daily "2h 25m" target unchanged (no Days wheel involved)', () => {
    const targetS = 2 * 3600 + 25 * 60;
    const parts = targetSToParts(targetS, 'daily');
    expect(parts).toEqual({ days: 0, hours: 2, minutes: 25 });
    expect(partsToTargetS(parts)).toBe(targetS);
  });

  it('round-trips a monthly value that spans several days', () => {
    const targetS = 9 * 86400 + 5 * 3600 + 15 * 60; // 9d 5h 15m
    const parts = targetSToParts(targetS, 'monthly');
    expect(parts).toEqual({ days: 9, hours: 5, minutes: 15 });
    expect(partsToTargetS(parts)).toBe(targetS);
  });

  it('snaps an off-5-minute-grid value (e.g. dashboard-written) to the nearest stop', () => {
    const targetS = 1 * 3600 + 58 * 60; // 1h58m -- 58 is not on the 5-minute grid
    const parts = targetSToParts(targetS, 'weekly');
    expect(parts.minutes).toBe(55);
  });
});

describe('exact-max boundaries', () => {
  it('decomposes the exact weekly max (168h) as 7d 0h 0m, not 6d 24h 0m', () => {
    expect(targetSToParts(MAX_WEEKLY_TARGET_S, 'weekly')).toEqual({ days: 7, hours: 0, minutes: 0 });
  });

  it('decomposes the exact monthly max (744h) as 31d 0h 0m', () => {
    expect(targetSToParts(MAX_MONTHLY_TARGET_S, 'monthly')).toEqual({ days: 31, hours: 0, minutes: 0 });
  });

  it('decomposes the exact daily max (24h) as 0d 24h 0m (Days wheel not shown)', () => {
    expect(targetSToParts(MAX_DAILY_TARGET_S, 'daily')).toEqual({ days: 0, hours: 24, minutes: 0 });
  });

  it('forces hours/minutes to 0 when a raw days-at-max combo is re-clamped, even if hours/minutes were nonzero', () => {
    expect(clampPartsForPeriod({ days: 7, hours: 23, minutes: 55 }, 'weekly')).toEqual({ days: 7, hours: 0, minutes: 0 });
    expect(clampPartsForPeriod({ days: 31, hours: 12, minutes: 30 }, 'monthly')).toEqual({ days: 31, hours: 0, minutes: 0 });
  });

  it('does not clamp hours/minutes away one day below the max (still expressible)', () => {
    // 6d 23h 55m is comfortably under the 7d/168h weekly bound (604500s < 604800s).
    expect(clampPartsForPeriod({ days: 6, hours: 23, minutes: 55 }, 'weekly')).toEqual({ days: 6, hours: 23, minutes: 55 });
  });
});

describe('period switching clamps into the new period range', () => {
  it('clamps a 20d monthly value down to the weekly max (7d 0h 0m)', () => {
    const monthlyParts = targetSToParts(20 * 86400, 'monthly');
    expect(monthlyParts).toEqual({ days: 20, hours: 0, minutes: 0 });
    expect(clampPartsForPeriod(monthlyParts, 'weekly')).toEqual({ days: 7, hours: 0, minutes: 0 });
  });

  it('clamps that same weekly max further down to the daily max (24h 0m) when switching again', () => {
    const weeklyParts = clampPartsForPeriod({ days: 20, hours: 0, minutes: 0 }, 'weekly');
    expect(clampPartsForPeriod(weeklyParts, 'daily')).toEqual({ days: 0, hours: 24, minutes: 0 });
  });

  it('leaves a value untouched when switching to a period with a larger or equal bound', () => {
    const dailyParts = { days: 0, hours: 3, minutes: 30 };
    expect(clampPartsForPeriod(dailyParts, 'weekly')).toEqual({ days: 0, hours: 3, minutes: 30 });
    expect(clampPartsForPeriod(dailyParts, 'monthly')).toEqual({ days: 0, hours: 3, minutes: 30 });
  });
});

describe('no combination of parts can compose above the period bound', () => {
  const periods: Array<{ period: 'daily' | 'weekly' | 'monthly'; maxS: number }> = [
    { period: 'daily', maxS: MAX_DAILY_TARGET_S },
    { period: 'weekly', maxS: MAX_WEEKLY_TARGET_S },
    { period: 'monthly', maxS: MAX_MONTHLY_TARGET_S },
  ];

  it.each(periods)('holds for every days/hours/minutes combination under $period', ({ period, maxS }) => {
    const maxDays = maxDaysFor(period) || 2; // daily has no Days wheel; still fuzz a couple of "days" values
    for (let days = 0; days <= maxDays + 1; days++) {
      for (let hours = 0; hours <= 25; hours += 5) {
        for (const minutes of [...MINUTE_VALUES, 59]) {
          const clamped = clampPartsForPeriod({ days, hours, minutes }, period);
          expect(partsToTargetS(clamped)).toBeLessThanOrEqual(maxS);
        }
      }
    }
  });
});

describe('initialPartsFor', () => {
  const goal = (overrides: Partial<Goal>): Goal => ({
    id: 'goal:a',
    topic: null,
    period: 'weekly',
    targetS: 3600,
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    ...overrides,
  });

  it('decomposes an existing goal using its own targetS and period', () => {
    expect(initialPartsFor(goal({ period: 'weekly', targetS: 12600 }), 1500, 'daily')).toEqual({
      days: 0,
      hours: 3,
      minutes: 30,
    });
  });

  it('falls back to the caller-supplied default for a brand new goal', () => {
    expect(initialPartsFor(undefined, 1500, 'daily')).toEqual({ days: 0, hours: 0, minutes: 25 });
  });
});
