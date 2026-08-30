// expoPush.ts -- delivery to the phone app, through Expo's push service.
//
// Why Expo and not FCM directly, when this backend already has
// firebase-admin: the app is an Expo (SDK 52) dev-client/EAS build using the
// Firebase JS SDK, and `firebase/messaging` is browser-only -- there is no
// way to obtain an FCM registration token in that app without adding
// @react-native-firebase/messaging and a second native Firebase setup
// (google-services.json + an APNs key uploaded to the Firebase console).
// expo-notifications' getExpoPushTokenAsync needs neither: Expo's service
// owns the APNs/FCM credentials and fans out for both platforms. The browser
// half of this feature does go through firebase-admin (see webPush.ts) --
// two transports, one queue.
//
// Hand-rolled over `fetch` rather than pulling in expo-server-sdk: the whole
// contract used here is one POST, a 100-message chunk limit, and one error
// code worth acting on (DeviceNotRegistered). A dependency for that would be
// more surface than it saves.
import { chunk } from './reminders';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
/** Expo's documented cap on messages per request. */
const EXPO_CHUNK_SIZE = 100;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  /** Arrives as `notification.request.content.data` in the app -- carries
   * enough for a tap to open the right day, without the app having to guess
   * which reminder it just received. */
  data?: Record<string, string>;
}

/** Per-token outcome. `unregistered` is the only failure worth acting on:
 * it means this token belongs to an app instance that no longer exists
 * (uninstalled, or notifications revoked), so the token document should be
 * deleted rather than retried forever. */
export interface PushResult {
  token: string;
  ok: boolean;
  unregistered: boolean;
  error?: string;
}

/**
 * Sends every message, chunked, and reports one result per message in the
 * SAME order they were given.
 *
 * Never throws: a push service outage must not take down the scheduled run
 * (the reminders it was carrying stay un-marked and are retried on the next
 * tick, which is exactly what should happen). A transport failure is
 * reported as `ok: false, unregistered: false` for every message in the
 * affected chunk, so no token is deleted on the strength of a network
 * problem.
 */
export async function sendExpoPush(messages: ExpoMessage[]): Promise<PushResult[]> {
  const results: PushResult[] = [];

  for (const batch of chunk(messages, EXPO_CHUNK_SIZE)) {
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Expo's own recommendation for the push endpoint; harmless if the
          // service ignores it.
          'Accept-Encoding': 'gzip, deflate',
          Accept: 'application/json',
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        const detail = `expo push HTTP ${response.status}`;
        results.push(...batch.map((m) => ({ token: m.to, ok: false, unregistered: false, error: detail })));
        continue;
      }

      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = Array.isArray(payload.data) ? payload.data : [];
      batch.forEach((message, i) => {
        const ticket = tickets[i];
        if (!ticket) {
          // A short/missing ticket array is a protocol surprise, not a dead
          // token -- report it as a plain failure so the token survives.
          results.push({ token: message.to, ok: false, unregistered: false, error: 'expo push: no ticket' });
          return;
        }
        if (ticket.status === 'ok') {
          results.push({ token: message.to, ok: true, unregistered: false });
          return;
        }
        results.push({
          token: message.to,
          ok: false,
          unregistered: ticket.details?.error === 'DeviceNotRegistered',
          error: ticket.message ?? 'expo push error',
        });
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'expo push failed';
      results.push(...batch.map((m) => ({ token: m.to, ok: false, unregistered: false, error: detail })));
    }
  }

  return results;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}
