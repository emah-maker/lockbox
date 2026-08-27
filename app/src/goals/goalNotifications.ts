// goalNotifications.ts -- local (not push) notification scheduling for the
// per-goal reminder opt-in added by the "flexible goals" extension
// (Goal.notify/Goal.notifyAt, see goals.ts). Three layers, in ascending
// order of how much this file trusts the native module to exist and behave:
//
//   1. goalNotificationRequests -- PURE, dependency-free mapping from one
//      Goal to the local notification request(s) it implies (identifier,
//      copy, and a trigger DESCRIPTOR -- see GoalNotificationTrigger's own
//      comment for why that's a locally-defined shape rather than
//      expo-notifications' own SchedulableTriggerInput union). No import of
//      expo-notifications' VALUES, only -- when actually scheduling, below
//      -- its types; this half of the file is unit-testable with no native
//      module registered at all, the same "leaf module" reasoning
//      goals.ts's own header gives for staying dependency-free.
//   2. requestGoalNotificationPermission -- the one place this module
//      touches the native permission prompt.
//   3. syncGoalNotifications -- the impure reconciler useGoalsStore calls
//      after every mutation and after hydrate (see that file).
//
// Every native call in layers 2-3 is individually wrapped so a denial, a
// missing native module (Expo Go, a simulator without notification
// capability, web), or any other native-side failure degrades to "nothing
// scheduled" -- never a thrown error, never a blocked UI. This app runs in
// Expo Go and a dev-client build alike, and a focus-goal reminder is a
// nice-to-have layered on top of the goal itself, not something any other
// code path depends on succeeding -- same "never crash over this" posture
// auth/secureStorePersistence.ts's own probe-and-catch `_isAvailable` takes
// for a similarly optional platform capability.
import * as Notifications from 'expo-notifications';
import type { Goal, GoalPeriod } from './goals';

// Every identifier this module ever schedules starts with this prefix, and
// ONLY this module ever schedules anything with it -- syncGoalNotifications
// below uses the prefix to find and cancel exactly its own prior schedules
// on every reconcile, without needing to persist "what did I schedule last
// time" anywhere itself (see that function's own comment).
const NOTIF_ID_PREFIX = 'goal-notif:';

// 'HH:MM', strict 24h ranges (00-23 : 00-59) -- Goal.notifyAt's own shape
// (goals.ts's NOTIFY_AT_RE). Re-derived rather than imported: importing it
// would pull this leaf module into goals.ts's own import graph for a single
// regex literal, which isn't worth the coupling -- the two are kept in sync
// by inspection (both are small, both documented, and any drift would show
// up immediately as this module either rejecting every real notifyAt or
// accepting a shape goals.ts itself would have already rejected upstream).
const NOTIFY_AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * One local notification's trigger, described independently of
 * expo-notifications' own `SchedulableTriggerInput` union (DailyTriggerInput/
 * WeeklyTriggerInput/MonthlyTriggerInput) -- toNativeTrigger below is the
 * ONLY place this module maps into that union. Keeping this file's own
 * exported shape free of expo-notifications' types is what lets
 * goalNotificationRequests (the pure half of this module) stay importable
 * and testable in a plain jest environment with no native module
 * registered, without a test needing to know or care that expo-notifications
 * exists at all.
 *
 * `weekday` here is 0=Sun..6=Sat -- this app's one existing convention
 * (goals.ts's Goal.daysOfWeek, goalProgress.ts's isGoalDueOn, JS
 * `Date#getDay()`), NOT expo-notifications' own 1=Sun..7=Sat -- converted
 * only at the native boundary in toNativeTrigger, so every OTHER part of
 * this module (and its test) can reason in the one convention the rest of
 * the goals feature already uses.
 */
export type GoalNotificationTrigger =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'monthly'; day: number; hour: number; minute: number };

export interface GoalNotificationRequest {
  /** Stable for a given goal+trigger-shape combination (not random), so a
   * cancel-then-reschedule reconcile (syncGoalNotifications below) is
   * idempotent, and so every identifier this module ever hands to
   * expo-notifications carries the NOTIF_ID_PREFIX filter needs. */
  identifier: string;
  title: string;
  body: string;
  trigger: GoalNotificationTrigger;
}

