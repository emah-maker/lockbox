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
import { expandHex, isHexColor } from '../theme/color';

export interface CustomLabel {
  id: string;
  name: string;
  color: string; // user-picked hex, same in both theme modes
}

const CUSTOM_ID_PREFIX = 'custom:';

// Mirrors firestore.rules' settings/app write rule (customLabels.size() <= 40) --
// keep these in sync so a rejected write here never surfaces as a confusing
// remote permission error instead of this module's own validation message.
export const MAX_CUSTOM_LABELS = 40;
export const MAX_LABEL_NAME_LENGTH = 40;

// Mirrors firestore.rules' sessions/{sessionId} create rule (topic.size() <= 200) --
// bounds TopicPicker.tsx's free-text one-time tag the same way.
export const MAX_TOPIC_LENGTH = 200;

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
  if (trimmed.length > MAX_LABEL_NAME_LENGTH) throw new Error(`Label name must be ${MAX_LABEL_NAME_LENGTH} characters or fewer.`);
  // Same hex requirement sanitizeCustomLabels enforces on the remote side --
  // the authoring path shouldn't be able to create locally what the sync
  // boundary would drop on the way back in. Throws (rather than dropping)
  // because this is a user-initiated edit with a form to render the message
  // in, the create/sanitize split goalSanitize.ts's header describes.
  if (!color) throw new Error('Label color is required.');
  if (!isHexColor(color)) throw new Error('Label color must be a hex color.');
  if (labels.length >= MAX_CUSTOM_LABELS) throw new Error(`You can have at most ${MAX_CUSTOM_LABELS} custom labels.`);
  return [...labels, { id: makeCustomLabelId(), name: trimmed, color: expandHex(color) }];
}

export function renameCustomLabel(labels: CustomLabel[], id: string, name: string): CustomLabel[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Label name is required.');
  if (trimmed.length > MAX_LABEL_NAME_LENGTH) throw new Error(`Label name must be ${MAX_LABEL_NAME_LENGTH} characters or fewer.`);
  return labels.map((l) => (l.id === id ? { ...l, name: trimmed } : l));
}

export function deleteCustomLabel(labels: CustomLabel[], id: string): CustomLabel[] {
  return labels.filter((l) => l.id !== id);
}

/**
 * Untrusted value -> a label catalog this app can actually render.
 *
 * The boundary-validation choke point for customLabels, the same role
 * goals/goalSanitize.ts plays for goals -- and the one the settings merge was
 * missing. This array arrives from users/{uid}/settings/app, whose rule
 * bounds the catalog SIZE but cannot iterate a list of maps to check each
 * entry (see the rule's own comment), so nothing until now guaranteed the
 * entries were even objects. Everything downstream treats a label as
 * `{id, name, color}` with strings in it: resolveTopic reads `.name`,
 * topicBreakdownWithCustom keys a Map by `.id`, and the pickers paint
 * `.color` straight into a style. A doc written by a client with a different
 * shape -- or one where customLabels is not a list at all, which that rule
 * also lets through -- turned into a render-time crash on a screen the user
 * cannot navigate away from.
 *
 * Drops what it cannot repair rather than substituting placeholders: a label
 * invented here would be one the user never created, and it would then be
 * pushed back to the account by the next sync.
 */
export function sanitizeCustomLabels(value: unknown): CustomLabel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CustomLabel[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, color } = entry as Partial<CustomLabel>;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    if (typeof name !== 'string' || !name.trim()) continue;
    // Hex specifically, not merely "a non-empty string". Two things in this
    // app do arithmetic on a label's color rather than just handing it to a
    // style: theme/color.ts's contrast math (via readableTextColor, which
    // picks the ink for text sitting inside a chip of this color) and
    // withAlpha, which builds an 8-digit hex by string concatenation --
    // FocusHero's topic pill and the stats donut both call it on exactly this
    // value. Neither has any meaning for `rgb(...)`, a CSS color name, or a
    // typo, and the second produces a string React Native cannot render at
    // all, so the chip loses its fill. Both clients that write this document
    // pick from a hex swatch list (LABEL_SWATCHES here, the same set in
    // website/js/labelsPanel.js), so requiring hex rejects nothing either one
    // legitimately produces.
    //
    // Dropped rather than recolored, the same discipline as the fields above:
    // a color invented here is one the user never chose, and the next sync
    // would push it back to the account as though they had.
    if (!isHexColor(color)) continue;
    seen.add(id);
    // Stored in the 6-digit form, so `#abc` -- legal, and what a website
    // color input can emit -- doesn't have to be re-expanded at every render.
    out.push({ id, name: name.trim().slice(0, MAX_LABEL_NAME_LENGTH), color: expandHex(color) });
    if (out.length === MAX_CUSTOM_LABELS) break;
  }
  return out;
}

/** A topic id -> the name a human should read, and nothing else.
 *
 * resolveTopic below answers the same question but also computes a color and
 * a measured ink for it, which needs a ThemeMode. Callers that are only
 * writing a sentence -- a notification body, say -- have no theme and no use
 * for either. Having to invent a ThemeMode just to get at `.label` is what
 * pushed goals/goalNotificationPlan.ts into interpolating `goal.topic` raw
 * instead, so a reminder for a custom label read
 * `40m left on your daily goal for "custom:mf3k2xa9b1"`.
 *
 * Returns null where there is no name to show: untagged, or a saved custom
 * label that has since been deleted. Callers phrase that case themselves --
 * a notification says "your focus time" rather than naming a label the user
 * removed. A one-time free-text tag resolves to itself, since the string the
 * user typed IS its name. */
export function topicDisplayName(
  topic: string | null | undefined,
  customLabels: CustomLabel[],
): string | null {
  if (!topic) return null;
  if (topic in TOPIC_LABELS) return TOPIC_LABELS[topic as TopicKey];
  const custom = customLabels.find((l) => l.id === topic);
  if (custom) return custom.name;
  if (isCustomLabelId(topic)) return null; // saved label, since deleted
  return topic; // a one-time free-text tag is its own name
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
