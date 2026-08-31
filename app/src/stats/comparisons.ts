// comparisons.ts -- turns a total focused-seconds count into lighthearted
// real-world comparisons ("that's like 3.2 movies") for the Stats screen.
// Pure/no deps, unit-testable the same way as stats.ts.
//
// Deliberately NOT given a `labels: CustomLabel[]` parameter of its own,
// unlike stats.ts's aggregate or trend.ts's bestDay/lastNDays/
// lastNDaysHeatmap: every function here takes an already-computed `totalS`,
// not a session list, so there is nothing for this module to filter --
// exclusion happens once, upstream, wherever that totalS was produced (in
// practice, StatsScreen.tsx's `stats.foc`, which comes from stats.ts's own
// aggregate(sessions, customLabels)). Adding a no-op labels param here would
// only invite a caller to pass customLabels a second time and wonder why a
// number already excluded needed excluding again.

export interface RealWorldRef {
  key: string;
  label: string; // noun phrase following "That's like Nx ...", e.g. "watching a movie"
  unitS: number; // reference duration in seconds
}

// Deliberately round, easy-to-defend reference durations -- not meant to be
// precise, just relatable. Ordered shortest -> longest, and each unitS is
// distinct: two refs with the same duration would tie in topComparisons and
// show two identical multiples on the Stats screen, which reads like a bug
// rather than a fun fact. Picked for a wide, evenly-spread range (10 min to
// half a day) so short sessions and marathon ones each surface something
// that actually feels dramatic instead of always landing on the same 1-2 refs.
//
// Hand-ported, byte-for-byte, to website/js/focusStats.js's own
// REAL_WORLD_REFS (~line 283) -- the two lists must stay in sync (same 11
// entries, same order, same key/label/unitS), which nothing in either
// runtime enforces on its own. Checked against tests/fixtures/
// realWorldRefs.golden.json by this file's own "REAL_WORLD_REFS parity"
// test in comparisons.test.ts and by focusStats.test.js's twin -- adding a
// 12th reference here without also updating website/js/focusStats.js AND
// that fixture will fail both.
export const REAL_WORLD_REFS: RealWorldRef[] = [
  { key: 'coffee', label: 'brewing a pot of coffee', unitS: 10 * 60 },
  { key: 'tv-episode', label: 'watching a sitcom episode', unitS: 22 * 60 },
  { key: 'workout', label: 'a gym workout', unitS: 60 * 60 },
  { key: 'movie', label: 'watching a movie', unitS: 2 * 60 * 60 },
  { key: 'baseball-game', label: 'a baseball game', unitS: 3 * 60 * 60 },
  { key: 'marathon', label: 'running a marathon', unitS: 4.5 * 60 * 60 },
  { key: 'novel', label: 'reading a novel', unitS: 6 * 60 * 60 },
  { key: 'flight-transatlantic', label: 'a transatlantic flight', unitS: 7 * 60 * 60 },
  { key: 'sleep', label: 'a full night of sleep', unitS: 8 * 60 * 60 },
  { key: 'lotr-trilogy', label: 'bingeing the Lord of the Rings trilogy (extended cuts)', unitS: 11.4 * 60 * 60 },
  { key: 'weekend', label: 'a full weekend', unitS: 48 * 60 * 60 },
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
