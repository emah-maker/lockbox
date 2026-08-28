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
// sanitizeRemoteGoals (now in goalSanitize.ts, re-exported below) is the
// boundary-validation choke point: every
// array that comes from outside this device's own CRUD calls (a Firestore
// pull in sync/, or a future direct read from the dashboard's write) must be
// pushed through it before anything here or in goalProgress.ts trusts it as
// a real Goal[] -- see this file's own header precedent in
// sessionHistory.ts's loadSessions, which heals untrusted-shape data at its
// one choke point rather than expecting every caller to re-validate.
//
// The reminder-schedule fields (notifyTimes/notifyDays/notifyOnlyIfBehind)
// have their own leaf module, goalReminders.ts -- see that file's header for
// why they live there rather than here.
import { validateNotifySchedule, normalizeNotifyTimes } from './goalReminders';

// The untrusted-input boundary lives in goalSanitize.ts (see its header for
// why it was split out). Re-exported here so every existing
// `import { sanitizeRemoteGoals } from './goals'` call site -- sync/, the
// store, the tests -- keeps working against its original module path.
export { sanitizeRemoteGoals } from './goalSanitize';

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
   * `notify`'s own comment) so it survives a notify:false round-trip.
   *
   * Superseded by `notifyTimes` below, but deliberately still written (as
   * `notifyTimes[0]`) and still read: the website dashboard and every goal
   * recorded before multi-time reminders existed know only this field, so
   * keeping it populated is what lets a goal edited here still show a
   * sensible reminder there. goalReminders.ts's goalNotifyTimes is the one
   * place the two are reconciled -- nothing else should read either field
   * directly. */
  notifyAt?: string;
  /** Every 'HH:MM' local reminder time for this goal, canonical (sorted,
   * deduped, at most goalReminders.ts's MAX_NOTIFY_TIMES). `undefined`
   * means "no multi-time list recorded", which goalNotifyTimes reads as
   * falling back to a lone `notifyAt`. */
  notifyTimes?: string[];
  /** Which weekdays the reminders fire on, 0=Sun..6=Sat -- distinct from
   * `daysOfWeek` above, which is about which days COUNT toward the target.
   * `undefined` defers to the goal's own schedule; see goalReminders.ts's
   * goalNotifyDays for the precedence. */
  notifyDays?: number[];
  /** Skip the reminder entirely when this goal's current window is already
   * met -- a "you're 40m short" nudge is useful, the same nudge after
   * you've already hit the target is just noise. Enforced at schedule time
   * by goalNotifications.ts, which re-reconciles whenever progress moves. */
  notifyOnlyIfBehind?: boolean;
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

// Exported for goalSanitize.ts, which re-checks the same per-period bound
// on the untrusted side.
export function maxTargetSFor(period: GoalPeriod): number {
  if (period === 'daily') return MAX_DAILY_TARGET_S;
  if (period === 'weekly') return MAX_WEEKLY_TARGET_S;
  return MAX_MONTHLY_TARGET_S;
}

