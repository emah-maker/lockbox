// Unit tests for the custom-label CRUD + topic/label-resolution helpers.
// Run with `npm test` (jest-expo).
import {
  makeCustomLabelId,
  isCustomLabelId,
  createCustomLabel,
  renameCustomLabel,
  deleteCustomLabel,
  setLabelExcluded,
  setTopicKeyExcluded,
  sanitizeCustomLabels,
  sanitizeExcludedTopicKeys,
  resolveTopic,
  allLabelChoices,
  topicBreakdownWithCustom,
  dominantTopicWithCustom,
  sessionCountsTowardTotals,
  filterCountedSessions,
  CustomLabel,
  MAX_CUSTOM_LABELS,
  MAX_LABEL_NAME_LENGTH,
  MAX_EXCLUDED_TOPIC_KEYS,
} from './customLabels';
import { TOPIC_LABELS, TOPIC_KEYS, topicColor } from './topics';
import { LoggedSession } from './sessionHistory';

const s = (topic: string | undefined, actualS: number): LoggedSession => ({
  startedAt: 0,
  plannedS: actualS,
  actualS,
  outcome: 'completed',
  topic,
});

describe('makeCustomLabelId / isCustomLabelId', () => {
  it('generates ids namespaced so they can never collide with a built-in TopicKey', () => {
    const id = makeCustomLabelId();
    expect(isCustomLabelId(id)).toBe(true);
    expect(id in TOPIC_LABELS).toBe(false);
  });

  it('generates unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => makeCustomLabelId()));
    expect(ids.size).toBe(20);
  });

  it('does not treat a built-in TopicKey or undefined as a custom id', () => {
    expect(isCustomLabelId('work')).toBe(false);
    expect(isCustomLabelId(undefined)).toBe(false);
  });
});

describe('createCustomLabel / renameCustomLabel / deleteCustomLabel', () => {
  it('creates a label with the user-picked color, trimming the name', () => {
    const labels = createCustomLabel([], '  Deep Work  ', '#123456');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ name: 'Deep Work', color: '#123456' });
    expect(isCustomLabelId(labels[0].id)).toBe(true);
  });

  it('appends without disturbing existing labels', () => {
    const first = createCustomLabel([], 'A', '#111111');
    const both = createCustomLabel(first, 'B', '#222222');
    expect(both.map((l) => l.name)).toEqual(['A', 'B']);
  });

  it('rejects an empty (or whitespace-only) name', () => {
    expect(() => createCustomLabel([], '   ', '#123456')).toThrow();
  });

  it('rejects a missing color', () => {
    expect(() => createCustomLabel([], 'Deep Work', '')).toThrow();
  });

  it('renames only the matching label by id', () => {
    const labels = createCustomLabel(createCustomLabel([], 'A', '#111111'), 'B', '#222222');
    const renamed = renameCustomLabel(labels, labels[0].id, 'A2');
    expect(renamed.map((l) => l.name)).toEqual(['A2', 'B']);
  });

  it('rejects renaming to an empty name', () => {
    const labels = createCustomLabel([], 'A', '#111111');
    expect(() => renameCustomLabel(labels, labels[0].id, '')).toThrow();
  });

  it('rejects a name longer than MAX_LABEL_NAME_LENGTH', () => {
    const tooLong = 'x'.repeat(MAX_LABEL_NAME_LENGTH + 1);
    expect(() => createCustomLabel([], tooLong, '#123456')).toThrow();
  });

  it('accepts a name exactly at MAX_LABEL_NAME_LENGTH', () => {
    const atLimit = 'x'.repeat(MAX_LABEL_NAME_LENGTH);
    const labels = createCustomLabel([], atLimit, '#123456');
    expect(labels[0].name).toHaveLength(MAX_LABEL_NAME_LENGTH);
  });

  it('rejects renaming to a name longer than MAX_LABEL_NAME_LENGTH', () => {
    const labels = createCustomLabel([], 'A', '#111111');
    const tooLong = 'x'.repeat(MAX_LABEL_NAME_LENGTH + 1);
    expect(() => renameCustomLabel(labels, labels[0].id, tooLong)).toThrow();
  });

  it('rejects creating a label past MAX_CUSTOM_LABELS', () => {
    let labels: CustomLabel[] = [];
    for (let i = 0; i < MAX_CUSTOM_LABELS; i += 1) {
      labels = createCustomLabel(labels, `Label ${i}`, '#123456');
    }
    expect(labels).toHaveLength(MAX_CUSTOM_LABELS);
    expect(() => createCustomLabel(labels, 'One too many', '#123456')).toThrow();
  });

  it('deletes only the matching label by id', () => {
    const labels = createCustomLabel(createCustomLabel([], 'A', '#111111'), 'B', '#222222');
    const remaining = deleteCustomLabel(labels, labels[0].id);
    expect(remaining.map((l) => l.name)).toEqual(['B']);
  });
});

