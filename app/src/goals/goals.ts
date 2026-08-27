// goals.ts -- the focus-goals data model + pure CRUD-on-array helpers, in
// the same spirit as stats/customLabels.ts's createCustomLabel/
// renameCustomLabel/deleteCustomLabel: every mutation takes the current
// array and returns a NEW array, validates before mutating, and throws a
// plain Error whose `message` is written to be shown directly to the user
// (see createCustomLabel's "Label name is required." convention -- matched
// exactly below, not just "some error").
//
// Kept as its own module, dependency-free (no RN, no Firebase, no
// AsyncStorage), so it's unit-testable the same way topics.ts/
// customLabels.ts are, and so it can be shared byte-for-byte in spirit with
// website/js/goals.js (the dashboard's pure-JS twin, see
// docs/rfcs/google-signin-cross-device-sync-architecture.md) -- neither
// surface can import the other's file, but keeping this module free of any
// app-only dependency is what makes porting it 1:1 possible at all.
//
// sanitizeRemoteGoals below is the boundary-validation choke point: every
// array that comes from outside this device's own CRUD calls (a Firestore
// pull in sync/, or a future direct read from the dashboard's write) must be
// pushed through it before anything here or in goalProgress.ts trusts it as
// a real Goal[] -- see this file's own header precedent in
// sessionHistory.ts's loadSessions, which heals untrusted-shape data at its
// one choke point rather than expecting every caller to re-validate.

/** A goal's recurrence window. Matches goalProgress.ts's two window kinds
 * exactly -- there is no third period, so this stays a plain union rather
 * than an open string type. */
export type GoalPeriod = 'daily' | 'weekly';

export interface Goal {
  id: string;
  /** null = all focus time regardless of topic. Otherwise a built-in
   * TopicKey (stats/topics.ts) or a custom label id (`custom:<...>`, see
   * stats/customLabels.ts) -- stored as a plain string, same reasoning as
   * LoggedSession.topic in sessionHistory.ts: a goal aimed at a
   * since-deleted custom label id should keep matching that id's past (and
   * future re-tagged) sessions, not silently stop working. */
  topic: string | null;
  period: GoalPeriod;
  /** Seconds. Bounds depend on `period` -- see MIN_TARGET_S/
   * MAX_DAILY_TARGET_S/MAX_WEEKLY_TARGET_S below. */
  targetS: number;
  createdAt: number; // epoch ms
  /** Per-goal logical clock (epoch ms), NOT a server timestamp -- compared
   * by goalMerge.ts's last-write-wins merge the same way sessionHistory.ts's
   * topicUpdatedAt is compared by sync/sessionMerge.ts. Every mutation in
   * this file re-stamps it. */
  updatedAt: number;
  /** Tombstone, not a delete. A "deleted" goal stays in the array with
   * archived: true so the delete itself propagates through goalMerge.ts's
   * per-id LWW compare across devices/the dashboard, instead of a stale
   * remote copy silently resurrecting it on next sync -- same reasoning as
   * why sessions are never actually removed (firestore.rules' sessions
   * `allow delete: if false`). pruneArchivedGoals below is what eventually
   * drops these, once they're old enough that every side has surely already
   * observed the tombstone. */
  archived: boolean;
}

const GOAL_ID_PREFIX = 'goal:';

// Keep these numbers identical on both surfaces (app + website/js/goals.js)
// and in app/firestore.rules' goals/config write rule -- same convention as
// customLabels.ts's MAX_CUSTOM_LABELS/MAX_LABEL_NAME_LENGTH comment, which
// says the same thing about settings/app's customLabels.size() check.
export const MAX_GOALS = 20;
export const MAX_GOAL_ID_LENGTH = 64;
// Mirrors customLabels.ts's own MAX_TOPIC_LENGTH (itself mirroring
// firestore.rules' sessions `topic.size() <= 200`) -- kept as an independent
// constant rather than an import so this module stays free of
// customLabels.ts's own dependency chain (topics.ts, theme.ts); the two
// values must still be changed together.
export const MAX_TOPIC_LENGTH = 200;
export const MIN_TARGET_S = 60;
export const MAX_DAILY_TARGET_S = 86400; // 24h
export const MAX_WEEKLY_TARGET_S = 604800; // 7d

