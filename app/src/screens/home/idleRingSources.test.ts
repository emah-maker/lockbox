// Unit tests for idleRingSources.ts -- the three Home ring sources added
// after the original five. Pure module; `nowMs` is always pinned explicitly
// rather than read from the clock, same convention idleRingState.test.ts
// uses. Run with `npm test`.
import {
  computePaceRingProgress,
  computeSessionCountRingProgress,
  todaySessionCount,
  paceFractionOfDay,
  PACE_DAY_START_HOUR,
  PACE_DAY_END_HOUR,
} from './idleRingSources';
import type { LoggedSession } from '../../stats/sessionHistory';

// Local times, deliberately -- every helper here reasons in the device's own
// calendar day / wall clock, so a UTC-pinned fixture would drift by timezone.
const at = (hour: number, minute = 0, dayOffset = 0) =>
  new Date(2026, 0, 15 + dayOffset, hour, minute, 0).getTime();

const session = (startedAt: number): LoggedSession => ({
  startedAt,
  plannedS: 1800,
  actualS: 1800,
  outcome: 'completed',
});

describe('paceFractionOfDay', () => {
  it('is 0 before the pace window opens, so an early morning never reads as "behind"', () => {
    expect(paceFractionOfDay(at(0))).toBe(0);
    expect(paceFractionOfDay(at(PACE_DAY_START_HOUR))).toBe(0);
    expect(paceFractionOfDay(at(PACE_DAY_START_HOUR - 1))).toBe(0);
  });

  it('is halfway through the window at its midpoint', () => {
    const mid = (PACE_DAY_START_HOUR + PACE_DAY_END_HOUR) / 2;
    expect(paceFractionOfDay(at(mid))).toBeCloseTo(0.5, 6);
  });

  it('saturates at 1 by the end of the window', () => {
    expect(paceFractionOfDay(at(23, 59))).toBeCloseTo(1, 2);
  });
});

describe('computePaceRingProgress', () => {
  it('reads as empty with no daily goal to pace against', () => {
    expect(computePaceRingProgress(3600, null, at(12))).toEqual({ progress: 0, source: 'empty' });
    expect(computePaceRingProgress(3600, 0, at(12))).toEqual({ progress: 0, source: 'empty' });
  });

  it('reports a real pace source with nothing expected yet before the window opens', () => {
    const state = computePaceRingProgress(0, 7200, at(6));
    expect(state.source).toBe('pace');
    expect(state.progress).toBe(0);
    expect(state.pace).toEqual({ expectedS: 0, actualS: 0 });
  });

  it('is exactly 1 when today matches what is expected by now', () => {
    // Midpoint of the window: half the daily target is expected.
    const mid = (PACE_DAY_START_HOUR + PACE_DAY_END_HOUR) / 2;
    const state = computePaceRingProgress(3600, 7200, at(mid));
    expect(state.progress).toBeCloseTo(1, 6);
    expect(state.pace!.expectedS).toBeCloseTo(3600, 6);
  });

  it('goes above 1 when ahead and below 1 when behind', () => {
    const mid = (PACE_DAY_START_HOUR + PACE_DAY_END_HOUR) / 2;
    expect(computePaceRingProgress(5400, 7200, at(mid)).progress).toBeGreaterThan(1);
    expect(computePaceRingProgress(900, 7200, at(mid)).progress).toBeLessThan(1);
  });

  it('does NOT suppress a zero-focus day -- "0% of what you should have done by 4pm" is the whole point', () => {
    const state = computePaceRingProgress(0, 7200, at(16));
    expect(state.source).toBe('pace');
    expect(state.progress).toBe(0);
    expect(state.pace!.expectedS).toBeGreaterThan(0);
  });
});

describe('computeSessionCountRingProgress', () => {
  it('reads as empty without a target, rather than inventing one', () => {
    expect(computeSessionCountRingProgress(3, null)).toEqual({ progress: 0, source: 'empty' });
    expect(computeSessionCountRingProgress(3, 0)).toEqual({ progress: 0, source: 'empty' });
  });

  it('reports the raw counts alongside the ratio', () => {
    const state = computeSessionCountRingProgress(2, 4);
    expect(state.progress).toBe(0.5);
    expect(state.source).toBe('sessionCount');
    expect(state.sessionCount).toEqual({ count: 2, target: 4 });
  });

  it('leaves an exceeded target unclamped, same as every other ratio source', () => {
    expect(computeSessionCountRingProgress(6, 4).progress).toBe(1.5);
  });
});

describe('todaySessionCount', () => {
  it('counts only the calendar day containing nowMs', () => {
    const sessions = [session(at(9)), session(at(14)), session(at(10, 0, -1)), session(at(10, 0, 1))];
    expect(todaySessionCount(sessions, at(12))).toBe(2);
  });

  it('is 0 with no sessions at all, and 0 on a day with none', () => {
    expect(todaySessionCount([], at(12))).toBe(0);
    expect(todaySessionCount([session(at(10, 0, -3))], at(12))).toBe(0);
  });
});
