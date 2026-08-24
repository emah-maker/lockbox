// customLabels.ts -- user-created focus labels that coexist with the six
// built-in topics (topics.ts). Each label's color is chosen by the user at
// creation time -- never auto-assigned from a palette (LABEL_SWATCHES below
// is just a tappable set of starting points, not an assignment rule). A
// label is referenced from LoggedSession.topic by its `id` (see
// sessionHistory.ts), namespaced with a `custom:` prefix so it can never
// collide with a built-in TopicKey string -- that prefix is also how
// resolveTopic tells a custom id apart from a built-in one without a
// separate "is this custom" flag stored on the session itself.
//
// Kept as its own module (rather than folding into topics.ts) so topics.ts
// stays exactly what its own header describes -- the fixed, zero-dependency
// built-in category table, with its existing tests untouched -- while this
// module is the one place that knows how to blend those built-ins with a
// user's mutable custom catalog. Pure/no RN deps, unit-testable the same way.
import type { LoggedSession } from './sessionHistory';
import type { ThemeMode } from '../theme/theme';
import { TOPIC_KEYS, TOPIC_LABELS, topicColor, readableTextColor, TopicKey } from './topics';

export interface CustomLabel {
  id: string;
  name: string;
  color: string; // user-picked hex, same in both theme modes
}

const CUSTOM_ID_PREFIX = 'custom:';

/** A palette of starting-point swatches for the label-creation UI. Distinct
 * from topics.ts's TOPIC_HEX so a custom label never visually reads as a
 * built-in topic when both appear in the same breakdown. Purely a UI
 * convenience -- the user still taps to pick one, so this is not an
 * "auto-assignment from the palette". */
export const LABEL_SWATCHES: string[] = [
  '#e11d48', '#f97316', '#ca8a04', '#65a30d', '#059669', '#0891b2',
  '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#78716c', '#334155',
];

/** Neutral color for a one-time free-text tag typed via DashboardScreen's
 * TopicPicker "Type a label for this session..." field (see resolveTopic
 * below) -- these are never added to customLabels, so there's no user-picked
 * color to look up. Reuses LABEL_SWATCHES's own warm-gray swatch rather than
 * inventing a new hex, since it's already this app's "no strong color"
 * choice. */
const ONE_TIME_TAG_COLOR = '#78716c';

export function makeCustomLabelId(): string {
  return `${CUSTOM_ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function isCustomLabelId(topic: string | undefined | null): boolean {
  return !!topic && topic.startsWith(CUSTOM_ID_PREFIX);
}

export function createCustomLabel(labels: CustomLabel[], name: string, color: string): CustomLabel[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Label name is required.');
  if (!color) throw new Error('Label color is required.');
  return [...labels, { id: makeCustomLabelId(), name: trimmed, color }];
}

export function renameCustomLabel(labels: CustomLabel[], id: string, name: string): CustomLabel[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Label name is required.');
  return labels.map((l) => (l.id === id ? { ...l, name: trimmed } : l));
}

export function deleteCustomLabel(labels: CustomLabel[], id: string): CustomLabel[] {
  return labels.filter((l) => l.id !== id);
}

export interface ResolvedTopic {
  id: string;
  label: string;
  color: string;
  textColor: string;
  isCustom: boolean;
  /** True for a one-time free-text tag (DashboardScreen's TopicPicker
   * "Type a label..." field) -- a raw session-scoped string that was never
   * saved to customLabels, as distinct from isCustom's "a saved CustomLabel
   * catalog entry". Never true at the same time as isCustom. */
  isOneTime: boolean;
}

/** Resolves a session's stored topic id (a built-in TopicKey, a saved
 * custom label's id, or a one-time free-text tag typed directly into
 * DashboardScreen's TopicPicker) to a display name + color. Returns null
 * only when untagged, or when a *saved* custom label was since deleted --
 * its past sessions keep the id, but there's nothing left to render for it.
 * A one-time tag has no catalog entry to go stale, so it always resolves
 * back to the exact string the user typed. */
export function resolveTopic(
  topic: string | undefined,
  customLabels: CustomLabel[],
  mode: ThemeMode,
): ResolvedTopic | null {
  if (!topic) return null;
  if (topic in TOPIC_LABELS) {
    const key = topic as TopicKey;
    const color = topicColor(key, mode);
    return { id: key, label: TOPIC_LABELS[key], color, textColor: readableTextColor(color), isCustom: false, isOneTime: false };
  }
  const custom = customLabels.find((l) => l.id === topic);
  if (custom) {
    return { id: custom.id, label: custom.name, color: custom.color, textColor: readableTextColor(custom.color), isCustom: true, isOneTime: false };
  }
  if (isCustomLabelId(topic)) return null; // saved custom label, since deleted -- nothing left to render
  // A one-time free-text tag: not a built-in key, not a saved custom label
  // (or its id), so the raw string itself is the only thing to show.
  return { id: topic, label: topic, color: ONE_TIME_TAG_COLOR, textColor: readableTextColor(ONE_TIME_TAG_COLOR), isCustom: false, isOneTime: true };
}

/** Every selectable label for (re)tagging a session: built-ins in their
 * fixed order, then custom labels in creation order. */
export function allLabelChoices(customLabels: CustomLabel[], mode: ThemeMode): ResolvedTopic[] {
  const builtins = TOPIC_KEYS.map((k) => resolveTopic(k, customLabels, mode)!);
  const customs = customLabels.map((l) => resolveTopic(l.id, customLabels, mode)!);
  return [...builtins, ...customs];
}

export interface LabelStat {
  key: string;
  label: string;
  color: string;
  focusS: number;
  n: number;
}

/** Like topics.ts's topicBreakdown, but aware of custom labels too --
 * StatsScreen/DashboardScreen/CalendarScreen use this widened version so a
 * custom-labeled session renders correctly everywhere, not just built-ins.
 * Untagged sessions and sessions whose custom label was deleted are excluded,
 * same as topicBreakdown. */
export function topicBreakdownWithCustom(
  sessions: LoggedSession[],
  customLabels: CustomLabel[],
  mode: ThemeMode,
): LabelStat[] {
  const totals = new Map<string, { focusS: number; n: number }>();
  for (const s of sessions) {
    const resolved = resolveTopic(s.topic, customLabels, mode);
    if (!resolved) continue;
    const cur = totals.get(resolved.id) ?? { focusS: 0, n: 0 };
    cur.focusS += s.actualS;
    cur.n += 1;
    totals.set(resolved.id, cur);
  }
  const stats: LabelStat[] = [];
  for (const [id, agg] of totals) {
    const resolved = resolveTopic(id, customLabels, mode)!;
    stats.push({ key: id, label: resolved.label, color: resolved.color, ...agg });
  }
  return stats.sort((a, b) => b.focusS - a.focusS);
}

/** The label with the most focus time among the given sessions (e.g. one
 * day's sessions), or null if none of them are tagged. */
export function dominantTopicWithCustom(
  sessions: LoggedSession[],
  customLabels: CustomLabel[],
  mode: ThemeMode,
): LabelStat | null {
  return topicBreakdownWithCustom(sessions, customLabels, mode)[0] ?? null;
}
