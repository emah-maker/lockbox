// goalNotifications.ts -- the IMPURE half of goal reminders: everything that
// actually touches expo-notifications. The decision of *what* should be
// scheduled is goalNotificationPlan.ts's job (pure, no native import); this
// file owns only the native side of it:
//
//   1. ensureNotificationSetup -- the presentation handler and the Android
//      channel. Without these a scheduled reminder is silently swallowed
//      (see that function's own comment); this is the piece that was
//      missing, and why reminders appeared to do nothing at all.
//   2. requestGoalNotificationPermission -- the one place this module
//      touches the native permission prompt.
//   3. syncGoalNotifications -- the reconciler called after every goal
//      mutation, after hydrate, and whenever progress or the global prefs
//      change (see goalNotificationBridge.ts).
//
// Every native call is individually wrapped so a denial, a missing native
// module (Expo Go on Android, a simulator without notification capability,
// web), or any other native-side failure degrades to "nothing scheduled" --
// never a thrown error, never a blocked UI. A focus-goal reminder is a
// nice-to-have layered on top of the goal itself, not something any other
// code path depends on succeeding: the same "never crash over this" posture
// auth/secureStorePersistence.ts takes for its own optional capability.
import * as Notifications from 'expo-notifications';
import { serializeLatest } from '../push/reconcileQueue';
import { cancelScheduledWithPrefix, scheduleLocalNotifications } from '../push/localNotifications';
import { Platform } from 'react-native';
import type { Goal } from './goals';
import type { CustomLabel } from '../stats/customLabels';
import {
  planGoalNotifications,
  NOTIF_ID_PREFIX,
  type GoalNotificationTrigger,
  type GoalProgressSnapshot,
  type NotificationPrefs,
} from './goalNotificationPlan';

// Re-exported so every existing importer of these (the store, the tests)
// keeps its original `from './goalNotifications'` path working even though
// the pure half now lives next door.
export {
  goalNotificationRequests,
  planGoalNotifications,
  allowedNotifyTimes,
  isInQuietHours,
  NOTIF_ID_PREFIX,
} from './goalNotificationPlan';
export type {
  GoalNotificationTrigger,
  GoalNotificationRequest,
  GoalProgressSnapshot,
  NotificationPrefs,
} from './goalNotificationPlan';

// Android requires an explicit channel for a notification to be presented at
// all; expo-notifications' fallback channel exists but gives no control over
// importance, so a reminder can land silently in a low-importance bucket.
const ANDROID_CHANNEL_ID = 'goal-reminders';

let setupDone = false;

/**
 * Registers the foreground presentation handler and (on Android) the
 * reminder channel. Idempotent and safe to call from anywhere -- the flag
 * makes repeat calls free, and every native call is wrapped.
 *
 * This is the fix for "the reminder does nothing": expo-notifications
 * DISCARDS a notification that fires while the app is in the foreground
 * unless a handler explicitly says to present it, and on Android a
 * notification with no channel of adequate importance never surfaces.
 * Nothing in this app had ever called either API, so a correctly scheduled
 * goal reminder could fire and still be invisible.
 *
 * Called from syncGoalNotifications (so it can never be forgotten on the
 * path that actually needs it) and once from App.tsx at startup (so a
 * reminder arriving before any goal mutation is still presentable).
 */
export async function ensureNotificationSetup(): Promise<void> {
  if (setupDone) return;
  setupDone = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        // The two legacy keys the SDK still reads on older runtimes -- kept
        // alongside the banner/list pair above so this behaves the same on
        // whichever of the two shapes the installed version expects.
        shouldShowAlert: true,
      }),
    });
  } catch {
    // No native module (Expo Go on Android, web) -- nothing to hook up.
  }
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Focus goal reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
      });
    } catch {
      // Same degradation as above -- scheduling will simply fall back to
      // whatever default channel the platform provides, or to nothing.
    }
  }
}

/** Maps the plan module's own trigger descriptor to expo-notifications'
 * `SchedulableTriggerInput` union -- the ONLY place that union is
 * constructed. The `weekday + 1` is the one unit conversion needed:
 * expo-notifications' WeeklyTriggerInput uses 1=Sunday..7=Saturday, while
 * every descriptor in this feature uses 0=Sunday..6=Saturday, matching
 * Goal.daysOfWeek. */
