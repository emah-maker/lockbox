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
// iOS limitation (honest): CXCallObserver cannot tell us WHO is calling, so the
// MVP alerts on ANY incoming call ("Tier 1"). Per-contact greenlisting ("Tier
// 2") requires the caller to reach you through the app as a VoIP call
// (PushKit + CallKit); `resolveLabel` is where that identity would be filled in
// once the VoIP path is built. Until then the label is a generic "Call".
import { addCallListener, isCallObserverAvailable, CallEvent } from '../../modules/call-observer';
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

  constructor(private opts: CallMonitorOptions) {}

  get available() {
    return isCallObserverAvailable();
  }

  start() {
    if (this.sub) return;
    this.sub = addCallListener((e) => this.handle(e));
  }

  stop() {
    this.sub?.remove();
    this.sub = null;
  }

  private async handle(e: CallEvent) {
    if (e.state !== 'incoming' || e.outgoing) return;
    if (!this.opts.isEnabled()) return;
    if (!LOCKED.includes(this.opts.getBoxState())) return;
    if (!this.opts.client.connected) return;

    const label = this.resolveLabel(e);
    try {
      await this.opts.client.alertCall(label);
      this.opts.onAlertSent?.(label);
    } catch {
      // radio not reachable right now; nothing to do -- the box just won't buzz
    }
  }

  // Placeholder for Tier 2 per-contact identity (VoIP/PushKit). CXCallObserver
  // gives us no caller info, so today every call is a generic "Call".
  private resolveLabel(_e: CallEvent): string {
    return 'Call';
  }
}