describe('setLabelExcluded', () => {
  it('turns exclusion on for only the matching label', () => {
    const labels = createCustomLabel(createCustomLabel([], 'A', '#111111'), 'B', '#222222');
    const updated = setLabelExcluded(labels, labels[0].id, true);
    expect(updated[0].excludeFromTotals).toBe(true);
    expect(updated[1].excludeFromTotals).toBeUndefined();
  });

  it('turning exclusion back off omits the field rather than storing false', () => {
    const labels = createCustomLabel([], 'A', '#111111');
    const excluded = setLabelExcluded(labels, labels[0].id, true);
    const restored = setLabelExcluded(excluded, labels[0].id, false);
    expect(restored[0]).toEqual(labels[0]);
    expect('excludeFromTotals' in restored[0]).toBe(false);
  });

  it('is a no-op for an id that is not in the catalog', () => {
    const labels = createCustomLabel([], 'A', '#111111');
    expect(setLabelExcluded(labels, 'custom:gone', true)).toEqual(labels);
  });
});

describe('sessionCountsTowardTotals', () => {
  const sleepLabel: CustomLabel[] = [{ id: 'custom:sleep', name: 'Sleep', color: '#123456', excludeFromTotals: true }];
  const plainLabel: CustomLabel[] = [{ id: 'custom:focus', name: 'Focus', color: '#654321' }];

  it('an untagged session always counts, regardless of the catalog', () => {
    expect(sessionCountsTowardTotals(undefined, sleepLabel)).toBe(true);
    expect(sessionCountsTowardTotals(undefined, [])).toBe(true);
  });

  it('a label with excludeFromTotals: true does not count', () => {
    expect(sessionCountsTowardTotals('custom:sleep', sleepLabel)).toBe(false);
  });

  it('a label without the flag (the default) counts', () => {
    expect(sessionCountsTowardTotals('custom:focus', plainLabel)).toBe(true);
  });

  it('a built-in topic counts by default -- excludedTopicKeys defaults to []', () => {
    expect(sessionCountsTowardTotals('work', sleepLabel)).toBe(true);
  });

  it('a since-deleted custom label id (no longer in the catalog) counts, same as topicDisplayName/resolveTopic keep its past sessions', () => {
    expect(sessionCountsTowardTotals('custom:sleep', [])).toBe(true);
  });

  it('a one-time free-text tag (never a catalog entry) counts', () => {
    expect(sessionCountsTowardTotals('Client call prep', sleepLabel)).toBe(true);
  });

  // The built-in-topic exclusion extension (setTopicKeyExcluded's own
  // header comment on why a THIRD argument, rather than a field on TopicKey
  // itself, closes this gap).
  it('a built-in topic in excludedTopicKeys does not count', () => {
    expect(sessionCountsTowardTotals('work', [], ['work'])).toBe(false);
  });

  it('a built-in topic NOT in excludedTopicKeys still counts', () => {
    expect(sessionCountsTowardTotals('work', [], ['study'])).toBe(true);
  });

  it('an excluded custom label and an excluded built-in topic are independent checks', () => {
    // The custom label check must not accidentally suppress a built-in, and
    // vice versa -- each catalog's exclusion is decided by its own branch in
    // sessionCountsTowardTotals.
    expect(sessionCountsTowardTotals('work', sleepLabel, ['work'])).toBe(false);
    expect(sessionCountsTowardTotals('custom:sleep', sleepLabel, ['work'])).toBe(false);
    expect(sessionCountsTowardTotals('custom:focus', sleepLabel, ['work'])).toBe(true);
    expect(sessionCountsTowardTotals('study', sleepLabel, ['work'])).toBe(true);
  });

  it('an untagged session counts regardless of excludedTopicKeys', () => {
    expect(sessionCountsTowardTotals(undefined, [], ['work', 'study'])).toBe(true);
  });

  // A one-time free-text tag (screens/TopicPicker.tsx's "Type a label..."
  // field) can be literally the name of something every plain object
  // inherits from Object.prototype. `topic in TOPIC_LABELS` (the bug this
  // guards) is true for these even though none is a real TopicKey, so they
  // used to fall into the built-in branch instead of the "always counts,
  // no catalog entry" branch below it -- and, for 'toString'/'constructor'
  // specifically, TOPIC_LABELS[topic] and TOPIC_HEX[topic] resolve to the
  // INHERITED function rather than a label/color, corrupting resolveTopic
  // everywhere it's called (StatsScreen, DashboardScreen, the calendar).
  it('a free-text tag matching an inherited Object.prototype property is not mistaken for a built-in topic', () => {
    for (const tag of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
      expect(sessionCountsTowardTotals(tag, [])).toBe(true);
      // Must not be treated as excludable via excludedTopicKeys either --
      // it isn't a real TopicKey, so nothing should ever suppress it that way.
      expect(sessionCountsTowardTotals(tag, [], [tag])).toBe(true);
    }
  });
});

