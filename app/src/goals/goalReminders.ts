// goalReminders.ts -- the reminder SCHEDULE half of the goal model: how a
// goal's `notify*` fields are validated, normalized, and read back. Split
// out of goals.ts rather than added to it for the plain reason goals.ts's
// own header gives about GoalForm/GoalsSection: goals.ts was already at 449
// lines and this project caps a file at 500, so the reminder-schedule rules
// (which grew from one optional 'HH:MM' string into a times list + its own
// weekday set + a progress-aware flag) get their own module instead of
// pushing that one past the line.
//
// Dependency-free in exactly the sense goals.ts's header means it -- no RN,
// no Firebase, no storage -- and it imports only TYPES from goals.ts, never
// values, so the two files don't form a runtime cycle and this one stays
// unit-testable on its own. goals.ts is still the only module that decides
// whether a whole Goal is acceptable; this one only owns the notify fields.
//
// Two validation paths, matching goals.ts's own established split:
//   - validate*  -- THROWS a caller-renderable Error, for a user-initiated
//     create/update (goals.ts's validateGoalExtras convention).
//   - sanitize*  -- never throws, drops what it can't trust and returns
//     `undefined`, for the untrusted-remote boundary (sanitizeOneGoal).
import type { GoalPeriod } from './goals';

/** 'HH:MM', strict 24h ranges (00-23 : 00-59). goals.ts keeps its own copy
 * of this literal (see its comment) and goalNotifications.ts re-derives a
 * third; all three are small, documented, and deliberately independent so
 * neither leaf module has to import the other. */
export const NOTIFY_AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** How many reminder times one goal may carry. Bounded because
 * goalNotifications.ts multiplies this by the goal's reminder weekdays (up
 * to 7) for every goal (up to goals.ts's MAX_GOALS = 20) when it schedules:
 * 6 x 7 x 20 = 840 worst-case local notifications, already well past what
 * iOS will actually keep (its own 64-per-app pending limit), so raising
 * this buys nothing real. Six distinct nudges a day is far more than any
 * reminder is useful at anyway. */
export const MAX_NOTIFY_TIMES = 6;

/** The notify-related fields this module reasons about, structurally rather
 * than as a whole `Goal` -- so a form's in-progress, not-yet-a-Goal values
 * can be passed straight in without being cast. */
export interface ReminderFields {
  period: GoalPeriod;
  daysOfWeek?: number[];
  notify?: boolean;
  /** Legacy single reminder time, still written by this app (as
   * `notifyTimes[0]`) and still the only field the website dashboard and
   * any pre-multi-time record knows about -- see goalNotifyTimes below for
   * how the two are reconciled on read. */
  notifyAt?: string;
  /** The canonical reminder-time list: sorted, deduped, 'HH:MM'. */
  notifyTimes?: string[];
  /** Which weekdays the reminders fire on, 0=Sun..6=Sat -- INDEPENDENT of
   * `daysOfWeek` (which is the goal's own "which days count toward the
   * target" restriction, daily-only). A user can want a Mon-Fri goal
   * nudged on Sunday evening to plan the week, or an every-day goal nudged
   * only on the days they keep forgetting. `undefined` means "follow the
   * goal's own schedule" -- see goalNotifyDays below for what that
   * resolves to per period. */
  notifyDays?: number[];
  /** Only send the reminder when the goal's current window is NOT already
   * met -- see goalNotifications.ts's syncGoalNotifications, which is what
   * actually skips scheduling for a met goal and re-reconciles whenever
   * progress changes. */
  notifyOnlyIfBehind?: boolean;
}

function isValidTime(t: unknown): t is string {
  return typeof t === 'string' && NOTIFY_AT_RE.test(t);
}

/** Sorted + deduped, so 'HH:MM' strings (which are zero-padded, and
 * therefore sort chronologically as plain strings) always land in one
 * canonical order regardless of the order the user picked them in. Capped
 * to MAX_NOTIFY_TIMES from the FRONT (earliest kept) rather than the back,
 * so an over-long list degrades to the earliest reminders of the day rather
 * than to an arbitrary tail. */
function canonicalize(times: string[]): string[] {
  return Array.from(new Set(times)).sort().slice(0, MAX_NOTIFY_TIMES);
}

/** Throwing validation for a user-initiated create/update, in goals.ts's
 * own caller-renderable-Error convention. Only the fields' own shapes are
 * checked here -- whether a reminder makes sense at all for the goal (it
 * always does; `notify: false` simply means nothing is scheduled) is not
 * this function's call. */
export function validateNotifySchedule(
  notifyTimes: string[] | undefined,
  notifyDays: number[] | undefined,
  notifyOnlyIfBehind: boolean | undefined,
): void {
  if (notifyTimes !== undefined) {
    if (!Array.isArray(notifyTimes) || !notifyTimes.every(isValidTime)) {
      throw new Error('Every reminder time must be a 24-hour "HH:MM" time.');
    }
    if (new Set(notifyTimes).size > MAX_NOTIFY_TIMES) {
      throw new Error(`A goal can have at most ${MAX_NOTIFY_TIMES} reminder times.`);
    }
  }
  if (notifyDays !== undefined) {
    if (!Array.isArray(notifyDays) || notifyDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new Error('Reminder days must be whole numbers 0-6 (0=Sun..6=Sat).');
    }
  }
  if (notifyOnlyIfBehind !== undefined && typeof notifyOnlyIfBehind !== 'boolean') {
    throw new Error('Goal notifyOnlyIfBehind must be true or false.');
  }
}

/** Canonical form for storage, or `undefined` for "nothing set" -- an empty
 * list collapses to `undefined` for exactly the reason goals.ts's
 * normalizeDaysOfWeek collapses an empty daysOfWeek: "no value" should have
 * one representation, not two. */
export function normalizeNotifyTimes(times: string[] | undefined): string[] | undefined {
  if (times === undefined) return undefined;
  const canonical = canonicalize(times.filter(isValidTime));
  return canonical.length > 0 ? canonical : undefined;
}

/** Same canonical shape as normalizeNotifyTimes, but for the untrusted
 * remote boundary: anything that isn't an array of well-formed 'HH:MM'
 * strings is dropped entry-by-entry rather than rejecting the whole goal
 * (goals.ts's sanitizeOneGoal makes the identical call for every other
 * extension field -- see its own comment on why a bad extension value
 * never nukes the record). */
export function sanitizeNotifyTimes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return normalizeNotifyTimes(raw.filter(isValidTime));
}

