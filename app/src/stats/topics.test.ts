// Unit tests for the pure topic helpers. Run with `npm test` (jest-expo).
import { topicBreakdown, dominantTopic, readableTextColor, topicColor, TOPIC_KEYS, TOPIC_LABELS } from './topics';
import { LABEL_SWATCHES } from './customLabels';
import { contrastRatio } from '../theme/color';
import { THEME_MODES } from '../theme/theme';
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

describe('readableTextColor', () => {
  // Every color this is actually called with: the built-in topic series in
  // both modes, the custom-label swatch palette, and the one-time-tag gray.
  const PALETTE = [
    ...THEME_MODES.flatMap((mode) => TOPIC_KEYS.map((k) => topicColor(k, mode))),
    ...LABEL_SWATCHES,
    '#78716c',
  ];

  it('picks the higher-contrast ink, measuring the ink it actually returns', () => {
    // The regression this pins: the hand-rolled version measured PURE black
    // while returning #0b0b0b, so near the crossover it could return the
    // LOWER-contrast option. Whatever it returns must beat the alternative.
    for (const hex of PALETTE) {
      const ink = readableTextColor(hex);
      const other = ink === '#ffffff' ? '#0b0b0b' : '#ffffff';
      expect(contrastRatio(ink, hex)).toBeGreaterThanOrEqual(contrastRatio(other, hex));
    }
  });

  it('only ever returns one of the two inks', () => {
    for (const hex of PALETTE) {
      expect(['#ffffff', '#0b0b0b']).toContain(readableTextColor(hex));
    }
  });

  // KNOWN GAP, pre-existing and not introduced by the move to `bestTextOn`:
  // light mode's `work` blue (#2a78d6) sits almost exactly on the crossover
  // where neither ink reaches AA -- 4.46:1 against the near-black, 4.42:1
  // against white. Every other topic fill clears 4.5:1 comfortably. Closing
  // it means nudging that one series color (either direction works: ~#276fc6
  // puts white at 5.03:1), which is a palette decision, not a test fix -- so
  // the shortfall is pinned here rather than papered over with a lower bar
  // everywhere.
  const AA_TEXT = 4.5;
  const KNOWN_SUB_AA: Record<string, number> = { 'light/work': 4.45 };

  it('clears AA text contrast on every built-in topic fill', () => {
    // This is the guarantee the original perceptual-luma version failed
    // outright (3.1-4.0:1 on work/study/reading/creative/exercise).
    for (const mode of THEME_MODES) {
      for (const key of TOPIC_KEYS) {
        const fill = topicColor(key, mode);
        const floor = KNOWN_SUB_AA[`${mode}/${key}`] ?? AA_TEXT;
        expect(contrastRatio(readableTextColor(fill), fill)).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('has exactly one known sub-AA topic fill, so a new one cannot slip in', () => {
    const failing = THEME_MODES.flatMap((mode) =>
      TOPIC_KEYS.filter((key) => contrastRatio(readableTextColor(topicColor(key, mode)), topicColor(key, mode)) < AA_TEXT)
        .map((key) => `${mode}/${key}`),
    );
    expect(failing).toEqual(Object.keys(KNOWN_SUB_AA));
  });
});