function toNativeTrigger(trigger: GoalNotificationTrigger): Notifications.SchedulableNotificationTriggerInput {
  // No Android channelId spread on any branch any more: push/
  // localNotifications.ts attaches it to every trigger it schedules, so the
  // platform check exists once instead of once per trigger shape.
  if (trigger.kind === 'daily') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: trigger.hour,
      minute: trigger.minute,
    };
  }
  if (trigger.kind === 'weekly') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: trigger.weekday + 1,
      hour: trigger.hour,
      minute: trigger.minute,
    };
  }
  return {
    type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
    day: trigger.day,
    hour: trigger.hour,
    minute: trigger.minute,
  };
}

/**
 * Requests notification permission, degrading to `false` -- NEVER throwing
 * -- for every way this can fail to be granted: the user denies it, the
 * environment has no real notification capability to grant (a simulator,
 * certain Expo Go configurations), or any other native-module error. Checks
 * the current status first so a goal edit made after the user already
 * granted (or already denied) permission doesn't make a pointless extra
 * native round-trip.
 */
export async function requestGoalNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return requested.granted === true;
  } catch {
    return false;
  }
}

/** The current permission state without ever prompting -- used by the
 * Settings > Notifications sheet to show an honest status row (and to decide
 * whether to offer a "Turn on notifications" button) instead of the user
 * having to guess why nothing arrives. `'unavailable'` covers an
 * environment with no native module at all, which is a genuinely different
 * answer from "denied" and reads differently in the UI. */
export async function getGoalNotificationPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (current.canAskAgain) return 'undetermined';
    return 'denied';
  } catch {
    return 'unavailable';
  }
}

/** Defaults matching NotificationPrefs' own "unrestricted" reading, so a
 * caller that doesn't care about global prefs (or a test) can still call
 * syncGoalNotifications with just an array, exactly as before. */
const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
};

/**
 * Reconciles the OS's scheduled local notifications with what `goals`
 * currently implies: cancels everything this feature scheduled before, then
 * re-schedules the current set from scratch.
 *
 * Cancel-then-reschedule (rather than diffing against a persisted "what did
 * I schedule last time" list) stays the simple, correct option: goals.ts's
 * MAX_GOALS caps this at 20 goals, each producing at most
 * MAX_NOTIFY_TIMES x 7 requests, so the whole reschedule is a small batch of
 * native calls -- and doing it this way means this module carries no
 * persisted state of its own that could drift from what's actually on the
 * OS. It also means a progress-aware goal that just got met has its
 * remaining nudges genuinely removed on the very next reconcile, rather than
 * lingering until tomorrow.
 *
 * Never prompts for permission when nothing wants a reminder
 * (`requests.length === 0` short-circuits before the permission call) --
 * there's no reason to interrupt the user for a capability nothing has asked
 * to use. Never throws: an environment with no notification capability, or a
 * user who denied the permission, just ends up scheduling nothing.
 */
export const syncGoalNotifications = serializeLatest(async function syncGoalNotifications(
  goals: Goal[],
  prefs: NotificationPrefs = DEFAULT_PREFS,
  progressById: Map<string, GoalProgressSnapshot> = new Map(),
  customLabels: CustomLabel[] = [],
): Promise<void> {
  // Cancels only this feature's own identifiers -- never a session
  // reminder, never anything else the app or OS holds.
  await cancelScheduledWithPrefix(NOTIF_ID_PREFIX);

  const requests = planGoalNotifications(goals, prefs, progressById, customLabels);
  if (requests.length === 0) return;

  // Ordered before the permission prompt so the handler/channel are in place
  // by the time the very first notification can possibly be delivered.
  await ensureNotificationSetup();

  const granted = await requestGoalNotificationPermission();
  if (!granted) return;

  // Which requests landed is not tracked here, unlike sessionReminders:
  // goal reminders have no server-side counterpart whose duplicate this
  // would need to suppress. Per-request failures are swallowed inside
  // scheduleLocalNotifications, so one goal's trigger being rejected can't
  // take down every other goal's reminder.
  await scheduleLocalNotifications(
    requests.map((r) => ({
      identifier: r.identifier,
      title: r.title,
      body: r.body,
      trigger: toNativeTrigger(r.trigger),
    })),
    ANDROID_CHANNEL_ID,
  );
});
