// Unit tests for the pure comparison helpers. Run with `npm test` (jest-expo).
import { computeComparisons, topComparisons, formatComparison, REAL_WORLD_REFS, RealWorldRef } from './comparisons';
import realWorldRefsGolden from '../../../tests/fixtures/realWorldRefs.golden.json';

const REFS: RealWorldRef[] = [
  { key: 'short', label: 'a short thing', unitS: 60 },
  { key: 'long', label: 'a long thing', unitS: 600 },
];

describe('computeComparisons', () => {
  it('divides the total by each reference duration', () => {
    const cs = computeComparisons(1200, REFS);
    expect(cs).toEqual([
      { ref: REFS[0], count: 20 },
      { ref: REFS[1], count: 2 },
    ]);
  });
});

describe('topComparisons', () => {
  it('sorts by the highest multiple first', () => {
    const cs = topComparisons(1200, REFS);
    expect(cs.map((c) => c.ref.key)).toEqual(['short', 'long']);
  });
});

describe('formatComparison', () => {
  it('keeps one decimal under 10x', () => {
    expect(formatComparison({ ref: REFS[0], count: 3.26 })).toBe('That\'s like 3.3x a short thing.');
  });

  it('rounds to a whole number at 10x and above', () => {
    expect(formatComparison({ ref: REFS[0], count: 12.4 })).toBe('That\'s like 12x a short thing.');
  });
});

// Drift guard: REAL_WORLD_REFS is hand-ported to website/js/focusStats.js
// (comment above that file's own copy explains why), and nothing in either
// runtime enforces the two staying in sync -- a 12th entry added to only
// one side is an easy, silent mistake. Both sides are asserted here against
// the SAME third source (tests/fixtures/realWorldRefs.golden.json) rather
// than against each other directly, since this file can't import a plain-JS
// website module -- see focusStats.test.js's identical check on that side.
describe('REAL_WORLD_REFS parity with website/js/focusStats.js', () => {
  it('matches the golden fixture exactly -- same count, same order, same key/label/unitS', () => {
    expect(REAL_WORLD_REFS).toEqual(realWorldRefsGolden.refs);
  });
});
