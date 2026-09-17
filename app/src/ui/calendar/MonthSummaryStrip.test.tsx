// MonthSummaryStrip.test.tsx -- "Best day" has to name the day the month
// summary actually picked.
//
// summary.bestDayKey is a dayKey, and every dayKey in this app is a LOCAL
// calendar day rendered as 'YYYY-MM-DD' (stats/sessionHistory.ts's dayKey
// builds it from getFullYear/getMonth/getDate; monthGrid.ts's
// computeMonthSummary hands this one straight through from that). Reading it
// back with `new Date(key)` is the one Date constructor that parses a bare
// date-only string as UTC midnight, which west of UTC is still the previous
// local evening -- so the strip named the day BEFORE the busiest one, every
// month, on every phone in the Americas. dayKeyToDate is the matching
// local-calendar parse and is what DaySheet.tsx's own title already uses.
//
// The zone is pinned in-process for the same two reasons
// screens/CalendarScreen.deeplink.test.tsx gives: in UTC the two parses agree
// and this would pass against the bug, and a `TZ=...` command prefix is
// silently dropped by the shell this repo's tests are usually launched from.
process.env.TZ = 'America/Los_Angeles';

import TestRenderer, { act } from 'react-test-renderer';
import { MonthSummaryStrip } from './MonthSummaryStrip';
import { resolveTheme } from '../../theme/theme';
import type { MonthSummary } from '../../screens/calendar/monthGrid';

const theme = resolveTheme('dark', 'mint');

const summary = (over: Partial<MonthSummary> = {}): MonthSummary => ({
  totalFocusS: 7200,
  bestDayKey: null,
  bestDayFocusS: 0,
  streakDays: 0,
  ...over,
});

/** Every string this strip renders, flattened -- the component is three
 * value/label pairs with no testIDs, so the assertions below read the whole
 * set rather than reaching for a particular node's path. */
function textsOf(tree: TestRenderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => n.props.children)
    .filter((child): child is string => typeof child === 'string');
}

function render(s: MonthSummary) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<MonthSummaryStrip summary={s} theme={theme} />);
  });
  return tree!;
}

/** The label the strip is supposed to produce, built the same way it builds
 * it, so this comparison stays locale-independent -- only WHICH DAY is under
 * test, not how a month name is spelled. */
function dayLabel(y: number, monthIndex: number, day: number) {
  return new Date(y, monthIndex, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

test('the pinned zone actually took, or nothing below proves anything', () => {
  expect(new Date(2026, 2, 1).getTimezoneOffset()).toBeGreaterThan(0);
});

describe('best day', () => {
  it('names the dayKey it was given, not the evening before it', () => {
    const tree = render(summary({ bestDayKey: '2026-03-14', bestDayFocusS: 5400 }));
    const texts = textsOf(tree);

    expect(texts.some((t) => t.startsWith(dayLabel(2026, 2, 14)))).toBe(true);
    expect(texts.some((t) => t.startsWith(dayLabel(2026, 2, 13)))).toBe(false);
  });

  it('stays in the right month when the best day is the 1st', () => {
    // The 1st is where the off-by-one day also crosses a month boundary, so
    // the strip under the March grid claimed February's last day was March's
    // best -- a date not even on screen.
    const tree = render(summary({ bestDayKey: '2026-03-01', bestDayFocusS: 5400 }));
    const texts = textsOf(tree);

    expect(texts.some((t) => t.startsWith(dayLabel(2026, 2, 1)))).toBe(true);
    expect(texts.some((t) => t.startsWith(dayLabel(2026, 1, 28)))).toBe(false);
  });

  it('still shows the placeholder for a month with no focus time', () => {
    // bestDayKey null is the no-data path and must not start date-formatting
    // anything -- guarded here so the fix above can't quietly change it.
    expect(textsOf(render(summary({ totalFocusS: 0 })))).toContain('--');
  });
});
