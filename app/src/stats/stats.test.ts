// Unit tests for the pure stats helpers. Run with `npm test` (jest-expo).
import { aggregate, formatDuration, completionRate, clampLockSeconds, splitLockSeconds, MAX_LOCK_HOURS, MAX_LOCK_SECONDS, MIN_LOCK_SECONDS, SessionRecord } from './stats';
import { parseStatus, parseHistoryEntries } from '../ble/protocol';

describe('aggregate', () => {
  const recs: SessionRecord[] = [
    { plannedS: 300, actualS: 300, outcome: 'completed' },
    { plannedS: 600, actualS: 120, outcome: 'overridden' },
    { plannedS: 900, actualS: 900, outcome: 'completed' },
  ];

  it('counts sessions, focus, completed, longest', () => {
    const s = aggregate(recs);
    expect(s.n).toBe(3);
    expect(s.foc).toBe(1320);
    expect(s.done).toBe(2);
    expect(s.lng).toBe(900);
  });

  it('streak counts only trailing completed sessions', () => {
    expect(aggregate(recs).str).toBe(1); // newest completed, prior is override
  });

  it('streak spans a run of trailing completed', () => {
    const r: SessionRecord[] = [
      { plannedS: 60, actualS: 10, outcome: 'overridden' },
      { plannedS: 300, actualS: 300, outcome: 'completed' },
      { plannedS: 300, actualS: 300, outcome: 'completed' },
    ];
    expect(aggregate(r).str).toBe(2);
  });

  it('empty history is all zeros', () => {
    expect(aggregate([])).toEqual({ n: 0, foc: 0, done: 0, str: 0, lng: 0 });
  });
});

describe('formatDuration', () => {
  it('formats sub-hour and multi-hour', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(300)).toBe('5m');
    expect(formatDuration(3720)).toBe('1h 02m');
  });
});

describe('completionRate', () => {
  it('is 0 with no sessions and rounds otherwise', () => {
    expect(completionRate({ n: 0, foc: 0, done: 0, str: 0, lng: 0 })).toBe(0);
    expect(completionRate({ n: 3, foc: 0, done: 2, str: 0, lng: 0 })).toBe(67);
  });
});

describe('clampLockSeconds', () => {
  it('combines hours and minutes into seconds', () => {
    expect(clampLockSeconds(1, 30)).toBe(5400);
    expect(clampLockSeconds(0, 5)).toBe(300);
  });

  it('caps at the box\'s 9h55m maximum', () => {
    expect(clampLockSeconds(9, 55)).toBe(MAX_LOCK_SECONDS);
    expect(clampLockSeconds(9, 60)).toBe(MAX_LOCK_SECONDS);
    expect(clampLockSeconds(20, 0)).toBe(MAX_LOCK_SECONDS);
  });

  it('floors negative or fractional input at the MIN_LOCK_SECONDS minimum, not 0', () => {
    expect(clampLockSeconds(-1, -5)).toBe(MIN_LOCK_SECONDS);
    expect(clampLockSeconds(0.9, 0.9)).toBe(MIN_LOCK_SECONDS);
  });

  it('floors an explicit 0h00m selection at MIN_LOCK_SECONDS', () => {
    expect(clampLockSeconds(0, 0)).toBe(MIN_LOCK_SECONDS);
  });
});

describe('splitLockSeconds', () => {
  const STEP = 5; // DashboardScreen's MINUTE_STEP -- the only step in use

  it('splits an exact H/M duration back into the wheel values', () => {
    expect(splitLockSeconds(0, STEP)).toEqual({ hours: 0, minutes: 0 });
    expect(splitLockSeconds(300, STEP)).toEqual({ hours: 0, minutes: 5 });
    expect(splitLockSeconds(3600, STEP)).toEqual({ hours: 1, minutes: 0 });
    expect(splitLockSeconds(5100, STEP)).toEqual({ hours: 1, minutes: 25 });
  });

  it('carries a remainder that rounds up to a full hour instead of emitting minutes: 60', () => {
    // The bug this exists for: floor(7150/3600)=1 and round(3550/60/5)*5=60,
    // which the minute wheel has no index for -- it fell back to 00m while
    // clampLockSeconds(1, 60) still produced 2h.
    expect(splitLockSeconds(7150, STEP)).toEqual({ hours: 2, minutes: 0 });
    expect(splitLockSeconds(3599, STEP)).toEqual({ hours: 1, minutes: 0 });
  });

  it('never emits a minutes value the 5-minute wheel cannot show', () => {
    for (let s = 0; s <= MAX_LOCK_SECONDS; s += 7) {
      const { minutes } = splitLockSeconds(s, STEP);
      expect(minutes % STEP).toBe(0);
      expect(minutes).toBeLessThan(60);
    }
  });

  it('clamps both ends rather than running off either wheel', () => {
    expect(splitLockSeconds(-1, STEP)).toEqual({ hours: 0, minutes: 0 });
    expect(splitLockSeconds(MAX_LOCK_SECONDS, STEP)).toEqual({ hours: MAX_LOCK_HOURS, minutes: 55 });
    expect(splitLockSeconds(999999, STEP)).toEqual({ hours: MAX_LOCK_HOURS, minutes: 55 });
  });

  it('round-trips through clampLockSeconds for every step on the wheels', () => {
    for (let h = 0; h <= MAX_LOCK_HOURS; h++) {
      for (let m = 0; m < 60; m += STEP) {
        const seconds = clampLockSeconds(h, m);
        const split = splitLockSeconds(seconds, STEP);
        expect(clampLockSeconds(split.hours, split.minutes)).toBe(seconds);
      }
    }
  });
});

describe('protocol parsers', () => {
  it('parses a status payload from the box', () => {
    const s = parseStatus('{"st":"running","rem":1234,"set":1800,"bat":78,"fw":"1.0"}');
    expect(s?.st).toBe('running');
    expect(s?.rem).toBe(1234);
  });

  it('parses a batch of history entries drained from the box', () => {
    const entries = parseHistoryEntries('[{"p":300,"a":300,"c":1,"t":1700000000}]');
    expect(entries).toEqual([{ p: 300, a: 300, c: 1, t: 1700000000 }]);
  });

  it('treats a missing/garbled history payload as empty', () => {
    expect(parseHistoryEntries('not json')).toEqual([]);
    expect(parseHistoryEntries('{}')).toEqual([]);
  });

  it('rejects garbled json', () => {
    expect(parseStatus('{not json')).toBeNull();
  });
});
