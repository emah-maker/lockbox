// goalNotificationPlan.ts -- the PURE half of goal reminders: given some
// goals, their current progress, and the user's global notification
// preferences, decide exactly which local notifications should exist. No
// import of expo-notifications at all (not even its types), no store reads,
// no Date.now() of its own -- every time-dependent input is a parameter, so
// this is unit-testable in a plain jest environment with no native module
// registered, the same "leaf module" discipline goals.ts's header describes.
//
// goalNotifications.ts is the impure counterpart: it owns the permission
// prompt, the notification handler/channel setup, and the actual
// cancel/schedule calls, and it re-exports goalNotificationRequests from
// here so that function's original import path keeps working.
//
// Three things decide whether a given goal-time pair becomes a request:
//   1. The goal itself wants reminders (`notify`) and has at least one
//      reminder time (goalReminders.ts's goalNotifyTimes).
//   2. Global preferences allow it -- the master switch is on, and the time
//      doesn't land inside quiet hours.
//   3. Progress allows it -- a `notifyOnlyIfBehind` goal whose current
//      window is already met is skipped entirely.
import type { Goal, GoalPeriod } from './goals';
import { goalNotifyTimes, goalNotifyDays, notifyTimeToMinutes } from './goalReminders';
// Name-only, so this leaf still needs no ThemeMode and does no color math
// -- see topicDisplayName's own comment. The chain it pulls in
// (topics.ts -> theme/color.ts) is pure TypeScript with no react-native
// import anywhere in it, so this stays as unit-testable as it was.
import { topicDisplayName, type CustomLabel } from '../stats/customLabels';

// Every identifier this feature ever schedules starts with this prefix, and
// ONLY this feature schedules anything with it -- syncGoalNotifications uses
// the prefix to find and cancel exactly its own prior schedules on every
// reconcile, without persisting "what did I schedule last time" anywhere.
export const NOTIF_ID_PREFIX = 'goal-notif:';

/**
 * One local notification's trigger, described independently of
 * expo-notifications' own `SchedulableTriggerInput` union --
 * goalNotifications.ts's toNativeTrigger is the ONLY place this maps into
 * that union. Keeping this module's exported shape free of
 * expo-notifications' types is what lets it stay importable and testable
 * with no native module registered.
 *
 * `weekday` here is 0=Sun..6=Sat -- this app's one existing convention
 * (Goal.daysOfWeek, goalProgress.ts's isGoalDueOn, JS `Date#getDay()`), NOT
 * expo-notifications' own 1=Sun..7=Sat, which is converted only at the
 * native boundary.
 */
export type GoalNotificationTrigger =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'monthly'; day: number; hour: number; minute: number };

export interface GoalNotificationRequest {
  /** Stable for a given goal + trigger-shape + time combination (never
   * random), so a cancel-then-reschedule reconcile is idempotent, and so
   * every identifier carries the NOTIF_ID_PREFIX the cancel filter needs.
   * The time is part of the id because one goal can now carry several
   * reminder times, which would otherwise collide on a single id and leave
   * only the last one actually scheduled. */
  identifier: string;
  title: string;
  body: string;
  trigger: GoalNotificationTrigger;
}

/** The user's global (not per-goal) notification preferences -- owned by
 * useSettingsStore, passed in rather than read, same reason nothing else in
 * this module reads a store. */
export interface NotificationPrefs {
  /** Master switch. `false` means this module plans nothing at all,
   * regardless of any individual goal's own `notify`. */
  enabled: boolean;
  /** When true, a reminder whose time falls inside [quietStart, quietEnd)
   * is dropped rather than shifted. Dropping (not moving) is deliberate: a
   * reminder silently relocated to a time the user never picked is more
   * confusing than one that simply doesn't fire, and the form shows which
   * times are affected (see NotifyControl's quiet-hours hint). */
  quietHoursEnabled: boolean;
  /** 'HH:MM' local. A range that wraps past midnight (22:00 -> 07:00) is
   * supported and is in fact the common case -- see isInQuietHours. */
  quietStart: string;
  quietEnd: string;
}