// Archived tombstones older than this are dropped on the next local write
// (pruneArchivedGoals) -- long enough that any device or the dashboard that
// was offline for a while has almost certainly reconnected and observed the
// tombstone before it disappears, short enough that the array doesn't grow
// unboundedly from years of deleted goals.
export const ARCHIVED_GOAL_PRUNE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function makeGoalId(): string {
  return `${GOAL_ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function maxTargetSFor(period: GoalPeriod): number {
  return period === 'daily' ? MAX_DAILY_TARGET_S : MAX_WEEKLY_TARGET_S;
}

/** Throws the same caller-renderable Error convention as customLabels.ts
 * (e.g. "Label name is required.") for every rejection reason a goal's
 * topic/period/targetS can fail on. Shared by createGoal, updateGoal, and
 * sanitizeRemoteGoals's per-entry check (sanitizeRemoteGoals catches the
 * throw itself -- see below -- rather than silently accepting bad data). */
function validateGoalFields(topic: string | null, period: GoalPeriod, targetS: number): void {
  if (topic !== null) {
    if (typeof topic !== 'string' || !topic) throw new Error('Goal topic is required.');
    if (topic.length > MAX_TOPIC_LENGTH) throw new Error(`Goal topic must be ${MAX_TOPIC_LENGTH} characters or fewer.`);
  }
  if (period !== 'daily' && period !== 'weekly') throw new Error('Goal period must be "daily" or "weekly".');
  if (!Number.isInteger(targetS)) throw new Error('Goal target must be a whole number of seconds.');
  const max = maxTargetSFor(period);
  if (targetS < MIN_TARGET_S || targetS > max) {
    throw new Error(`Goal target must be between ${MIN_TARGET_S} and ${max} seconds for a ${period} goal.`);
  }
}

/** Appends a new goal, stamping createdAt/updatedAt to `nowMs`. Rejects (via
 * throw, same as createCustomLabel) an invalid topic/period/targetS or a
 * goal count already at MAX_GOALS -- checked last, same ordering as
 * createCustomLabel's own field-then-cap checks, so a field error is never
 * masked by a cap error that would have applied regardless. */
export function createGoal(
  goals: Goal[],
  topic: string | null,
  period: GoalPeriod,
  targetS: number,
  nowMs: number = Date.now(),
): Goal[] {
  validateGoalFields(topic, period, targetS);
  if (goals.length >= MAX_GOALS) throw new Error(`You can have at most ${MAX_GOALS} goals.`);
  const goal: Goal = { id: makeGoalId(), topic, period, targetS, createdAt: nowMs, updatedAt: nowMs, archived: false };
  return [...goals, goal];
}

export interface GoalPatch {
  topic?: string | null;
  period?: GoalPeriod;
  targetS?: number;
}

/** Updates the one goal matching `id` (topic/period/targetS only -- id,
 * createdAt, and archived are not editable here; archiving is archiveGoal's
 * job), re-stamping updatedAt to `nowMs`. Validates the *merged* result (so
 * e.g. patching only targetS still re-checks it against the goal's existing
 * period's bounds). Silently no-ops for an id that isn't present, same
 * convention as customLabels.ts's renameCustomLabel/deleteCustomLabel. */
export function updateGoal(goals: Goal[], id: string, patch: GoalPatch, nowMs: number = Date.now()): Goal[] {
  return goals.map((g) => {
    if (g.id !== id) return g;
    const topic = patch.topic !== undefined ? patch.topic : g.topic;
    const period = patch.period !== undefined ? patch.period : g.period;
    const targetS = patch.targetS !== undefined ? patch.targetS : g.targetS;
    validateGoalFields(topic, period, targetS);
    return { ...g, topic, period, targetS, updatedAt: nowMs };
  });
}

/** Tombstones the one goal matching `id` (archived: true, updatedAt bumped)
 * instead of removing it -- see Goal.archived's own comment for why. A
 * missing id is a silent no-op, same as deleteCustomLabel. */
export function archiveGoal(goals: Goal[], id: string, nowMs: number = Date.now()): Goal[] {
  return goals.map((g) => (g.id === id ? { ...g, archived: true, updatedAt: nowMs } : g));
}

/** Drops archived tombstones older than ARCHIVED_GOAL_PRUNE_MS (by their
 * own updatedAt, i.e. when they were archived). Called on the local write
 * path (not on every read) so a device that's been offline still gets to
 * observe a tombstone before it can vanish out from under a pending merge. */
export function pruneArchivedGoals(goals: Goal[], nowMs: number = Date.now()): Goal[] {
  return goals.filter((g) => !g.archived || nowMs - g.updatedAt <= ARCHIVED_GOAL_PRUNE_MS);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Hardens one arbitrary/untrusted candidate object into a Goal, or returns
 * null if any field fails a hard type/shape/bound check. Unlike
 * validateGoalFields (which throws to reject a *user-initiated* edit with a
 * renderable message), this never throws -- a single malformed entry from a
 * remote array is just dropped, not surfaced as an error the sanitizing
 * caller has to catch. archived/createdAt/updatedAt are coerced/defaulted
 * where it's safe to do so (see inline comments); id/topic/period/targetS
 * are not, because there's no safe default for "which goal is this" or
 * "what does this goal actually target". */
function sanitizeOneGoal(raw: unknown, nowMs: number): Goal | null {
  if (!isPlainObject(raw)) return null;

  const id = raw.id;
  if (typeof id !== 'string' || !id || id.length > MAX_GOAL_ID_LENGTH) return null;

  const topic = raw.topic === null || raw.topic === undefined ? null : raw.topic;
  if (topic !== null && (typeof topic !== 'string' || !topic || topic.length > MAX_TOPIC_LENGTH)) return null;

  const period = raw.period;
  if (period !== 'daily' && period !== 'weekly') return null;

  const targetS = raw.targetS;
  if (typeof targetS !== 'number' || !Number.isInteger(targetS)) return null;
  if (targetS < MIN_TARGET_S || targetS > maxTargetSFor(period)) return null;

  // createdAt only affects sort order (goalMerge.ts's tiebreak, and this
  // module's own display sort), so a missing/malformed value falls back to
  // `nowMs` -- worst case a corrupt entry sorts as if created "just now",
  // which is a cosmetic ordering nit, not a data-integrity problem.
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : nowMs;
  // updatedAt is load-bearing for goalMerge.ts's last-write-wins compare, so
  // it must fail CLOSED, not open: falling back to `nowMs` here would make a
  // clockless entry -- exactly the kind of malformed record this function
  // exists to catch -- automatically win every LWW compare against a real,
  // legitimately-newer edit on the other side, since `nowMs` is the largest
  // plausible clock value at sanitize time. Falling back to 0 instead means
  // a clockless entry always LOSES a compare against any genuine edit
  // (whose updatedAt is a real epoch ms, necessarily > 0), which is the safe
  // direction for a value crossing this trust boundary.
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;

  // Anything other than a literal `true` is treated as not-archived -- an
  // untrusted source writing a truthy-but-wrong-typed value (e.g. "true",
  // the string) should not accidentally tombstone a goal.
  const archived = raw.archived === true;

  return { id, topic, period, targetS, createdAt, updatedAt, archived };
}

/**
 * Hardens an arbitrary/untrusted array (a Firestore `goals` field, or
 * anything the dashboard might write) into a valid Goal[]: wrong types,
 * missing fields, over-length strings, and out-of-range targets are dropped
 * per-entry by sanitizeOneGoal; duplicate ids are resolved by the same
 * greater-updatedAt-wins rule goalMerge.ts uses (tie -> first occurrence, so
 * this stays a pure function of its input order); and the result is capped
 * to MAX_GOALS, keeping input order, so a corrupted or maliciously oversized
 * remote array can never blow past this device's own cap. This is the one
 * choke point sync code should push a remote `goals` array through before
 * treating it as trustworthy -- see this file's header comment. */
export function sanitizeRemoteGoals(input: unknown, nowMs: number = Date.now()): Goal[] {
  if (!Array.isArray(input)) return [];

  const byId = new Map<string, Goal>();
  const order: string[] = [];
  for (const raw of input) {
    const goal = sanitizeOneGoal(raw, nowMs);
    if (!goal) continue;
    const existing = byId.get(goal.id);
    if (!existing) {
      order.push(goal.id);
      byId.set(goal.id, goal);
    } else if (goal.updatedAt > existing.updatedAt) {
      byId.set(goal.id, goal); // keep order position of the first occurrence, just replace its value
    }
  }

  return order.slice(0, MAX_GOALS).map((id) => byId.get(id)!);
}
