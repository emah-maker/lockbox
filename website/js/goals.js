/* =========================================================================
   goals.js -- focus-goal data model for the website dashboard. Plain-JS twin
   of the app's app/src/goals/{goals,goalMerge,goalProgress}.ts (Goal shape,
   caps, create/update/archive, sanitizeRemoteGoals, mergeGoals, progress
   computation) for the same reason focusStats.js hand-ports app/src/stats/
   *.ts: the website has no build step / TypeScript, but reads and writes the
   exact same users/{uid}/goals/config document the app does, so the two
   copies must agree on field names, caps, validation, and merge semantics
   down to the number. Every export below (names, signatures, error strings,
   field names, tie-break rules) was confirmed against the app's own three
   source files rather than re-derived from the shared contract text alone.

   Pure -- no Firebase, no DOM. dashboard.js is the only consumer that talks
   to Firestore; this module just knows how to shape, validate, reconcile,
   and score goal data, so it stays unit-testable the same way
   app/src/sync/sessionMerge.ts and app/src/stats/customLabels.ts are.

   Reuses focusStats.js's dayKey (local-day key) for the progress window math
   below rather than inventing a second date convention -- see that import
   and the "first-day-of-week" comment on goalWindow.
   ========================================================================= */
import { dayKey } from './focusStats.js';

// ---------- Goal shape ----------
// {
//   id: string,                       -- 'goal:' + random suffix, <= MAX_GOAL_ID_LENGTH, unique in the array
//   topic: string | null,             -- null = all focus time; otherwise a built-in TopicKey or a
//                                         'custom:'-id (see focusStats.js's TOPIC_KEYS/resolveTopic).
//                                         Compared as a raw string everywhere in this file -- never
//                                         resolved against TOPIC_KEYS/customLabels, so a goal pinned to
//                                         a since-deleted custom label id still matches its own sessions.
//   period: 'daily' | 'weekly' | 'monthly',
//   targetS: number,                  -- integer seconds; daily: MIN_TARGET_S..MAX_DAILY_TARGET_S,
//                                         weekly: MIN_TARGET_S..MAX_WEEKLY_TARGET_S,
//                                         monthly: MIN_TARGET_S..MAX_MONTHLY_TARGET_S
//   daysOfWeek?: number[],            -- 'flexible goals' extension, only meaningful for period:'daily'.
//                                         Which weekdays count, 0=Sun..6=Sat (JS Date#getDay()). undefined
//                                         or [] both mean "every day" -- always normalized (deduped+sorted,
//                                         collapsed to undefined when empty) by normalizeDaysOfWeek below,
//                                         so a stored array is never itself empty.
//   targetSessions?: number,          -- 'flexible goals' extension: an optional session-COUNT target
//                                         alongside targetS's time target. undefined = time-only goal
//                                         (every goal that existed before this field did). MIN 1,
//                                         MAX_TARGET_SESSIONS -- period-independent, unlike targetS's bounds.
//   notify?: boolean,                 -- 'flexible goals' extension: per-goal opt-in to a local reminder
//                                         (app/src/goals/goalNotifications.ts schedules it; this module
//                                         only stores the choice). undefined/false = no reminder.
//   notifyAt?: string,                -- 'flexible goals' extension: 'HH:MM' 24h local reminder time, see
//                                         NOTIFY_AT_RE below. Meaningful only alongside notify:true, but
//                                         kept independent of it so toggling notify off/on doesn't lose it.
//   createdAt: number,                -- epoch ms
//   updatedAt: number,                -- epoch ms, per-goal logical clock used by mergeGoals below
//   archived: boolean,                -- tombstone: a "deleted" goal stays in the array with
//                                         archived:true so the delete propagates to the other side
//                                         instead of being resurrected by its stale copy.
// }
//
// The four fields above (daysOfWeek/targetSessions/notify/notifyAt) were
// added by the app's "flexible goals" extension after this file's first
// version shipped -- confirmed field-for-field against app/src/goals/
// goals.ts's own Goal interface and sanitizeOneGoal, including the
// old-shape compatibility guarantee: an entry with none of these four keys
// at all sails through sanitizeRemoteGoals below completely unchanged.

