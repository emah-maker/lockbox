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

/** WCAG relative luminance (sRGB, gamma-corrected) -- what the 4.5:1
 * contrast-ratio formula is actually defined against, unlike a perceptual
 * luma weighting. */
function relativeLuminance(hex: string): number {
  const chan = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = chan(parseInt(hex.slice(1, 3), 16));
  const g = chan(parseInt(hex.slice(3, 5), 16));
  const b = chan(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Picks whichever of black/white clears WCAG AA (4.5:1) against `hex`, or
 * the higher-contrast of the two if neither does -- shared with
 * stats/customLabels.ts so a user-picked custom label color gets the same
 * readable-text treatment as a built-in topic's. Previously used a
 * perceptual-luma threshold that picked white text for work/study/reading/
 * creative/exercise even though it measures 3.1-4.0:1 against those fills,
 * below the 4.5:1 floor -- same fix applied to the website's port of this
 * function (website/js/focusStats.js). */
export function readableTextColor(hex: string): string {
  const luminance = relativeLuminance(hex);
  const whiteContrast = contrastRatio(1, luminance);
  const blackContrast = contrastRatio(luminance, 0);
  return whiteContrast >= blackContrast ? '#ffffff' : '#0b0b0b';
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
    if (!key || !(key in TOPIC_LABELS)) continue;
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
