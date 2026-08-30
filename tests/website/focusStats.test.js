// Unit tests for website/js/focusStats.js -- the plain-ES-module twin of
// app/src/stats/{stats,topics,customLabels,trend,comparisons}.ts. Cases are
// ported from app/src/stats/stats.test.ts (and this file's own comments)
// since this module exists specifically to keep the two surfaces from
// drifting. Run with `npm test` from the repo root (node --test).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate,
  formatDuration,
  completionRate,
  dayKey,
  dayKeyToDate,
  groupByDay,
  bestDay,
  lastNDays,
  sanitizeCustomLabels,
  topicBreakdownWithCustom,
  dominantTopicWithCustom,
  REAL_WORLD_REFS,
  topComparisons,
  formatComparison,
  startOfMonth,
  buildMonthGrid,
  heatmapLevel,
  ALPHA_FOR_LEVEL,
  readableTextColor,
  allLabelChoices,
  resolveTopic,
  createCustomLabel,
  renameCustomLabel,
  recolorCustomLabel,
  deleteCustomLabel,
  MAX_CUSTOM_LABELS,
  MAX_LABEL_NAME_LENGTH,
  TOPIC_KEYS,
} from '../../website/js/focusStats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const realWorldRefsGolden = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'fixtures', 'realWorldRefs.golden.json'), 'utf8'),
);

describe('aggregate', () => {
  const recs = [
    { plannedS: 300, actualS: 300, outcome: 'completed' },
    { plannedS: 600, actualS: 120, outcome: 'overridden' },
    { plannedS: 900, actualS: 900, outcome: 'completed' },
  ];

  it('counts sessions, focus, completed, longest', () => {
    const s = aggregate(recs);
    assert.equal(s.n, 3);
    assert.equal(s.foc, 1320);
    assert.equal(s.done, 2);
    assert.equal(s.lng, 900);
  });

  it('streak counts only trailing consecutive completed sessions (records are oldest-first)', () => {
    // recs' newest (last) entry is completed, the one before it is an
    // override -- so the trailing streak is exactly 1, not 2.
    assert.equal(aggregate(recs).str, 1);
  });

  it('streak spans a run of multiple trailing completed sessions', () => {
    const r = [
      { plannedS: 60, actualS: 10, outcome: 'overridden' },
      { plannedS: 300, actualS: 300, outcome: 'completed' },
      { plannedS: 300, actualS: 300, outcome: 'completed' },
    ];
    assert.equal(aggregate(r).str, 2);
  });

  it('streak is 0 when the newest session is not completed, even with completed ones earlier', () => {
    const r = [
      { plannedS: 300, actualS: 300, outcome: 'completed' },
      { plannedS: 60, actualS: 10, outcome: 'overridden' },
    ];
    assert.equal(aggregate(r).str, 0);
  });

  it('empty history is all zeros', () => {
    assert.deepEqual(aggregate([]), { n: 0, foc: 0, done: 0, str: 0, lng: 0 });
  });
});

describe('formatDuration', () => {
  it('formats sub-hour minutes and multi-hour durations', () => {
    assert.equal(formatDuration(0), '0m');
    assert.equal(formatDuration(300), '5m');
    assert.equal(formatDuration(3720), '1h 02m');
  });

  it('floors fractional seconds and never goes negative', () => {
    assert.equal(formatDuration(59.9), '0m');
    assert.equal(formatDuration(-100), '0m');
  });
});

describe('completionRate', () => {
  it('is 0 with no sessions and rounds otherwise', () => {
    assert.equal(completionRate({ n: 0, foc: 0, done: 0, str: 0, lng: 0 }), 0);
    assert.equal(completionRate({ n: 3, foc: 0, done: 2, str: 0, lng: 0 }), 67);
  });
});

describe('dayKey', () => {
  it('formats as zero-padded local Y-M-D', () => {
    assert.equal(dayKey(new Date(2024, 0, 5, 23, 59).getTime()), '2024-01-05');
    assert.equal(dayKey(new Date(2024, 11, 31, 0, 0).getTime()), '2024-12-31');
  });
});

