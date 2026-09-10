// localNotifications.ts -- the two expo-notifications calls that goal
// reminders and scheduled-session reminders were each making for themselves.
//
// goals/goalNotifications.ts and schedule/sessionReminders.ts are deliberately
// separate features: separate planners, separate id prefixes, separate Android
// channels (channel importance is per-channel user-configurable, so sharing
// one would mean muting either mutes both). What they are NOT separate about
// is how a planned request becomes a native scheduled notification, or how a
// feature cancels only its own. Both had a byte-identical
// cancel-everything-with-my-prefix loop, and both built the same
// `{ identifier, content: { title, body, channelId }, trigger }` payload with
// the same `Platform.OS === 'android'` channel spread repeated per trigger
// shape -- five copies of that one conditional between them.
//
// Lives in push/ rather than in either feature because both already import
// push/reconcileQueue's serializeLatest, so this is the directory that
// already holds the notification plumbing neither feature owns.
//
// Every native call is individually wrapped: a denial, a missing native
// module (Expo Go on Android, web, a simulator without notification
// capability), or any other native-side failure degrades to "nothing
// scheduled" -- never a thrown error. Same posture both callers' own headers
// set out.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** One planned notification, in the shape both features' planners already
 * produce -- minus the Android channel, which is this module's job to attach
 * so no caller has to remember the platform check. */
export interface LocalNotificationRequest {
  identifier: string;
  title: string;
  body: string;
  trigger: Notifications.SchedulableNotificationTriggerInput;
}

/**
 * Cancels every scheduled notification whose identifier starts with
 * `prefix` -- never another feature's, and never anything else the app or the
 * OS might hold.
 *
 * Degrades to a no-op on any native failure: if notifications aren't
 * available here, nothing was scheduled in the first place, so there is
 * nothing to clean up either. One stale identifier failing to cancel doesn't
 * stop the rest, since the next full reconcile tries again anyway.
 */
export async function cancelScheduledWithPrefix(prefix: string): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter((n) => n.identifier.startsWith(prefix));
    await Promise.all(
      ours.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
    );
  } catch {
    // No native module / nothing ever scheduled.
  }
}

/**
 * Schedules every request, attaching `androidChannelId` on Android only, and
 * returns the identifiers that actually landed.
 *
 * Each request is scheduled independently and its failure swallowed: one
 * trigger the platform rejects must not take down every other reminder in the
 * batch. Returning what LANDED rather than what was requested is what lets
 * schedule/sessionReminders.ts report honest coverage to the push backend --
 * over-reporting there would suppress a server-side copy of a reminder this
 * phone then never shows.
 */
export async function scheduleLocalNotifications(
  requests: LocalNotificationRequest[],
  androidChannelId: string,
): Promise<Set<string>> {
  const landed = new Set<string>();
  await Promise.all(
    requests.map((r) =>
      Notifications.scheduleNotificationAsync({
        identifier: r.identifier,
        content: {
          title: r.title,
          body: r.body,
          ...androidChannel(androidChannelId),
        },
        // The channel goes on the trigger as well as the content, which is
        // what both callers did by hand. The cast is because
        // SchedulableNotificationTriggerInput is a union of per-type shapes
        // and TypeScript can't see that adding `channelId` keeps it in the
        // union -- expo-notifications accepts it on every schedulable type
        // (ChannelAwareTriggerInput).
        trigger: {
          ...(r.trigger as object),
          ...androidChannel(androidChannelId),
        } as Notifications.SchedulableNotificationTriggerInput,
      })
        .then(() => {
          landed.add(r.identifier);
        })
        .catch(() => {}),
    ),
  );
  return landed;
}

/** `{ channelId }` on Android, nothing anywhere else -- the one conditional
 * that used to be spread inline at every call site. */
function androidChannel(channelId: string): { channelId?: string } {
  return Platform.OS === 'android' ? { channelId } : {};
}
