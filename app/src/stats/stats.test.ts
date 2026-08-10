// Unit tests for the pure stats helpers. Run with `npm test` (jest-expo).
import { aggregate, formatDuration, completionRate, clampLockSeconds, MAX_LOCK_SECONDS, SessionRecord } from './stats';
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

  it('caps at the box\'s 9-hour maximum', () => {
    expect(clampLockSeconds(9, 30)).toBe(MAX_LOCK_SECONDS);
    expect(clampLockSeconds(20, 0)).toBe(MAX_LOCK_SECONDS);
  });

  it('floors negative or fractional input at 0', () => {
    expect(clampLockSeconds(-1, -5)).toBe(0);
    expect(clampLockSeconds(0.9, 0.9)).toBe(0);
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
