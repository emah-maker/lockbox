// webPush.ts -- delivery to a browser tab that granted notification
// permission on the dashboard, through FCM's Web Push transport.
//
// This half DOES go through firebase-admin, unlike the phone app (see
// expoPush.ts's header for why that one can't): `firebase/messaging` is a
// browser API, so the dashboard can mint a real FCM registration token with
// nothing more than a VAPID key pasted into the config, and firebase-admin
// can address it directly.
//
// Reports results in the same PushResult shape expoPush.ts uses, so the
// caller treats the two transports identically -- including the one failure
// worth acting on, a token whose registration is gone.
import { getMessaging } from 'firebase-admin/messaging';
import { chunk, type PushTokenDoc } from './reminders';
import type { PushResult } from './expoPush';

/** FCM's documented cap for sendEachForMulticast. */
const FCM_CHUNK_SIZE = 500;

/** FCM error codes that mean "this token is dead, stop sending to it" --
 * every other failure (quota, transient unavailability, an auth blip) leaves
 * the token in place to be retried.
 *
 * Deliberately only the two codes that are ABOUT the registration token.
 * 'messaging/invalid-argument' used to be in here and does not belong: FCM
 * returns it for a bad request generally, including a rejected payload, and
 * the payload is the same for every token in the multicast. So one
 * payload-level rejection -- a field FCM tightens validation on, an
 * fcmOptions.link that stops validating after a hosting change -- would come
 * back as invalid-argument for EVERY address in the batch, and the caller's
 * removeDeadTokens would then delete every web registration the user has, on
 * the strength of an error that said nothing about any of them. Web reminders
 * would just stop, with no error surfaced anywhere and nothing to re-arm them
 * until the user happened to reopen the dashboard.
 *
 * Retrying a genuinely malformed token forever is the failure in the other
 * direction, and it is the one to prefer -- the same asymmetry reminders.ts
 * states for localReminderIds: a duplicate is annoying, a reminder that never
 * arrives is the thing this feature exists to prevent. In practice it does
 * not arise: an empty token is filtered before it gets here
 * (tokensForReminder), the rules cap the length, and a non-empty but invalid
 * token comes back as invalid-registration-token, which IS in this set. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Sends one notification to every web token, chunked, reporting one result
 * per token in the SAME order they were given.
 *
 * Never throws, for the same reason sendExpoPush doesn't: an FCM outage must
 * leave the reminders un-marked so the next tick retries them, rather than
 * failing the whole scheduled run.
 */
export async function sendWebPush(
  tokens: PushTokenDoc[],
  content: { title: string; body: string },
  link: string,
): Promise<PushResult[]> {
  const results: PushResult[] = [];
  if (tokens.length === 0) return results;

  for (const batch of chunk(tokens, FCM_CHUNK_SIZE)) {
    const addresses = batch.map((t) => t.token);
    try {
      const response = await getMessaging().sendEachForMulticast({
        tokens: addresses,
        webpush: {
          notification: {
            title: content.title,
            body: content.body,
            // Collapses repeat reminders for the same feature rather than
            // stacking a tower of them in the OS tray. The website's
            // firebase-messaging-sw.js uses the same tag when it presents
            // this, and pairs it with `renotify` so a second reminder still
            // alerts rather than silently replacing the first.
            //
            // No `icon`: the site ships no square PNG to point at (its
            // favicon is an inline SVG data URI, which a notification icon
            // can't use), and a broken icon URL looks worse than the
            // browser's own default.
            tag: 'phonebox-session-reminder',
          },
          fcmOptions: { link },
        },
      });

      response.responses.forEach((r, i) => {
        const token = addresses[i];
        if (r.success) {
          results.push({ token, ok: true, unregistered: false });
          return;
        }
        const code = r.error?.code ?? '';
        results.push({
          token,
          ok: false,
          unregistered: DEAD_TOKEN_CODES.has(code),
          error: code || r.error?.message || 'fcm error',
        });
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'fcm send failed';
      results.push(...addresses.map((token) => ({ token, ok: false, unregistered: false, error: detail })));
    }
  }

  return results;
}