/** Same dropping-not-throwing treatment for a remote notifyDays. */
export function sanitizeNotifyDays(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kept = raw.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6);
  const unique = Array.from(new Set(kept)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : undefined;
}

/**
 * The reminder times a goal actually has, reconciling the multi-time
 * `notifyTimes` with the legacy single `notifyAt`. `notifyTimes` wins when
 * present; otherwise a lone `notifyAt` is read as a one-entry list, which
 * is what makes every goal written before multi-time reminders existed --
 * and every goal the website dashboard writes, since it only knows
 * `notifyAt` -- keep working with no migration step at all.
 *
 * Returns `[]` (never undefined) so callers can iterate unconditionally.
 * Does NOT consult `notify`: "which times are configured" and "are
 * reminders switched on" are deliberately separate questions, the same
 * separation Goal.notify's own comment draws.
 */
export function goalNotifyTimes(goal: ReminderFields): string[] {
  if (goal.notifyTimes && goal.notifyTimes.length > 0) return canonicalize(goal.notifyTimes.filter(isValidTime));
  return isValidTime(goal.notifyAt) ? [goal.notifyAt] : [];
}

/**
 * The weekdays a goal's reminders fire on, 0=Sun..6=Sat, or `null` for "no
 * weekday restriction -- every day".
 *
 * Precedence:
 *  1. An explicit `notifyDays` always wins -- it's the user saying, in the
 *     form, exactly which days to be nudged on.
 *  2. Otherwise a DAILY goal inherits its own `daysOfWeek` restriction:
 *     being reminded about a Mon/Wed/Fri goal on a Tuesday is noise, so
 *     "which days count" is the sensible default for "which days to nudge"
 *     when the user hasn't said otherwise. (This is exactly what
 *     goalNotifications.ts did unconditionally before `notifyDays`
 *     existed, preserved here as the default rather than as the rule.)
 *  3. A weekly/monthly goal has no weekday meaning of its own (its window
 *     spans the whole period -- goalProgress.ts's isGoalDueOn), so it falls
 *     through to null and goalNotifications.ts picks the window-start day.
 */
export function goalNotifyDays(goal: ReminderFields): number[] | null {
  if (goal.notifyDays && goal.notifyDays.length > 0) {
    return Array.from(new Set(goal.notifyDays)).sort((a, b) => a - b);
  }
  if (goal.period === 'daily' && goal.daysOfWeek && goal.daysOfWeek.length > 0) {
    return Array.from(new Set(goal.daysOfWeek)).sort((a, b) => a - b);
  }
  return null;
}

/** Minutes since local midnight for an 'HH:MM' string, or null if it isn't
 * one. The one place reminder times become comparable numbers -- used by
 * the quiet-hours check in goalNotifications.ts and by the form's own
 * display sort. */
export function notifyTimeToMinutes(time: string): number | null {
  const m = NOTIFY_AT_RE.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