describe('groupByDay', () => {
  it('buckets sessions under the local day they started, preserving order within a day', () => {
    const a = { startedAt: new Date(2024, 0, 5, 8).getTime() };
    const b = { startedAt: new Date(2024, 0, 5, 20).getTime() };
    const c = { startedAt: new Date(2024, 0, 6, 8).getTime() };
    const grouped = groupByDay([a, b, c]);
    assert.deepEqual(grouped.get('2024-01-05'), [a, b]);
    assert.deepEqual(grouped.get('2024-01-06'), [c]);
  });
});

describe('bestDay', () => {
  it('returns null for an empty or all-zero log', () => {
    assert.equal(bestDay([]), null);
  });

  it('picks the single calendar day with the most total focus time across all history', () => {
    const sessions = [
      { startedAt: new Date(2024, 0, 1, 8).getTime(), actualS: 100 },
      { startedAt: new Date(2024, 0, 2, 8).getTime(), actualS: 500 },
      { startedAt: new Date(2024, 0, 2, 20).getTime(), actualS: 200 }, // same day as above, adds up
    ];
    const best = bestDay(sessions);
    assert.equal(best.key, '2024-01-02');
    assert.equal(best.focusS, 700);
  });
});

describe('lastNDays', () => {
  it('returns `days` entries oldest-to-newest, including today, zero-filled for days with no sessions', () => {
    const now = new Date(2024, 0, 10, 12);
    const sessions = [{ startedAt: new Date(2024, 0, 10, 8).getTime(), actualS: 300 }];
    const result = lastNDays(sessions, 3, now.getTime());
    assert.equal(result.length, 3);
    assert.equal(result[0].key, '2024-01-08');
    assert.equal(result[0].focusS, 0);
    assert.equal(result[2].key, '2024-01-10');
    assert.equal(result[2].focusS, 300);
  });

  it('labels each day with its local weekday initial, Sun-first', () => {
    // 2024-01-07 is a Sunday.
    const result = lastNDays([], 7, new Date(2024, 0, 13, 12).getTime());
    assert.deepEqual(result.map((r) => r.label), ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  });
});

describe('resolveTopic', () => {
  it('returns null for a falsy topic (untagged session)', () => {
    assert.equal(resolveTopic(null, []), null);
    assert.equal(resolveTopic(undefined, []), null);
    assert.equal(resolveTopic('', []), null);
  });

  it('resolves a built-in TOPIC_KEYS entry without needing customLabels', () => {
    const resolved = resolveTopic('work', []);
    assert.equal(resolved.id, 'work');
    assert.equal(resolved.isCustom, false);
  });

  it('resolves a "custom:"-prefixed id against the supplied customLabels list', () => {
    const labels = [{ id: 'custom:abc', name: 'Side project', color: '#2563eb' }];
    const resolved = resolveTopic('custom:abc', labels);
    assert.equal(resolved.label, 'Side project');
    assert.equal(resolved.isCustom, true);
  });

  it('returns null for a custom: id whose label was since deleted', () => {
    assert.equal(resolveTopic('custom:gone', []), null);
  });

  it('picks the light/dark hex variant per the `mode` argument for a built-in topic', () => {
    const light = resolveTopic('work', [], 'light');
    const dark = resolveTopic('work', [], 'dark');
    assert.notEqual(light.color, dark.color);
  });
});

describe('allLabelChoices', () => {
  it('lists built-ins in TOPIC_KEYS order, then custom labels in creation order', () => {
    const labels = [{ id: 'custom:a', name: 'A', color: '#111' }, { id: 'custom:b', name: 'B', color: '#222' }];
    const choices = allLabelChoices(labels);
    assert.deepEqual(choices.slice(0, TOPIC_KEYS.length).map((c) => c.id), TOPIC_KEYS);
    assert.deepEqual(choices.slice(TOPIC_KEYS.length).map((c) => c.id), ['custom:a', 'custom:b']);
  });
});

describe('topicBreakdownWithCustom / dominantTopicWithCustom', () => {
  it('excludes untagged/deleted-label sessions and sorts by highest focus first', () => {
    const sessions = [
      { actualS: 100, topic: 'work' },
      { actualS: 500, topic: 'study' },
      { actualS: 900, topic: undefined },
      { actualS: 50, topic: 'custom:gone' },
    ];
    const breakdown = topicBreakdownWithCustom(sessions, []);
    assert.deepEqual(breakdown.map((b) => b.key), ['study', 'work']);
    assert.equal(dominantTopicWithCustom(sessions, []).key, 'study');
  });

  it('dominantTopicWithCustom is null when nothing is tagged', () => {
    assert.equal(dominantTopicWithCustom([{ actualS: 100, topic: undefined }], []), null);
  });
});

describe('topComparisons / formatComparison', () => {
  it('sorts by the most dramatic (highest multiple) comparison first -- smaller unitS wins for a fixed totalS', () => {
    const refs = [{ key: 'small', label: 'small', unitS: 60 }, { key: 'big', label: 'big', unitS: 600 }];
    const compared = topComparisons(600, refs);
    assert.equal(compared[0].ref.key, 'small'); // 600/60 = 10x beats 600/600 = 1x
    assert.equal(compared[0].count, 10);
    assert.equal(compared[1].count, 1);
  });

  it('formats with one decimal below 10x, whole numbers at/above 10x', () => {
    assert.equal(formatComparison({ count: 3.24, ref: { label: 'reading a novel' } }), "That's like 3.2x reading a novel.");
    assert.equal(formatComparison({ count: 12.6, ref: { label: 'a full weekend' } }), "That's like 13x a full weekend.");
  });
});

// Drift guard: REAL_WORLD_REFS is hand-ported from app/src/stats/
// comparisons.ts (comment above this file's own copy explains why), and
// nothing in either runtime enforces the two staying in sync -- a 12th
// entry added to only one side is an easy, silent mistake. Both sides are
// asserted here against the SAME third source
// (tests/fixtures/realWorldRefs.golden.json) rather than against each other
// directly, since this suite can't import a TypeScript module -- see
// comparisons.test.ts's identical check on the app side.
describe('REAL_WORLD_REFS parity with app/src/stats/comparisons.ts', () => {
  it('matches the golden fixture exactly -- same count, same order, same key/label/unitS', () => {
    assert.deepEqual(REAL_WORLD_REFS, realWorldRefsGolden.refs);
  });
});

describe('startOfMonth / buildMonthGrid', () => {
  it('startOfMonth clears to the 1st of the given date\'s month', () => {
    assert.deepEqual(startOfMonth(new Date(2024, 1, 15)), new Date(2024, 1, 1));
  });

  it('pads a Sun-first grid to full weeks with null filler cells', () => {
    // Feb 2024: the 1st is a Thursday (getDay() === 4) -> 4 leading nulls;
    // 29 days (leap year) -> total cells must still be a multiple of 7.
    const grid = buildMonthGrid(new Date(2024, 1, 1));
    assert.equal(grid.length % 7, 0);
    assert.equal(grid[0], null);
    assert.equal(grid[1], null);
    assert.equal(grid[2], null);
    assert.equal(grid[3], null);
    assert.deepEqual(grid[4], new Date(2024, 1, 1));
    assert.deepEqual(grid[4 + 28], new Date(2024, 1, 29)); // leap day
  });
});

describe('heatmapLevel / ALPHA_FOR_LEVEL', () => {
  it('is level 0 for zero (or negative) focus time regardless of max', () => {
    assert.equal(heatmapLevel(0, 100), 0);
    assert.equal(heatmapLevel(-5, 100), 0);
  });

  it('is level 4 for the busiest day (ratio === 1)', () => {
    assert.equal(heatmapLevel(100, 100), 4);
  });

  it('sits just above the 0.75 boundary at level 4, and at/just below it at level 3', () => {
    assert.equal(heatmapLevel(75.01, 100), 4);
    assert.equal(heatmapLevel(75, 100), 3); // exactly 0.75 does not clear ">"
    assert.equal(heatmapLevel(74.99, 100), 3);
  });

  it('sits just above the 0.5 boundary at level 3, and at/just below it at level 2', () => {
    assert.equal(heatmapLevel(50.01, 100), 3);
    assert.equal(heatmapLevel(50, 100), 2); // exactly 0.5 does not clear ">"
    assert.equal(heatmapLevel(49.99, 100), 2);
  });

  it('sits just above the 0.25 boundary at level 2, and at/just below it at level 1', () => {
    assert.equal(heatmapLevel(25.01, 100), 2);
    assert.equal(heatmapLevel(25, 100), 1); // exactly 0.25 does not clear ">"
    assert.equal(heatmapLevel(24.99, 100), 1);
  });

  it('never renders any focus time as invisible level 0 -- the smallest nonzero amount is level 1', () => {
    assert.equal(heatmapLevel(0.01, 100), 1);
  });

  it('exposes exactly the 5 fill alphas the app\'s ALPHA_FOR_LEVEL table defines, so a drift on either side breaks this test', () => {
    assert.deepEqual(ALPHA_FOR_LEVEL, { 0: 0, 1: 0.25, 2: 0.5, 3: 0.75, 4: 1 });
  });
});

describe('readableTextColor', () => {
  it('picks black text on a light/bright fill', () => {
    assert.equal(readableTextColor('#ffffff'), '#0b0b0b');
    assert.equal(readableTextColor('#eda100'), '#0b0b0b'); // "creative" topic hex
  });

  it('picks white text on a dark fill', () => {
    assert.equal(readableTextColor('#000000'), '#ffffff');
    assert.equal(readableTextColor('#008300'), '#ffffff'); // "other" topic hex
  });
});

describe('createCustomLabel / renameCustomLabel / recolorCustomLabel / deleteCustomLabel', () => {
  it('creates a label with a trimmed name, rejecting an empty/whitespace-only one', () => {
    const labels = createCustomLabel([], '  Side project  ', '#2563eb');
    assert.equal(labels[0].name, 'Side project');
    assert.throws(() => createCustomLabel([], '   ', '#2563eb'));
  });

  it('rejects a name over MAX_LABEL_NAME_LENGTH, accepts one at the limit', () => {
    assert.throws(() => createCustomLabel([], 'x'.repeat(MAX_LABEL_NAME_LENGTH + 1), '#2563eb'));
    assert.equal(createCustomLabel([], 'x'.repeat(MAX_LABEL_NAME_LENGTH), '#2563eb')[0].name.length, MAX_LABEL_NAME_LENGTH);
  });

  it('requires a color', () => {
    assert.throws(() => createCustomLabel([], 'Name', ''));
  });

  it('rejects creating a label past MAX_CUSTOM_LABELS', () => {
    let labels = [];
    for (let i = 0; i < MAX_CUSTOM_LABELS; i += 1) labels = createCustomLabel(labels, `Label ${i}`, '#2563eb');
    assert.equal(labels.length, MAX_CUSTOM_LABELS);
    assert.throws(() => createCustomLabel(labels, 'One too many', '#2563eb'));
  });

  it('renameCustomLabel only touches the matching id, recolorCustomLabel likewise', () => {
    const labels = createCustomLabel(createCustomLabel([], 'A', '#111'), 'B', '#222');
    const renamed = renameCustomLabel(labels, labels[0].id, 'A2');
    assert.equal(renamed[0].name, 'A2');
    assert.equal(renamed[1].name, 'B'); // untouched

    const recolored = recolorCustomLabel(labels, labels[1].id, '#333');
    assert.equal(recolored[1].color, '#333');
    assert.equal(recolored[0].color, '#111'); // untouched
  });

  it('deleteCustomLabel removes only the matching id', () => {
    const labels = createCustomLabel(createCustomLabel([], 'A', '#111'), 'B', '#222');
    const remaining = deleteCustomLabel(labels, labels[0].id);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].name, 'B');
  });
});

