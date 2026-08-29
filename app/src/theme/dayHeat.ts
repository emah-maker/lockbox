// dayHeat.ts -- the heat scale shared by the calendar's month grid, its
// legend, and the stats heatmap: how a discrete intensity level turns into a
// fill, and which ink stays readable on that fill.
//
// Lives in theme/ rather than in ui/calendar/DayCell.tsx (its previous home)
// because none of this is rendering -- it is `(theme, level) -> color`, pure
// palette math with no RN in it. Keeping it here is what lets theme.test.ts
// verify the contrast guarantees without importing a calendar cell component,
// and lets DayCell/HeatLegend go back to being dumb leaves that just draw
// what they are handed.
import type { ThemeColors } from './theme';
import { bestTextOn, blendOver, withAlpha } from './color';

/** Discrete heat bucket. 0 = no focus time; 4 = the busiest day in the
 * window. Produced by stats/trend.ts's `heatmapLevel` and
 * screens/calendar/monthGrid.ts's `monthHeatLevels`; consumed here. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export const HEAT_LEVELS: HeatLevel[] = [0, 1, 2, 3, 4];

// The single source of truth mapping a heat level to a fill alpha. Both the
// day cells and the legend swatches read this same table -- that is what
// guarantees they never drift apart the way the old continuous-alpha scheme
// and trend.ts's discrete one silently did.
export const ALPHA_FOR_LEVEL: Record<HeatLevel, number> = {
  0: 0,
  1: 0.25,
  2: 0.5,
  3: 0.75,
  4: 1,
};

/** Background fill for a cell at this heat level, as an RN 8-digit hex. */
export function heatFill(theme: ThemeColors, level: HeatLevel): string {
  return withAlpha(theme.accent, ALPHA_FOR_LEVEL[level]);
}

/** Text color for the day number drawn on top of `heatFill`.
 *
 * `accentText` alone is wrong for every level except 4: it is contrast-tuned
 * against the accent at FULL strength, but levels 1-3 are a 25/50/75% tint
 * over `bg`, which resolves much closer to the page background than to the
 * accent.
 *
 * Rather than hardcode a threshold level (the right answer flips between
 * light and dark at level 3), this composites the fill `heatFill` will
 * actually produce and asks which candidate wins on that pixel -- correct for
 * every (mode, accent, level) combination by construction, including any
 * accent added later. `accentText` is passed first so it keeps winning ties
 * at level 4, where it is the deliberate choice. */
export function dayNumColor(theme: ThemeColors, level: HeatLevel): string {
  if (level === 0) return theme.text;
  return bestTextOn(blendOver(theme.accent, theme.bg, ALPHA_FOR_LEVEL[level]), theme.accentText, theme.text);
}
