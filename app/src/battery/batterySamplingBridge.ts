// batterySamplingBridge.ts -- subscribes to useStore's live BLE status and
// feeds every status.bat change into useBatteryStore's shared sample log.
// This is what used to be StatusStrip.tsx's own private recording effect;
// hoisted out (task 2) so Home's BatteryBadge and StatusStrip both read the
// same log through useBatteryStore instead of each independently recording
// off their own copy of `status` (which would double-write every sample).
// Modeled on sync/settingsSyncBridge.ts's own "subscribe once at app start,
// idempotent start guard" shape.
import { useStore } from '../store/useStore';
import { useBatteryStore } from './useBatteryStore';

let started = false;

/** Call once at app start (App.tsx), alongside useBatteryStore's own
 * hydrate() call. Idempotent. */
export function startBatterySampling(): void {
  if (started) return;
  started = true;
  let prevBat = useStore.getState().status?.bat ?? -1;
  useStore.subscribe((state) => {
    const bat = state.status?.bat ?? -1;
    if (bat === prevBat) return;
    prevBat = bat;
    useBatteryStore.getState().recordIfNew(bat, Date.now());
  });
}