describe('filterCountedSessions', () => {
  const sleepLabel: CustomLabel[] = [{ id: 'custom:sleep', name: 'Sleep', color: '#123456', excludeFromTotals: true }];

  it('drops only sessions tagged with an excluded label', () => {
    const sessions = [s('work', 100), s('custom:sleep', 200), s(undefined, 50)];
    const kept = filterCountedSessions(sessions, sleepLabel);
    expect(kept.map((x) => x.topic)).toEqual(['work', undefined]);
  });

  it('an empty labels array keeps every session', () => {
    const sessions = [s('work', 100), s('custom:sleep', 200)];
    expect(filterCountedSessions(sessions, [])).toEqual(sessions);
  });

  it('drops sessions tagged with an excluded built-in topic, alongside an excluded label', () => {
    const sessions = [s('work', 100), s('study', 150), s('custom:sleep', 200), s(undefined, 50)];
    const kept = filterCountedSessions(sessions, sleepLabel, ['work']);
    expect(kept.map((x) => x.topic)).toEqual(['study', undefined]);
  });

  it('an empty excludedTopicKeys array (the default) keeps every built-in-tagged session', () => {
    const sessions = [s('work', 100), s('study', 150)];
    expect(filterCountedSessions(sessions, [])).toEqual(sessions);
    expect(filterCountedSessions(sessions, [], [])).toEqual(sessions);
  });
});

describe('setTopicKeyExcluded', () => {
  it('adds a key when excluding, in TOPIC_KEYS fixed order regardless of toggle order', () => {
    let keys = setTopicKeyExcluded([], 'exercise', true);
    keys = setTopicKeyExcluded(keys, 'work', true);
    expect(keys).toEqual(['work', 'exercise']);
  });

  it('removes a key when un-excluding', () => {
    const keys = setTopicKeyExcluded(['work', 'study'], 'work', false);
    expect(keys).toEqual(['study']);
  });

  it('is a no-op for excluding a key that is already excluded (no duplicate)', () => {
    expect(setTopicKeyExcluded(['work'], 'work', true)).toEqual(['work']);
  });

  it('is a no-op for un-excluding a key that was never excluded', () => {
    expect(setTopicKeyExcluded(['study'], 'work', false)).toEqual(['study']);
  });

  it('can exclude every built-in topic, up to MAX_EXCLUDED_TOPIC_KEYS', () => {
    let keys: string[] = [];
    for (const key of TOPIC_KEYS) keys = setTopicKeyExcluded(keys, key, true);
    expect(keys).toEqual(TOPIC_KEYS);
    expect(keys.length).toBe(MAX_EXCLUDED_TOPIC_KEYS);
  });
});

describe('sanitizeExcludedTopicKeys', () => {
  it('keeps only real TopicKey strings, in TOPIC_KEYS fixed order', () => {
    expect(sanitizeExcludedTopicKeys(['other', 'work'])).toEqual(['work', 'other']);
  });

  it('drops unknown/garbage entries', () => {
    expect(sanitizeExcludedTopicKeys(['work', 'not-a-real-topic', 123, null, {}, 'custom:sleep'])).toEqual(['work']);
  });

  it('de-duplicates', () => {
    expect(sanitizeExcludedTopicKeys(['work', 'work', 'study', 'work'])).toEqual(['work', 'study']);
  });

  it('answers with [] for a non-array value', () => {
    expect(sanitizeExcludedTopicKeys(undefined)).toEqual([]);
    expect(sanitizeExcludedTopicKeys(null)).toEqual([]);
    expect(sanitizeExcludedTopicKeys('work')).toEqual([]);
    expect(sanitizeExcludedTopicKeys({})).toEqual([]);
  });

  it('answers with [] for an empty array', () => {
    expect(sanitizeExcludedTopicKeys([])).toEqual([]);
  });

  it('never returns more than MAX_EXCLUDED_TOPIC_KEYS entries, even from a garbage-padded array', () => {
    const garbage = Array.from({ length: 200 }, (_, i) => `garbage-${i}`);
    expect(sanitizeExcludedTopicKeys([...TOPIC_KEYS, ...garbage]).length).toBe(MAX_EXCLUDED_TOPIC_KEYS);
  });
});

