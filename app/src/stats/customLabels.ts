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
import { TOPIC_KEYS, TOPIC_LABELS, topicColor, readableTextColor, isTopicKey, TopicKey } from './topics';
import { expandHex, isHexColor } from '../theme/color';

// Mirrors firestore.rules' settings/app write rule (excludedTopicKeys.size()
// <= 6) -- keep in sync for the same reason MAX_CUSTOM_LABELS documents.
// There are only ever TOPIC_KEYS.length built-in topics to exclude, so this
// is derived rather than a second hand-picked number that could drift from
// topics.ts if a seventh built-in topic were ever added.
export const MAX_EXCLUDED_TOPIC_KEYS = TOPIC_KEYS.length;

export interface CustomLabel {
  id: string;
  name: string;
  color: string; // user-picked hex, same in both theme modes
  /** When true, a session tagged with this label is excluded from focus
   * totals/goal progress/streaks/the calendar heat map (sessionCountsTowardTotals
   * below) -- it is still logged and still shown everywhere a session's own
   * history is rendered (SessionListSheet, DaySheet, the topic breakdown),
   * exactly like any other tagged session. This is the per-label "don't let
   * this count" switch (manager request: a "Sleep" label whose time shouldn't
   * inflate a focus goal).
   *
   * Optional, and OMITTED (not `false`) for the ordinary case, deliberately --
   * every label already on a device or in Firestore before this field existed
   * has no opinion on it, and sessionCountsTowardTotals treats `undefined`
   * exactly like `false` (counts). Writing `excludeFromTotals: false` onto
   * every label would work identically but bloat every synced settings/app
   * write and every local write for a fact that's already the default; only
   * a label the user has actually flipped ever carries this key. */
  excludeFromTotals?: boolean;
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

/** This app's "no strong color" choice, used wherever a label has to be
 * drawn without a user-picked color to draw it in. Two callers: a one-time
 * free-text tag typed via DashboardScreen's TopicPicker (never added to
 * customLabels, so there is no color to look up), and sanitizeCustomLabels
 * repairing an entry whose stored color cannot be rendered. Reuses
 * LABEL_SWATCHES's own warm-gray swatch rather than inventing a new hex. */
const NEUTRAL_LABEL_COLOR = '#78716c';

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

/** Flips one label's `excludeFromTotals`, alongside create/rename/delete
 * above -- same "pure array-in, array-out" shape so useSettingsStore's
 * action can persist the result the same way it already persists theirs. No
 * validation to throw on: unlike a name or color, a boolean has no invalid
 * value, and toggling a label that no longer exists (a delete raced with a
 * toggle) is a silent no-op rather than an error a UI would have nowhere to
 * show. Stores `undefined` rather than `false` when turning exclusion back
 * OFF, matching the field's own "omitted means counts" comment on
 * CustomLabel -- so re-enabling a label round-trips it to byte-identical to
 * a label that was never excluded, rather than leaving a `false` behind. */
export function setLabelExcluded(labels: CustomLabel[], id: string, excluded: boolean): CustomLabel[] {
  return labels.map((l) => {
    if (l.id !== id) return l;
    if (!excluded) {
      const { excludeFromTotals, ...rest } = l;
      return rest;
    }
    return { ...l, excludeFromTotals: true };
  });
}

/** setLabelExcluded's counterpart for a built-in topic (topics.ts's
 * TopicKey) -- flips `key`'s membership in the `excludedTopicKeys` array
 * useSettingsStore.ts persists alongside `customLabels`, backing
 * CustomLabelsSection.tsx's built-in-topic switches the same "Counts toward
 * totals & goals" way it already backs each custom label's own switch.
 *
 * A built-in topic has no catalog entry of its own to carry a boolean flag
 * on (unlike CustomLabel.excludeFromTotals) -- topics.ts's TOPIC_KEYS is a
 * fixed table, not a per-user array this app can attach fields to -- so the
 * flag is represented the only way it can be: membership in a `string[]` of
 * excluded keys, alongside settings rather than on the topic itself. Always
 * returns keys in TOPIC_KEYS' own fixed order (not append/insertion order),
 * so the array is stable and de-duplicated by construction regardless of
 * which key was just toggled -- there is no meaningful "order" to an
 * exclusion set the way there is for customLabels' creation order, so
 * canonicalizing here costs nothing and makes the array trivially
 * comparable/testable. */
export function setTopicKeyExcluded(excludedTopicKeys: string[], key: TopicKey, excluded: boolean): string[] {
  const next = new Set(excludedTopicKeys);
  if (excluded) next.add(key);
  else next.delete(key);
  return TOPIC_KEYS.filter((k) => next.has(k));
}

/**
 * Whether a session tagged `topic` should count toward focus totals, goal
 * progress, streaks, trends, and the calendar heat map -- the one predicate
 * every counting path in this app (stats/stats.ts's aggregate, stats/
 * trend.ts's bestDay/lastNDays/lastNDaysHeatmap, goals/goalProgress.ts's
 * computeGoalProgress, stats/goalStreak.ts's computeGoalStreak) is meant to
 * run a session through before summing it. An excluded session is NEVER
 * dropped from the session log itself, and NEVER hidden from a view that
 * shows what was actually done (SessionListSheet, DaySheet, CalendarScreen's
 * day topic stack, topicBreakdownWithCustom's "by label" breakdown below) --
 * only from the aggregates that answer "how much have I focused"/"did I hit
 * my goal". Untagged (`topic` undefined) always counts; there is nothing to
 * exclude it via.
 *
 * Both of this app's excludable topic catalogs get the exact same treatment,
 * via two independent checks:
 *   - A saved custom label (`labels`, i.e. CustomLabel.excludeFromTotals) --
 *     the original mechanism, unchanged.
 *   - One of the six built-in topics (`excludedTopicKeys`, a `string[]` of
 *     topics.ts's TopicKey -- see useSettingsStore.ts's field of the same
 *     name, written by CustomLabelsSection.tsx's built-in-topic switches).
 * A built-in topic has no catalog entry of its own to carry a boolean flag
 * on the way a CustomLabel does (topics.ts's TOPIC_KEYS is a fixed table,
 * not a per-user array this app can attach fields to), so its exclusion is a
 * plain membership test against `excludedTopicKeys` instead of a lookup.
 * `excludedTopicKeys` defaults to `[]` (nothing excluded), the same
 * backward-compatible convention `labels`' own default-`[]` callers already
 * rely on -- every pre-existing two-argument call site keeps behaving
 * exactly as before. (An earlier revision of this function only took
 * `labels`, and this comment used to explain built-in exclusion as a
 * deliberate scope cut of that two-argument contract -- see setTopicKeyExcluded's
 * own comment above for why a THIRD argument, rather than a field on
 * TopicKey itself, is how that gap closes.)
 *
 * `labels` not finding `topic` at all -- a built-in TopicKey, a one-time
 * free-text tag, or a saved custom label that has since been deleted --
 * always counts too: there is no catalog entry left to carry an exclusion
 * opinion, and a deleted label's past sessions keep contributing to history
 * the same way resolveTopic keeps their `actualS` in every other aggregate
 * that doesn't already special-case a dangling id.
 */
export function sessionCountsTowardTotals(
  topic: string | undefined,
  labels: CustomLabel[],
  excludedTopicKeys: string[] = [],
): boolean {
  if (!topic) return true;
  if (isTopicKey(topic)) return !excludedTopicKeys.includes(topic);
  const label = labels.find((l) => l.id === topic);
  return !label?.excludeFromTotals;
}

/** `sessions` with every entry `sessionCountsTowardTotals` says not to count
 * removed -- the shared filter step every pure aggregator above runs before
 * summing. Generic over `T` (not pinned to LoggedSession) so it works
 * equally on a full LoggedSession and on stats.ts's narrower SessionRecord,
 * the two shapes those aggregators actually receive. `excludedTopicKeys`
 * (default `[]`) is forwarded straight through to sessionCountsTowardTotals
 * -- see that function's own comment. */
export function filterCountedSessions<T extends { topic?: string }>(
  sessions: T[],
  labels: CustomLabel[],
  excludedTopicKeys: string[] = [],
): T[] {
  return sessions.filter((s) => sessionCountsTowardTotals(s.topic, labels, excludedTopicKeys));
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
    seen.add(id);
    // Hex specifically, not merely "a non-empty string". Two things in this
    // app do arithmetic on a label's color rather than just handing it to a
    // style: theme/color.ts's contrast math (via readableTextColor, which
    // picks the ink for text sitting inside a chip of this color) and
    // withAlpha, which builds an 8-digit hex by string concatenation --
    // FocusHero's topic pill and the stats donut both call it on exactly this
    // value. Neither has any meaning for `rgb(...)`, a CSS color name, or a
    // typo, and the second produces a string React Native cannot render at
    // all, so the chip loses its fill.
    //
    // RECOLORED, not dropped -- deliberately unlike the fields above, and the
    // one place this module's "drop what you cannot repair" rule does not
    // apply. That rule exists because an invented label is one the user never
    // created; it is about identity. A color is not identity, and there IS a
    // safe default for it, so the rule's premise does not hold here. Dropping
    // is also the more destructive option, not the more conservative one:
    // resolveTopic returns null for a label the catalog no longer has, so
    // topicBreakdownWithCustom silently excludes every session tagged with it
    // -- measured, an hour of real logged focus time vanishing from the
    // breakdown -- and the pruned catalog is then pushed back to the account,
    // losing the user's own label name for good. A neutral swatch they can
    // change in two taps is a far smaller wrong than either.
    //
    // The authoring path still THROWS on a bad color (createCustomLabel), the
    // same split goalSanitize.ts documents: a user-initiated edit has a form
    // to render the message in, while untrusted remote data has nobody to
    // tell and must simply be made safe.
    const safeColor = isHexColor(color) ? expandHex(color) : NEUTRAL_LABEL_COLOR;
    // Same "omitted, not false" shape setLabelExcluded writes locally --
    // dropped rather than coerced when a hostile/old remote doc's value
    // isn't literally `true` or `false` (a string "true", a number, etc.),
    // since a garbage value here has no safe repair the way a bad color
    // does; falling through to "no flag at all" is exactly this field's own
    // documented default of "counts".
    const excludeFromTotals = (entry as Partial<CustomLabel>).excludeFromTotals;
    out.push({
      id,
      name: name.trim().slice(0, MAX_LABEL_NAME_LENGTH),
      color: safeColor,
      ...(excludeFromTotals === true ? { excludeFromTotals: true } : {}),
    });
    if (out.length === MAX_CUSTOM_LABELS) break;
  }
  return out;
}

