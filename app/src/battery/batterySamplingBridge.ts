// batterySamplingBridge.ts -- subscribes to useStore's live BLE status and
// feeds every status.bat change into useBatteryStore's shared sample log.
// This is what used to be StatusStrip.tsx's own private recording effect;
// hoisted out (task 2) so Home's BatteryBadge and StatusStrip both read the
// same log through useBatteryStore instead of each independently recording
// off their own copy of `status` (which would double-write every sample).
// Modeled on sync/settingsSyncBridge.ts's own "subscribe once at app start,
// idempotent start guard" shape.
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useBatteryStore } from './useBatteryStore';

let started = false;

/** Call once at app start (App.tsx), alongside useBatteryStore's own
 * hydrate() call. Idempotent. */
export function startBatterySampling(): void {
  if (started) return;
  started = true;
  let prevBat = useStore.getState().status?.bat ?? -1;
  useStore.subscribe((state) => {
    // The simulated box (ble/DemoBoxClient.ts) reports a fixed, invented
    // percent, and it arrives here by exactly the same route a real
    // reading does -- useStore's `status`. A BatterySample carries no
    // provenance, so once one is written it is indistinguishable from the
    // user's own box's, in a log that is persisted and survives the toggle
    // being switched back off.
    //
    // The cost is not one wrong point on a graph, because this log is not
    // a graph: dischargeRatePerHour fits a slope through it and
    // estimateRemainingMs divides by that slope. A real box sitting at 95%
    // followed by the demo box's 87 reads as a perfectly legal discharge
    // of eight percent in the second it took to flip the switch -- the
    // fit discards sharp jumps UP (a plug-in) and never down -- so the
    // estimate collapses to minutes for a box with days left, and stays
    // there for the whole six-hour fitting window.
    //
    // Skipped rather than recorded-and-flagged: nothing downstream wants
    // an imaginary box's charge curve, so there is nothing to flag it FOR.
    // The number still reaches the screen (Home's BatteryBadge and the
    // status strip read `status` directly, not this log) -- a demo box
    // with no battery reading would be its own kind of wrong.
    if (useSettingsStore.getState().demoModeEnabled) return;
    const bat = state.status?.bat ?? -1;
    if (bat === prevBat) return;
    prevBat = bat;
    useBatteryStore.getState().recordIfNew(bat, Date.now());
  });
}
