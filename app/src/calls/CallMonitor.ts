// CallMonitor.ts -- ties incoming-call detection to the box's alert-through.
//
// When a call rings while the box is LOCKED and the user has call-alerts on, we
// tell the box (over BLE) to light up its screen. By default the box only
// alerts (screen notification, latch stays shut); if the user has opted in to
// "Unlock box when called" (Settings -> boxSettings.ucal), the box releases the
// lock instead -- that decision is made firmware-side (lock_controller.
// notify_call), not here, so this file's job is unchanged: just deliver the
// alert write.
//
// Two ways in, because one of them does not survive the only situation that
// matters. CXCallObserver's delegate -- addCallListener below -- fires only
// while this process is actually running, and a phone shut inside the box is a
// phone whose app iOS has suspended. The ring transition then happens with
// nobody home to hear it and is never replayed, which is why the alert
// "worked" when tested with the app open and did nothing in real use.
//
// So the listener is now only the fast path. The reliable path is checkNow():
// a snapshot poll of getCurrentCalls(), driven by whatever happens to wake
// this app. While the box is connected that is the box's own status notify,
// about once a second (Box-code/lib/lock_ble.py's _push_outbound), delivered
// in the background under the bluetooth-central mode. Against a ~20-30s ring
// that is many chances to notice, so the alert lands even though the
// transition itself was missed.
//
// iOS limitation (honest): CXCallObserver cannot tell us WHO is calling, so
// this alerts on ANY incoming call ("Tier 1"). Per-contact greenlisting is not
// deferred, it is impossible -- Apple exposes no caller identity to a
// third-party app on a cellular call, by design, through any API (Call
// Directory and Live Caller ID Lookup both feed the system's own call UI, not
// your process). `resolveLabel` therefore stays a constant.
import {
  addCallListener,
  isCallObserverAvailable,
  getCurrentCalls,
  CallEvent,
} from '../../modules/call-observer';
import { recordTick, recordCallEvent, CallDiagKind } from './callDiagnostics';
import { PhoneBoxClient } from '../ble/PhoneBoxClient';
import type { BoxState } from '../ble/protocol';

export interface CallMonitorOptions {
  client: PhoneBoxClient;
  // live box state getter so we only alert while the box is locked
  getBoxState: () => BoxState;
  // user toggle: alert the box when calls come in during a lock
  isEnabled: () => boolean;
  onAlertSent?: (label: string) => void;
}

const LOCKED: BoxState[] = ['running', 'closed'];

export class CallMonitor {
  private sub: { remove: () => void } | null = null;
  // Calls already alerted on, by CXCall uuid. Without this the once-a-second
  // poll would re-alert the same ring on every tick, so a single call would
  // hammer the box with ~20 writes and restart its 20s alert overlay each
  // time (BLE_CALL_ALERT_S) -- or, with "unlock when called" on, re-fire
  // notify_call's unlock over and over.
  private alerted = new Set<string>();
  // What has already been written to the diagnostic log for each call uuid.
  // An ineligible ring is re-examined every second for as long as it rings,
  // so without this one call would evict every other entry from the buffer.
  private logged = new Map<string, Set<CallDiagKind>>();

  constructor(private opts: CallMonitorOptions) {}

  get available() {
    return isCallObserverAvailable();
  }

  start() {
    if (this.sub) return;
    this.sub = addCallListener((e) => {
      void this.consider(e);
    });
    // A call already ringing at this moment produced its transition before
    // there was any listener to receive it, and Expo does not buffer events
    // for a late subscriber. start() runs on BLE connect, which is exactly
    // when that is likely -- so take a snapshot immediately rather than
    // waiting for a state change that has already happened.
    recordCallEvent('monitor-started');
    void this.checkNow();
  }

  stop() {
    this.sub?.remove();
    this.sub = null;
    // Nothing is watching these calls any more; keeping the uuids would
    // suppress a legitimate alert if start() runs again while the same call
    // is still up.
    this.alerted.clear();
    this.logged.clear();
    recordCallEvent('monitor-stopped');
  }

