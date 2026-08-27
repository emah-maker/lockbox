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

/** A goal's recurrence window. Matches goalProgress.ts's three window kinds
 * exactly -- this stays a closed union (not an open string type) so adding a
 * fourth period anywhere is a type-checked, all-call-sites-visible change,
 * not a silent runtime surprise. 'monthly' was added alongside
 * Goal.daysOfWeek/targetSessions/notify/notifyAt below (the "certain days or
 * things" extension) -- see goalProgress.ts's monthlyWindow for its window
 * math and this file's own maxTargetSFor for its target bound. */
export type GoalPeriod = 'daily' | 'weekly' | 'monthly';

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
   * MAX_DAILY_TARGET_S/MAX_WEEKLY_TARGET_S/MAX_MONTHLY_TARGET_S below. */
  targetS: number;
  /** Only meaningful for `period: 'daily'` -- which weekdays count toward
   * this goal, 0=Sun..6=Sat (JS `Date#getDay()` convention, matching
   * goalProgress.ts's own dailyWindow/weeklyWindow comments). `undefined`
   * or an empty array both mean "every day", so a caller never has to
   * special-case which one a particular Goal happens to carry -- see
   * normalizeDaysOfWeek below, which is why a stored array is never empty
   * (an edit that clears it back to "every day" stores `undefined`, not
   * `[]`). Ignored entirely for `weekly`/`monthly` goals: their window
   * already spans the whole period, so "which days count" has no meaning
   * for them (goalProgress.ts's isGoalDueOn treats it the same way). */
  daysOfWeek?: number[];
  /** An optional session-COUNT target alongside `targetS`'s time target --
   * e.g. "3 sessions" as well as "2 hours". `undefined` means this is a
   * time-only goal, matching every goal that existed before this field was
   * added (see sanitizeRemoteGoals's old-shape compatibility). When set,
   * goalProgress.ts's computeGoalProgress reports `sessionCount`/
   * `sessionsMet` alongside the existing seconds-based fields, and folds
   * this into the overall `met` the same way `targetS` already is (met
   * requires BOTH targets when both are present). Bounds: MIN 1,
   * MAX_TARGET_SESSIONS below -- deliberately period-independent (unlike
   * targetS's bounds), since "how many sessions" doesn't scale with the
   * window length the way "how many seconds" does. */
  targetSessions?: number;
  /** Per-goal opt-in to a local reminder notification (see
   * goals/goalNotifications.ts) -- `undefined`/`false` means no reminder is
   * scheduled for this goal regardless of `notifyAt`. Kept as its own field
   * (rather than inferring "wants a reminder" from `notifyAt` being set) so
   * turning a reminder off and back on doesn't lose the previously-chosen
   * time. */
  notify?: boolean;
  /** 'HH:MM' local 24-hour reminder time (see NOTIFY_AT_RE below) --
   * meaningful only when `notify` is true, but kept independent of it (see
   * `notify`'s own comment) so it survives a notify:false round-trip. */
  notifyAt?: string;
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
// 31d -- the longest possible calendar month, so this bound never rejects a
// target that's legitimately achievable in a short (28/30-day) one; a
// monthly goal's actual window (goalProgress.ts's monthlyWindow) is the
// real calendar month containing `nowMs`, whatever length that turns out to
// be, same as `MAX_WEEKLY_TARGET_S` bounding a fixed 7d window above.
export const MAX_MONTHLY_TARGET_S = 31 * 24 * 60 * 60;
// Bound for Goal.targetSessions -- deliberately a flat cap independent of
// `period` (unlike the *_TARGET_S bounds above): "how many sessions" is a
// count, not a duration, so it doesn't scale with a period's window length
// the way seconds-targets do. 100 is generous for even a very short-session
// habit tracked monthly (3+/day) while still bounding the number this
// module (and goalNotifications.ts, indirectly, via MAX_GOALS) ever has to
// reason about.
export const MAX_TARGET_SESSIONS = 100;

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
  if (period === 'daily') return MAX_DAILY_TARGET_S;
  if (period === 'weekly') return MAX_WEEKLY_TARGET_S;
  return MAX_MONTHLY_TARGET_S;
}