function periodLabel(period: GoalPeriod): string {
  if (period === 'daily') return 'daily';
  if (period === 'weekly') return 'weekly';
  return 'monthly';
}

/** The notification copy for `goal` -- deliberately generic ("your focus
 * time", not a resolved topic label) rather than importing
 * stats/customLabels.ts's resolveTopic: that module drags in theme.ts and a
 * ResolvedTopic's measured text color, neither of which a plain reminder
 * string needs, and goals.ts's own header is explicit that this feature's
 * data-model-adjacent modules stay dependency-free of anything beyond the
 * goal model itself. A topic-specific goal still gets a slightly more
 * specific line using its raw topic id/string -- not as polished as the
 * resolved label, but accurate and free of that dependency chain. */
function contentFor(goal: Goal): { title: string; body: string } {
  const target = goal.topic === null ? 'your focus time' : `"${goal.topic}"`;
  return {
    title: 'Focus goal reminder',
    body: `Time to work toward ${target} -- your ${periodLabel(goal.period)} goal is waiting.`,
  };
}

/**
 * Pure mapping from one Goal to the local notification request(s) it
 * implies, given `goal.notify`/`goal.notifyAt`/`goal.period`/
 * `goal.daysOfWeek`. Returns `[]` whenever there's nothing to schedule:
 * `notify` is not `true`, `notifyAt` is unset, or (defensively) `notifyAt`
 * fails the "HH:MM" shape -- sanitizeRemoteGoals/createGoal/updateGoal
 * already guarantee a valid `notifyAt` for anything that reached this
 * function through the normal write paths, but this function doesn't
 * import goals.ts's validator (see NOTIFY_AT_RE's own comment on why), so it
 * re-checks defensively rather than trusting the caller.
 *
 * - `daily` with no `daysOfWeek` restriction (`undefined`/`[]`, matching
 *   Goal.daysOfWeek's own "every day" convention): one daily-repeating
 *   trigger.
 * - `daily` WITH a `daysOfWeek` restriction: one weekly-repeating trigger
 *   PER selected weekday, so e.g. a Mon/Wed/Fri goal only ever reminds on
 *   those three days, never the other four.
 * - `weekly`: one weekly-repeating trigger on Sunday -- this app's one
 *   first-day-of-week convention (goalProgress.ts's weeklyWindow) -- at the
 *   start of the goal's own window, as a "your week's goal starts now"
 *   nudge.
 * - `monthly`: one monthly-repeating trigger on the 1st, at the start of
 *   the goal's own window (goalProgress.ts's monthlyWindow), same reasoning
 *   as `weekly` above.
 */
export function goalNotificationRequests(goal: Goal): GoalNotificationRequest[] {
  if (!goal.notify || !goal.notifyAt) return [];
  const match = NOTIFY_AT_RE.exec(goal.notifyAt);
  if (!match) return [];
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const { title, body } = contentFor(goal);

  if (goal.period === 'daily' && goal.daysOfWeek && goal.daysOfWeek.length > 0) {
    return goal.daysOfWeek.map((weekday) => ({
      identifier: `${NOTIF_ID_PREFIX}${goal.id}:weekly:${weekday}`,
      title,
      body,
      trigger: { kind: 'weekly', weekday, hour, minute },
    }));
  }
  if (goal.period === 'daily') {
    return [{ identifier: `${NOTIF_ID_PREFIX}${goal.id}:daily`, title, body, trigger: { kind: 'daily', hour, minute } }];
  }
  if (goal.period === 'weekly') {
    return [
      { identifier: `${NOTIF_ID_PREFIX}${goal.id}:weekly:0`, title, body, trigger: { kind: 'weekly', weekday: 0, hour, minute } },
    ];
  }
  return [{ identifier: `${NOTIF_ID_PREFIX}${goal.id}:monthly`, title, body, trigger: { kind: 'monthly', day: 1, hour, minute } }];
}

/** Maps this module's own trigger descriptor to expo-notifications'
 * `SchedulableTriggerInput` union -- the ONLY place that union is
 * constructed, so every other function in this file stays free of it (see
 * GoalNotificationTrigger's own comment). The `weekday + 1` below is the
 * one unit conversion this module needs: expo-notifications' WeeklyTriggerInput
 * uses 1=Sunday..7=Saturday (per its own SDK docs), while this module's
 * descriptors use 0=Sunday..6=Saturday throughout, matching goals.ts's
 * Goal.daysOfWeek. */
