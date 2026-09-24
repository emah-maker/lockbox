// historyIntake.ts -- what happens to a batch of finished sessions the box
// pushes over BLE, between arriving and existing in the durable log.
//
// Lifted out of useStore.ts, and worth its own module for the same reason the
// reconnect policy is: this is the ONLY path by which focus time is ever
// recorded, and its failure modes are permanent rather than transient. The
// box holds each finished session in RAM and drops its queue only when it
// hears an ack (firmware/lib/lock_log.py's SessionLog.ack), so acking a batch
// that was not stored loses it for good, while failing to ack one that WAS
// stored costs a duplicate delivery that dedupes. Everything below keeps that
// asymmetry pointing the right way.
//
// The three things it needs from the store arrive as `deps` rather than as a
// closure, so the rule can be read -- and exercised -- without standing up a
// BleManager. src/store/useStore.history.test.ts drives it through the real
// store wiring.
import { getJSON, setJSON } from '../storage/storage';
import { appendSessions, buildLoggedSessions, type LoggedSession, type PendingTopicTag } from '../stats/sessionHistory';
import type { HistoryEntry } from './protocol';

/** Where this device's in-flight topic tag is parked between the app tagging
 * a running session and the box reporting that session as finished. */
export const PENDING_TOPIC_KEY = 'pendingTopicTag';

/** Tolerance past a session's end for a tag to still count as belonging to
 * it -- the user taps a label a moment after the box has already logged the
 * session. */
export const PENDING_TOPIC_SLACK_MS = 5000;

/** How far BEFORE a session's end a tag may have been placed and still be
 * taken as that session's. Generous: the tag is normally chosen at the START
 * of a session, which for a long one is a long time before it ends.
 */
export const PENDING_TOPIC_PRE_SLACK_MS = 120_000;

// Serializes every read-modify-write against PENDING_TOPIC_KEY that this
// module and useStore.ts's handleStatus perform, so the two sequences that
// touch it -- this module's read-pending -> decide -> re-read -> compare-
// and-clear below, and handleStatus's read -> refresh-the-timestamp ->
// compare-and-set write on a freshRun where the box echoes no topic -- can
// never interleave. Without this, handleStatus's refresh landing between
// this module's initial `pending` read and its own `stillCurrent` re-read
// could (a) change `.at` out from under the compare-and-clear so this
// module wrongly skips clearing a tag it DID just consume, leaving a
// stale-but-freshly-timestamped tag in storage for a LATER session to pick
// up, or (b) land after the clear has already run and resurrect the
// just-cleared tag with a fresh timestamp attached to nothing. AsyncStorage
// gives no real atomic compare-and-swap, so this is a plain in-process
// promise chain: each queued unit of work only starts once every previously
// queued one has fully settled (success or failure). It deliberately does
// NOT cover tagCurrentSession's own direct setJSON(PENDING_TOPIC_KEY, ...)
// in useStore.ts -- that is a single unconditional write, not a
// read-modify-write, so it cannot tear -- callers here still re-check with
// their own compare-and-set immediately before writing, to avoid clobbering
// a tag tagCurrentSession wrote in between.
let pendingTopicChain: Promise<unknown> = Promise.resolve();
export function withPendingTopicLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = pendingTopicChain.then(fn, fn);
  // Chain the NEXT queued call off a version of this one that always
  // resolves, so one failed unit of work doesn't wedge every call after it.
  pendingTopicChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** What the intake needs from whatever owns the connection and the store. */
export interface HistoryIntakeDeps {
  /** Commit the reconciled session list to the live store. */
  onSessions: (sessions: LoggedSession[]) => void;
  /** The pending tag just consumed has been cleared from storage; drop it
   * from the live store too, if it is still the one showing. */
  onTopicConsumed: (topic: string) => void;
  /** Tell the box the batch was handled, by its ORIGINAL entry count. */
  ack: (count: number) => Promise<unknown>;
  /** Whether the box that produced this batch was the demonstration-mode
   * fake (ble/DemoBoxClient.ts). Stamped onto each session on the way into
   * the durable log -- see LoggedSession.demo for why the provenance has to
   * be recorded here, at the only point it is still knowable, rather than
   * inferred later from whether the toggle happens to be on. */
  demo?: boolean;
}

// The box queues every finished session in RAM (see firmware/lib/lock_log.py
// SessionLog.record, called unconditionally from go_done) and pushes +
// clears that queue on its very next service tick whenever connected -- so
// this is the *only* source of session records, live or not. There is
// deliberately no separate "watch the status transition live" path: the
// box would report the same session again here within about a second,
// which would double-count it.
// A topic tagged via tagCurrentSession() while a session is running is
// matched here to whichever incoming history entry's time window contains
// the tag's timestamp -- the box has no keyboard/topic input of its own
// (touchscreen swipe timer only) and keeps no long-term session store (see
// firmware/lib/lock_log.py's 2026-07-24 SD-card removal), so topic tagging
// is entirely app-side and only ever needs to survive to this hand-off.
export function handleHistoryEntries(entries: HistoryEntry[], deps: HistoryIntakeDeps): void {
  if (!entries.length) return;
  // The `pending` read, the decide, the re-read, and the conditional clear
  // all run as one queued unit against withPendingTopicLock -- see that
  // function's comment -- so none of it can interleave with handleStatus's
  // own refresh of this same key.
  withPendingTopicLock(async () => {
    const pending = await getJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
    // buildLoggedSessions drops sessions under MIN_LOGGED_SESSION_S
    // (accidental taps/instant overrides, not real focus time) so they
    // never reach the durable log/stats, not merely hidden from it later.
    const { sessions: logged, consumedPendingTopic } = buildLoggedSessions(
      entries,
      pending,
      PENDING_TOPIC_SLACK_MS,
      PENDING_TOPIC_PRE_SLACK_MS,
    );
    if (consumedPendingTopic && pending) {
      // Compare-and-clear, not an unconditional clear: tagCurrentSession's
      // direct (lock-free) write can still land in storage while this
      // function's own PENDING_TOPIC_KEY read was in flight. Clearing
      // unconditionally would silently discard that newer tag instead of
      // the stale one this call actually consumed (production readiness
      // review, High: "handleHistory async-read-then-clear race"). Only
      // clear if the stored tag is still the exact one just consumed.
      const stillCurrent = await getJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
      if (stillCurrent && stillCurrent.at === pending.at && stillCurrent.topic === pending.topic) {
        await setJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
        deps.onTopicConsumed(pending.topic);
      }
    }
    // Only set when true, so an ordinary session serialises exactly as it
    // always has -- same treatment buildLoggedSessions gives approxStart.
    return deps.demo ? logged.map((s) => ({ ...s, demo: true as const })) : logged;
  }).then((logged) => {
    // Ack by the original entry count once handled, whether or not any of
    // them were durably logged -- see firmware/lib/lock_log.py's
    // SessionLog.ack and
    // docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
    // §3.2: the box only drops its own pending queue once it hears this
    // back, so a dropped write here (e.g. disconnected right after this
    // notify) just means the box resends the same batch next connection
    // -- safe because appendSessions dedupes by (startedAt, plannedS).
    const ack = () => deps.ack(entries.length).catch(() => {});
    if (!logged.length) {
      ack();
      return;
    }
    appendSessions(logged)
      .then((sessions) => {
        deps.onSessions(sessions);
        ack();
      })
      .catch(() => {
        // A failed local append must not ack -- the box only clears its
        // own pending queue once it hears this back (see the comment
        // above), so skipping ack() here leaves the batch queued for a
        // resend next connection instead of silently losing it.
      });
  });
}
