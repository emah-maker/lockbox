// topics.ts -- fixed per-session focus categories + their colors. Pure/no
// deps, unit-testable the same way as stats.ts and comparisons.ts.
//
// Colors are the first six slots of the dataviz skill's reference categorical
// order (blue/orange/aqua/yellow/magenta/green), which is validated for
// adjacent-pair CVD safety in both light and dark mode. This is a separate
// color channel from the user's selectable accent (theme.ts) -- accent is a
// UI/interaction color, this is data-series identity for the topic breakdown
// bars, the 7-day trend, and the Calendar's per-day dominant-topic dot.
import type { LoggedSession } from './sessionHistory';
import type { ThemeMode } from '../theme/theme';
import { bestTextOn } from '../theme/color';

/** The app's near-black, the dark half of every filled-chip ink decision. */
const TOPIC_INK = '#0b0b0b';

export type TopicKey = 'work' | 'study' | 'reading' | 'creative' | 'exercise' | 'other';

export const TOPIC_KEYS: TopicKey[] = ['work', 'study', 'reading', 'creative', 'exercise', 'other'];

export const TOPIC_LABELS: Record<TopicKey, string> = {
  work: 'Work',
  study: 'Study',
  reading: 'Reading',
  creative: 'Creative',
  exercise: 'Exercise',
  other: 'Other',
};

/** Type-safe test for "is this one of the six real built-in topic keys".
 * Deliberately NOT `value in TOPIC_LABELS` (or `in TOPIC_HEX`) -- both are
 * plain object literals, so the `in` operator also matches anything
 * inherited from `Object.prototype` (`toString`, `constructor`,
 * `hasOwnProperty`, `valueOf`, `__proto__`, ...). A one-time free-text tag
 * (screens/TopicPicker.tsx's "Type a label..." field, or a session synced
 * from another client) can be literally the string "toString" -- `in` would
 * then treat it as the built-in TopicKey "toString", index TOPIC_HEX with
 * it, and get back the INHERITED `Function.prototype.toString` instead of a
 * color, corrupting every screen that resolves the topic (and, before this
 * fix, letting such a tag silently ride sessionCountsTowardTotals'
 * excludedTopicKeys check as if it were a real built-in). TOPIC_KEYS is a
 * plain array, so `.includes` has no such inherited-property hazard. */
export function isTopicKey(value: string): value is TopicKey {
  return (TOPIC_KEYS as string[]).includes(value);
}

const TOPIC_HEX: Record<TopicKey, { light: string; dark: string }> = {
  work: { light: '#2a78d6', dark: '#3987e5' },
  study: { light: '#eb6834', dark: '#d95926' },
  reading: { light: '#1baf7a', dark: '#199e70' },
  creative: { light: '#eda100', dark: '#c98500' },
  exercise: { light: '#e87ba4', dark: '#d55181' },
  other: { light: '#008300', dark: '#008300' },
};

export function topicColor(key: TopicKey, mode: ThemeMode): string {
  return TOPIC_HEX[key][mode];
}

/** Readable label color for text placed *inside* a filled topic chip/segment
 * (the one case where a mark's own hue picks the text color, per the
 * light-yellow/aqua-as-text problem -- everywhere else text stays a theme
 * ink token, never the series color). */
export function topicTextColor(key: TopicKey, mode: ThemeMode): string {
  return readableTextColor(TOPIC_HEX[key][mode]);
}

/** Ink for text placed *inside* a filled chip/segment of `hex`: whichever of
 * white or the app's near-black reads better on it. Shared with
 * stats/customLabels.ts so a user-picked custom label color gets the same
 * treatment as a built-in topic's.
 *
 * `bestTextOn` measures the ink this actually returns. The hand-rolled
 * version this replaces carried its own copy of the luminance and
 * contrast-ratio math (a second one, with `contrastRatio` taking a luminance
 * pair rather than a hex pair like theme/color.ts's) and compared against
 * PURE black's luminance while returning `#0b0b0b` -- so on a narrow band
 * near the crossover it chose the lower-contrast option. Every color this is
 * called with today (TOPIC_HEX, LABEL_SWATCHES, the one-time-tag gray) picks
 * the same ink either way. */
export function readableTextColor(hex: string): string {
  return bestTextOn(hex, '#ffffff', TOPIC_INK);
}

export interface TopicStat {
  key: TopicKey;
  label: string;
  color: string;
  focusS: number;
  n: number;
}

/** Focus time + session count per tagged topic, sorted highest focus first.
 * Untagged sessions are excluded -- the caller shows a hint instead of a
 * fake "Untagged" bar when nothing has been tagged yet. */
export function topicBreakdown(sessions: LoggedSession[], mode: ThemeMode): TopicStat[] {
  const totals = new Map<TopicKey, { focusS: number; n: number }>();
  for (const s of sessions) {
    const key = s.topic as TopicKey | undefined;
    if (!key || !isTopicKey(key)) continue;
    const cur = totals.get(key) ?? { focusS: 0, n: 0 };
    cur.focusS += s.actualS;
    cur.n += 1;
    totals.set(key, cur);
  }
  return TOPIC_KEYS.filter((k) => totals.has(k))
    .map((k) => ({ key: k, label: TOPIC_LABELS[k], color: topicColor(k, mode), ...totals.get(k)! }))
    .sort((a, b) => b.focusS - a.focusS);
}

/** The topic with the most focus time among the given sessions (e.g. one
 * day's sessions), or null if none of them are tagged. */
export function dominantTopic(sessions: LoggedSession[], mode: ThemeMode): TopicStat | null {
  return topicBreakdown(sessions, mode)[0] ?? null;
}