describe('resolveTopic', () => {
  const customLabels: CustomLabel[] = [{ id: 'custom:abc', name: 'Deep Work', color: '#123456' }];

  it('resolves a built-in TopicKey the same way topics.ts does', () => {
    const resolved = resolveTopic('work', customLabels, 'dark');
    expect(resolved).toMatchObject({ id: 'work', label: TOPIC_LABELS.work, color: topicColor('work', 'dark'), isCustom: false });
  });

  it('resolves a custom label id to its name/color', () => {
    const resolved = resolveTopic('custom:abc', customLabels, 'dark');
    expect(resolved).toMatchObject({ id: 'custom:abc', label: 'Deep Work', color: '#123456', isCustom: true });
  });

  it('returns null for a since-deleted saved custom label id', () => {
    expect(resolveTopic('custom:gone', customLabels, 'dark')).toBeNull();
  });

  it('returns null for an untagged session', () => {
    expect(resolveTopic(undefined, customLabels, 'dark')).toBeNull();
  });

  it('resolves a one-time free-text tag to the raw string, not null', () => {
    const resolved = resolveTopic('Client call prep', customLabels, 'dark');
    expect(resolved).toMatchObject({ id: 'Client call prep', label: 'Client call prep', isCustom: false, isOneTime: true });
    expect(resolved?.color).toBeTruthy();
  });

  // Same inherited-property hazard as sessionCountsTowardTotals' own test
  // above ('topic in TOPIC_LABELS' matches Object.prototype members) --
  // resolveTopic must treat these as one-time free-text tags, not as a
  // built-in whose TOPIC_HEX/TOPIC_LABELS lookup silently returns an
  // inherited function instead of a color/label.
  it('resolves a free-text tag matching an inherited Object.prototype property as a one-time tag, not a corrupted built-in', () => {
    const resolved = resolveTopic('toString', customLabels, 'dark');
    expect(resolved).toMatchObject({ id: 'toString', label: 'toString', isCustom: false, isOneTime: true, excludedFromTotals: false });
    expect(typeof resolved?.color).toBe('string');
  });

  it('excludedFromTotals is false for a built-in topic by default (excludedTopicKeys omitted)', () => {
    expect(resolveTopic('work', customLabels, 'dark')?.excludedFromTotals).toBe(false);
  });

  it('excludedFromTotals is true for a built-in topic in excludedTopicKeys', () => {
    expect(resolveTopic('work', customLabels, 'dark', ['work'])?.excludedFromTotals).toBe(true);
    expect(resolveTopic('study', customLabels, 'dark', ['work'])?.excludedFromTotals).toBe(false);
  });

  it('excludedFromTotals mirrors excludeFromTotals for a custom label, independent of excludedTopicKeys', () => {
    const excluded: CustomLabel[] = [{ id: 'custom:sleep', name: 'Sleep', color: '#123456', excludeFromTotals: true }];
    expect(resolveTopic('custom:sleep', excluded, 'dark', ['work'])?.excludedFromTotals).toBe(true);
  });

  it('excludedFromTotals is always false for a one-time free-text tag', () => {
    expect(resolveTopic('Client call prep', customLabels, 'dark', ['work'])?.excludedFromTotals).toBe(false);
  });
});

