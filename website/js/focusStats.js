/* =========================================================================
   focusStats.js -- focus-session stat math for the website dashboard.
   Plain-JS port of app/src/stats/{stats,topics,customLabels,trend}.ts's pure
   functions -- kept here (rather than shared) because the website has no
   build step / TypeScript and reads the same Firestore documents the app
   writes (see app/src/sync/firestoreSync.ts's RemoteSession/localSettingsPayload
   shapes). No dependencies; ESM so dashboard.js can import it directly.
   ========================================================================= */

export const TOPIC_KEYS = ['work', 'study', 'reading', 'creative', 'exercise', 'other'];

export const TOPIC_LABELS = {
  work: 'Work',
  study: 'Study',
  reading: 'Reading',
  creative: 'Creative',
  exercise: 'Exercise',
  other: 'Other',
};

// Light/dark variants, matching app/src/stats/topics.ts's TOPIC_HEX exactly --
// the dashboard now resolves the signed-in user's actual themeMode (synced to
// users/{uid}/settings/app) rather than assuming dark, so topic colors need
// to follow it the same way the app's own screens do.
const TOPIC_HEX = {
  work: { light: '#2a78d6', dark: '#3987e5' },
  study: { light: '#eb6834', dark: '#d95926' },
  reading: { light: '#1baf7a', dark: '#199e70' },
  creative: { light: '#eda100', dark: '#c98500' },
  exercise: { light: '#e87ba4', dark: '#d55181' },
  other: { light: '#008300', dark: '#008300' },
};

/** True for the one colour notation the maths below can work on: `#RGB` or
 * `#RRGGBB`. Twin of app/src/theme/color.ts's isHexColor -- keep in step. */