function toNativeTrigger(trigger: GoalNotificationTrigger): Notifications.SchedulableNotificationTriggerInput {
  if (trigger.kind === 'daily') {
    return { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: trigger.hour, minute: trigger.minute };
  }
  if (trigger.kind === 'weekly') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: trigger.weekday + 1,
      hour: trigger.hour,
      minute: trigger.minute,
    };
  }
  return { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: trigger.day, hour: trigger.hour, minute: trigger.minute };
}

/**
 * Requests notification permission, degrading to `false` -- NEVER throwing
 * -- for every way this can fail to be granted: the user denies it, the
 * environment has no real notification capability to grant in the first
 * place (a simulator, certain Expo Go configurations), or any other
 * native-module error. Checks the current status first so a goal edit made
 * after the user already granted (or already denied) permission doesn't
 * re-prompt the OS every single time -- `getPermissionsAsync`/
 * `requestPermissionsAsync` are themselves safe to call repeatedly (the OS,
 * not this module, gates whether a prompt is actually shown again after a
 * denial), but there's no reason to make the extra native round-trip when
 * the answer is already known.
 */
export async function requestGoalNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    return requested.granted === true;
  } catch {
    return false;
  }
}

/** Cancels every notification this module has ever scheduled (any
 * identifier starting with NOTIF_ID_PREFIX) -- never anything else the app,
 * or the OS, might have scheduled outside this feature. Degrades to a
 * no-op on any native-module failure, same reasoning as
 * requestGoalNotificationPermission above: if notifications aren't
 * available in this environment, nothing was scheduled in the first place,
 * so there's nothing to clean up either. */
async function cancelAllGoalNotifications(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter((n) => n.identifier.startsWith(NOTIF_ID_PREFIX));
    await Promise.all(
      ours.map((n) =>
        Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {
          // One stale identifier failing to cancel shouldn't stop the rest
          // -- the next full reconcile will try again anyway.
        }),
      ),
    );
  } catch {
    // No native module / no permission ever granted -- nothing to cancel.
  }
}

/**
 * Reconciles the OS's scheduled local notifications with what `goals`
 * currently implies: cancels every notification this module previously
 * scheduled, then re-schedules the current set from scratch. Intended to be
 * called from useGoalsStore after every goal mutation and after hydrate
 * (see that file), so the OS's schedule always matches whatever's on
 * screen.
 *
 * Cancel-then-reschedule (rather than diffing against a persisted "what did
 * I schedule last time" list) is deliberately the simple option here:
 * goals.ts's MAX_GOALS caps this at 20 goals, each producing at most 7
 * trigger requests (a daily goal with every weekday selected), so the
 * entire reschedule is a small, cheap batch of native calls, and doing it
 * this way means this module carries no persisted state of its own that
 * could ever drift out of sync with what's actually on the OS.
 *
 * Never prompts for permission at all when NO goal currently wants a
 * reminder (`requests.length === 0` short-circuits before
 * requestGoalNotificationPermission is even called) -- there's no reason to
 * interrupt the user with a permission dialog for a capability nothing has
 * asked to use yet. Never throws: an environment with no notification
 * capability, or a user who denied the permission, just ends up scheduling
 * nothing (every native call is individually wrapped, here and in the two
 * helpers above) -- useGoalsStore fires this without a try/catch of its
 * own, same "never block the UI over this" convention
 * requestGoalNotificationPermission itself follows.
 */
export async function syncGoalNotifications(goals: Goal[]): Promise<void> {
  await cancelAllGoalNotifications();

  const requests = goals.filter((g) => !g.archived).flatMap((g) => goalNotificationRequests(g));
  if (requests.length === 0) return;

  const granted = await requestGoalNotificationPermission();
  if (!granted) return;

  await Promise.all(
    requests.map((r) =>
      Notifications.scheduleNotificationAsync({
        identifier: r.identifier,
        content: { title: r.title, body: r.body },
        trigger: toNativeTrigger(r.trigger),
      }).catch(() => {
        // One goal's trigger failing to schedule (e.g. a platform rejecting
        // a particular combination) shouldn't take down every other goal's
        // reminder -- each request is independent.
      }),
    ),
  );
}