// 'HH:MM', strict 24h ranges (00-23 : 00-59) -- Goal.notifyAt's own shape.
// Shared by validateGoalExtras (throwing path) and sanitizeOneGoal
// (dropping path) and goalNotifications.ts (which re-derives, rather than
// imports, this exact pattern -- see that file's header for why it stays a
// leaf module with no import of this one).
export const NOTIFY_AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Dedupes and sorts an untrusted-but-already-int-checked daysOfWeek array
 * into Goal.daysOfWeek's own canonical form, collapsing an empty result
 * back to `undefined` -- so "every day" is always represented the same one
 * way (missing key), never as a stored `[]`, regardless of which caller
 * produced it (createGoal/updateGoal's throwing path, or
 * sanitizeOneGoal's dropping path). Callers are responsible for having
 * already rejected/dropped anything that isn't an integer 0-6 -- this
 * function only normalizes shape, it doesn't itself validate values. */
export function normalizeDaysOfWeek(daysOfWeek: number[]): number[] | undefined {
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
  // The multi-time reminder schedule -- validated by goalReminders.ts (see
  // that module's header for why it isn't inlined here), but called from
  // this one function so every create/update path still has exactly ONE
  // extras-validation entry point, as before.
  schedule: {
    notifyTimes?: string[];
    notifyDays?: number[];
    notifyOnlyIfBehind?: boolean;
  } = {},
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
  validateNotifySchedule(schedule.notifyTimes, schedule.notifyDays, schedule.notifyOnlyIfBehind);
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
  /** Every reminder time for the new goal. When supplied, it is the
   * authority and `notifyAt` above is DERIVED from it (set to the earliest
   * entry) rather than read -- see Goal.notifyAt's own comment on why that
   * legacy field keeps being written at all. */
  notifyTimes?: string[];
  notifyDays?: number[];
  notifyOnlyIfBehind?: boolean;
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
  validateGoalExtras(period, extra.daysOfWeek, extra.targetSessions, extra.notify, extra.notifyAt, {
    notifyTimes: extra.notifyTimes,
    notifyDays: extra.notifyDays,
    notifyOnlyIfBehind: extra.notifyOnlyIfBehind,
  });
  if (goals.length >= MAX_GOALS) throw new Error(`You can have at most ${MAX_GOALS} goals.`);
  const daysOfWeek = extra.daysOfWeek !== undefined ? normalizeDaysOfWeek(extra.daysOfWeek) : undefined;
  const notifyTimes = normalizeNotifyTimes(extra.notifyTimes);
  const notifyDays = extra.notifyDays !== undefined ? normalizeDaysOfWeek(extra.notifyDays) : undefined;
  // `notifyAt` is a derived mirror of the list's earliest entry whenever a
  // list exists -- never an independent second source of truth (see
  // Goal.notifyAt). Only when NO list was supplied does an explicitly
  // passed `notifyAt` stand on its own, which is what keeps every existing
  // single-time caller working byte-for-byte as before.
  const notifyAt = notifyTimes ? notifyTimes[0] : extra.notifyAt;
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
    ...(notifyAt !== undefined ? { notifyAt } : {}),
    ...(notifyTimes !== undefined ? { notifyTimes } : {}),
    ...(notifyDays !== undefined ? { notifyDays } : {}),
    ...(extra.notifyOnlyIfBehind !== undefined ? { notifyOnlyIfBehind: extra.notifyOnlyIfBehind } : {}),
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
   * same three-way shape as `daysOfWeek`/`targetSessions` above. Ignored
   * when `notifyTimes` is also present in the same patch, since `notifyAt`
   * is derived from the list in that case (see Goal.notifyAt). */
  notifyAt?: string | null;
  /** Same three-way shape again: `undefined` = leave unchanged, `null` =
   * clear every reminder time, an array = replace the whole list. */
  notifyTimes?: string[] | null;
  notifyDays?: number[] | null;
  notifyOnlyIfBehind?: boolean;
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
    const patchedNotifyAt = patch.notifyAt !== undefined ? (patch.notifyAt === null ? undefined : patch.notifyAt) : g.notifyAt;
    const rawNotifyTimes =
      patch.notifyTimes !== undefined ? (patch.notifyTimes === null ? undefined : patch.notifyTimes) : g.notifyTimes;
    const rawNotifyDays =
      patch.notifyDays !== undefined ? (patch.notifyDays === null ? undefined : patch.notifyDays) : g.notifyDays;
    const notifyOnlyIfBehind = patch.notifyOnlyIfBehind !== undefined ? patch.notifyOnlyIfBehind : g.notifyOnlyIfBehind;
    validateGoalFields(topic, period, targetS);
    validateGoalExtras(period, rawDaysOfWeek, targetSessions, notify, patchedNotifyAt, {
      notifyTimes: rawNotifyTimes,
      notifyDays: rawNotifyDays,
      notifyOnlyIfBehind,
    });
    const daysOfWeek = rawDaysOfWeek !== undefined ? normalizeDaysOfWeek(rawDaysOfWeek) : undefined;
    const notifyTimes = normalizeNotifyTimes(rawNotifyTimes);
    const notifyDays = rawNotifyDays !== undefined ? normalizeDaysOfWeek(rawNotifyDays) : undefined;
    // Re-derived from the list on every write, so the legacy mirror can
    // never drift out of step with it -- see Goal.notifyAt.
    const notifyAt = notifyTimes ? notifyTimes[0] : patchedNotifyAt;
    return {
      ...g,
      topic,
      period,
      targetS,
      daysOfWeek,
      targetSessions,
      notify,
      notifyAt,
      notifyTimes,
      notifyDays,
      notifyOnlyIfBehind,
      updatedAt: nowMs,
    };
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
