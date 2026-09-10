// sessionReminderPlan.ts -- the PURE half of scheduled-session reminders:
// given the planned sessions, the user's global notification preferences and
// the current time, decide exactly which one-off local notifications should
// exist. No expo-notifications import (not even its types), no store read,
// no Date.now() of its own -- `nowMs` is a parameter, so this is testable in
// a plain jest environment with no native module registered. Exactly the
// division goals/goalNotificationPlan.ts has with goalNotifications.ts.
//
// The one thing that genuinely differs from the goal planner: a goal's
// reminder is RECURRING (a daily/weekly/monthly trigger the OS repeats),
// whereas a planned session's reminder happens once, at an absolute moment.
// That's why this module produces a `fireAtMs` rather than one of
// goalNotificationPlan's calendar-trigger descriptors, and why it has to
// know what time it is at all: a one-off already in the past must never be
// handed to the OS (iOS silently drops it; Android may deliver it
// immediately, which is worse -- a reminder for a session you planned last
// Tuesday arriving now).
import { formatClockTime, shortDuration } from '../ui/time';
import { isInQuietHours, type NotificationPrefs } from '../goals/goalNotificationPlan';
import { reminderFireMs, scheduledStartMs, type ScheduledSession } from './scheduledSessions';

// Every identifier this feature schedules starts with this prefix, and ONLY
// this feature schedules anything with it -- the reconciler uses it to find
// and cancel exactly its own prior schedules without persisting a "what did
// I schedule last time" list. Deliberately distinct from
// goalNotificationPlan's NOTIF_ID_PREFIX ('goal-notif:'), so neither
// feature's cancel sweep can ever collect the other's pending reminders.
export const SESSION_NOTIF_ID_PREFIX = 'session-notif:';

/**
 * How many upcoming session reminders are ever handed to the OS at once.
 *
 * iOS caps an app at 64 PENDING local notifications and silently drops the
 * rest -- a limit goal reminders already spend against from the same budget
 * (goals.ts's MAX_GOALS x MAX_NOTIFY_TIMES x 7 can exceed it on its own).
 * Since a planned session is inherently near-term, taking the SOONEST N and
 * dropping the far-future tail is the right shape of loss: those get picked
 * up on a later reconcile, long before they're due. Well under
 * scheduledSessions.ts's own MAX_SCHEDULED_SESSIONS on purpose -- that cap
 * bounds the DATA, this one bounds what the OS is asked to hold.
 */
export const MAX_SESSION_REMINDERS = 24;

/** One planned session's reminder, described independently of
 * expo-notifications' own trigger union -- sessionReminders.ts is the ONLY
 * place `fireAtMs` becomes a native DATE trigger, the same boundary
 * goalNotifications.ts's toNativeTrigger owns for the goal side. */
export interface SessionReminderRequest {
  /** Stable for a given plan + fire time (never random), so a
   * cancel-then-reschedule reconcile is idempotent, and so every identifier
   * carries the prefix the cancel filter needs. The fire time is part of the
   * id so an edited plan can't collide with its own previous schedule. */
  identifier: string;
  /** The ScheduledSession this request came from. Carried separately from
   * `identifier` (which encodes it, but as a string that would have to be
   * parsed back out) because the caller reports exactly these ids to the
   * push backend as "already covered locally, don't push these" -- see
   * push/pushRegistration.ts's reportLocalCoverage. */
  planId: string;
  title: string;
  body: string;
  /** Absolute local epoch ms. Always strictly in the future relative to the
   * `nowMs` this plan was built with. */
  fireAtMs: number;
}

/** Reminder copy. Says WHEN the session starts rather than "now", because
 * the whole point of `leadMinutes` is that this arrives early -- a body
 * reading "time to focus" when the session is 30 minutes away would be
 * actively misleading. The note (if any) leads, since that's the user's own
 * words for what this session is for, and it's the thing that actually makes
 * the reminder actionable. */
function contentFor(item: ScheduledSession, lead: number): { title: string; body: string } {
  const when = formatClockTime(item.time);
  const what = item.note ? `${item.note} -- ` : '';
  const duration = item.plannedS ? ` (${shortDuration(item.plannedS)})` : '';
  return {
    title: lead === 0 ? 'Focus session now' : `Focus session in ${lead === 60 ? '1 hour' : `${lead} min`}`,
    body: `${what}${lead === 0 ? 'Starting' : 'Starts'} at ${when}${duration}. Time to box your phone.`,
  };
}

/** What a reconcile pass concluded about the current plans: what to hand the
 * OS, and what was deliberately silenced. Both halves matter to the caller,
 * because the push backend pushes exactly what no device reports handling --
 * see `quietHoursSuppressed`. */
