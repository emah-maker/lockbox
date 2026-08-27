// sessionHistory.ts -- the app's own local log of focus sessions. Most
// entries come live from BLE status transitions (see useStore's
// handleStatus); the rest are drained in a batch from the box's small
// RAM-only queue of sessions that finished while no phone was connected (see
// Box-code/lib/lock_log.py and useStore's handleHistory). Either way, this
// is the durable, per-session, timestamped copy -- the box keeps nothing
// long-term (no SD card, no NVM) once it has handed a session off here.
import type { SessionRecord } from './stats';
import type { HistoryEntry } from '../ble/protocol';
import { getJSON, setJSON } from '../storage/storage';

const KEY = 'sessionHistory';
const MAX_RECORDS = 2000; // keep unbounded growth in check; ~a session/hour is years of history

// Accidental taps/instant overrides aren't real focus time -- entries shorter
// than this are dropped in buildLoggedSessions below before they ever reach
// the durable log, not merely filtered out of stats afterward.
export const MIN_LOGGED_SESSION_S = 60;

export interface LoggedSession extends SessionRecord {
  startedAt: number; // epoch ms, local device clock at session start
  // Optional per-session focus category: either a built-in TopicKey
  // (stats/topics.ts) or a custom label's id (stats/customLabels.ts).
  // Stored as a plain string rather than a union so an old record tagged
  // with a since-deleted custom label id still round-trips cleanly --
  // resolveTopic() is what decides whether a given string is still
  // renderable, not this type.
  topic?: string;
  // Epoch ms this session's `topic` was last set, local or remote. Absent on
  // records written before this field existed. Compared against a remote
  // session doc's own topicUpdatedAt by sync/sessionMerge.ts's last-write-wins
  // merge, so a relabel from the website dashboard and a retag from this
  // device's CalendarScreen resolve deterministically instead of one silently
  // overwriting the other on next sync -- see firestore.rules' sessions
  // `update` rule, the backend for pushing either edit to Firestore.
  topicUpdatedAt?: number;
}

/** Loads the durable session log, pruning (and persisting the prune of) any
 * sub-MIN_LOGGED_SESSION_S record found in storage. buildLoggedSessions has
 * kept new box-history entries clean since it started filtering, but that
 * doesn't retroactively clean records written before this threshold existed,
 * or ones that arrive through a path that doesn't go through
 * buildLoggedSessions at all -- e.g. firestoreSync.ts's cross-device merge,
 * which reads session docs straight from Firestore. This is the one choke
 * point every consumer reads through, so healing here covers both cases. */
export async function loadSessions(): Promise<LoggedSession[]> {
  const sessions = await getJSON<LoggedSession[]>(KEY, []);
  const kept = sessions.filter((s) => s.actualS >= MIN_LOGGED_SESSION_S);
  if (kept.length !== sessions.length) await setJSON(KEY, kept);
  return kept;
}

/** Append one completed/overridden session and persist. Returns the updated list. */
export async function appendSession(session: LoggedSession): Promise<LoggedSession[]> {
  return appendSessions([session]);
}

/** Append a batch (e.g. a drained box history queue) in one read/write.
 * De-duped against what's already stored by (startedAt, plannedS): the box
 * resends an un-acked `history` batch verbatim on its next connection (see
 * Box-code/lib/lock_log.py's SessionLog.ack and
 * docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
 * §3.2) -- if the app already durably stored that batch but the box never
 * heard the ack (e.g. a disconnect right after), the resend would otherwise
 * double-count every session in it. */
export async function appendSessions(sessions: LoggedSession[]): Promise<LoggedSession[]> {
  if (!sessions.length) return loadSessions();
  const existing = await loadSessions();
  const seen = new Set(existing.map((s) => `${s.startedAt}:${s.plannedS}`));
  const fresh = sessions.filter((s) => {
    const key = `${s.startedAt}:${s.plannedS}`;
    if (seen.has(key)) return false;
    seen.add(key); // also guards against duplicates within this same batch
    return true;
  });
  if (!fresh.length) return existing;
  const next = [...existing, ...fresh].slice(-MAX_RECORDS);
  await setJSON(KEY, next);
  return next;
}

export async function clearSessions(): Promise<void> {
  await setJSON<LoggedSession[]>(KEY, []);
}

/** Replace the full local session set (e.g. after a cross-device Firestore
 * merge -- see sync/firestoreSync.ts). Unlike appendSessions, this is a full
 * overwrite, not an append. Returns the stored list. */
export async function replaceSessions(sessions: LoggedSession[]): Promise<LoggedSession[]> {
  const next = sessions.slice(-MAX_RECORDS);
  await setJSON(KEY, next);
  return next;
}