describe('dayKeyToDate', () => {
  it('round-trips any timestamp through dayKey back to that local day', () => {
    // Spread across the day, including the two a UTC-vs-local mix-up flips:
    // just after local midnight and just before it.
    for (const t of [
      new Date(2026, 0, 1, 0, 0, 1),
      new Date(2026, 6, 4, 12, 0, 0),
      new Date(2026, 7, 28, 23, 59, 59),
      new Date(2026, 11, 31, 20, 30, 0),
    ]) {
      const back = dayKeyToDate(dayKey(t.getTime()));
      assert.equal(back.getFullYear(), t.getFullYear());
      assert.equal(back.getMonth(), t.getMonth());
      assert.equal(back.getDate(), t.getDate());
    }
  });

  it('lands on local midnight', () => {
    const d = dayKeyToDate('2026-08-28');
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
    assert.equal(d.getSeconds(), 0);
    assert.equal(d.getMilliseconds(), 0);
  });

  it("does not repeat new Date(key)'s UTC parse, which shifts the day west of UTC", () => {
    // `new Date('2026-08-28')` is UTC midnight, i.e. the 27th in any negative
    // -offset zone. calendarPanel.js's day-list title used to do exactly that.
    assert.equal(dayKeyToDate('2026-08-28').getDate(), 28);
    assert.equal(dayKeyToDate('2026-01-01').getMonth(), 0);
    assert.equal(dayKeyToDate('2026-01-01').getFullYear(), 2026);
  });
});

