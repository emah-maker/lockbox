// Unit tests for the pure idle-ring helpers. Run with `npm test` (jest-expo).
import { computeIdleRingProgress, ringBaselineWindowLabel } from './idleRingState';

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