describe('allLabelChoices', () => {
  it('lists built-ins first in their fixed order, then customs in creation order', () => {
    const customLabels = createCustomLabel(createCustomLabel([], 'Deep Work', '#111111'), 'Errands', '#222222');
    const choices = allLabelChoices(customLabels, 'dark');
    expect(choices.slice(0, 6).map((c) => c.id)).toEqual(['work', 'study', 'reading', 'creative', 'exercise', 'other']);
    expect(choices.slice(6).map((c) => c.label)).toEqual(['Deep Work', 'Errands']);
  });

  it('marks excluded built-in topics, and still lists them as pickable', () => {
    const choices = allLabelChoices([], 'dark', ['work', 'exercise']);
    expect(choices.map((c) => c.id)).toEqual(['work', 'study', 'reading', 'creative', 'exercise', 'other']);
    expect(choices.map((c) => c.excludedFromTotals)).toEqual([true, false, false, false, true, false]);
  });

  it('excludedTopicKeys only affects the built-in half -- a custom label keeps its own excludeFromTotals', () => {
    const excluded = createCustomLabel([], 'Sleep', '#123456');
    const sleepId = excluded[0].id;
    const labels = setLabelExcluded(excluded, sleepId, true);
    const choices = allLabelChoices(labels, 'dark', ['work']);
    const sleepChoice = choices.find((c) => c.id === sleepId);
    const workChoice = choices.find((c) => c.id === 'work');
    expect(sleepChoice?.excludedFromTotals).toBe(true);
    expect(workChoice?.excludedFromTotals).toBe(true);
    expect(choices.find((c) => c.id === 'study')?.excludedFromTotals).toBe(false);
  });
});

describe('topicBreakdownWithCustom / dominantTopicWithCustom', () => {
  it('sums focus time across both built-in and custom labels, sorted highest first', () => {
    const customLabels = createCustomLabel([], 'Deep Work', '#123456');
    const customId = customLabels[0].id;
    const sessions = [s('work', 100), s(customId, 500), s('work', 200)];
    const breakdown = topicBreakdownWithCustom(sessions, customLabels, 'dark');
    expect(breakdown.map((t) => t.key)).toEqual([customId, 'work']);
    expect(breakdown[0]).toMatchObject({ label: 'Deep Work', color: '#123456', focusS: 500, n: 1 });
    expect(breakdown[1]).toMatchObject({ key: 'work', focusS: 300, n: 2 });
  });

  it('excludes sessions tagged with a since-deleted custom label', () => {
    const breakdown = topicBreakdownWithCustom([s('custom:gone', 100)], [], 'dark');
    expect(breakdown).toEqual([]);
  });

  it('includes a session tagged with a one-time free-text label, grouped by its own text', () => {
    const breakdown = topicBreakdownWithCustom([s('Client call prep', 100)], [], 'dark');
    expect(breakdown).toMatchObject([{ key: 'Client call prep', label: 'Client call prep', focusS: 100, n: 1 }]);
  });

  it('dominantTopicWithCustom picks the highest-focus entry, or null when untagged', () => {
    const customLabels = createCustomLabel([], 'Deep Work', '#123456');
    const customId = customLabels[0].id;
    expect(dominantTopicWithCustom([s('work', 100), s(customId, 500)], customLabels, 'dark')?.key).toBe(customId);
    expect(dominantTopicWithCustom([s(undefined, 100)], customLabels, 'dark')).toBeNull();
  });
});

// The boundary between users/{uid}/settings/app and everything that renders a
// label. That document's rule bounds the catalog SIZE but cannot iterate a
// list of maps to check the entries, so nothing before this guaranteed they
// were even objects -- and resolveTopic/topicBreakdownWithCustom/the pickers
// all read .id/.name/.color straight out of them.
describe('sanitizeCustomLabels', () => {
  const label = (over = {}) => ({ id: 'custom:1', name: 'Deep Work', color: '#123456', ...over });

  it('keeps a well-formed catalog as it is', () => {
    expect(sanitizeCustomLabels([label()])).toEqual([label()]);
  });

  it('answers with an empty catalog for anything that is not an array', () => {
    // The shape the rule lets through: size() is defined on strings, so
    // `customLabels: "xx"` satisfied the 40-entry cap.
    expect(sanitizeCustomLabels('xx')).toEqual([]);
    expect(sanitizeCustomLabels(undefined)).toEqual([]);
    expect(sanitizeCustomLabels(null)).toEqual([]);
    expect(sanitizeCustomLabels({ 0: label() })).toEqual([]);
  });

  it('drops entries whose IDENTITY is missing or wrong-typed', () => {
    // id and name only. A bad `color` is repaired rather than dropped -- it
    // is presentational, not identity, and there is a safe default for it;
    // see the colour-validation suite below for why dropping over it is the
    // more destructive choice.
    const kept = sanitizeCustomLabels([
      null,
      'not-a-label',
      label({ id: undefined }),
      label({ id: 42 }),
      label({ name: '   ' }),
      label({ id: 'custom:keep' }),
    ]);
    expect(kept).toEqual([label({ id: 'custom:keep' })]);
  });

  it('drops a duplicate id rather than letting two labels share one key', () => {
    const kept = sanitizeCustomLabels([label({ name: 'First' }), label({ name: 'Second' })]);
    expect(kept).toEqual([label({ name: 'First' })]);
  });

  it('trims a name and holds it to the same cap the editor enforces', () => {
    const long = 'x'.repeat(MAX_LABEL_NAME_LENGTH + 10);
    expect(sanitizeCustomLabels([label({ name: `  ${long}  ` })])[0].name).toHaveLength(MAX_LABEL_NAME_LENGTH);
  });

  it('stops at the catalog cap', () => {
    const many = Array.from({ length: MAX_CUSTOM_LABELS + 5 }, (_, i) => label({ id: `custom:${i}` }));
    expect(sanitizeCustomLabels(many)).toHaveLength(MAX_CUSTOM_LABELS);
  });
});

