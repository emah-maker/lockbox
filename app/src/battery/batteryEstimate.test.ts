// Unit tests for the pure battery-estimate helpers. Run with `npm test`
// (jest-expo), same convention as ../stats/trend.test.ts.
import {
  MAX_SAMPLES,
  BatterySample,
  recordBatterySample,
  dischargeRatePerHour,
  estimateRemainingMs,
  formatRemaining,
} from './batteryEstimate';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('recordBatterySample', () => {
  it('appends a new reading', () => {
    const out = recordBatterySample([], { t: 0, pct: 90 });
    expect(out).toEqual([{ t: 0, pct: 90 }]);
  });

  it('ignores a duplicate percent reading (no new information to log)', () => {
    const samples: BatterySample[] = [{ t: 0, pct: 80 }];
    const out = recordBatterySample(samples, { t: HOUR, pct: 80 });
    expect(out).toBe(samples); // unchanged, same reference
  });

  it('ignores a stale/out-of-order timestamp', () => {
    const samples: BatterySample[] = [{ t: HOUR, pct: 80 }];
    const out = recordBatterySample(samples, { t: 0, pct: 70 });
    expect(out).toBe(samples);
  });

  it('prunes samples older than ~7 days relative to the new sample', () => {
    const samples: BatterySample[] = [{ t: 0, pct: 95 }];
    const out = recordBatterySample(samples, { t: 8 * DAY, pct: 50 });
    expect(out).toEqual([{ t: 8 * DAY, pct: 50 }]);
  });

  it('caps the log at MAX_SAMPLES, dropping the oldest first', () => {
    // Alternates between two percents so every consecutive pair differs --
    // recordBatterySample would otherwise treat a same-percent run as a
    // no-op duplicate and never grow the log in the first place.
    const distinct: BatterySample[] = Array.from({ length: MAX_SAMPLES }, (_, i) => ({
      t: i * 60_000,
      pct: i % 2 === 0 ? 60 : 61,
    }));
    const next = recordBatterySample(distinct, { t: MAX_SAMPLES * 60_000, pct: 62 });
    expect(next).toHaveLength(MAX_SAMPLES);
    expect(next[0]).toEqual(distinct[1]); // the oldest entry (distinct[0]) was dropped
    expect(next[next.length - 1]).toEqual({ t: MAX_SAMPLES * 60_000, pct: 62 });
  });
});

describe('dischargeRatePerHour', () => {
  it('returns null with fewer than 2 samples', () => {
    expect(dischargeRatePerHour([])).toBeNull();
    expect(dischargeRatePerHour([{ t: 0, pct: 80 }])).toBeNull();
  });

  it('fits a clean linear discharge from as few as 2 samples', () => {
    const samples: BatterySample[] = [
      { t: 0, pct: 100 },
      { t: HOUR, pct: 95 },
    ];
    expect(dischargeRatePerHour(samples)).toBeCloseTo(5, 5);
  });

  it('fits a least-squares slope across several samples', () => {
    const samples: BatterySample[] = [
      { t: 0, pct: 100 },
      { t: HOUR, pct: 95 },
      { t: 2 * HOUR, pct: 90 },
      { t: 3 * HOUR, pct: 85 },
    ];
    expect(dischargeRatePerHour(samples)).toBeCloseTo(5, 5);
  });

  it('returns null when the box is actively charging (real jump up at the end)', () => {
    const samples: BatterySample[] = [
      { t: 0, pct: 80 },
      { t: HOUR, pct: 78 },
      { t: 2 * HOUR, pct: 76 },
      { t: 3 * HOUR, pct: 80 }, // plugged in just now
    ];
    expect(dischargeRatePerHour(samples)).toBeNull();
  });

  it('ignores an earlier upward blip instead of letting it flatten/invert the fit', () => {
    const samples: BatterySample[] = [
      { t: 0, pct: 80 },
      { t: HOUR, pct: 85 }, // brief plug-in blip, not sustained
      { t: 2 * HOUR, pct: 78 },
      { t: 3 * HOUR, pct: 76 },
      { t: 4 * HOUR, pct: 74 },
    ];
    const rate = dischargeRatePerHour(samples);
    expect(rate).not.toBeNull();
    expect(rate as number).toBeGreaterThan(0);
  });

  it('returns null for a flat (non-discharging) reading', () => {
    const samples: BatterySample[] = [
      { t: 0, pct: 80 },
      { t: HOUR, pct: 80 + 0.0001 }, // effectively flat, never a true duplicate for recordBatterySample
      { t: 2 * HOUR, pct: 80 },
    ];
    expect(dischargeRatePerHour(samples)).toBeNull();
  });
});

describe('estimateRemainingMs', () => {
  const samples: BatterySample[] = [
    { t: 0, pct: 100 },
    { t: HOUR, pct: 90 }, // 10%/hour
  ];

  it('returns null for an unknown battery reading', () => {
    expect(estimateRemainingMs(samples, -1)).toBeNull();
  });

  it('returns null when there is no usable discharge rate', () => {
    expect(estimateRemainingMs([], 50)).toBeNull();
  });

  it('divides the current percent by the fitted discharge rate', () => {
    const ms = estimateRemainingMs(samples, 50);
    expect(ms).toBeCloseTo(5 * HOUR, 0); // 50% / 10%/hour = 5h
  });
});

describe('formatRemaining', () => {
  it('formats sub-hour remainders in minutes', () => {
    expect(formatRemaining(40 * 60_000)).toBe('~40m left');
  });

  it('formats whole hours without a minutes remainder', () => {
    expect(formatRemaining(5 * HOUR)).toBe('~5h left');
  });

  it('formats multi-day remainders as days + hours', () => {
    expect(formatRemaining(2 * DAY + 4 * HOUR)).toBe('~2d 4h left');
  });

  it('drops the hours part when it is exactly zero', () => {
    expect(formatRemaining(3 * DAY)).toBe('~3d left');
  });

  it('returns null for unknown, zero, or negative durations', () => {
    expect(formatRemaining(null)).toBeNull();
    expect(formatRemaining(0)).toBeNull();
    expect(formatRemaining(-1000)).toBeNull();
  });
});
