// Unit tests for the custom-label CRUD + topic/label-resolution helpers.
// Run with `npm test` (jest-expo).
import {
  makeCustomLabelId,
  isCustomLabelId,
  createCustomLabel,
  renameCustomLabel,
  deleteCustomLabel,
  sanitizeCustomLabels,
  resolveTopic,
  allLabelChoices,
  topicBreakdownWithCustom,
  dominantTopicWithCustom,
  CustomLabel,
  MAX_CUSTOM_LABELS,
  MAX_LABEL_NAME_LENGTH,
} from './customLabels';
import { TOPIC_LABELS, topicColor } from './topics';
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
});

describe('allLabelChoices', () => {
  it('lists built-ins first in their fixed order, then customs in creation order', () => {
    const customLabels = createCustomLabel(createCustomLabel([], 'Deep Work', '#111111'), 'Errands', '#222222');
    const choices = allLabelChoices(customLabels, 'dark');
    expect(choices.slice(0, 6).map((c) => c.id)).toEqual(['work', 'study', 'reading', 'creative', 'exercise', 'other']);
    expect(choices.slice(6).map((c) => c.label)).toEqual(['Deep Work', 'Errands']);
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

  it('drops entries that are missing a field, or hold the wrong type in one', () => {
    const kept = sanitizeCustomLabels([
      null,
      'not-a-label',
      label({ id: undefined }),
      label({ id: 42 }),
      label({ name: '   ' }),
      label({ color: '' }),
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

// The color is not just handed to a style: readableTextColor does contrast
// math on it, and withAlpha builds an 8-digit hex from it by string
// concatenation (FocusHero's topic pill, the stats donut). Neither has any
// meaning for a color that isn't hex.
describe('color validation at both boundaries', () => {
  const label = (over = {}) => ({ id: 'custom:1', name: 'Deep Work', color: '#123456', ...over });

  it('drops a remote label whose color is not a hex color', () => {
    for (const color of ['red', 'rgb(1,2,3)', '#ab', '#aabbccdd', '', 7, null]) {
      expect(sanitizeCustomLabels([label({ color })])).toEqual([]);
    }
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
