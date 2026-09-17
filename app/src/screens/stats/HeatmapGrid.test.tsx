// HeatmapGrid.test.tsx -- the Stats heatmap has to paint a heat level the
// same colour the rest of the app paints it.
//
// theme/dayHeat.ts's ALPHA_FOR_LEVEL calls itself "the single source of
// truth mapping a heat level to a fill alpha", and the calendar's day cells
// (ui/calendar/DayCell.tsx) and its legend (ui/calendar/HeatLegend.tsx) do
// both read it, through heatFill. This grid did not: it carried a private
// [0.08, 0.3, 0.5, 0.72, 1] of its own. Levels 2 and 4 happened to agree,
// levels 1 and 3 did not -- the same day was one shade on the Calendar tab
// and another on Stats, and nothing would ever have flagged it, because a
// "single source of truth" that something can simply not read is just a
// table with a confident comment on it.
//
// Level 0 is the deliberate exception and is pinned separately below.
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { HeatmapGrid } from './HeatmapGrid';
import { useSettingsStore } from '../../store/useSettingsStore';
import { resolveTheme } from '../../theme/theme';
import { heatFill, HEAT_LEVELS } from '../../theme/dayHeat';
import type { HeatmapDay } from '../../stats/trend';

const MODE = 'dark';
const ACCENT = 'mint';
const theme = resolveTheme(MODE, ACCENT);

const day = (level: HeatmapDay['level']): HeatmapDay => ({
  key: `2026-03-0${level + 1}`,
  dateMs: new Date(2026, 2, level + 1).getTime(),
  focusS: level * 900,
  level,
});

/** One cell's rendered fill, in the order HEAT_LEVELS were handed in. The
 * cells are the only 32x32 Views in the tree. */
function cellFills(): (string | undefined)[] {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<HeatmapGrid heatmap={HEAT_LEVELS.map(day)} onInspectDay={() => {}} />);
  });
  const fills = tree!.root
    .findAll((n) => typeof n.type === 'string')
    .map((n) => StyleSheet.flatten(n.props.style) as Record<string, unknown> | undefined)
    .filter((s) => s && s.width === 32 && s.height === 32)
    .map((s) => s!.backgroundColor as string | undefined);
  act(() => {
    tree!.unmount();
  });
  return fills;
}

beforeEach(() => {
  useSettingsStore.setState({ hydrated: true, themeMode: MODE, accent: ACCENT } as never);
});

describe('heat fills', () => {
  it('draws one cell per day', () => {
    expect(cellFills()).toHaveLength(HEAT_LEVELS.length);
  });

  it.each(HEAT_LEVELS.filter((l) => l > 0))('matches the shared scale at level %i', (level) => {
    expect(cellFills()[level]).toBe(heatFill(theme, level));
  });

  it('keeps an empty day visible rather than punching a hole in the grid', () => {
    // NOT heatFill(theme, 0). That is withAlpha(accent, 0) -- fully
    // transparent -- which is right on the calendar, where the cell still
    // draws a day number and the grid reads as a grid without it, and in
    // the legend, which gives level 0 its own outlined `surface` swatch.
    // Here the cells ARE the grid: this one sits on a Sheet already painted
    // theme.surface, so both transparent and `surface` render as a missing
    // tile in a 5x7 block of them. The faint tint is the empty-cell
    // affordance, and it is the one thing the private table below was
    // actually buying.
    const empty = cellFills()[0];
    expect(empty).not.toBe(heatFill(theme, 0));
    expect(empty).not.toBe(theme.surface);
    expect(empty).toBeTruthy();
  });
});
