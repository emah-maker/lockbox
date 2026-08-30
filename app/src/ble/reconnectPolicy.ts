// reconnectPolicy.ts -- how long to wait before the next auto-reconnect
// attempt, and whether to attempt one at all.
//
// Pure, and split out of useStore.ts for the reason every other
// plan/execute pair in this app is split (goalNotificationPlan vs
// goalNotifications, sessionReminderPlan vs sessionReminders): the DECISION
// is the interesting part and the part that can silently regress, while the
// part around it is a setTimeout and a BleManager. Living inside useStore's
// closure, this arithmetic could not be exercised at all -- and the failure
// it guards against is not one a person notices in testing. A backoff that
// stops growing is a box that has been off for an hour still being scanned
// for every four seconds, which costs the phone's battery quietly and for as
// long as the app is open.
//
// The numbers themselves are useStore.ts's; this module takes them as
// parameters rather than importing them, so a test can state the shape of
// the curve without restating the constants it happens to be tuned to.

/** Inputs to `shouldScheduleReconnect`, named so the call site reads as the
 * question it is asking. */
export interface ReconnectGate {
  /** The user pressed Disconnect. Overrides everything: an explicit "stop"
   * must not be undone by the app's own retry loop. */
  userDisconnected: boolean;
  /** Settings > Auto-connect. */
  autoConnect: boolean;
  /** A retry is already armed. Arming a second one would compound the
   * backoff into two independent ladders, each halving the effective delay
   * the other thinks it is enforcing. */
  timerArmed: boolean;
}

/** Whether a reconnect attempt should be armed at all. */
export function shouldScheduleReconnect(gate: ReconnectGate): boolean {
  return !gate.userDisconnected && gate.autoConnect && !gate.timerArmed;
}

/**
 * How long to wait before attempt number `attempts` (0-based: 0 is the first
 * retry after a drop, and gets `baseMs`).
 *
 * Exponential, capped at `maxMs`. The cap is the load-bearing half -- without
 * it the delay reaches Infinity within about eleven hundred attempts and, far
 * sooner than that, hours; with only the exponent and no cap the retry that
 * matters (the user walking back into range) never happens.
 *
 * Clamps `attempts` at zero rather than trusting the caller: a negative
 * exponent yields a FRACTION of the base delay, which would turn the first
 * retries into a tight loop -- the exact opposite of a backoff.
 */
export function reconnectDelayMs(attempts: number, baseMs: number, maxMs: number): number {
  const n = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
  // Math.min against a NaN-free base: 2 ** n overflows to Infinity for large
  // n, and Math.min(maxMs, Infinity) is maxMs, so the cap absorbs it without
  // a special case.
  return Math.min(maxMs, baseMs * 2 ** n);
}