export interface SessionReminderPlan {
  requests: SessionReminderRequest[];
  /**
   * Plan ids dropped for landing inside quiet hours -- and ONLY for that.
   *
   * Reported to the push backend as "do not push these here" alongside the
   * ones actually scheduled (push/pushRegistration.ts's reportLocalCoverage).
   * Without it, quiet hours had the exact opposite of their effect: a
   * reminder suppressed locally is by definition one this device does not
   * report covering, and an uncovered reminder is what sendDueReminders
   * exists to deliver -- so the 06:40 reminder the user silenced arrived at
   * 06:40 as a push instead. A local drop the server doesn't know about is
   * not silence, it is a handoff.
   *
   * Ids only, never the whole plan: this list is written to a Firestore
   * document a rule caps at 50 entries, and it is capped at
   * MAX_SESSION_REMINDERS soonest-first for the same reason `requests` is.
   * Suppressed plans further out than that are not near enough to be due
   * before the next reconcile rewrites this list.
   */
  quietHoursSuppressed: string[];
}

/**
 * Which one-off reminders should currently exist.
 *
 * A plan is skipped when any of these hold -- each is a deliberate drop, not
 * a shift:
 *   1. The global notification switch is off (same master-switch semantics
 *      goalNotificationPlan applies -- it overrides every per-item setting).
 *   2. The plan is ticked done, or is malformed enough that its start time
 *      doesn't parse.
 *   3. Its fire time has already passed. See this file's header for why a
 *      past one-off is worse than useless.
 *   4. Its fire time lands inside quiet hours. Dropped rather than moved,
 *      matching the goal side exactly: a reminder silently relocated to a
 *      time the user never picked is more confusing than one that doesn't
 *      arrive, and the form warns about it up front. Unlike the other three,
 *      this drop is REPORTED -- see SessionReminderPlan.quietHoursSuppressed
 *      for why silence has to be told to the server to actually be silence.
 *
 * The survivors are sorted soonest-first and capped at
 * MAX_SESSION_REMINDERS.
 */
export function planSessionReminders(
  items: ScheduledSession[],
  prefs: NotificationPrefs,
  nowMs: number,
): SessionReminderPlan {
  // The master switch is NOT reported as suppression. It is handled one level
  // up by removing this device's push token entirely
  // (push/pushRegistration.ts): "notify me for none of my 200 plans" is a
  // property of the device, and expressing it as a list of plan ids would
  // both overflow the 50-entry cap on that list and re-state it once per
  // plan.
  if (!prefs.enabled) return { requests: [], quietHoursSuppressed: [] };

  const requests: SessionReminderRequest[] = [];
  // Kept with their fire times so this can be sorted soonest-first like
  // `requests`, then reduced to bare ids on the way out.
  const suppressed: { planId: string; fireAtMs: number }[] = [];
  for (const item of items) {
    if (item.done) continue;
    const startMs = scheduledStartMs(item);
    if (!Number.isFinite(startMs)) continue;
    const fireAtMs = reminderFireMs(item);
    // A plan whose moment has already passed is not "suppressed" -- there is
    // nothing left to suppress, and the backend's own grace window has the
    // same view of it. Only a future reminder the user silenced counts.
    if (!(fireAtMs > nowMs)) continue;

    if (prefs.quietHoursEnabled && isInQuietHours(fireTimeOfDay(fireAtMs), prefs.quietStart, prefs.quietEnd)) {
      suppressed.push({ planId: item.id, fireAtMs });
      continue;
    }

    const { title, body } = contentFor(item, item.leadMinutes);
    requests.push({
      identifier: `${SESSION_NOTIF_ID_PREFIX}${item.id}:${fireAtMs}`,
      planId: item.id,
      title,
      body,
      fireAtMs,
    });
  }

  return {
    requests: requests.sort((a, b) => a.fireAtMs - b.fireAtMs).slice(0, MAX_SESSION_REMINDERS),
    quietHoursSuppressed: suppressed
      .sort((a, b) => a.fireAtMs - b.fireAtMs)
      .slice(0, MAX_SESSION_REMINDERS)
      .map((x) => x.planId),
  };
}

/** The 'HH:MM' local clock time of an absolute moment -- the shape
 * isInQuietHours takes. Needed because a reminder's own time-of-day is
 * `leadMinutes` before the SESSION's, so it can fall inside quiet hours even
 * when the session itself doesn't (an 07:10 session with a 30-minute lead
 * fires at 06:40, inside a 22:00-07:00 quiet window). */
export function fireTimeOfDay(fireAtMs: number): string {
  const d = new Date(fireAtMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Whether this plan's reminder would currently be suppressed by quiet
 * hours -- the exact same check planSessionReminders applies, exported so
 * the form can warn about it BEFORE the user saves rather than leaving them
 * to discover a reminder that silently never arrives (the same warning
 * GoalReminderControl.tsx shows for a goal's reminder times). */
export function reminderFallsInQuietHours(
  item: Pick<ScheduledSession, 'date' | 'time' | 'leadMinutes'>,
  prefs: Pick<NotificationPrefs, 'quietHoursEnabled' | 'quietStart' | 'quietEnd'>,
): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const fireAtMs = reminderFireMs(item);
  if (!Number.isFinite(fireAtMs)) return false;
  return isInQuietHours(fireTimeOfDay(fireAtMs), prefs.quietStart, prefs.quietEnd);
}
