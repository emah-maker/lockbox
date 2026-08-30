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
//
// TWO STEPS, NOT ONE. A ticket coming back `status: 'ok'` means Expo
// ACCEPTED the message, not that a device got it. The delivery outcome lands
// later, at the getPushReceipts endpoint -- and that is where
// DeviceNotRegistered shows up for the ordinary case of an app that was
// simply uninstalled, which the ticket almost never reports. So sendExpoPush
// returns the ticket id for every accepted message, index.ts persists those,
// and collectPushReceipts reads them back a few minutes later through
// fetchExpoReceipts below. Without that second half, a token belonging to a
// long-gone install survives forever and is pushed to on every reminder.
import { chunk } from './reminders';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
/** Expo's documented cap on messages per request. */
const EXPO_CHUNK_SIZE = 100;
/** Node's fetch has no default timeout, and this runs inside a scheduled
 * function with a 120s budget shared by every due reminder in the batch. One
 * stalled connection to a push service would otherwise hold the whole run
 * until the platform killed it -- taking down the reminders queued behind it
 * as collateral, where a prompt failure only costs the one chunk (its
 * reminders stay un-marked, and the next tick retries them). */
const REQUEST_TIMEOUT_MS = 15000;

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
  /** Expo's id for an ACCEPTED message, to be redeemed for a receipt later
   * (see this file's header). Present only when `ok`, and only when Expo
   * actually returned one -- it is the handle to the delivery outcome, not
   * the outcome. */
  ticketId?: string;
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
          results.push({ token: message.to, ok: true, unregistered: false, ...(ticket.id ? { ticketId: ticket.id } : {}) });
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
      // Includes the timeout above, which arrives as a TimeoutError from the
      // abort signal -- reported like any other transport failure, so no
      // token is deleted over a slow network.
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

const EXPO_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo's documented cap on ids per receipts request. */
const EXPO_RECEIPT_CHUNK_SIZE = 1000;

/** What a redeemed ticket says about the delivery it stood for. */
export interface ReceiptOutcome {
  ticketId: string;
  /** Delivered as far as the push service is concerned. */
  ok: boolean;
  /** The registration is gone -- app uninstalled, notifications revoked.
   * The ONLY outcome that should cost a token its document. */
  unregistered: boolean;
  error?: string;
}

/**
 * Redeems ticket ids for their receipts.
 *
 * Returns an entry ONLY for ids Expo actually answered about. An id it omits
 * is not an error and must not be read as one: a receipt is simply not
 * available yet, and the caller's job is to leave that ticket alone and ask
 * again later. Conflating "no receipt yet" with "delivered" would throw away
 * the very DeviceNotRegistered this path exists to catch.
 *
 * Never throws, for the same reason sendExpoPush doesn't: this runs inside a
 * scheduled job whose failure mode should be "try again next tick", not a
 * crashed run. A transport failure simply yields no outcomes.
 */
export async function fetchExpoReceipts(ticketIds: string[]): Promise<ReceiptOutcome[]> {
  const outcomes: ReceiptOutcome[] = [];

  for (const batch of chunk(ticketIds, EXPO_RECEIPT_CHUNK_SIZE)) {
    try {
      const response = await fetch(EXPO_RECEIPTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: batch }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) continue; // nothing learned; the tickets stay pending

      const payload = (await response.json()) as { data?: Record<string, ExpoReceipt> };
      const data = payload.data;
      if (!data || typeof data !== 'object') continue;

      for (const ticketId of batch) {
        const receipt = data[ticketId];
        if (!receipt) continue; // not available yet -- ask again next run
        if (receipt.status === 'ok') {
          outcomes.push({ ticketId, ok: true, unregistered: false });
          continue;
        }
        outcomes.push({
          ticketId,
          ok: false,
          unregistered: receipt.details?.error === 'DeviceNotRegistered',
          error: receipt.message ?? 'expo receipt error',
        });
      }
    } catch {
      // Offline, timed out, or a malformed body. Learn nothing, delete
      // nothing, and let the next run ask again.
    }
  }

  return outcomes;
}

interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}