/** Local-timezone Y-M-D key so a session groups under the day it happened for the user. */
export function dayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Pure retag transform: returns `sessions` with the one entry matching
 * `target` (identified by its startedAt+plannedS+actualS triple -- the
 * finest-grained identity already implied by this file's own dedup/doc-id
 * conventions) given a new topic. Split out from retagSession so it's
 * unit-testable without touching storage. */
export function applyTopicUpdate(
  sessions: LoggedSession[],
  target: Pick<LoggedSession, 'startedAt' | 'plannedS' | 'actualS'>,
  topic: string | undefined,
  nowMs: number = Date.now(),
): LoggedSession[] {
  return sessions.map((s) =>
    s.startedAt === target.startedAt && s.plannedS === target.plannedS && s.actualS === target.actualS
      ? { ...s, topic, topicUpdatedAt: nowMs }
      : s,
  );
}

/** Retag (or clear the tag on) one past session and persist the full set.
 * Uses replaceSessions rather than appendSessions -- this edits an existing
 * record in place, it doesn't add a new one. */
export async function retagSession(
  sessions: LoggedSession[],
  target: Pick<LoggedSession, 'startedAt' | 'plannedS' | 'actualS'>,
  topic: string | undefined,
  nowMs: number = Date.now(),
): Promise<LoggedSession[]> {
  return replaceSessions(applyTopicUpdate(sessions, target, topic, nowMs));
}

export interface PendingTopicTag {
  topic: string;
  at: number; // epoch ms when the user tagged the in-progress session
}

export interface BuiltLoggedSessions {
  sessions: LoggedSession[];
  consumedPendingTopic: boolean;
}

/** Pure transform from raw box history entries (ble/protocol.ts's
 * HistoryEntry) to LoggedSessions: drops entries under
 * MIN_LOGGED_SESSION_S, and matches `pending` (a topic tagged via
 * useStore's tagCurrentSession, either while a session was running or ahead
 * of it via DashboardScreen's pre-session tag picker) to whichever surviving
 * entry's time window contains its timestamp, widened by `preSlackMs` before
 * the start and `slackMs` past the end. Split out from useStore's
 * handleHistory so this is unit-testable without BLE mocks, same as
 * applyTopicUpdate above. */
export function buildLoggedSessions(
  entries: HistoryEntry[],
  pending: PendingTopicTag | null,
  slackMs: number,
  preSlackMs: number = 0,
  nowMs: number = Date.now(),
): BuiltLoggedSessions {
  let consumed = false;
  const sessions: LoggedSession[] = entries
    .filter((e) => e.a >= MIN_LOGGED_SESSION_S)
    .map((e) => {
      // e.t is a wall-clock epoch second, or -1 if the box's clock was never
      // synced (no phone had connected yet); fall back to "now" so the
      // session still shows up somewhere on the calendar.
      const startedAt = (e.t >= 0 ? e.t * 1000 : nowMs) - e.a * 1000;
      const endedAt = startedAt + e.a * 1000;
      let topic: string | undefined;
      let topicUpdatedAt: number | undefined;
      if (pending && !consumed && pending.at >= startedAt - preSlackMs && pending.at <= endedAt + slackMs) {
        topic = pending.topic;
        topicUpdatedAt = pending.at;
        consumed = true;
      }
      return { startedAt, plannedS: e.p, actualS: e.a, outcome: e.c ? 'completed' : 'overridden', topic, topicUpdatedAt };
    });
  return { sessions, consumedPendingTopic: consumed };
}

export type TimeWindow = 'day' | 'week' | 'month' | 'all';

const WINDOW_DAYS: Record<TimeWindow, number | null> = { day: 1, week: 7, month: 30, all: null };

/** Filters to sessions started within the selected calendar window, anchored
 * to today (local time): 'day' = today only, 'week'/'month' = the trailing 7
 * or 30 calendar days including today, 'all' = no filtering. Local-date
 * arithmetic (not raw ms subtraction), same as lastNDays, so the boundary
 * lands on the right calendar day across a DST transition. Used by
 * StatsScreen to scope both the total (stats.aggregate) and the topic
 * breakdown (customLabels.topicBreakdownWithCustom) to the same window. */
export function filterByWindow(
  sessions: LoggedSession[],
  window: TimeWindow,
  nowMs: number = Date.now(),
): LoggedSession[] {
  const days = WINDOW_DAYS[window];
  if (days == null) return sessions;
  const now = new Date(nowMs);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  return sessions.filter((s) => s.startedAt >= start);
}

export function groupByDay(sessions: LoggedSession[]): Map<string, LoggedSession[]> {
  const map = new Map<string, LoggedSession[]>();
  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    const bucket = map.get(key);
    if (bucket) bucket.push(s);
    else map.set(key, [s]);
  }
  return map;
}
