// Unit tests for the pure topic helpers. Run with `npm test` (jest-expo).
import { topicBreakdown, dominantTopic, TOPIC_LABELS } from './topics';
import { LoggedSession } from './sessionHistory';

const s = (topic: string | undefined, actualS: number): LoggedSession => ({
  startedAt: 0,
  plannedS: actualS,
  actualS,
  outcome: 'completed',
  topic,
});

describe('topicBreakdown', () => {
  it('sums focus time and count per topic, sorted highest first', () => {
    const b = topicBreakdown([s('work', 100), s('study', 500), s('work', 200)], 'dark');
    expect(b.map((t) => t.key)).toEqual(['study', 'work']);
    expect(b[1]).toMatchObject({ key: 'work', label: TOPIC_LABELS.work, focusS: 300, n: 2 });
  });

  it('excludes untagged and unknown topic values', () => {
    const b = topicBreakdown([s(undefined, 100), s('not-a-real-topic', 200), s('other', 50)], 'dark');
    expect(b).toEqual([{ key: 'other', label: 'Other', color: expect.any(String), focusS: 50, n: 1 }]);
  });

  it('is empty when nothing is tagged', () => {
    expect(topicBreakdown([s(undefined, 100)], 'dark')).toEqual([]);
  });

  it('resolves distinct colors per mode', () => {
    const [light] = topicBreakdown([s('work', 1)], 'light');
    const [dark] = topicBreakdown([s('work', 1)], 'dark');
    expect(light.color).not.toBe(dark.color);
  });
});

describe('dominantTopic', () => {
  it('picks the topic with the most focus time', () => {
    const d = dominantTopic([s('work', 100), s('study', 500)], 'dark');
    expect(d?.key).toBe('study');
  });

  it('is null when nothing is tagged', () => {
    expect(dominantTopic([s(undefined, 100)], 'dark')).toBeNull();
  });
});
