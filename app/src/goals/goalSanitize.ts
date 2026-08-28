// goalSanitize.ts -- the untrusted-input boundary for the goal model:
// sanitizeRemoteGoals (and its per-entry sanitizeOneGoal) hardens an
// arbitrary array -- a Firestore `goals` pull, or anything the website
// dashboard might have written -- into a Goal[] that goals.ts and
// goalProgress.ts can trust.
//
// Split out of goals.ts, which owns the *authoring* half (createGoal/
// updateGoal/archiveGoal and their throwing validators). The two halves
// answer genuinely different questions -- "is this edit acceptable, and what
// do I tell the user if not" vs. "what, if anything, of this foreign blob is
// salvageable" -- and goals.ts had grown past this project's 500-line file
// guideline once the reminder-schedule fields landed. goals.ts re-exports
// sanitizeRemoteGoals so every existing `from './goals'` import keeps
// working unchanged.
//
// The dropping-not-throwing discipline here is deliberate and is documented
// per-field below: an invalid EXTENSION field never rejects the whole goal,
// while an unusable identity field (id/topic/period/targetS) does, because
// there is no safe default for "which goal is this" or "what does it
// target".
import {
  Goal,
  MAX_GOALS,
  MAX_GOAL_ID_LENGTH,
  MAX_TOPIC_LENGTH,
  MAX_TARGET_SESSIONS,
  MIN_TARGET_S,
  NOTIFY_AT_RE,
  maxTargetSFor,
  normalizeDaysOfWeek,
} from './goals';
import { sanitizeNotifyTimes, sanitizeNotifyDays } from './goalReminders';

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

  const rawNotifyAt = typeof raw.notifyAt === 'string' && NOTIFY_AT_RE.test(raw.notifyAt) ? raw.notifyAt : undefined;
  // Same per-field drop-don't-reject treatment as the four above. The
  // website dashboard writes only `notifyAt`, so a doc it wrote arrives here
  // with notifyTimes absent -- which is exactly the fallback goalNotifyTimes
  // already handles, no migration needed.
  const notifyTimes = sanitizeNotifyTimes(raw.notifyTimes);
  const notifyDays = sanitizeNotifyDays(raw.notifyDays);
  const notifyOnlyIfBehind = raw.notifyOnlyIfBehind === true ? true : raw.notifyOnlyIfBehind === false ? false : undefined;
  // The legacy mirror is re-derived rather than trusted whenever a list
  // survived sanitizing, so a remote doc whose two fields disagree (a
  // dashboard edit to notifyAt racing an app edit to notifyTimes) resolves
  // the same deterministic way every local write already does.
  const notifyAt = notifyTimes ? notifyTimes[0] : rawNotifyAt;

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
    ...(notifyTimes !== undefined ? { notifyTimes } : {}),
    ...(notifyDays !== undefined ? { notifyDays } : {}),
    ...(notifyOnlyIfBehind !== undefined ? { notifyOnlyIfBehind } : {}),
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
