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

// Dark-mode variants only -- the dashboard page is dark-themed like the rest
// of the site (website/css/styles.css), unlike the app which supports both.
const TOPIC_HEX = {
  work: '#3987e5',
  study: '#d95926',
  reading: '#199e70',
  creative: '#c98500',
  exercise: '#d55181',
  other: '#008300',
};

/** Same binary black/white contrast pick as the app's readableTextColor. */
export function readableTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0b0b0b' : '#ffffff';
}

/** Resolves a session's stored topic id (a built-in key or a `custom:`-prefixed
 * label id) to a display name + color. Returns null when untagged, or when a
 * custom label was since deleted. Mirrors app/src/stats/customLabels.ts's
 * resolveTopic. */
export function resolveTopic(topic, customLabels) {
  if (!topic) return null;
  if (topic in TOPIC_LABELS) {
    const color = TOPIC_HEX[topic];
    return { id: topic, label: TOPIC_LABELS[topic], color, textColor: readableTextColor(color), isCustom: false };
  }
  const custom = (customLabels || []).find((l) => l.id === topic);
  if (!custom) return null;
  return { id: custom.id, label: custom.name, color: custom.color, textColor: readableTextColor(custom.color), isCustom: true };
}

/** Aggregate raw session records the same way the app/firmware does. Records
 * are expected oldest-first; streak = trailing consecutive completed
 * sessions. Mirrors app/src/stats/stats.ts's aggregate. */
export function aggregate(records) {
  let n = 0;
  let foc = 0;
  let done = 0;
  let lng = 0;
  let str = 0;
  let streakOpen = true;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i];
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

/** Oldest-to-newest focus totals for the last `days` calendar days (including
 * today). Mirrors app/src/stats/trend.ts's lastNDays. */
export function lastNDays(sessions, days = 7, nowMs = Date.now()) {
  const byDay = groupByDay(sessions);
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
 * mirrors app/src/stats/customLabels.ts's topicBreakdownWithCustom. */
export function topicBreakdownWithCustom(sessions, customLabels) {
  const totals = new Map();
  for (const s of sessions) {
    const resolved = resolveTopic(s.topic, customLabels);
    if (!resolved) continue;
    const cur = totals.get(resolved.id) || { focusS: 0, n: 0 };
    cur.focusS += s.actualS;
    cur.n += 1;
    totals.set(resolved.id, cur);
  }
  const stats = [];
  for (const [id, agg] of totals) {
    const resolved = resolveTopic(id, customLabels);
    stats.push({ key: id, label: resolved.label, color: resolved.color, focusS: agg.focusS, n: agg.n });
  }
  return stats.sort((a, b) => b.focusS - a.focusS);
}

/** The label with the most focus time among the given sessions (e.g. one
 * calendar day's sessions), or null if none of them are tagged. Mirrors
 * app/src/stats/customLabels.ts's dominantTopicWithCustom -- used by the
 * dashboard's calendar grid to pick each day's dot color. */
export function dominantTopicWithCustom(sessions, customLabels) {
  return topicBreakdownWithCustom(sessions, customLabels)[0] || null;
}

// ---------- app/src/stats/comparisons.ts port ("fun facts" card) ----------

// Deliberately round, easy-to-defend reference durations. Ordered
// shortest -> longest with distinct unitS values so topComparisons never
// ties. Mirrors app/src/stats/comparisons.ts's REAL_WORLD_REFS exactly.
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
