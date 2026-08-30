// Unit tests for the auto-reconnect policy. The behaviour under test is one
// a person would not notice going wrong: a backoff that stops growing still
// reconnects, it just scans every four seconds forever, draining the battery
// of a phone whose box happens to be switched off. Run with `npm test`.
import { reconnectDelayMs, shouldScheduleReconnect } from './reconnectPolicy';

const BASE = 4000;
const MAX = 60000;

describe('reconnectDelayMs', () => {
  it('starts at the base delay and doubles', () => {
    expect(reconnectDelayMs(0, BASE, MAX)).toBe(4000);
    expect(reconnectDelayMs(1, BASE, MAX)).toBe(8000);
    expect(reconnectDelayMs(2, BASE, MAX)).toBe(16000);
    expect(reconnectDelayMs(3, BASE, MAX)).toBe(32000);
  });

  it('stops at the cap rather than growing into hours', () => {
    expect(reconnectDelayMs(4, BASE, MAX)).toBe(MAX);
    expect(reconnectDelayMs(50, BASE, MAX)).toBe(MAX);
  });

  // 2 ** n overflows to Infinity well before a long-running app could get
  // there, and an Infinity delay is a reconnect that never fires -- the box
  // would stay unreachable until the app was restarted.
  it('holds at the cap even where the exponent overflows', () => {
    expect(reconnectDelayMs(1100, BASE, MAX)).toBe(MAX);
    expect(Number.isFinite(reconnectDelayMs(Number.MAX_SAFE_INTEGER, BASE, MAX))).toBe(true);
  });

  it('never returns less than the base delay', () => {
    // A negative exponent would yield a fraction of the base -- a tight retry
    // loop, the exact opposite of a backoff.
    expect(reconnectDelayMs(-1, BASE, MAX)).toBe(BASE);
    expect(reconnectDelayMs(NaN, BASE, MAX)).toBe(BASE);
  });

  it('never goes backwards as attempts pile up', () => {
    let previous = 0;
    for (let n = 0; n < 40; n += 1) {
      const delay = reconnectDelayMs(n, BASE, MAX);
      expect(delay).toBeGreaterThanOrEqual(previous);
      expect(delay).toBeLessThanOrEqual(MAX);
      previous = delay;
    }
  });
});

describe('shouldScheduleReconnect', () => {
  const gate = (over: Partial<Parameters<typeof shouldScheduleReconnect>[0]> = {}) => ({
    userDisconnected: false,
    autoConnect: true,
    timerArmed: false,
    ...over,
  });

  it('arms a retry after an unexpected drop', () => {
    expect(shouldScheduleReconnect(gate())).toBe(true);
  });

  // An explicit Disconnect must not be undone by the app's own retry loop --
  // the user pressed the button that means stop.
  it('does not fight a deliberate disconnect', () => {
    expect(shouldScheduleReconnect(gate({ userDisconnected: true }))).toBe(false);
  });

  it('respects Auto-connect being off', () => {
    expect(shouldScheduleReconnect(gate({ autoConnect: false }))).toBe(false);
  });

  // Two ladders climbing at once each halve the delay the other believes it
  // is enforcing, which quietly undoes the backoff.
  it('does not arm a second retry on top of one already waiting', () => {
    expect(shouldScheduleReconnect(gate({ timerArmed: true }))).toBe(false);
  });

  it('needs every condition at once', () => {
    expect(shouldScheduleReconnect(gate({ userDisconnected: true, autoConnect: false, timerArmed: true }))).toBe(false);
  });
});