/**
 * Untrusted value -> a clean `excludedTopicKeys` array -- sanitizeCustomLabels's
 * counterpart for the built-in-topic exclusion list, the same boundary role
 * for the same reason: this array arrives from users/{uid}/settings/app,
 * whose rule (see firestore.rules' own comment beside it) bounds the array's
 * SIZE and type but, like customLabels, cannot check each element is
 * actually one of the six real TopicKey strings. Every real reader
 * (sessionCountsTowardTotals, resolveTopic, allLabelChoices) treats an entry
 * as a TopicKey it can look up TOPIC_LABELS/TOPIC_HEX by -- a garbage string
 * here is harmless to those (a membership test against an unknown string
 * just never matches), but it would round-trip back to the account forever
 * and silently occupy a slot toward the cap, so it is dropped rather than
 * carried through.
 *
 * Returns keys in TOPIC_KEYS' own fixed order and de-duplicated, same as
 * setTopicKeyExcluded above -- there is no meaningful order to preserve from
 * an untrusted array the way sanitizeCustomLabels preserves customLabels'
 * creation order, so canonicalizing here makes the sanitized result stable
 * and trivially comparable regardless of what order the remote doc happened
 * to list keys in.
 */
export function sanitizeExcludedTopicKeys(value: unknown): TopicKey[] {
  if (!Array.isArray(value)) return [];
  const keys = new Set<TopicKey>();
  for (const entry of value) {
    if (typeof entry === 'string' && (TOPIC_KEYS as string[]).includes(entry)) {
      keys.add(entry as TopicKey);
    }
    if (keys.size === MAX_EXCLUDED_TOPIC_KEYS) break; // every real key already seen -- nothing left to add
  }
  return TOPIC_KEYS.filter((k) => keys.has(k));
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
  if (isTopicKey(topic)) return TOPIC_LABELS[topic];
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
  /** Mirrors `sessionCountsTowardTotals(id, customLabels, excludedTopicKeys)`'s
   * negation -- true for a saved custom label with `excludeFromTotals: true`,
   * OR a built-in topic whose TopicKey is in `excludedTopicKeys`. Always
   * false for a one-time tag, which has no catalog entry of any kind to
   * carry an exclusion opinion. Carried here so the two pickers that render
   * a ResolvedTopic (screens/TopicPicker.tsx, ui/calendar/LabelPickerSheet.tsx)
   * can show a "doesn't count" affordance identically for either kind of
   * excluded topic, without re-deriving it from the raw customLabels/
   * excludedTopicKeys arrays a second time. */
  excludedFromTotals: boolean;
}