  /** Ask iOS what is ringing right now and alert on it if it qualifies.
   * Safe and cheap to call on every box status notify -- see the file header
   * for why that cadence is the point. */
  async checkNow(): Promise<void> {
    // Counted before any gating below, deliberately: this number is not about
    // the feature, it is the measurement of whether iOS wakes this app for a
    // BLE notify at all -- the premise the whole background design rests on.
    // See callDiagnostics.ts.
    recordTick();
    // Cheap bail-outs first: this runs ~1/s for the whole length of every
    // lock, and when the feature is off or the box is open there is nothing
    // a snapshot could tell us that we would act on.
    if (!this.sub) return;
    if (!this.opts.isEnabled()) return;
    if (!LOCKED.includes(this.opts.getBoxState())) return;

    const calls = getCurrentCalls();
    this.forget(calls);
    for (const call of calls) {
      await this.consider(call);
    }
  }

  /** Drop dedupe entries for calls iOS no longer reports, so the set can't
   * grow for the life of the process. */
  private forget(calls: CallEvent[]) {
    if (this.alerted.size === 0 && this.logged.size === 0) return;
    const live = new Set(calls.map((c) => c.uuid));
    for (const uuid of this.alerted) {
      if (!live.has(uuid)) this.alerted.delete(uuid);
    }
    for (const uuid of this.logged.keys()) {
      if (!live.has(uuid)) this.logged.delete(uuid);
    }
  }

  /** Records `kind` for this call at most once, so the 1/s poll cannot flood
   * the diagnostic buffer with repeats of the same finding. */
  private logOnce(uuid: string, kind: CallDiagKind, detail?: string) {
    let kinds = this.logged.get(uuid);
    if (!kinds) {
      kinds = new Set();
      this.logged.set(uuid, kinds);
    }
    if (kinds.has(kind)) return;
    kinds.add(kind);
    recordCallEvent(kind, detail);
  }

  /** The single gate both the event and the poll go through. */
  private async consider(e: CallEvent) {
    if (e.state !== 'incoming' || e.outgoing) return;
    if (this.alerted.has(e.uuid)) return;

    // Reached only via the event path when a gate below blocks -- checkNow
    // bails out before its snapshot for the disabled/unlocked cases. Either
    // way, a call that was seen and then dropped is the single most useful
    // thing this log can say, because it is otherwise indistinguishable from
    // never having been woken.
    this.logOnce(e.uuid, 'saw-call');
    if (!this.opts.isEnabled()) {
      this.logOnce(e.uuid, 'skipped', 'call alerts are off');
      return;
    }
    if (!LOCKED.includes(this.opts.getBoxState())) {
      this.logOnce(e.uuid, 'skipped', `box is ${this.opts.getBoxState()}, not locked`);
      return;
    }
    if (!this.opts.client.connected) {
      this.logOnce(e.uuid, 'skipped', 'box not connected');
      return;
    }

    const label = this.resolveLabel(e);
    // Marked before the await, not after: checkNow can be re-entered by the
    // next status tick while this write is still in flight, and both would
    // otherwise pass the has() check above and alert the same call twice.
    this.alerted.add(e.uuid);
    try {
      await this.opts.client.alertCall(label);
      this.opts.onAlertSent?.(label);
      this.logOnce(e.uuid, 'alert-sent', label);
    } catch {
      // Radio not reachable this instant. Un-mark so the next status tick
      // retries -- the call is probably still ringing, and silently giving
      // up on the first failed write is how a recoverable BLE hiccup turned
      // into a missed call.
      this.alerted.delete(e.uuid);
      this.logOnce(e.uuid, 'write-failed', 'BLE write rejected; retrying next tick');
    }
  }

  // iOS gives us no caller identity on a cellular call (see file header), so
  // every call is a generic "Call".
  private resolveLabel(_e: CallEvent): string {
    return 'Call';
  }
}