// 'HH:MM', strict 24h ranges (00-23 : 00-59) -- Goal.notifyAt's own shape.
// Shared by validateGoalExtras (throwing path) and sanitizeOneGoal
// (dropping path) and goalNotifications.ts (which re-derives, rather than
// imports, this exact pattern -- see that file's header for why it stays a
// leaf module with no import of this one).
const NOTIFY_AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Dedupes and sorts an untrusted-but-already-int-checked daysOfWeek array
 * into Goal.daysOfWeek's own canonical form, collapsing an empty result
 * back to `undefined` -- so "every day" is always represented the same one
 * way (missing key), never as a stored `[]`, regardless of which caller
 * produced it (createGoal/updateGoal's throwing path, or
 * sanitizeOneGoal's dropping path). Callers are responsible for having
 * already rejected/dropped anything that isn't an integer 0-6 -- this
 * function only normalizes shape, it doesn't itself validate values. */
function normalizeDaysOfWeek(daysOfWeek: number[]): number[] | undefined {
  const unique = Array.from(new Set(daysOfWeek)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : undefined;
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
  if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') {
    throw new Error('Goal period must be "daily", "weekly", or "monthly".');
  }
  if (!Number.isInteger(targetS)) throw new Error('Goal target must be a whole number of seconds.');
  const max = maxTargetSFor(period);
  if (targetS < MIN_TARGET_S || targetS > max) {
    throw new Error(`Goal target must be between ${MIN_TARGET_S} and ${max} seconds for a ${period} goal.`);
  }
}

/** Validates the "flexible goals" extension fields (daysOfWeek/
 * targetSessions/notify/notifyAt) for a caller-initiated create/update,
 * throwing the same renderable-Error convention as validateGoalFields --
 * called right after it, since the daysOfWeek/period cross-check below
 * depends on `period` already being known-valid. `daysOfWeek` here is the
 * caller's raw (not yet deduped/sorted) input; callers normalize it via
 * normalizeDaysOfWeek AFTER this passes, so a rejected edit never mutates
 * anything first. */
function validateGoalExtras(
  period: GoalPeriod,
  daysOfWeek: number[] | undefined,
  targetSessions: number | undefined,
  notify: boolean | undefined,
  notifyAt: string | undefined,
): void {
  if (daysOfWeek !== undefined) {
    if (period !== 'daily') throw new Error('daysOfWeek only applies to a daily goal.');
    if (!Array.isArray(daysOfWeek) || daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new Error('daysOfWeek entries must be whole numbers 0-6 (0=Sun..6=Sat).');
    }
  }
  if (targetSessions !== undefined) {
    if (!Number.isInteger(targetSessions) || targetSessions < 1 || targetSessions > MAX_TARGET_SESSIONS) {
      throw new Error(`Goal session target must be a whole number between 1 and ${MAX_TARGET_SESSIONS}.`);
    }
  }
  if (notify !== undefined && typeof notify !== 'boolean') {
    throw new Error('Goal notify must be true or false.');
  }
  if (notifyAt !== undefined && (typeof notifyAt !== 'string' || !NOTIFY_AT_RE.test(notifyAt))) {
    throw new Error('Goal notifyAt must be a 24-hour "HH:MM" time.');
  }
}

/** The "flexible goals" extension fields a caller can supply on create,
 * bundled into one optional trailing param rather than four more positional
 * ones -- createGoal's existing (goals, topic, period, targetS, nowMs)
 * signature stays entirely unchanged for any existing call site, this is
 * purely additive. `daysOfWeek` here is the caller's raw selection (not yet
 * deduped/sorted); createGoal normalizes it via normalizeDaysOfWeek. */
export interface GoalCreateExtras {
  daysOfWeek?: number[];
  targetSessions?: number;
  notify?: boolean;
  notifyAt?: string;
}

/** Appends a new goal, stamping createdAt/updatedAt to `nowMs`. Rejects (via
 * throw, same as createCustomLabel) an invalid topic/period/targetS/
 * daysOfWeek/targetSessions/notify/notifyAt, or a goal count already at
 * MAX_GOALS -- the cap is checked last, same ordering as createCustomLabel's
 * own field-then-cap checks, so a field error is never masked by a cap error
 * that would have applied regardless. */
export function createGoal(
  goals: Goal[],
  topic: string | null,
  period: GoalPeriod,
  targetS: number,
  nowMs: number = Date.now(),
  extra: GoalCreateExtras = {},
): Goal[] {
  validateGoalFields(topic, period, targetS);
  validateGoalExtras(period, extra.daysOfWeek, extra.targetSessions, extra.notify, extra.notifyAt);
  if (goals.length >= MAX_GOALS) throw new Error(`You can have at most ${MAX_GOALS} goals.`);
  const daysOfWeek = extra.daysOfWeek !== undefined ? normalizeDaysOfWeek(extra.daysOfWeek) : undefined;
  const goal: Goal = {
    id: makeGoalId(),
    topic,
    period,
    targetS,
    createdAt: nowMs,
    updatedAt: nowMs,
    archived: false,
    ...(daysOfWeek !== undefined ? { daysOfWeek } : {}),
    ...(extra.targetSessions !== undefined ? { targetSessions: extra.targetSessions } : {}),
    ...(extra.notify !== undefined ? { notify: extra.notify } : {}),
    ...(extra.notifyAt !== undefined ? { notifyAt: extra.notifyAt } : {}),
  };
  return [...goals, goal];
}

export interface GoalPatch {
  topic?: string | null;
  period?: GoalPeriod;
  targetS?: number;
  /** `undefined` = leave unchanged; an array (including `[]`, which
   * normalizeDaysOfWeek collapses to "every day") = replace; `null` =
   * explicitly clear back to "every day" -- same three-way shape as the
   * other extension fields below, so a form can always distinguish "the
   * user didn't touch this control" from "the user turned it off". */
  daysOfWeek?: number[] | null;
  targetSessions?: number | null;
  notify?: boolean;
  /** `undefined` = leave unchanged, `null` = clear, a string = replace --
   * same three-way shape as `daysOfWeek`/`targetSessions` above. */
  notifyAt?: string | null;
}

/** Updates the one goal matching `id` (topic/period/targetS plus the
 * daysOfWeek/targetSessions/notify/notifyAt extension fields -- id,
 * createdAt, and archived are not editable here; archiving is archiveGoal's
 * job), re-stamping updatedAt to `nowMs`. Validates the *merged* result (so
 * e.g. patching only targetS still re-checks it against the goal's existing
 * period's bounds, and patching `period` away from 'daily' still re-checks
 * whatever daysOfWeek the goal already had). Silently no-ops for an id
 * that isn't present, same convention as customLabels.ts's
 * renameCustomLabel/deleteCustomLabel. */
export function updateGoal(goals: Goal[], id: string, patch: GoalPatch, nowMs: number = Date.now()): Goal[] {
  return goals.map((g) => {
    if (g.id !== id) return g;
    const topic = patch.topic !== undefined ? patch.topic : g.topic;
    const period = patch.period !== undefined ? patch.period : g.period;
    const targetS = patch.targetS !== undefined ? patch.targetS : g.targetS;
    const rawDaysOfWeek = patch.daysOfWeek !== undefined ? (patch.daysOfWeek === null ? undefined : patch.daysOfWeek) : g.daysOfWeek;
    const targetSessions =
      patch.targetSessions !== undefined ? (patch.targetSessions === null ? undefined : patch.targetSessions) : g.targetSessions;
    const notify = patch.notify !== undefined ? patch.notify : g.notify;
    const notifyAt = patch.notifyAt !== undefined ? (patch.notifyAt === null ? undefined : patch.notifyAt) : g.notifyAt;
    validateGoalFields(topic, period, targetS);
    validateGoalExtras(period, rawDaysOfWeek, targetSessions, notify, notifyAt);
    const daysOfWeek = rawDaysOfWeek !== undefined ? normalizeDaysOfWeek(rawDaysOfWeek) : undefined;
    return { ...g, topic, period, targetS, daysOfWeek, targetSessions, notify, notifyAt, updatedAt: nowMs };
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
  if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') return null;

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

  // The four "flexible goals" extension fields, each hardened
  // independently: unlike id/topic/period/targetS above, an invalid value
  // for any ONE of these never rejects the whole goal -- it's simply
  // dropped (comes back as `undefined`, exactly the old-shape case), same
  // "recoverable, so don't nuke the whole record over it" reasoning
  // createdAt/archived get above, just with "drop the field" standing in
  // for "coerce to a safe default" (there IS no safe default for e.g. a
  // malformed notifyAt to coerce TO). This is also what makes an old-shape
  // input -- one with none of these keys at all -- sail through unchanged:
  // every one of the four checks below simply doesn't match and leaves the
  // corresponding local `undefined`.
  const daysOfWeek =
    period === 'daily' && Array.isArray(raw.daysOfWeek) && raw.daysOfWeek.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      ? normalizeDaysOfWeek(raw.daysOfWeek as number[])
      : undefined;

  const targetSessions =
    typeof raw.targetSessions === 'number' &&
    Number.isInteger(raw.targetSessions) &&
    raw.targetSessions >= 1 &&
    raw.targetSessions <= MAX_TARGET_SESSIONS
      ? raw.targetSessions
      : undefined;

  const notify = raw.notify === true ? true : raw.notify === false ? false : undefined;

  const notifyAt = typeof raw.notifyAt === 'string' && NOTIFY_AT_RE.test(raw.notifyAt) ? raw.notifyAt : undefined;

  return {
    id,
    topic,
    period,
    targetS,
    createdAt,
    updatedAt,
    archived,
    ...(daysOfWeek !== undefined ? { daysOfWeek } : {}),
    ...(targetSessions !== undefined ? { targetSessions } : {}),
    ...(notify !== undefined ? { notify } : {}),
    ...(notifyAt !== undefined ? { notifyAt } : {}),
  };
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