/** What this module needs to know about a goal's CURRENT window progress to
 * apply `notifyOnlyIfBehind` and to write a progress-aware body. Supplied by
 * the caller from goalProgress.ts's computeGoalProgress -- this module never
 * recomputes goal math, the same restriction idleRingState.ts operates
 * under. A goal with no entry is treated as "progress unknown", which reads
 * as not-met (schedule it) and gets the generic body. */
export interface GoalProgressSnapshot {
  met: boolean;
  remainingS: number;
}

function periodLabel(period: GoalPeriod): string {
  if (period === 'daily') return 'daily';
  if (period === 'weekly') return 'weekly';
  return 'monthly';
}

/** Short "1h 20m" / "45m" phrasing for a reminder body. A local copy rather
 * than an import of stats/stats.ts's formatDuration, for the same reason
 * contentFor below doesn't import resolveTopic: that module drags in a
 * dependency chain this leaf deliberately doesn't have, and a reminder
 * string needs only this much. */
function shortDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** Reminder copy for `goal`. Deliberately generic about the topic ("your
 * focus time", or the raw topic string) rather than importing
 * stats/customLabels.ts's resolveTopic, which drags in theme.ts and a
 * measured text color that a plain reminder string doesn't need.
 *
 * When a progress snapshot is available the body says how much is actually
 * left -- that's the whole point of a progress-aware nudge, and it's the
 * same number the goal's own row shows ("40m to go"), never a second
 * computation of it. Without a snapshot it falls back to the original
 * generic line. */
function contentFor(
  goal: Goal,
  progress: GoalProgressSnapshot | undefined,
  customLabels: CustomLabel[],
): { title: string; body: string } {
  // `goal.topic` is an ID, not a name. Interpolating it raw put
  // `custom:mf3k2xa9b1` in the body of every reminder for a custom label --
  // the user's own label, rendered as the internal string it is keyed by.
  // Built-in topics merely read lowercase ("work"); a custom label read as
  // garbage. A goal whose label was since deleted has no name left to show,
  // so it falls back to the same generic wording an untagged goal uses
  // rather than naming something the user removed.
  const name = topicDisplayName(goal.topic, customLabels);
  const target = name === null ? 'your focus time' : `"${name}"`;
  if (progress && !progress.met && progress.remainingS > 0) {
    return {
      title: 'Focus goal reminder',
      body: `${shortDuration(progress.remainingS)} left on your ${periodLabel(goal.period)} goal for ${target}.`,
    };
  }
  return {
    title: 'Focus goal reminder',
    body: `Time to work toward ${target} -- your ${periodLabel(goal.period)} goal is waiting.`,
  };
}

/**
 * Whether `time` ('HH:MM') falls inside the quiet-hours range. Handles both
 * an ordinary same-day range (09:00 -> 17:00: inside means start <= t < end)
 * and one that WRAPS past midnight (22:00 -> 07:00: inside means t >= start
 * OR t < end), which is what quiet hours almost always are.
 *
 * A degenerate range where start === end is treated as "no quiet hours at
 * all" rather than "the whole day is quiet" -- silently suppressing every
 * reminder a user had configured is much worse than ignoring a range they
 * probably set by accident.
 */
export function isInQuietHours(time: string, quietStart: string, quietEnd: string): boolean {
  const t = notifyTimeToMinutes(time);
  const start = notifyTimeToMinutes(quietStart);
  const end = notifyTimeToMinutes(quietEnd);
  if (t === null || start === null || end === null) return false;
  if (start === end) return false;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/** Every reminder time on `goal` that the global prefs actually permit --
 * exported because the goal form uses the same function to mark which of the
 * user's chosen times are currently being suppressed, so the UI's warning
 * and the scheduler's behavior can never disagree. */
export function allowedNotifyTimes(goal: Goal, prefs: NotificationPrefs): string[] {
  const times = goalNotifyTimes(goal);
  if (!prefs.quietHoursEnabled) return times;
  return times.filter((t) => !isInQuietHours(t, prefs.quietStart, prefs.quietEnd));
}

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
};

/**
 * Pure mapping from one Goal to the local notification request(s) it
 * implies. Returns `[]` whenever there's nothing to schedule: reminders are
 * globally off, `notify` isn't true, no valid reminder time is configured,
 * every configured time is inside quiet hours, or the goal is
 * `notifyOnlyIfBehind` and its current window is already met.
 *
 * Per reminder time, the trigger shape follows the goal's reminder weekdays
 * (goalReminders.ts's goalNotifyDays):
 *  - Reminder weekdays present (an explicit `notifyDays`, or a daily goal's
 *    own `daysOfWeek` restriction inherited as the default): one
 *    weekly-repeating trigger PER selected weekday, so a Mon/Wed/Fri goal
 *    never nudges on the other four days.
 *  - No weekday restriction, daily goal: one daily-repeating trigger.
 *  - No weekday restriction, weekly goal: one weekly trigger on Sunday --
 *    this app's one first-day-of-week convention (goalProgress.ts's
 *    weeklyWindow) -- at the start of the goal's own window.
 *  - No weekday restriction, monthly goal: one monthly trigger on the 1st,
 *    at the start of its window (goalProgress.ts's monthlyWindow).
 *
 * `prefs`/`progress` both default to "unrestricted / unknown", which is
 * exactly the pre-existing behavior -- that's what keeps this function's
 * original one-argument call shape (and its existing tests) working.
 */
export function goalNotificationRequests(
  goal: Goal,
  prefs: NotificationPrefs = DEFAULT_PREFS,
  progress?: GoalProgressSnapshot,
  customLabels: CustomLabel[] = [],
): GoalNotificationRequest[] {
  if (!prefs.enabled) return [];
  if (!goal.notify) return [];
  // A goal that only wants nudging when it's behind, and isn't behind, is
  // the one case where having a perfectly valid reminder time still
  // schedules nothing. Re-evaluated on every reconcile, so finishing a
  // goal mid-day actually cancels the rest of today's nudges rather than
  // waiting until tomorrow.
  if (goal.notifyOnlyIfBehind && progress?.met) return [];

  const times = allowedNotifyTimes(goal, prefs);
  if (times.length === 0) return [];

  const { title, body } = contentFor(goal, progress, customLabels);
  const weekdays = goalNotifyDays(goal);
  const requests: GoalNotificationRequest[] = [];

  for (const time of times) {
    const minutes = notifyTimeToMinutes(time);
    if (minutes === null) continue; // goalNotifyTimes already filtered these, but this stays defensive
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    // The time is part of every identifier below -- see
    // GoalNotificationRequest.identifier for why a multi-time goal would
    // otherwise collapse to one surviving schedule.
    const slot = time.replace(':', '');

    if (weekdays && weekdays.length > 0) {
      for (const weekday of weekdays) {
        requests.push({
          identifier: `${NOTIF_ID_PREFIX}${goal.id}:weekly:${weekday}:${slot}`,
          title,
          body,
          trigger: { kind: 'weekly', weekday, hour, minute },
        });
      }
      continue;
    }
    if (goal.period === 'daily') {
      requests.push({
        identifier: `${NOTIF_ID_PREFIX}${goal.id}:daily:${slot}`,
        title,
        body,
        trigger: { kind: 'daily', hour, minute },
      });
    } else if (goal.period === 'weekly') {
      requests.push({
        identifier: `${NOTIF_ID_PREFIX}${goal.id}:weekly:0:${slot}`,
        title,
        body,
        trigger: { kind: 'weekly', weekday: 0, hour, minute },
      });
    } else {
      requests.push({
        identifier: `${NOTIF_ID_PREFIX}${goal.id}:monthly:${slot}`,
        title,
        body,
        trigger: { kind: 'monthly', day: 1, hour, minute },
      });
    }
  }

  return requests;
}

/** Every request implied by a whole goal array -- archived goals dropped,
 * then flat-mapped through goalNotificationRequests. The one place the
 * per-goal progress lookup happens, so the scheduler doesn't have to know
 * the map's shape. */
export function planGoalNotifications(
  goals: Goal[],
  prefs: NotificationPrefs,
  progressById: Map<string, GoalProgressSnapshot>,
  customLabels: CustomLabel[] = [],
): GoalNotificationRequest[] {
  return goals
    .filter((g) => !g.archived)
    .flatMap((g) => goalNotificationRequests(g, prefs, progressById.get(g.id), customLabels));
}