// Caps mirror the Firestore-side allowlist that will gate users/{uid}/goals/config
// writes (see app/firestore.rules' settings/app rule for the existing style this
// follows) -- kept here as named constants, identical numbers on both surfaces,
// so a rejected write never surfaces as a confusing remote permission error
// instead of this module's own validation message (same reasoning as
// focusStats.js's MAX_CUSTOM_LABELS/MAX_LABEL_NAME_LENGTH). Names/values
// confirmed against app/src/goals/goals.ts's own constants.
export const MAX_GOALS = 20;
export const MAX_GOAL_ID_LENGTH = 64;
export const MAX_TOPIC_LENGTH = 200;
export const MIN_TARGET_S = 60;
export const MAX_DAILY_TARGET_S = 86400;
export const MAX_WEEKLY_TARGET_S = 604800;
// 31d -- the longest possible calendar month, so this bound never rejects a
// target that's legitimately achievable in a short (28/30-day) one; see
// app/src/goals/goals.ts's own MAX_MONTHLY_TARGET_S comment.
export const MAX_MONTHLY_TARGET_S = 31 * 24 * 60 * 60;
// Mirrors app/src/goals/goalReminders.ts's MAX_NOTIFY_TIMES -- keep the two
// identical, same convention as every other cap shared across these two
// surfaces.
export const MAX_NOTIFY_TIMES = 6;

// Flat cap for targetSessions, independent of period -- "how many sessions"
// doesn't scale with a period's window length the way a seconds-target does.
export const MAX_TARGET_SESSIONS = 100;

// An archived goal is a cross-device delete tombstone (see the Goal shape
// comment above) -- it only needs to live long enough for every other signed-in
// device to have had a chance to sync and drop its own stale copy. 30 days is
// a generous window for that while still bounding a chronically-offline
// account's per-user storage growth (same motivation as sessionHistory.ts's
// MAX_RECORDS and the recent "cap session topic/custom-label lengths" change).
export const ARCHIVED_GOAL_PRUNE_MS = 30 * 24 * 60 * 60 * 1000;

const GOAL_ID_PREFIX = 'goal:';

/** Random goal id, same recipe as focusStats.js's makeCustomLabelId (base-36
 * timestamp + random suffix) so both id families are cheap, unique-enough,
 * and instantly tell-apart-able by prefix. */
