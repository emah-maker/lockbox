// sessionHistory.ts -- the app's own local log of focus sessions. Most
// entries come live from BLE status transitions (see useStore's
// handleStatus); the rest are drained in a batch from the box's small
// RAM-only queue of sessions that finished while no phone was connected (see
// firmware/lib/lock_log.py and useStore's handleHistory). Either way, this
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
  /** True when `startedAt` is a GUESS, not a reading: the box logged this
   * session before its clock had ever been set (no phone had connected yet),
   * so buildLoggedSessions had nothing to date it from but the moment the
   * entry happened to arrive. Local-only bookkeeping -- firestoreSync's
   * sessionPayload names the fields it uploads explicitly, so this never
   * reaches Firestore (and firestore.rules' `hasOnly` allow-list would
   * reject it if it tried). appendSessions is the only reader; see its own
   * comment for why a guessed timestamp cannot be deduped like a real one. */
  approxStart?: boolean;
  /** True when this session was produced by the demonstration-mode fake box
   * (ble/DemoBoxClient.ts) rather than a real one. Local-only bookkeeping,
   * exactly like `approxStart` above and by the same mechanism -- nothing
   * names it in sync/sessionsSync.ts's sessionPayload, and firestore.rules'
   * `hasOnly` allow-list would refuse it if anything did.
   *
   * It exists because "local-only" has to outlive the toggle. Demo sessions
   * stay in the durable log (that is the point -- the reviewer watches them
   * land in Home, Stats and the calendar), so switching demo mode back off
   * and later signing in would otherwise hand the full local log to
   * syncSessions and upload them. firestore.rules' sessions block allows a
   * delete only while `users/{uid}` is absent, so anything that reaches an
   * account is in its stats permanently. Stamped once at intake
   * (ble/historyIntake.ts); read in sync/sessionsSync.ts. */
  demo?: boolean;
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

/** Append a batch (e.g. a drained box history queue) in one read/write.
 * De-duped against what's already stored by (startedAt, plannedS): the box
 * resends an un-acked `history` batch verbatim on its next connection (see
 * firmware/lib/lock_log.py's SessionLog.ack and
 * docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
 * §3.2) -- if the app already durably stored that batch but the box never
 * heard the ack (e.g. a disconnect right after), the resend would otherwise
 * double-count every session in it.
 *
 * That key only works for a session with a REAL timestamp. A session the box
 * logged before its clock was ever set (`approxStart`) was dated from
 * whatever moment the entry arrived, so the very same session arriving again
 * on the next connection gets a DIFFERENT startedAt, sails past the dedupe,
 * and is counted twice -- permanently inflating focus time, goals and
 * streaks. Those are matched on content and MULTIPLICITY instead: how many
 * (plannedS, actualS, outcome) triples the batch carries versus how many
 * matching guessed-time sessions are already stored, appending only the
 * surplus. A verbatim resend has a surplus of zero. Counting rather than
 * plain set-membership is what keeps this from swallowing real sessions: a
 * box still stuck without a clock CAN legitimately log two identical
 * 25-minute completions, and the second one shows up as a surplus of one.
 * Real-timestamped sessions never take this path, and after the first
 * successful connect the box has a clock, so nothing new enters this
 * population at all. */