describe('sanitizeCustomLabels -- excludeFromTotals round-trip', () => {
  const label = (over = {}) => ({ id: 'custom:1', name: 'Deep Work', color: '#123456', ...over });

  it('round-trips excludeFromTotals: true unchanged', () => {
    expect(sanitizeCustomLabels([label({ excludeFromTotals: true })])).toEqual([label({ excludeFromTotals: true })]);
  });

  it('omits the field entirely for a label that never had it, same as before this field existed', () => {
    expect(sanitizeCustomLabels([label()])).toEqual([label()]);
    expect('excludeFromTotals' in sanitizeCustomLabels([label()])[0]).toBe(false);
  });

  it('drops a garbage (non-boolean) value from a hostile/old remote doc rather than coercing it', () => {
    for (const excludeFromTotals of ['true', 1, 0, null, {}, []]) {
      const [kept] = sanitizeCustomLabels([label({ excludeFromTotals })]);
      expect('excludeFromTotals' in kept).toBe(false);
    }
  });

  it('explicit false is also dropped -- the omitted-key form is canonical, same as setLabelExcluded writes', () => {
    expect('excludeFromTotals' in sanitizeCustomLabels([label({ excludeFromTotals: false })])[0]).toBe(false);
  });
});

// The color is not just handed to a style: readableTextColor does contrast
// math on it, and withAlpha builds an 8-digit hex from it by string
// concatenation (FocusHero's topic pill, the stats donut). Neither has any
// meaning for a color that isn't hex.
describe('color validation at both boundaries', () => {
  const label = (over = {}) => ({ id: 'custom:1', name: 'Deep Work', color: '#123456', ...over });

  it('recolors a remote label whose color is not hex, rather than dropping it', () => {
    // Dropping is the more destructive option, not the safer one: the label's
    // name is lost, and every session tagged with it silently leaves the
    // breakdown (see the next test). A neutral swatch is a far smaller wrong.
    for (const color of ['red', 'rgb(1,2,3)', '#ab', '#aabbccdd', '', 7, null]) {
      const [kept] = sanitizeCustomLabels([label({ color })]);
      expect(kept).toBeDefined();
      expect(kept.name).toBe('Deep Work');
      expect(kept.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps every tagged session counted when a color has to be repaired', () => {
    // The measured harm of the alternative: resolveTopic returns null for a
    // label the catalog no longer has, so topicBreakdownWithCustom excludes
    // every session carrying it -- an hour of real logged focus time gone
    // from the number this app exists to show.
    const labels = sanitizeCustomLabels([{ id: 'custom:x', name: 'Thesis', color: 'rgb(1,2,3)' }]);
    const sessions = [s('custom:x', 3600), s('work', 1800)];
    const shown = topicBreakdownWithCustom(sessions, labels, 'dark').reduce((a, b) => a + b.focusS, 0);
    expect(shown).toBe(5400);
    expect(resolveTopic('custom:x', labels, 'dark')?.label).toBe('Thesis');
  });

  it('keeps a remote label written in the shorthand form, stored expanded', () => {
    // '#abc' is legal and renders fine; what breaks is withAlpha('#abc', a)
    // -> '#abcXX', which React Native drops. Expanding on the way in means no
    // render site has to know about the shorthand at all.
    expect(sanitizeCustomLabels([label({ color: '#abc' })])[0].color).toBe('#aabbcc');
  });

  it('rejects a non-hex color in the authoring path too, with a renderable message', () => {
    expect(() => createCustomLabel([], 'Reading', 'red')).toThrow(/hex color/);
  });

  it('stores a shorthand color from the authoring path expanded, same as the sync path', () => {
    expect(createCustomLabel([], 'Reading', '#abc')[0].color).toBe('#aabbcc');
  });
});
