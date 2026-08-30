// sessionReminders.ts -- the IMPURE half of scheduled-session reminders:
// everything that actually touches expo-notifications. sessionReminderPlan.ts
// decides WHAT should be scheduled; this file owns only the native side of
// it, and is the ONLY place this feature's `fireAtMs` becomes a native DATE
// trigger.
//
// Every native call is individually wrapped, so a denial, a missing native
// module (Expo Go on Android, web, a simulator without notification
// capability), or any other native-side failure degrades to "nothing
// scheduled" -- never a thrown error, never a blocked UI. Same posture
// goalNotifications.ts's own header sets out, and for the same reason: a
// reminder is a nice-to-have layered on top of the plan itself, and the plan
// is still saved and still visible on the calendar either way.
//
// Reuses goalNotifications.ts's ensureNotificationSetup (the foreground
// presentation handler, which is app-global and idempotent) and its
// permission request rather than re-implementing either -- without that
// handler, a reminder that fires while the app is foregrounded is silently
// discarded, which is the exact bug that file's header documents. It does
// register its OWN Android channel: a session reminder is a different kind
// of interruption from a goal nudge, and channel importance/sound is
// per-channel user-configurable on Android, so sharing one channel would
// mean muting either mutes both.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { serializeLatest } from '../push/reconcileQueue';
import { ensureNotificationSetup, requestGoalNotificationPermission } from '../goals/goalNotifications';
import type { NotificationPrefs } from '../goals/goalNotificationPlan';
import { planSessionReminders, SESSION_NOTIF_ID_PREFIX } from './sessionReminderPlan';
import type { ScheduledSession } from './scheduledSessions';

const ANDROID_CHANNEL_ID = 'session-reminders';

let channelDone = false;

/** Registers this feature's own Android channel (see this file's header for
 * why it isn't the goal channel), on top of the app-global handler setup
 * goalNotifications.ts owns. Idempotent and wrapped -- on iOS and on any
 * runtime with no native module this is a no-op. */
async function ensureSessionChannel(): Promise<void> {
  await ensureNotificationSetup();
  if (channelDone || Platform.OS !== 'android') return;
  channelDone = true;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Scheduled focus sessions',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  } catch {
    // Scheduling will fall back to whatever default channel the platform
    // provides, or to nothing -- same degradation as everywhere else here.
  }
}

/** Cancels every notification THIS feature has ever scheduled (any
 * identifier starting with SESSION_NOTIF_ID_PREFIX) -- never a goal
 * reminder, and never anything else the app or OS might hold. Degrades to a
 * no-op on any native failure: if notifications aren't available here,
 * nothing was scheduled in the first place. */
async function cancelAllSessionReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter((n) => n.identifier.startsWith(SESSION_NOTIF_ID_PREFIX));
    await Promise.all(
      ours.map((n) =>
        Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {
          // One stale identifier failing shouldn't stop the rest -- the next
          // reconcile tries again anyway.
        }),
      ),
    );
  } catch {
    // No native module / nothing ever scheduled.
  }
}

/**
 * Reconciles the OS's pending session reminders with what `items` currently
 * imply: cancels everything this feature scheduled before, then re-schedules
 * the current plan from scratch.
 *
 * Cancel-then-reschedule rather than diffing against a persisted list, for
 * the same reasons syncGoalNotifications gives: the batch is small
 * (MAX_SESSION_REMINDERS = 24 native calls at the absolute worst), and this
 * module then carries no state of its own that could drift from what's
 * actually on the OS. It also means a plan that just went past its fire time
 * -- or got ticked done -- genuinely stops being pending on the very next
 * reconcile.
 *
 * Never prompts for permission when nothing wants a reminder: the
 * `length === 0` short-circuit comes before the permission call, so opening
 * the calendar can't interrupt someone who has never scheduled anything.
 * Never throws.
 *
 * Returns the plan ids this device now genuinely holds as local
 * notifications -- empty when nothing was scheduled, for ANY reason
 * (notifications off, permission denied, no native module, every plan in the
 * past). The caller reports that list to the push backend, which pushes only
 * what is NOT on it, so this return value has to describe what actually
 * happened rather than what was intended: over-reporting here would silence a
 * server-side reminder that the phone then never shows.
 */
export const syncSessionReminders = serializeLatest(async function syncSessionReminders(
  items: ScheduledSession[],
  prefs: NotificationPrefs,
  nowMs: number = Date.now(),
): Promise<string[]> {
  await cancelAllSessionReminders();

  const requests = planSessionReminders(items, prefs, nowMs);
  if (requests.length === 0) return [];

  // Ordered before the permission prompt so the handler/channel are in place
  // by the time the first reminder can possibly be delivered.
  await ensureSessionChannel();

  const granted = await requestGoalNotificationPermission();
  if (!granted) return [];

  // Collected from the individual results rather than assumed from
  // `requests`: a request whose schedule call rejected is NOT covered
  // locally, and reporting it as covered would suppress the server's copy
  // too, leaving that reminder with nowhere at all to come from.
  const scheduled: string[] = [];
  await Promise.all(
    requests.map((r) =>
      Notifications.scheduleNotificationAsync({
        identifier: r.identifier,
        content: {
          title: r.title,
          body: r.body,
          ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          // A Date, not epoch ms: the SDK accepts either, and passing the
          // Date makes the local-timezone reading explicit -- fireAtMs was
          // built from local Y/M/D + H:M (scheduledSessions.ts's
          // scheduledStartMs), never from a UTC-parsed date string.
          date: new Date(r.fireAtMs),
          ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
      })
        .then(() => {
          scheduled.push(r.planId);
        })
        .catch(() => {
          // One plan failing to schedule shouldn't take down the rest -- it
          // just doesn't join `scheduled`, so the backend still pushes it.
        }),
    ),
  );
  return scheduled;
});