// The twin of app/src/stats/customLabels.test.ts's own sanitizeCustomLabels
// block. settings/app's write rule bounds the catalog's size and that it is a
// list, but rules cannot iterate a list of maps -- so the entries reaching
// this module were never checked by anything, while every renderer reads
// .id/.name/.color straight out of them.
describe('sanitizeCustomLabels', () => {
  const label = (over = {}) => ({ id: 'custom:1', name: 'Deep Work', color: '#123456', ...over });

  it('keeps a well-formed catalog as it is', () => {
    assert.deepEqual(sanitizeCustomLabels([label()]), [label()]);
  });

  it('answers with an empty catalog for anything that is not an array', () => {
    assert.deepEqual(sanitizeCustomLabels('xx'), []);
    assert.deepEqual(sanitizeCustomLabels(undefined), []);
    assert.deepEqual(sanitizeCustomLabels(null), []);
  });

  it('drops entries missing a field or holding the wrong type in one', () => {
    const kept = sanitizeCustomLabels([
      null,
      'not-a-label',
      label({ id: 42 }),
      label({ name: '   ' }),
      label({ color: '' }),
      label({ id: 'custom:keep' }),
    ]);
    assert.deepEqual(kept, [label({ id: 'custom:keep' })]);
  });

  it('drops a duplicate id rather than letting two labels share one key', () => {
    assert.deepEqual(sanitizeCustomLabels([label({ name: 'First' }), label({ name: 'Second' })]), [
      label({ name: 'First' }),
    ]);
  });

  it('trims a name and holds it to the same cap the editor enforces', () => {
    const long = 'x'.repeat(MAX_LABEL_NAME_LENGTH + 10);
    assert.equal(sanitizeCustomLabels([label({ name: `  ${long}  ` })])[0].name.length, MAX_LABEL_NAME_LENGTH);
  });

  it('stops at the catalog cap', () => {
    const many = Array.from({ length: MAX_CUSTOM_LABELS + 5 }, (_, i) => label({ id: `custom:${i}` }));
    assert.equal(sanitizeCustomLabels(many).length, MAX_CUSTOM_LABELS);
  });
});
