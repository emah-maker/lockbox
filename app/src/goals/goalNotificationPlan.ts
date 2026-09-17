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
import { shortDuration } from '../ui/time';

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

/**
 * How many goal reminders are ever handed to the OS at once.
 *
 * iOS keeps at most 64 PENDING local notifications per app and silently
 * drops everything past that, choosing the victims itself. Nothing bounded
 * this side: goalReminders.ts's MAX_NOTIFY_TIMES comment has always
 * acknowledged the 20 goals x 6 times x 7 days = 840 worst case, but
 * acknowledging it is not enforcing it, and far more ordinary settings
 * overflow too -- 10 goals x 2 times x 5 weekdays is 100 requests from a
 * form the user can fill in without doing anything unusual.
 *
 * Overflowing isn't merely "some goal reminders go missing". The 64 slots
 * are one shared budget: schedule/sessionReminderPlan.ts spends up to
 * MAX_SESSION_REMINDERS (24) of it on planned sessions, which are one-off
 * and time-critical in a way a recurring goal nudge is not -- a goal
 * reminder lost today comes round again tomorrow, a session reminder lost is
 * a session missed. 64 - 24 leaves 40 here, which is what this is. The two
 * constants are deliberately independent rather than imported from each
 * other (sessionReminderPlan already imports this module's isInQuietHours,
 * so a value import back would be a runtime cycle) -- the arithmetic between
 * them is asserted in goalNotificationPlan.test.ts. Change one, check both.
 */
export const MAX_GOAL_REMINDERS = 40;

/** Every request implied by a whole goal array -- archived goals dropped,
 * then flat-mapped through goalNotificationRequests. The one place the
 * per-goal progress lookup happens, so the scheduler doesn't have to know
 * the map's shape.
 *
 * Capped at MAX_GOAL_REMINDERS, and the SHAPE of that cut is the point. The
 * obvious implementation -- flatten, then take the first N -- spends the
 * whole budget on the first few goals and leaves the rest of the user's
 * goals silent, which reads as "reminders are broken" rather than "some
 * reminders were dropped". So an over-budget plan is filled round-robin
 * instead: every goal's first reminder, then every goal's second, and so on
 * until the budget runs out. Every goal that wanted a reminder keeps at
 * least one, and each keeps its earliest times first (goalNotifyTimes
 * returns them sorted), which is the only "soonest" a recurring calendar
 * trigger has without a clock this pure module deliberately doesn't read.
 *
 * Survivors come back in the original goal/time order, not round-robin
 * order, and the selection is a pure function of the goals -- both matter
 * because syncGoalNotifications reconciles by cancelling this feature's
 * whole prefix and rescheduling, so an unstable survivor set would churn the
 * OS queue on every progress tick. */
export function planGoalNotifications(
  goals: Goal[],
  prefs: NotificationPrefs,
  progressById: Map<string, GoalProgressSnapshot>,
  customLabels: CustomLabel[] = [],
): GoalNotificationRequest[] {
  const perGoal = goals
    .filter((g) => !g.archived)
    .map((g) => goalNotificationRequests(g, prefs, progressById.get(g.id), customLabels))
    .filter((requests) => requests.length > 0);

  const total = perGoal.reduce((n, requests) => n + requests.length, 0);
  if (total <= MAX_GOAL_REMINDERS) return perGoal.flat();

  const kept: GoalNotificationRequest[][] = perGoal.map(() => []);
  let budget = MAX_GOAL_REMINDERS;
  // `slot` is the index within each goal's own request list; the loop ends
  // when the budget is spent, which is guaranteed to happen before every
  // goal is exhausted because `total` is known to exceed the budget.
  for (let slot = 0; budget > 0; slot += 1) {
    for (let i = 0; i < perGoal.length && budget > 0; i += 1) {
      const request = perGoal[i][slot];
      if (!request) continue;
      kept[i].push(request);
      budget -= 1;
    }
  }
  return kept.flat();
}