export function makeGoalId() {
  return `${GOAL_ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function maxTargetSFor(period) {
  if (period === 'daily') return MAX_DAILY_TARGET_S;
  if (period === 'weekly') return MAX_WEEKLY_TARGET_S;
  return MAX_MONTHLY_TARGET_S;
}

// 'HH:MM', strict 24h ranges (00-23 : 00-59) -- confirmed against
// app/src/goals/goals.ts's own NOTIFY_AT_RE.
const NOTIFY_AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Dedupes and sorts an already-int-checked daysOfWeek array, collapsing an
 * empty result back to `undefined` -- confirmed against app/src/goals/
 * goals.ts's own normalizeDaysOfWeek. Callers are responsible for having
 * already rejected/dropped anything that isn't an integer 0-6. */
function normalizeDaysOfWeek(daysOfWeek) {
  const unique = Array.from(new Set(daysOfWeek)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : undefined;
}

/** Writes `value` to `target[key]`, or REMOVES the key entirely when `value`
 * is `undefined`.
 *
 * Exists because "not set" has to reach Firestore as an ABSENT key, never as
 * a present key holding `undefined`. dashboard.js's writeGoals setDoc()s this
 * array through a plain getFirestore(app) instance -- ignoreUndefinedProperties
 * is off -- so an `undefined`-valued property makes the whole write throw
 * "Unsupported field value: undefined" in the browser, before anything leaves
 * the page. createGoal and sanitizeRemoteGoals get this for free by building
 * their objects from scratch with `...(x !== undefined ? { x } : {})`;
 * updateGoal cannot, because it builds on `...current`, where a plain
 * conditional spread would leave the goal's OLD value in place instead of
 * clearing it. Hence delete rather than skip -- the same shape the
 * notifyTimes block in updateGoal below has always used. */
function setOrDelete(target, key, value) {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/** Shared validation for create/update -- throws a plain Error with a
 * human-readable `.message`, same convention as focusStats.js's
 * createCustomLabel/renameCustomLabel (dashboard.js's errorMessage() already
 * knows to surface a plain Error's `.message` as-is, no Firebase `.code`).
 * Error strings match app/src/goals/goals.ts's own exactly. */
function validateGoalFields(topic, period, targetS) {
  if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') {
    throw new Error('Goal period must be "daily", "weekly", or "monthly".');
  }
  if (topic !== null) {
    if (typeof topic !== 'string' || !topic.length) {
      throw new Error('Goal topic is required.');
    }
    if (topic.length > MAX_TOPIC_LENGTH) {
      throw new Error(`Goal topic must be ${MAX_TOPIC_LENGTH} characters or fewer.`);
    }
  }
  if (!Number.isInteger(targetS)) {
    throw new Error('Goal target must be a whole number of seconds.');
  }
  const max = maxTargetSFor(period);
  if (targetS < MIN_TARGET_S || targetS > max) {
    throw new Error(`Goal target must be between ${MIN_TARGET_S} and ${max} seconds for a ${period} goal.`);
  }
}

/** Validates the "flexible goals" extension fields (daysOfWeek/
 * targetSessions/notify/notifyAt) for a caller-initiated create/update --
 * confirmed against app/src/goals/goals.ts's own validateGoalExtras,
 * including its error strings. `daysOfWeek` here is the caller's raw
 * (not yet deduped/sorted) input. */
function validateGoalExtras(period, daysOfWeek, targetSessions, notify, notifyAt) {
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

/** Appends a new goal (`topic: null` means "all focus time"). Mirrors
 * focusStats.js's createCustomLabel: validate, then return a new array
 * (never mutate `goals`) so callers can pass the result straight to a
 * re-render + write. `extra` (daysOfWeek/targetSessions/notify/notifyAt) is
 * the "flexible goals" extension -- confirmed against app/src/goals/
 * goals.ts's own createGoal(..., extra) trailing param. */
export function createGoal(goals, topic, period, targetS, nowMs = Date.now(), extra = {}) {
  validateGoalFields(topic, period, targetS);
  validateGoalExtras(period, extra.daysOfWeek, extra.targetSessions, extra.notify, extra.notifyAt);
  // LIVE goals, not the raw array. Archived entries are tombstones that
  // pruneArchivedGoals keeps for 30 days so an archive propagates through
  // mergeGoals' LWW union -- counting them meant a user whose visible goal
  // list was EMPTY could still be refused a new goal for a month. Mirrors
  // app/src/goals/goals.ts's createGoal, which had the identical bug.
  if (goals.filter((g) => !g.archived).length >= MAX_GOALS) {
    throw new Error(`You can have at most ${MAX_GOALS} goals.`);
  }
  const daysOfWeek = extra.daysOfWeek !== undefined ? normalizeDaysOfWeek(extra.daysOfWeek) : undefined;
  const goal = {
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
  // Letting the live-count check above through can still push the array
  // itself over MAX_GOALS when tombstones are what fill it, and the array is
  // what gets written: firestoreSync pushes it verbatim and firestore.rules
  // refuses goals.size() > 20, which would fail the sync identically on
  // every retry. So make room by dropping the stalest tombstones -- never a
  // live goal, which the check above guarantees is possible.
  return dropStalestTombstones([...goals, goal], goals.length + 1 - MAX_GOALS);
}

/** Drops the `count` stalest tombstones, oldest-updated first with id as the
 * tie-break so every surface agrees on which ones went. Only archived
 * entries are ever candidates. Mirrors the helper of the same name in
 * app/src/goals/goals.ts. */
function dropStalestTombstones(goals, count) {
  if (count <= 0) return goals;
  const doomed = new Set(
    goals
      .filter((g) => g.archived)
      .sort((a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, count)
      .map((g) => g.id),
  );
  return goals.filter((g) => !doomed.has(g.id));
}

/** Applies a partial edit (`patch` may include any of topic/period/targetS
 * plus the daysOfWeek/targetSessions/notify/notifyAt extension fields --
 * for the latter three, `undefined` = leave unchanged, `null` = clear,
 * anything else = replace, confirmed against app/src/goals/goals.ts's own
 * GoalPatch/updateGoal) to the goal with id `id`, validating the resulting
 * fields together (a period change without a matching targetS/daysOfWeek
 * change must still fail the same way a fresh create would) and bumping
 * its `updatedAt` logical clock -- the same field mergeGoals' LWW compare
 * (below) resolves on. Silently returns `goals` unchanged for an `id` that
 * isn't present, same as renameCustomLabel/deleteCustomLabel's "no matching
 * id -> no-op" stance -- not every caller can guarantee the id it has in
 * hand hasn't just lost a race with an archive from another device. */
export function updateGoal(goals, id, patch, nowMs = Date.now()) {
  const idx = goals.findIndex((g) => g.id === id);
  if (idx === -1) return goals.slice();
  const current = goals[idx];
  const topic = patch.topic !== undefined ? patch.topic : current.topic;
  const period = patch.period !== undefined ? patch.period : current.period;
  const targetS = patch.targetS !== undefined ? patch.targetS : current.targetS;
  const rawDaysOfWeek = patch.daysOfWeek !== undefined ? (patch.daysOfWeek === null ? undefined : patch.daysOfWeek) : current.daysOfWeek;
  const targetSessions =
    patch.targetSessions !== undefined ? (patch.targetSessions === null ? undefined : patch.targetSessions) : current.targetSessions;
  const notify = patch.notify !== undefined ? patch.notify : current.notify;
  const notifyAt = patch.notifyAt !== undefined ? (patch.notifyAt === null ? undefined : patch.notifyAt) : current.notifyAt;
  validateGoalFields(topic, period, targetS);
  validateGoalExtras(period, rawDaysOfWeek, targetSessions, notify, notifyAt);
  const daysOfWeek = rawDaysOfWeek !== undefined ? normalizeDaysOfWeek(rawDaysOfWeek) : undefined;
  const next = goals.slice();
  // topic/period/targetS/updatedAt are always defined, so they can be
  // assigned straight through; the four extension fields go via setOrDelete
  // above, which is what keeps an unset one an absent key rather than an
  // `undefined`-valued one Firestore refuses to write.
  const updated = { ...current, topic, period, targetS, updatedAt: nowMs };
  setOrDelete(updated, 'daysOfWeek', daysOfWeek);
  setOrDelete(updated, 'targetSessions', targetSessions);
  setOrDelete(updated, 'notify', notify);
  setOrDelete(updated, 'notifyAt', notifyAt);

  // Keep `notifyAt` and the phone's multi-time `notifyTimes` schedule from
  // drifting apart. The phone treats notifyTimes as the authority and notifyAt
  // as a derived mirror of notifyTimes[0] (goalReminders.ts's goalNotifyTimes:
  // a non-empty list wins outright and notifyAt is ignored). This form only
  // ever shows and edits ONE time, so without this a goal set to 09:00 + 18:00
  // on the phone, re-timed to 14:00 here, kept firing at 09:00 and 18:00 --
  // the edit silently did nothing.
  //
  // The condition is "did the time actually move", not "is notifyAt in the
  // patch": goalsPanel.js resubmits notifyAt on EVERY save, so keying off the
  // patch would let an unrelated edit (renaming the topic, changing the
  // target) quietly collapse a multi-time schedule the user set on their
  // phone. When the time really did change, the newer edit wins and the goal
  // collapses to that single time -- deliberate, since one time is all this
  // form can express. Multi-time schedules stay editable on the phone.
  // Only a real NEW time collapses the list. Clearing the time (the "Remind
  // me" toggle going off, which sends notifyAt: null) must NOT delete
  // notifyTimes: app/src/goals/goals.ts:422 keeps `g.notifyTimes` whenever the
  // patch doesn't name that field, and `notify: false` is already what
  // switches reminders off. Deleting it here meant a goal the user had set to
  // 09:00 + 18:00 on their phone came back single-timed after they toggled
  // the reminder off and on again from the dashboard -- and because the
  // website's write carries the newer `updatedAt`, mergeGoals' LWW compare
  // then propagated that loss down to the phone.
  if (notifyAt !== undefined && notifyAt !== current.notifyAt) {
    updated.notifyTimes = [notifyAt];
  }
  // notifyTimes is the authority the phone reads (goalReminders.ts's
  // goalNotifyTimes: a non-empty list wins outright and notifyAt is ignored),
  // so the legacy notifyAt mirror is re-derived from it on every write rather
  // than left to drift -- the same thing the app's updateGoal does.
  if (Array.isArray(updated.notifyTimes) && updated.notifyTimes.length > 0) {
    updated.notifyAt = updated.notifyTimes[0];
  }

  next[idx] = updated;
  return next;
}

/** Tombstones a goal in place (see the Goal shape comment on `archived`) --
 * never removes it from the array, so mergeGoals can still propagate the
 * delete to a side that hasn't seen it yet. Silent no-op for an unknown
 * `id`, same reasoning as updateGoal above. */
export function archiveGoal(goals, id, nowMs = Date.now()) {
  const idx = goals.findIndex((g) => g.id === id);
  if (idx === -1) return goals.slice();
  const next = goals.slice();
  next[idx] = { ...next[idx], archived: true, updatedAt: nowMs };
  return next;
}

/** Drops archived tombstones whose `updatedAt` (the archive itself bumps it,
 * per archiveGoal above, so this doubles as "how long ago it was archived")
 * is older than ARCHIVED_GOAL_PRUNE_MS. This is a client-side, on-write
 * prune -- callers run this on the array right before writing it back to
 * Firestore, not on every read, so a tombstone still gets its full
 * propagation window before it's dropped for good. */
export function pruneArchivedGoals(goals, nowMs = Date.now()) {
  return goals.filter((g) => !g.archived || nowMs - g.updatedAt <= ARCHIVED_GOAL_PRUNE_MS);
}

/** Validates+cleans an untrusted `goals` array read back from Firestore
 * (users/{uid}/goals/config) before anything else touches it -- the
 * untrusted-input boundary this repo's CLAUDE.md requires at every system
 * edge. Unlike createGoal/updateGoal (which throw on the first bad field, so
 * a form can show *why* it failed), this never throws: it drops any entry
 * whose id/period/topic/targetS doesn't fully check out (a malformed remote
 * entry is either a bug on the other writer or a tampered doc, and either
 * way there's no "correct" value to coerce those fields to), but repairs a
 * missing/malformed createdAt or updatedAt to `nowMs` and coerces any
 * non-`true` archived to `false` -- those three are recoverable defaults,
 * not structural problems.
 *
 * De-dupes by id: on a duplicate id, keeps whichever occurrence has the
 * greater `updatedAt` (a duplicate id is itself malformed input, not a
 * same-id-different-device case -- that's what mergeGoals below is for --
 * so "most recently edited" is the least-arbitrary tiebreak available), but
 * keeps it at the *first* occurrence's position in the output, so caps and
 * ordering below don't depend on where in the input array the newer
 * duplicate happened to land. Caps the result at MAX_GOALS, preserving
 * input order, so a bad or oversized remote doc can never make its way into
 * a local merge/render at more than this module's own limits allow. */
export function sanitizeRemoteGoals(input, nowMs = Date.now()) {
  if (!Array.isArray(input)) return [];
  const order = [];
  const byId = new Map();
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, period, targetS } = entry;
    if (typeof id !== 'string' || !id || id.length > MAX_GOAL_ID_LENGTH) continue;
    if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') continue;
    const topic = entry.topic === undefined ? null : entry.topic;
    if (topic !== null && (typeof topic !== 'string' || !topic.length || topic.length > MAX_TOPIC_LENGTH)) continue;
    const max = maxTargetSFor(period);
    if (!Number.isInteger(targetS) || targetS < MIN_TARGET_S || targetS > max) continue;

    // createdAt's fallback is nowMs -- it only affects display sort order, so
    // defaulting it "now" is safe. updatedAt's fallback is deliberately 0,
    // NOT nowMs: this value feeds mergeGoals' last-write-wins compare below,
    // and nowMs is the *largest* plausible clock value -- a clockless or
    // corrupt remote entry defaulted to nowMs would win an LWW compare
    // against every legitimate, older-but-real local edit. 0 makes a
    // malformed clock lose every real comparison instead.
    const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : nowMs;
    const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;

    // The four "flexible goals" extension fields, each hardened
    // independently -- confirmed against app/src/goals/goals.ts's own
    // sanitizeOneGoal: an invalid value for any ONE of these never rejects
    // the whole entry, it's simply dropped (comes back as `undefined`,
    // exactly the old-shape case). This is also what makes an old-shape
    // input -- one with none of these keys at all -- sail through
    // unchanged: every check below simply doesn't match.
    const daysOfWeek =
      period === 'daily' && Array.isArray(entry.daysOfWeek) && entry.daysOfWeek.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        ? normalizeDaysOfWeek(entry.daysOfWeek)
        : undefined;
    const targetSessions =
      typeof entry.targetSessions === 'number' &&
      Number.isInteger(entry.targetSessions) &&
      entry.targetSessions >= 1 &&
      entry.targetSessions <= MAX_TARGET_SESSIONS
        ? entry.targetSessions
        : undefined;
    const notify = entry.notify === true ? true : entry.notify === false ? false : undefined;
    const rawNotifyAt = typeof entry.notifyAt === 'string' && NOTIFY_AT_RE.test(entry.notifyAt) ? entry.notifyAt : undefined;

    // The multi-time reminder fields (app/src/goals/goalReminders.ts). This
    // dashboard does not yet EDIT them -- its own goal form still offers a
    // single reminder time -- but it must carry them through untouched:
    // this sanitizer rebuilds each goal from a fixed set of keys, so a field
    // it doesn't know about is silently dropped, and the dashboard would
    // then write the stripped copy back and collapse a phone-set multi-time
    // reminder down to one time on every sync. Preserving them here costs
    // nothing and is what keeps the two surfaces non-destructive to each
    // other, exactly as this file's header requires.
    const notifyTimes =
      Array.isArray(entry.notifyTimes)
        ? (() => {
            const kept = Array.from(
              new Set(entry.notifyTimes.filter((t) => typeof t === 'string' && NOTIFY_AT_RE.test(t))),
            ).sort().slice(0, MAX_NOTIFY_TIMES);
            return kept.length > 0 ? kept : undefined;
          })()
        : undefined;
    const notifyDays = Array.isArray(entry.notifyDays)
      ? normalizeDaysOfWeek(entry.notifyDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
      : undefined;
    const notifyOnlyIfBehind =
      entry.notifyOnlyIfBehind === true ? true : entry.notifyOnlyIfBehind === false ? false : undefined;
    // Mirrors goals.ts: the legacy single field is DERIVED from the list
    // whenever one survived, so the two can never disagree after a sync.
    const notifyAt = notifyTimes ? notifyTimes[0] : rawNotifyAt;

    const cleaned = {
      id,
      topic,
      period,
      targetS,
      createdAt,
      updatedAt,
      archived: entry.archived === true,
      ...(daysOfWeek !== undefined ? { daysOfWeek } : {}),
      ...(targetSessions !== undefined ? { targetSessions } : {}),
      ...(notify !== undefined ? { notify } : {}),
      ...(notifyAt !== undefined ? { notifyAt } : {}),
      ...(notifyTimes !== undefined ? { notifyTimes } : {}),
      ...(notifyDays !== undefined ? { notifyDays } : {}),
      ...(notifyOnlyIfBehind !== undefined ? { notifyOnlyIfBehind } : {}),
    };

    const existing = byId.get(id);
    if (!existing) {
      order.push(id);
    } else if (updatedAt <= existing.updatedAt) {
      continue; // older/equal duplicate -- keep what's already in byId
    }
    byId.set(id, cleaned);
  }
  return order.slice(0, MAX_GOALS).map((id) => byId.get(id));
}

function byCreatedThenId(a, b) {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Eviction ranking used only when a merged union exceeds MAX_GOALS (see
 * mergeGoals below) -- live goals outrank archived tombstones outright
 * (losing a tombstone early just means it propagates its delete to the
 * other side slightly later, which is harmless; losing a live goal outright
 * is not), then within the same archived status the more recently touched
 * entry outranks a staler one, then id breaks a true tie. Depends only on
 * each entry's own archived/updatedAt/id -- never on which side of the
 * merge it came from -- which is what makes mergeGoals(A, B) and
 * mergeGoals(B, A) always agree on *which ids* survive eviction. */
function evictionRank(a, b) {
  if (a.archived !== b.archived) return a.archived ? 1 : -1;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Per-goal last-write-wins union merge, confirmed against
 * app/src/goals/goalMerge.ts's own mergeGoals -- the same policy
 * app/src/sync/sessionMerge.ts uses for a session's topic, and
 * firestoreSync.ts's syncSettingsTwoWay uses at the whole-doc level, just
 * applied per-array-element here instead. `archived` is NOT special-cased:
 * it is resolved by the exact same updatedAt compare as every other field,
 * on the whole record -- a newer un-archive can resurrect a goal over an
 * older archive, and a newer archive can tombstone over an older live edit.
 * Seeds the result from `remote`, then overwrites with `local` whenever
 * `local.updatedAt >= existing.updatedAt` -- that `>=` is what gives an
 * equal-clock tie to local without a separate branch.
 *
 * Capped at MAX_GOALS after the union: two independently-capped
 * MAX_GOALS-sized sides can still union to more than MAX_GOALS distinct ids
 * (up to 2x, if disjoint), which firestore.rules' goals.size() <= 20 rule
 * would then reject outright on write -- so eviction has to happen here,
 * not just be left to the caller. evictionRank above decides what survives;
 * this ranking is deliberately independent of which array was passed as
 * `local` vs `remote`, so mergeGoals(A, B) and mergeGoals(B, A) keep the
 * identical set of ids (they can only still differ in which *copy* of a
 * shared id wins a genuine updatedAt tie, per the local-wins rule above).
 * The final createdAt-then-id display sort is applied strictly after
 * eviction, so sort order never influences which entries survive -- this is
 * the order mergedGoalsDocUpdatedAt and any "is a write worth making"
 * comparison should assume, not a display preference to be re-sorted away. */
export function mergeGoals(local, remote) {
  const byId = new Map();
  for (const g of remote) byId.set(g.id, g);
  for (const g of local) {
    const existing = byId.get(g.id);
    if (!existing || g.updatedAt >= existing.updatedAt) byId.set(g.id, g);
  }
  let merged = Array.from(byId.values());
  if (merged.length > MAX_GOALS) {
    merged = merged.sort(evictionRank).slice(0, MAX_GOALS);
  }
  return merged.sort(byCreatedThenId);
}

/** The doc-level clock to compare against what's already stored, to decide
 * whether writing `merged` back to Firestore is even worth it -- confirmed
 * against app/src/goals/goalMerge.ts's own mergedGoalsDocUpdatedAt. Not
 * called internally by mergeGoals; this is purely a helper for the
 * sync/write-back layer. The max of every merged goal's own `updatedAt` plus
 * both sides' whole-doc clocks -- falls back to
 * `Math.max(localDocUpdatedAt, remoteDocUpdatedAt)` when `merged` is empty. */
export function mergedGoalsDocUpdatedAt(merged, localDocUpdatedAt, remoteDocUpdatedAt) {
  let max = Math.max(localDocUpdatedAt, remoteDocUpdatedAt);
  for (const g of merged) if (g.updatedAt > max) max = g.updatedAt;
  return max;
}
