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
  sessionCountsTowardTotals,
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
  isHexColor,
  expandHex,
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

  // Regression: bestDay took no exclusion params at all, so the "Fun facts"
  // banner was computed from the RAW session log while the "Total focus
  // time" tile directly above it came from aggregate(), which does exclude.
  // Measured: exclude 'exercise', log 3h exercise Monday and 1h work
  // Tuesday, and the dashboard read "Total focus time 1h 00m" above "Your
  // best day was Mon -- 3h 00m focused." The app passes both lists
  // (StatsScreen.tsx's bestDay(topicScoped, 'all', nowMs, customLabels,
  // excludedTopicKeys)), so the banner named Tuesday there.
  it('skips a built-in topic listed in excludedTopicKeys', () => {
    const sessions = [
      { startedAt: new Date(2024, 0, 1, 8).getTime(), actualS: 10800, topic: 'exercise' }, // Mon, 3h
      { startedAt: new Date(2024, 0, 2, 8).getTime(), actualS: 3600, topic: 'work' }, // Tue, 1h
    ];
    assert.equal(bestDay(sessions).key, '2024-01-01'); // no exclusions: Monday still wins
    const best = bestDay(sessions, [], ['exercise']);
    assert.equal(best.key, '2024-01-02');
    assert.equal(best.focusS, 3600);
  });

  it('skips a custom label flagged excludeFromTotals', () => {
    const labels = [{ id: 'custom:chores', name: 'Chores', color: '#78716c', excludeFromTotals: true }];
    const sessions = [
      { startedAt: new Date(2024, 0, 1, 8).getTime(), actualS: 10800, topic: 'custom:chores' },
      { startedAt: new Date(2024, 0, 2, 8).getTime(), actualS: 3600, topic: 'work' },
    ];
    assert.equal(bestDay(sessions, labels).key, '2024-01-02');
  });

  it('returns null when every logged day is excluded', () => {
    const sessions = [{ startedAt: new Date(2024, 0, 1, 8).getTime(), actualS: 10800, topic: 'exercise' }];
    assert.equal(bestDay(sessions, [], ['exercise']), null);
  });

  // The defaults must reproduce the pre-exclusion behavior exactly -- an
  // empty catalog excludes nothing, same contract as aggregate/lastNDays.
  it('excludes nothing when both lists are omitted', () => {
    const sessions = [{ startedAt: new Date(2024, 0, 1, 8).getTime(), actualS: 10800, topic: 'exercise' }];
    assert.equal(bestDay(sessions).focusS, 10800);
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

  // Regression: resolveTopic used to stop at "not a built-in, not a saved
  // custom label -> null", which silently dropped every session tagged with
  // a one-time free-text tag (the app's TopicPicker "Type a label for this
  // session..." field) out of topicBreakdownWithCustom and therefore out of
  // "Time by label", the calendar dots and the goal rows -- on the website
  // only. app/src/stats/customLabels.ts's resolveTopic falls through to a
  // one-time branch instead, and that asymmetry is exactly the drift this
  // module exists to prevent.
  it('resolves a one-time free-text tag to itself, in the neutral label color', () => {
    const resolved = resolveTopic('Thesis', []);
    assert.equal(resolved.id, 'Thesis');
    assert.equal(resolved.label, 'Thesis');
    assert.equal(resolved.color, '#78716c'); // NEUTRAL_LABEL_COLOR, same as the app twin
    assert.equal(resolved.isCustom, false);
    assert.equal(resolved.isOneTime, true);
  });

  // Regression, and the drift this module exists to catch: the built-in test
  // was `topic in TOPIC_LABELS`, and TOPIC_LABELS is a plain object literal,
  // so `in` also matched every Object.prototype key. A session tagged with
  // the literal text 'constructor' -- the app's TopicPicker sends whatever
  // the user types, and firestore.rules accepts any string -- resolved as a
  // BUILT-IN: `label` came back as the inherited function and TOPIC_HEX had
  // no entry, so `color` was undefined, statsCards.js's compositeHex threw
  // on it, and the dashboard fell to "Something went wrong" on every load
  // until the tag was deleted on the phone. app/src/stats/topics.ts has
  // carried isTopicKey against exactly this since before the port.
  it('treats an Object.prototype key as a one-time tag, not a built-in topic', () => {
    for (const tag of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const resolved = resolveTopic(tag, []);
      assert.equal(resolved.label, tag, `${tag} must resolve to its own text`);
      assert.equal(resolved.color, '#78716c', `${tag} must get the neutral color, not undefined`);
      assert.equal(resolved.isOneTime, true);
      assert.equal(typeof resolved.label, 'string');
    }
  });

  // The same `in` hazard exists on the totals path (line 164 took the
  // built-in branch too), but it is currently unobservable: an inherited key
  // can never appear in excludedTopicKeys, because sanitizeExcludedTopicKeys
  // admits only real TOPIC_KEYS, so both branches answer "counts". Pinned
  // anyway -- this is the assertion that would start failing if that
  // sanitizer were ever loosened to pass arbitrary strings through.
  it('counts a prototype-keyed tag toward totals regardless of topic exclusions', () => {
    assert.equal(sessionCountsTowardTotals('constructor', [], ['exercise']), true);
    assert.equal(sessionCountsTowardTotals('toString', [], ['work', 'study']), true);
  });

  // The one-time fallback must not swallow the deleted-label case: a
  // 'custom:'-prefixed id IS catalog-shaped, so there is nothing to render
  // for it once the catalog entry is gone. Guarded because the naive port
  // (drop the null and always return the raw string) would make a deleted
  // label render as its own opaque id.
  it('still returns null for a deleted custom: id -- the prefix branch survives the one-time fallback', () => {
    assert.equal(resolveTopic('custom:gone', [{ id: 'custom:other', name: 'Other', color: '#2563eb' }]), null);
  });

  it('marks built-in and saved-custom resolutions as not one-time', () => {
    assert.equal(resolveTopic('work', []).isOneTime, false);
    assert.equal(resolveTopic('custom:abc', [{ id: 'custom:abc', name: 'Side project', color: '#2563eb' }]).isOneTime, false);
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

  // The user-visible half of the resolveTopic one-time regression above:
  // type "Thesis" into the app's TopicPicker for a 2h session and the app's
  // Stats screen shows "Thesis -- 2h 00m, 1 session", while the dashboard's
  // "Time by label" had no such row and read 2h short.
  it('counts one-time free-text tags as their own row, like the app', () => {
    const sessions = [
      { actualS: 7200, topic: 'Thesis' },
      { actualS: 3600, topic: 'work' },
    ];
    const breakdown = topicBreakdownWithCustom(sessions, []);
    assert.deepEqual(breakdown.map((b) => b.key), ['Thesis', 'work']);
    assert.equal(breakdown[0].focusS, 7200);
    assert.equal(breakdown[0].n, 1);
    assert.equal(dominantTopicWithCustom(sessions, []).key, 'Thesis');
  });

  // Two sessions typed with the same string are the same tag -- they must
  // land in one row, not two, since the raw string is the group key.
  it('groups repeated one-time tags under a single row', () => {
    const breakdown = topicBreakdownWithCustom(
      [{ actualS: 60, topic: 'Thesis' }, { actualS: 90, topic: 'Thesis' }],
      [],
    );
    assert.equal(breakdown.length, 1);
    assert.equal(breakdown[0].focusS, 150);
    assert.equal(breakdown[0].n, 2);
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
    // The shorthand colours here are just three distinguishable values; both
    // writers now store them expanded (see the colour-validation suite
    // below), so the expectations are the six-digit forms.
    const labels = createCustomLabel(createCustomLabel([], 'A', '#111'), 'B', '#222');
    const renamed = renameCustomLabel(labels, labels[0].id, 'A2');
    assert.equal(renamed[0].name, 'A2');
    assert.equal(renamed[1].name, 'B'); // untouched

    const recolored = recolorCustomLabel(labels, labels[1].id, '#333');
    assert.equal(recolored[1].color, '#333333');
    assert.equal(recolored[0].color, '#111111'); // untouched
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

  it('drops entries whose IDENTITY is missing or wrong-typed', () => {
    // id and name only. A bad colour is repaired rather than dropped -- it is
    // presentational, not identity, and there is a safe default for it; see
    // the colour-validation suite below.
    const kept = sanitizeCustomLabels([
      null,
      'not-a-label',
      label({ id: 42 }),
      label({ name: '   ' }),
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

// The twin of app/src/stats/customLabels.test.ts's own
// 'sanitizeCustomLabels -- excludeFromTotals round-trip' block, which this
// suite had no counterpart for.
//
// Why a DROPPED flag here is worse than a merely-unrendered one: this
// sanitizer is not just a read-side guard. Its output is what the dashboard
// re-sends -- labelsPanel.js's writeCustomLabels and accountPanel.js's
// writeAppearance both setDoc the whole settings/app document, carrying this
// catalog and a freshly-stamped `updatedAt`. Rebuilding each label as
// { id, name, color } therefore did not merely make the dashboard count an
// excluded label's time; it ERASED the user's exclusion from the account, and
// app/src/sync/settingsSyncPlan.ts, seeing the newer clock, answered 'apply'
// and pushed the erasure down to the phone. Renaming a label or clicking an
// accent swatch was enough to trigger it.
describe('sanitizeCustomLabels -- excludeFromTotals round-trip (twin of the app side)', () => {
  const label = (over = {}) => ({ id: 'custom:1', name: 'Deep Work', color: '#123456', ...over });

  it('round-trips excludeFromTotals: true unchanged', () => {
    assert.deepEqual(sanitizeCustomLabels([label({ excludeFromTotals: true })]), [label({ excludeFromTotals: true })]);
  });

  it('omits the field entirely for a label that never had it, same as before this field existed', () => {
    assert.deepEqual(sanitizeCustomLabels([label()]), [label()]);
    assert.equal('excludeFromTotals' in sanitizeCustomLabels([label()])[0], false);
  });

  it('drops a garbage (non-boolean) value from a hostile/old remote doc rather than coercing it', () => {
    for (const excludeFromTotals of ['true', 1, 0, null, {}, []]) {
      const [kept] = sanitizeCustomLabels([label({ excludeFromTotals })]);
      assert.equal('excludeFromTotals' in kept, false, `value ${JSON.stringify(excludeFromTotals)}`);
    }
  });

  it('explicit false is also dropped -- the omitted-key form is canonical, same as the app writes', () => {
    assert.equal('excludeFromTotals' in sanitizeCustomLabels([label({ excludeFromTotals: false })])[0], false);
  });

  // The end-to-end consequence, asserted against the two readers that
  // actually consume the flag, so this can't regress into "the key survives
  // but nothing reads it".
  it('keeps the sanitized catalog excluding the same sessions the raw one did', () => {
    const raw = [label({ id: 'custom:sleep', name: 'Sleep', excludeFromTotals: true })];
    const clean = sanitizeCustomLabels(raw);
    assert.equal(sessionCountsTowardTotals('custom:sleep', clean), false);
    const sessions = [
      { id: 's1', startedAt: 1_000, actualS: 8 * 3600, outcome: 'completed', topic: 'custom:sleep' },
      { id: 's2', startedAt: 2_000, actualS: 3600, outcome: 'completed', topic: 'work' },
    ];
    assert.equal(aggregate(sessions, clean).foc, 3600);
  });
});

// Colour validation, kept in step with app/src/stats/customLabels.ts and
// app/src/theme/color.ts. The two sides sanitize the SAME account document,
// so a catalog they disagree about is one each client keeps re-pushing over
// the other -- which is why these are twins and why this suite exists.
describe('label colour validation (twin of the app side)', () => {
  const label = (over = {}) => ({ id: 'custom:1', name: 'Deep Work', color: '#123456', ...over });

  it('accepts only the two notations the colour maths can work on', () => {
    assert.equal(isHexColor('#abc'), true);
    assert.equal(isHexColor('#AABBCC'), true);
    for (const v of ['red', 'rgb(1,2,3)', '#ab', '#aabbccdd', 'aabbcc', '', null, 42]) {
      assert.equal(isHexColor(v), false, `expected ${JSON.stringify(v)} to be rejected`);
    }
  });

  it('expands the shorthand form', () => {
    assert.equal(expandHex('#abc'), '#aabbcc');
    assert.equal(expandHex('#aabbcc'), '#aabbcc');
  });

  it('recolours a remote label whose colour is not hex, rather than dropping it', () => {
    // Dropping loses the user's label name and silently removes every
    // session tagged with it from the breakdown -- the more destructive
    // choice, not the safer one. Matches the app twin.
    for (const color of ['red', 'rgb(1,2,3)', '#ab', '', 7, null]) {
      const [kept] = sanitizeCustomLabels([label({ color })]);
      assert.ok(kept, `expected the label to survive a ${JSON.stringify(color)} colour`);
      assert.equal(kept.name, 'Deep Work');
      assert.match(kept.color, /^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps a shorthand colour, stored expanded', () => {
    assert.equal(sanitizeCustomLabels([label({ color: '#abc' })])[0].color, '#aabbcc');
  });

  it('rejects a non-hex colour in both authoring paths', () => {
    assert.throws(() => createCustomLabel([], 'Reading', 'red'), /hex color/);
    const made = createCustomLabel([], 'Reading', '#2563eb');
    assert.throws(() => recolorCustomLabel(made, made[0].id, 'red'), /hex color/);
  });

  it('never lets a non-hex colour produce a NaN contrast decision', () => {
    // NaN does not throw -- it makes both comparisons false, so the ink stops
    // being measured and silently becomes whichever branch loses the tie.
    for (const bad of ['red', 'not-a-colour', '']) {
      assert.ok(['#ffffff', '#0b0b0b'].includes(readableTextColor(bad)));
    }
  });

  it('measures shorthand colours properly instead of returning NaN', () => {
    assert.equal(readableTextColor('#fff'), '#0b0b0b');
    assert.equal(readableTextColor('#000'), '#ffffff');
  });
});

// ---------------------------------------------------------------------------
// resolveTopic's one-time fallback, seen from its consumers. Read as TEXT
// rather than imported for the reason settingsDoc.test.js spells out: these
// modules import the Firebase SDK from `https://www.gstatic.com/...`, which
// the default ESM loader refuses, so they cannot be imported under
// `node --test` at all.
// ---------------------------------------------------------------------------
describe('one-time tag consumers', () => {
  const read = (...parts) => readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
  const picker = read('website', 'js', 'sessionLabelPicker.js');

  // Before resolveTopic grew the fallback, this module carried its own
  // `isOneTimeTag` re-classifying the same three cases. A second copy of the
  // rule is how the two surfaces drift apart in the first place, so the
  // duplicate must not come back.
  it('sessionLabelPicker.js has no private re-implementation of the rule', () => {
    assert.ok(!/function isOneTimeTag/.test(picker), 'isOneTimeTag duplicate is back');
    assert.ok(picker.includes('resolved.isOneTime'), 'picker should read isOneTime off resolveTopic');
  });

  // Load-bearing ORDER, not just presence: a one-time tag is now a truthy
  // resolution, so an `if (resolved)` tested first would swallow it and paint
  // an ordinary filled chip, losing the dashed "typed once, not saved" cue
  // that distinguishes it from a saved label.
  it('renderChip tests the one-time case before the generic resolved case', () => {
    const chip = picker.slice(picker.indexOf('function renderChip'), picker.indexOf('function renderSelect'));
    const oneTimeAt = chip.indexOf('if (oneTime)');
    const resolvedAt = chip.indexOf('} else if (resolved) {');
    // Both asserted present first -- an indexOf of -1 on the one-time branch
    // would otherwise satisfy the ordering comparison vacuously.
    assert.ok(oneTimeAt >= 0, 'renderChip should branch on oneTime');
    assert.ok(resolvedAt >= 0, 'renderChip should keep a generic resolved branch');
    assert.ok(oneTimeAt < resolvedAt, 'one-time branch must come first');
  });
});

// ---------------------------------------------------------------------------
// The "Fun facts" banner's exclusion wiring. bestDay's own unit tests above
// prove it CAN exclude; these prove the dashboard actually hands it the
// lists. Both modules are read as TEXT -- they import the Firebase SDK from
// `https://www.gstatic.com/...` (and statsCards.js is reached through
// dashboard.js), which the default ESM loader refuses.
// ---------------------------------------------------------------------------
describe('fun-facts exclusion threading', () => {
  const read = (...parts) => readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
  const dashboard = read('website', 'js', 'dashboard.js');
  const statsCards = read('website', 'js', 'statsCards.js');

  // Extracts the argument text of `name(...)` -- the substring between the
  // call's parentheses. Plain slicing rather than a regex so nothing here
  // depends on escaping, and so a missing call is an explicit null.
  const argsOf = (src, name) => {
    const at = src.indexOf(name + '(');
    if (at < 0) return null;
    const open = at + name.length;
    const close = src.indexOf(')', open);
    return close < 0 ? null : src.slice(open + 1, close);
  };

  it('renderDataViews passes the same two exclusion lists to renderFacts that it passes to aggregate', () => {
    // Sliced from the call site, not the import line -- the import names
    // renderFacts without parentheses, so indexOf('renderFacts(') skips it.
    const args = argsOf(dashboard, 'renderFacts');
    assert.ok(args !== null, 'renderFacts call not found in dashboard.js');
    assert.ok(args.includes('customLabels'), `renderFacts should receive the label catalog, got: ${args}`);
    assert.ok(args.includes('calExcludedTopicKeys'), `renderFacts should receive the excluded built-in topics, got: ${args}`);
  });

  it('renderFacts forwards both lists into bestDay rather than dropping them', () => {
    const body = statsCards.slice(statsCards.indexOf('export function renderFacts'));
    const args = argsOf(body, 'bestDay');
    assert.ok(args !== null, 'bestDay call not found in renderFacts');
    assert.ok(args.includes('labels'), `bestDay should receive the label catalog, got: ${args}`);
    assert.ok(args.includes('excludedTopicKeys'), `bestDay should receive the excluded built-in topics, got: ${args}`);
  });
});