/** Resolves a session's stored topic id (a built-in TopicKey, a saved
 * custom label's id, or a one-time free-text tag typed directly into
 * DashboardScreen's TopicPicker) to a display name + color. Returns null
 * only when untagged, or when a *saved* custom label was since deleted --
 * its past sessions keep the id, but there's nothing left to render for it.
 * A one-time tag has no catalog entry to go stale, so it always resolves
 * back to the exact string the user typed.
 *
 * `excludedTopicKeys` (default `[]`) is only consulted for a built-in
 * TopicKey match -- see ResolvedTopic.excludedFromTotals's own comment. */
export function resolveTopic(
  topic: string | undefined,
  customLabels: CustomLabel[],
  mode: ThemeMode,
  excludedTopicKeys: string[] = [],
): ResolvedTopic | null {
  if (!topic) return null;
  if (isTopicKey(topic)) {
    const key = topic;
    const color = topicColor(key, mode);
    return {
      id: key,
      label: TOPIC_LABELS[key],
      color,
      textColor: readableTextColor(color),
      isCustom: false,
      isOneTime: false,
      excludedFromTotals: excludedTopicKeys.includes(key),
    };
  }
  const custom = customLabels.find((l) => l.id === topic);
  if (custom) {
    return {
      id: custom.id,
      label: custom.name,
      color: custom.color,
      textColor: readableTextColor(custom.color),
      isCustom: true,
      isOneTime: false,
      excludedFromTotals: !!custom.excludeFromTotals,
    };
  }
  if (isCustomLabelId(topic)) return null; // saved custom label, since deleted -- nothing left to render
  // A one-time free-text tag: not a built-in key, not a saved custom label
  // (or its id), so the raw string itself is the only thing to show.
  return {
    id: topic,
    label: topic,
    color: NEUTRAL_LABEL_COLOR,
    textColor: readableTextColor(NEUTRAL_LABEL_COLOR),
    isCustom: false,
    isOneTime: true,
    excludedFromTotals: false,
  };
}

/** Every selectable label for (re)tagging a session: built-ins in their
 * fixed order, then custom labels in creation order. `excludedTopicKeys`
 * (default `[]`) is forwarded only to the built-in half -- a custom label's
 * own `excludeFromTotals` already travels with it via `customLabels`, so
 * resolveTopic needs no exclusion list for that half of the call. Built-in
 * topics remain in this list -- and therefore fully pickable when tagging a
 * session -- regardless of `excludedTopicKeys`; only ResolvedTopic.
 * excludedFromTotals changes, the same "still shown, still pickable, just
 * not counted" contract sessionCountsTowardTotals's own comment documents. */
export function allLabelChoices(customLabels: CustomLabel[], mode: ThemeMode, excludedTopicKeys: string[] = []): ResolvedTopic[] {
  const builtins = TOPIC_KEYS.map((k) => resolveTopic(k, customLabels, mode, excludedTopicKeys)!);
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
