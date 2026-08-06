// comparisons.ts -- turns a total focused-seconds count into lighthearted
// real-world comparisons ("that's like 3.2 movies") for the Stats screen.
// Pure/no deps, unit-testable the same way as stats.ts.

export interface RealWorldRef {
  key: string;
  label: string; // noun phrase following "That's like Nx ...", e.g. "watching a movie"
  unitS: number; // reference duration in seconds
}

// Deliberately round, easy-to-defend reference durations -- not meant to be
// precise, just relatable. Ordered roughly shortest -> longest.
export const REAL_WORLD_REFS: RealWorldRef[] = [
  { key: 'tv-episode', label: 'watching a sitcom episode', unitS: 25 * 60 },
  { key: 'workout', label: 'a gym workout', unitS: 60 * 60 },
  { key: 'movie', label: 'watching a movie', unitS: 2 * 60 * 60 },
  { key: 'novel', label: 'reading a novel', unitS: 6 * 60 * 60 },
  { key: 'marathon', label: 'running a marathon', unitS: 4 * 60 * 60 },
  { key: 'flight-nyc-la', label: 'flying coast to coast', unitS: 6 * 60 * 60 },
  { key: 'sleep', label: 'a full night of sleep', unitS: 8 * 60 * 60 },
  { key: 'workday', label: 'a full workday', unitS: 8 * 60 * 60 },
];

export interface Comparison {
  ref: RealWorldRef;
  count: number; // totalS / ref.unitS
}

/** One comparison per reference, unsorted. */
export function computeComparisons(
  totalS: number,
  refs: RealWorldRef[] = REAL_WORLD_REFS,
): Comparison[] {
  return refs.map((ref) => ({ ref, count: totalS / ref.unitS }));
}

/** Comparisons sorted by the most dramatic (highest multiple) first. */
export function topComparisons(
  totalS: number,
  refs: RealWorldRef[] = REAL_WORLD_REFS,
): Comparison[] {
  return computeComparisons(totalS, refs).sort((a, b) => b.count - a.count);
}

/** "That's like 3.2x reading a novel." Whole numbers >= 10 drop the decimal. */
export function formatComparison(c: Comparison): string {
  const n = c.count;
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `That's like ${rounded}x ${c.ref.label}.`;
}