export async function appendSessions(sessions: LoggedSession[]): Promise<LoggedSession[]> {
  if (!sessions.length) return loadSessions();
  const existing = await loadSessions();
  const seen = new Set(existing.map((s) => `${s.startedAt}:${s.plannedS}`));
  const approxKey = (s: LoggedSession) => `${s.plannedS}:${s.actualS}:${s.outcome}`;
  const approxBudget = new Map<string, number>();
  for (const s of existing) {
    if (!s.approxStart) continue;
    approxBudget.set(approxKey(s), (approxBudget.get(approxKey(s)) ?? 0) + 1);
  }
  const fresh = sessions.filter((s) => {
    if (s.approxStart) {
      const key = approxKey(s);
      const alreadyStored = approxBudget.get(key) ?? 0;
      if (alreadyStored > 0) {
        approxBudget.set(key, alreadyStored - 1); // this one is the resend of a stored session
        return false;
      }
      return true;
    }
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

/** The inverse of `dayKey`: that key's LOCAL midnight, as a Date.
 *
 * Exists because `new Date('2026-08-28')` does NOT round-trip a dayKey --
 * the ES spec parses a bare date-only string as UTC midnight, while dayKey
 * writes the key from local Y/M/D. West of UTC the two disagree by a full
 * day, so every caller that did `new Date(someDayKey)` was off by one:
 * CalendarScreen's day sheet printed the day BEFORE the one you tapped, and
 * fed goalsMetOnDay a nowMs inside the previous day's goal window (so the
 * "goal met" chips described the wrong day). East of UTC it happened to
 * work, which is exactly why it survived this long. Callers should use this
 * instead of parsing the key themselves. */
export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Pure retag transform: returns `sessions` with the one entry matching
 * `target` (identified by its startedAt+plannedS+actualS triple -- the
 * finest-grained identity already implied by this file's own dedup/doc-id
 * conventions) given a new topic. Split out from retagSession so it's
 * unit-testable without touching storage.
 *
 * "The one entry" is enforced, not just described: the FIRST match is
 * relabelled and any later twin is left exactly as it was. The triple is the
 * finest identity available, but it has never been a guaranteed-unique one --
 * two clock-less sessions dated from the same arrival shared it outright
 * until buildLoggedSessions started staggering them, and a log written by an
 * older build (or restored from one) can still hold such a pair. A retag is a
 * per-session edit: the user taps ONE row in the calendar day sheet. Mapping
 * over every match instead relabelled that row's twins too, silently
 * rewriting sessions the user never touched -- and, since each carries its
 * own bumped topicUpdatedAt, pushing each of those edits to Firestore on the
 * next sync, where they win by recency on every other device as well. */
export function applyTopicUpdate(
  sessions: LoggedSession[],
  target: Pick<LoggedSession, 'startedAt' | 'plannedS' | 'actualS'>,
  topic: string | undefined,
  nowMs: number = Date.now(),
): LoggedSession[] {
  let retagged = false;
  return sessions.map((s) => {
    if (
      retagged ||
      s.startedAt !== target.startedAt ||
      s.plannedS !== target.plannedS ||
      s.actualS !== target.actualS
    ) {
      return s;
    }
    retagged = true;
    return { ...s, topic, topicUpdatedAt: nowMs };
  });
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
  // Kept as its own array (rather than chaining .filter().map()) because the
  // clock-less stagger below needs to know how many entries actually survive
  // the length filter, and which position this one holds among them.
  const kept = entries.filter((e) => e.a >= MIN_LOGGED_SESSION_S);
  const sessions: LoggedSession[] = kept
    .map((e, i) => {
      // e.t is a wall-clock epoch second, or -1 if the box's clock was never
      // synced (no phone had connected yet); fall back to "now" so the
      // session still shows up somewhere on the calendar.
      //
      // A `t` that is set but too small to place this session after the epoch
      // is treated as the same "no usable clock" case, not as a real reading.
      // The box's RTC is volatile -- it is set from the phone on connect (see
      // PhoneBoxClient.syncTime) and starts from a low value after a power
      // loss -- so a long session finishing shortly after a reset genuinely
      // computes a pre-epoch start. That is not a cosmetic wrong date:
      // firestore.rules' sessions `create` rule requires `startedAt >= 0`, so
      // the doc is refused, which fails the whole writeBatch, which fails
      // syncSessions -- the FIRST step of runMigrationAndSync, so settings,
      // goals and scheduled sessions never reconcile either. And since the
      // record stays in local storage, every later sync retries it and fails
      // the same way, permanently. Routing it through approxStart instead
      // dates it from arrival, which is exactly what that flag already means
      // and already handles (including its own resend dedupe).
      const approxStart = e.t < 0 || e.t * 1000 - e.a * 1000 < 0;
      // Every clock-less entry in a batch used to be dated from the SAME
      // nowMs, so two same-length ones came out with a byte-identical
      // startedAt -- and (startedAt, actualS) is exactly the pair
      // sync/sessionMerge.ts's sessionDocId turns into a Firestore doc id.
      // Two records on one id is not a cosmetic collision: syncSessions
      // merges into a Map keyed by that id and hands the result to
      // replaceSessions, which OVERWRITES local storage, so the twin that
      // lost the slot is gone from the phone as well as never uploaded. The
      // pair is reachable, not hypothetical -- appendSessions' multiplicity
      // dedupe deliberately keeps both, because a box still without a clock
      // can legitimately log two identical 25-minute sessions.
      //
      // So arrival is staggered a millisecond per surviving entry, oldest
      // first: lock_log.py's SessionLog appends at the end and evicts from
      // the front, so the batch is in queue order and this preserves it
      // instead of inverting it. The newest entry still lands on nowMs
      // exactly, which keeps the ordinary single-entry batch dated precisely
      // as it always was. The whole spread is bounded by LOG_MAX_PENDING
      // (200 entries, so under a fifth of a second) and only ever moves a
      // start EARLIER, so nothing can be dated into the future by it.
      const arrivedAt = nowMs - (kept.length - 1 - i);
      const startedAt = (approxStart ? arrivedAt : e.t * 1000) - e.a * 1000;
      const endedAt = startedAt + e.a * 1000;
      let topic: string | undefined;
      let topicUpdatedAt: number | undefined;
      if (pending && !consumed && pending.at >= startedAt - preSlackMs && pending.at <= endedAt + slackMs) {
        topic = pending.topic;
        topicUpdatedAt = pending.at;
        consumed = true;
      }
      return {
        startedAt,
        plannedS: e.p,
        actualS: e.a,
        outcome: e.c ? 'completed' : 'overridden',
        topic,
        topicUpdatedAt,
        // Only set when true, so an ordinary timestamped session serialises
        // exactly as it always has.
        ...(approxStart ? { approxStart: true } : {}),
      };
    });
  return { sessions, consumedPendingTopic: consumed };
}

// 'year' exists for the Home ring's best-day baseline (see
// screens/home/idleRingState.ts and useSettingsStore's ringBaselineWindow),
// not for the Stats period selector -- StatsScreen's own StatsPeriod union
// (screens/stats/PeriodSelector.tsx) deliberately doesn't include it, and
// isTimeWindow there only ever narrows *from* that union, so widening this
// type adds no Stats UI option.
export type TimeWindow = 'day' | 'week' | 'month' | 'year' | 'all';

// Trailing-N-days, same approximation 'month' already uses (30, not a
// calendar month) -- kept consistent rather than making 'year' the one
// calendar-accurate member of the set.
const WINDOW_DAYS: Record<TimeWindow, number | null> = { day: 1, week: 7, month: 30, year: 365, all: null };

/** Filters to sessions started within the selected calendar window, anchored
 * to today (local time): 'day' = today only, 'week'/'month' = the trailing 7
 * or 30 calendar days including today, 'all' = no filtering. Local-date
 * arithmetic (not raw ms subtraction), same as lastNDays, so the boundary
 * lands on the right calendar day across a DST transition. Used by
 * StatsScreen to scope both the total (stats.aggregate) and the topic
 * breakdown (customLabels.topicBreakdownWithCustom) to the same window.
 *
 * Bounded at BOTH edges -- half-open [start, tomorrow's midnight), the same
 * shape goalProgress.ts's goalWindow uses. Only the lower edge used to be
 * checked, on the assumption that nothing can be dated later than now, and
 * a logged session can be: the box's own RTC is what dates it
 * (buildLoggedSessions takes `e.t` as given), that clock is only re-synced
 * from the phone on connect, and the phone's own clock can move BACKWARDS
 * under it (a timezone change, a manual correction) -- to say nothing of a
 * sync pulling one in from a device that was running ahead. Such a session
 * then counted toward the header total for every window while
 * groupByDay/lastNDays filed it on a day past the end of the chart, which
 * draws only up to today: the period total disagreed with the bars beneath
 * it, and DashboardScreen's "focus time today" counted time that hasn't
 * happened. 'all' is deliberately left alone -- it is documented as no
 * filtering, and a lifetime total that quietly omits records is a worse
 * answer than one that includes an odd-looking day. */
export function filterByWindow(
  sessions: LoggedSession[],
  window: TimeWindow,
  nowMs: number = Date.now(),
): LoggedSession[] {
  const days = WINDOW_DAYS[window];
  if (days == null) return sessions;
  const now = new Date(nowMs);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return sessions.filter((s) => s.startedAt >= start && s.startedAt < end);
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
