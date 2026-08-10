// Unit tests for the custom-label CRUD + topic/label-resolution helpers.
// Run with `npm test` (jest-expo).
import {
  makeCustomLabelId,
  isCustomLabelId,
  createCustomLabel,
  renameCustomLabel,
  deleteCustomLabel,
  resolveTopic,
  allLabelChoices,
  topicBreakdownWithCustom,
  dominantTopicWithCustom,
  CustomLabel,
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

  it('returns null for an unknown or deleted custom label id', () => {
    expect(resolveTopic('custom:gone', customLabels, 'dark')).toBeNull();
  });

  it('returns null for an untagged session', () => {
    expect(resolveTopic(undefined, customLabels, 'dark')).toBeNull();
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

  it('dominantTopicWithCustom picks the highest-focus entry, or null when untagged', () => {
    const customLabels = createCustomLabel([], 'Deep Work', '#123456');
    const customId = customLabels[0].id;
    expect(dominantTopicWithCustom([s('work', 100), s(customId, 500)], customLabels, 'dark')?.key).toBe(customId);
    expect(dominantTopicWithCustom([s(undefined, 100)], customLabels, 'dark')).toBeNull();
  });
});