export function isHexColor(value) {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** `#RGB` -> `#RRGGBB`, leaving a six-digit value alone. Twin of
 * app/src/theme/color.ts's expandHex. relativeLuminance below slices the
 * string two characters at a time, so the shorthand form -- which browsers
 * render perfectly well, and which an `<input type="color">` sibling can
 * emit -- read channel 1 as a single digit and channel 2 as the empty
 * string, i.e. NaN. */
export function expandHex(hex) {
  const h = hex.replace('#', '');
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

/** WCAG relative luminance (sRGB, gamma-corrected) -- unlike a perceptual
 * luma weighting, this is what the 4.5:1 contrast-ratio formula is actually
 * defined against.
 *
 * Non-hex input resolves to mid-grey's luminance rather than NaN: a NaN here
 * does not throw, it makes both comparisons in readableTextColor false, so
 * the ink stops being measured and silently becomes whichever branch loses
 * the tie. Same guard as the app twin. */
function relativeLuminance(hex) {
  if (!isHexColor(hex)) return 0.2159; // luminance of #808080, mid-grey
  const full = expandHex(hex);
  const chan = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = chan(parseInt(full.slice(1, 3), 16));
  const g = chan(parseInt(full.slice(3, 5), 16));
  const b = chan(parseInt(full.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Same black/white contrast pick as the app's readableTextColor: picks
 * whichever of black/white clears WCAG AA (4.5:1) against `hex`, or the
 * higher-contrast of the two if neither does. Same fix applied to
 * app/src/stats/topics.ts's readableTextColor -- both copies shared the
 * same bug (a perceptual-luma threshold instead of real WCAG contrast),
 * which picked white text for work/study/reading/creative/exercise even
 * though it measures 3.1-4.0:1 against those fills, below the 4.5:1 floor. */
export function readableTextColor(hex) {
  const luminance = relativeLuminance(hex);
  const whiteContrast = contrastRatio(1, luminance);
  const blackContrast = contrastRatio(luminance, 0);
  return whiteContrast >= blackContrast ? '#ffffff' : '#0b0b0b';
}

/** This app's "no strong colour" choice -- the warm-grey already in
 * LABEL_SWATCHES, reused rather than inventing a new hex. Used when a label
 * has to be drawn without a usable user-picked colour; see
 * sanitizeCustomLabels. Twin of app/src/stats/customLabels.ts's
 * NEUTRAL_LABEL_COLOR. */
const NEUTRAL_LABEL_COLOR = '#78716c';

const CUSTOM_ID_PREFIX = 'custom:';

// Mirrors app/src/stats/customLabels.ts's own constants -- kept in sync so a
// rejected write here never surfaces as a confusing remote permission error
// (firestore.rules' settings/app write rule caps customLabels.size() at 40)
// instead of this module's own validation message.
export const MAX_CUSTOM_LABELS = 40;
export const MAX_LABEL_NAME_LENGTH = 40;

/** Same starting-point swatches as app/src/stats/customLabels.ts's
 * LABEL_SWATCHES, for the dashboard's own label-creation UI. */
export const LABEL_SWATCHES = [
  '#e11d48', '#f97316', '#ca8a04', '#65a30d', '#059669', '#0891b2',
  '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#78716c', '#334155',
];

export function makeCustomLabelId() {
  return `${CUSTOM_ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Port of app/src/stats/customLabels.ts's createCustomLabel/renameCustomLabel/
 * deleteCustomLabel -- same validation, same shape, so a label created here
 * round-trips through the app exactly like one created there. */
export function createCustomLabel(labels, name, color) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Label name is required.');
  if (trimmed.length > MAX_LABEL_NAME_LENGTH) throw new Error(`Label name must be ${MAX_LABEL_NAME_LENGTH} characters or fewer.`);
  if (!color) throw new Error('Label color is required.');
  // Hex specifically, matching the app twin: the app builds an 8-digit hex
  // from this value by string concatenation (withAlpha) and does contrast
  // maths on it, neither of which means anything for `rgb(...)` or a CSS
  // colour name. Both clients pick from LABEL_SWATCHES, so this rejects
  // nothing either legitimately produces.
  if (!isHexColor(color)) throw new Error('Label color must be a hex color.');
  if (labels.length >= MAX_CUSTOM_LABELS) throw new Error(`You can have at most ${MAX_CUSTOM_LABELS} custom labels.`);
  return [...labels, { id: makeCustomLabelId(), name: trimmed, color: expandHex(color) }];
}

export function renameCustomLabel(labels, id, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Label name is required.');
  if (trimmed.length > MAX_LABEL_NAME_LENGTH) throw new Error(`Label name must be ${MAX_LABEL_NAME_LENGTH} characters or fewer.`);
  return labels.map((l) => (l.id === id ? { ...l, name: trimmed } : l));
}

export function recolorCustomLabel(labels, id, color) {
  if (!color) throw new Error('Label color is required.');
  if (!isHexColor(color)) throw new Error('Label color must be a hex color.');
  return labels.map((l) => (l.id === id ? { ...l, color: expandHex(color) } : l));
}

export function deleteCustomLabel(labels, id) {
  return labels.filter((l) => l.id !== id);
}

/** Whether a session tagged `topic` should count toward focus totals/goal
 * progress -- port of app/src/stats/customLabels.ts's sessionCountsTowardTotals
 * (see that function's own long comment for the full rationale; kept here
 * rather than shared for this file's own header reason). Untagged always
 * counts; a built-in topic key counts unless it's in `excludedTopicKeys`; a
 * saved custom label counts unless that label has `excludeFromTotals: true`;
 * anything matching neither catalog (a one-time free-text tag, or a saved
 * label since deleted) always counts too -- there's no catalog entry left to
 * carry an exclusion opinion. */
export function sessionCountsTowardTotals(topic, labels, excludedTopicKeys = []) {
  if (!topic) return true;
  if (topic in TOPIC_LABELS) return !excludedTopicKeys.includes(topic);
  const label = (labels || []).find((l) => l.id === topic);
  return !(label && label.excludeFromTotals);
}

/** `sessions` with every entry `sessionCountsTowardTotals` says not to count
 * removed -- port of app/src/stats/customLabels.ts's filterCountedSessions,
 * the shared filter step aggregate/lastNDays below run before summing.
 * `excludedTopicKeys` (default `[]`) is forwarded straight through, same as
 * the app twin. */
export function filterCountedSessions(sessions, labels, excludedTopicKeys = []) {
  return sessions.filter((s) => sessionCountsTowardTotals(s.topic, labels, excludedTopicKeys));
}

/**
 * Untrusted value -> a clean `excludedTopicKeys` array -- port of
 * app/src/stats/customLabels.ts's sanitizeExcludedTopicKeys, sanitizeCustomLabels's
 * counterpart for the built-in-topic exclusion list. settings/app's rule
 * bounds this array's SIZE and type but cannot check each element is
 * actually one of the six real topic keys, so a garbage entry is dropped
 * rather than carried through (harmless to sessionCountsTowardTotals'
 * membership test, but it would round-trip back to the account forever and
 * silently occupy a slot toward the cap otherwise). Returns keys in
 * TOPIC_KEYS' own fixed order and de-duplicated, same as the app twin.
 */
export function sanitizeExcludedTopicKeys(value) {
  if (!Array.isArray(value)) return [];
  const keys = new Set();
  for (const entry of value) {
    if (typeof entry === 'string' && TOPIC_KEYS.includes(entry)) keys.add(entry);
    if (keys.size === TOPIC_KEYS.length) break; // every real key already seen -- nothing left to add
  }
  return TOPIC_KEYS.filter((k) => keys.has(k));
}

/**
 * Untrusted value -> a label catalog this page can actually render. The twin
 * of app/src/stats/customLabels.ts's sanitizeCustomLabels; keep the two in
 * step, the same way the rest of this module mirrors that one.
 *
 * settings/app's write rule bounds the catalog SIZE and (now) that it is a
 * list at all, but rules cannot iterate a list of maps, so nothing there
 * checks the ENTRIES. resolveTopic reads `.name`, topicBreakdownWithCustom
 * keys a Map by `.id`, and the pickers paint `.color` straight into a style
 * -- so a malformed entry is a render-time throw on a page whose whole job
 * is to render. This module used to be handed `settings.customLabels || []`
 * on the strength of that rule alone.
 *
 * Drops what it cannot repair rather than substituting placeholders: an
 * invented label would be one the user never created, and the dashboard
 * resends this catalog on its next settings write.
 */
export function sanitizeCustomLabels(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, color } = entry;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    if (typeof name !== 'string' || !name.trim()) continue;
    seen.add(id);
    // Hex, not merely a non-empty string -- see createCustomLabel above, and
    // the app twin, which this must stay in step with: a catalog the two
    // clients disagree about is one each of them keeps re-pushing over the
    // other.
    //
    // RECOLOURED, not dropped, and deliberately unlike the identity fields
    // above. Dropping is the more destructive option: resolveTopic returns
    // null for a label the catalog no longer has, so every session tagged
    // with it silently leaves the breakdown, and the pruned catalog is then
    // written back to the account, losing the user's own label name. A
    // neutral swatch they can change in two clicks is a far smaller wrong.
    // Stored six-digit so no render site has to know about the shorthand.
    const safeColor = isHexColor(color) ? expandHex(color) : NEUTRAL_LABEL_COLOR;
    out.push({ id, name: name.trim().slice(0, MAX_LABEL_NAME_LENGTH), color: safeColor });
    if (out.length === MAX_CUSTOM_LABELS) break;
  }
  return out;
}

/** Every selectable label for (re)tagging a session: built-ins in their fixed
 * order, then custom labels in creation order. Mirrors app/src/stats/
 * customLabels.ts's allLabelChoices, used to populate the dashboard's
 * per-session relabel dropdown. */
export function allLabelChoices(customLabels, mode = 'dark') {
  const builtins = TOPIC_KEYS.map((k) => resolveTopic(k, customLabels, mode));
  const customs = (customLabels || []).map((l) => resolveTopic(l.id, customLabels, mode));
  return [...builtins, ...customs];
}

/** Resolves a session's stored topic id (a built-in key or a `custom:`-prefixed
 * label id) to a display name + color. Returns null when untagged, or when a
 * custom label was since deleted. Mirrors app/src/stats/customLabels.ts's
 * resolveTopic. `mode` picks the built-in topic's light/dark hex the same way
 * the app's topicColor(key, mode) does; a custom label's color is user-picked
 * and mode-independent, same as the app. */
export function resolveTopic(topic, customLabels, mode = 'dark') {
  if (!topic) return null;
  if (topic in TOPIC_LABELS) {
    const color = TOPIC_HEX[topic][mode] || TOPIC_HEX[topic].dark;
    return { id: topic, label: TOPIC_LABELS[topic], color, textColor: readableTextColor(color), isCustom: false };
  }
  const custom = (customLabels || []).find((l) => l.id === topic);
  if (!custom) return null;
  return { id: custom.id, label: custom.name, color: custom.color, textColor: readableTextColor(custom.color), isCustom: true };
}

/** Aggregate raw session records the same way the app/firmware does. Records
 * are expected oldest-first; streak = trailing consecutive completed
 * sessions. Mirrors app/src/stats/stats.ts's aggregate.
 *
 * `labels` (default `[]`, i.e. nothing excluded) is threaded through
 * filterCountedSessions above before any of the math below runs, so a
 * session tagged with an `excludeFromTotals` label contributes to none of
 * `n`/`foc`/`done`/`str`/`lng` -- same rationale/default as the app twin.
 * `excludedTopicKeys` (default `[]`) is the identical exclusion for the six
 * built-in topics. Omitting both reproduces the pre-exclusion behavior
 * byte-for-byte, since an empty catalog excludes nothing. */
export function aggregate(records, labels = [], excludedTopicKeys = []) {
  const counted = filterCountedSessions(records, labels, excludedTopicKeys);
  let n = 0;
  let foc = 0;
  let done = 0;
  let lng = 0;
  let str = 0;
  let streakOpen = true;
  for (let i = counted.length - 1; i >= 0; i -= 1) {
    const r = counted[i];
    n += 1;
    foc += r.actualS;
    if (r.actualS > lng) lng = r.actualS;
    if (r.outcome === 'completed') {
      done += 1;
      if (streakOpen) str += 1;
    } else {
      streakOpen = false;
    }
  }
  return { n, foc, done, str, lng };
}

/** Whole-minute-rounded "Xh Ym" / "Ym" duration, matching the app's formatDuration. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${String(mm).padStart(2, '0')}m` : `${m}m`;
}

/** Completion rate as a 0..100 integer percent (0 when no sessions). */
export function completionRate(st) {
  if (!st.n) return 0;
  return Math.round((st.done / st.n) * 100);
}

/** Local-timezone Y-M-D key so a session groups under the day it happened. */
export function dayKey(epochMs) {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The inverse of `dayKey`: that key's LOCAL midnight, as a Date.
 *
 * Exists because `new Date('2026-08-28')` does NOT round-trip a dayKey -- the
 * ES spec parses a bare date-only string as UTC midnight, while dayKey writes
 * the key from local Y/M/D. Anywhere west of UTC the two disagree by a full
 * day, so `new Date(someDayKey).toLocaleDateString()` renders the day BEFORE
 * the one the key names. Port of app/src/stats/sessionHistory.ts's helper of
 * the same name, added there for the same bug. Callers should use this rather
 * than parsing a key themselves. */
export function dayKeyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function groupByDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    const bucket = map.get(key);
    if (bucket) bucket.push(s);
    else map.set(key, [s]);
  }
  return map;
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The single calendar day (across all logged history, not just the last 7)
 * with the most total focus time -- a real personal-record fact for the "Fun
 * facts" card, computed from the same session log as every other stat here.
 * Mirrors app/src/stats/trend.ts's bestDay. Null on an empty/all-zero log. */
export function bestDay(sessions) {
  const byDay = groupByDay(sessions);
  let best = null;
  for (const [key, daySessions] of byDay) {
    const focusS = daySessions.reduce((sum, s) => sum + s.actualS, 0);
    if (focusS > 0 && (!best || focusS > best.focusS)) {
      best = { key, dateMs: daySessions[0].startedAt, focusS };
    }
  }
  return best;
}

/** Oldest-to-newest focus totals for the last `days` calendar days (including
 * today). Mirrors app/src/stats/trend.ts's lastNDays.
 *
 * `labels` (default `[]`) excludes `excludeFromTotals`-tagged sessions from
 * every day's total, same rationale/default as aggregate above -- the trend
 * bars this feeds shouldn't read higher just because a day also had an
 * excluded label's time logged on it. `excludedTopicKeys` (default `[]`) is
 * the same exclusion for built-in topics, forwarded alongside `labels`. */
export function lastNDays(sessions, days = 7, nowMs = Date.now(), labels = [], excludedTopicKeys = []) {
  const byDay = groupByDay(filterCountedSessions(sessions, labels, excludedTopicKeys));
  const now = new Date(nowMs);
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d.getTime());
    const focusS = (byDay.get(key) || []).reduce((sum, s) => sum + s.actualS, 0);
    out.push({ key, label: WEEKDAY_INITIALS[d.getDay()], focusS });
  }
  return out;
}

/** Focus time + session count per resolvable label (built-in or custom),
 * sorted highest focus first. Untagged/deleted-label sessions are excluded --
 * mirrors app/src/stats/customLabels.ts's topicBreakdownWithCustom.
 *
 * Deliberately takes no `labels`/`excludedTopicKeys` exclusion params, unlike
 * aggregate/lastNDays above -- this is a "what was actually tagged" breakdown,
 * not a counting total. app/src/stats/customLabels.ts's own
 * sessionCountsTowardTotals doc comment names this exact function as one of
 * the views an excluded session is "NEVER hidden from ... only from the
 * aggregates that answer 'how much have I focused'/'did I hit my goal'" --
 * so an excludeFromTotals-tagged session's time still shows up here, same as
 * the app. Do not add exclusion filtering here without re-checking that
 * comment; doing so would newly diverge FROM the app rather than fix a
 * divergence. */
export function topicBreakdownWithCustom(sessions, customLabels, mode = 'dark') {
  const totals = new Map();
  for (const s of sessions) {
    const resolved = resolveTopic(s.topic, customLabels, mode);
    if (!resolved) continue;
    const cur = totals.get(resolved.id) || { focusS: 0, n: 0 };
    cur.focusS += s.actualS;
    cur.n += 1;
    totals.set(resolved.id, cur);
  }
  const stats = [];
  for (const [id, agg] of totals) {
    const resolved = resolveTopic(id, customLabels, mode);
    stats.push({ key: id, label: resolved.label, color: resolved.color, focusS: agg.focusS, n: agg.n });
  }
  return stats.sort((a, b) => b.focusS - a.focusS);
}

/** The label with the most focus time among the given sessions (e.g. one
 * calendar day's sessions), or null if none of them are tagged. Mirrors
 * app/src/stats/customLabels.ts's dominantTopicWithCustom -- used by the
 * dashboard's calendar grid to pick each day's dot color. */
export function dominantTopicWithCustom(sessions, customLabels, mode = 'dark') {
  return topicBreakdownWithCustom(sessions, customLabels, mode)[0] || null;
}

// ---------- app/src/stats/comparisons.ts port ("fun facts" card) ----------

// Deliberately round, easy-to-defend reference durations. Ordered
// shortest -> longest with distinct unitS values so topComparisons never
// ties. Mirrors app/src/stats/comparisons.ts's REAL_WORLD_REFS exactly --
// the two lists must stay in sync (same 11 entries, same order, same
// key/label/unitS), which nothing in either runtime enforces on its own.
// Checked against tests/fixtures/realWorldRefs.golden.json by this file's
// own twin's "REAL_WORLD_REFS parity" test (comparisons.test.ts) and by
// focusStats.test.js's copy of the same check -- adding a 12th reference
// here without also updating app/src/stats/comparisons.ts AND that fixture
// will fail both.
export const REAL_WORLD_REFS = [
  { key: 'coffee', label: 'brewing a pot of coffee', unitS: 10 * 60 },
  { key: 'tv-episode', label: 'watching a sitcom episode', unitS: 22 * 60 },
  { key: 'workout', label: 'a gym workout', unitS: 60 * 60 },
  { key: 'movie', label: 'watching a movie', unitS: 2 * 60 * 60 },
  { key: 'baseball-game', label: 'a baseball game', unitS: 3 * 60 * 60 },
  { key: 'marathon', label: 'running a marathon', unitS: 4.5 * 60 * 60 },
  { key: 'novel', label: 'reading a novel', unitS: 6 * 60 * 60 },
  { key: 'flight-transatlantic', label: 'a transatlantic flight', unitS: 7 * 60 * 60 },
  { key: 'sleep', label: 'a full night of sleep', unitS: 8 * 60 * 60 },
  { key: 'lotr-trilogy', label: 'bingeing the Lord of the Rings trilogy (extended cuts)', unitS: 11.4 * 60 * 60 },
  { key: 'weekend', label: 'a full weekend', unitS: 48 * 60 * 60 },
];

/** Comparisons sorted by the most dramatic (highest multiple) first. */
export function topComparisons(totalS, refs = REAL_WORLD_REFS) {
  return refs.map((ref) => ({ ref, count: totalS / ref.unitS })).sort((a, b) => b.count - a.count);
}

/** "That's like 3.2x reading a novel." Whole numbers >= 10 drop the decimal. */
export function formatComparison(c) {
  const n = c.count;
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `That's like ${rounded}x ${c.ref.label}.`;
}

// ---------- app/src/screens/CalendarScreen.tsx month-grid port ----------

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Sun-first month grid, padded to full weeks with `null` filler cells --
 * mirrors CalendarScreen.tsx's buildGrid. */
export function buildMonthGrid(monthStart) {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = monthStart.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Bucket a day's focus time into 5 discrete intensity levels (0-4) relative
 * to the busiest day in whatever window the caller is drawing (0 = no focus
 * time at all; 4 = the busiest day). Mirrors app/src/stats/trend.ts's
 * heatmapLevel exactly -- keep the two in sync; see that function's doc
 * comment for why the calendar heatmap needs discrete steps rather than a
 * continuous alpha. */
export function heatmapLevel(focusS, max) {
  if (focusS <= 0) return 0;
  const ratio = focusS / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

// The single source of truth mapping a heat level to a fill alpha. Mirrors
// app/src/theme/dayHeat.ts's ALPHA_FOR_LEVEL exactly -- keep the two in
// sync, same as heatmapLevel above.
export const ALPHA_FOR_LEVEL = {
  0: 0,
  1: 0.25,
  2: 0.5,
  3: 0.75,
  4: 1,
};
