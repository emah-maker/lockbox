// useBatteryStore.ts -- hoists StatusStrip.tsx's own battery-sample
// recording (and its persisted sample log) out of that one component, so
// Home's new BatteryBadge (screens/home/BatteryBadge.tsx) can read/extend
// the exact same sample log instead of keeping a second, independent copy
// that would double-record every percent change. Wraps batteryEstimate.ts's
// existing pure helpers (recordBatterySample/loadBatterySamples/
// saveBatterySamples) in the same thin "reducer shell around a pure,
// storage-backed module" shape useSettingsStore.ts/useGoalsStore.ts already
// use for their own persisted state -- batteryEstimate.ts itself is
// unchanged, this is purely a new consumer of it.
import { create } from 'zustand';
import { BatterySample, recordBatterySample, loadBatterySamples, saveBatterySamples } from './batteryEstimate';

interface BatteryState {
  hydrated: boolean;
  samples: BatterySample[];
  /** The last percent actually recorded (or seen while un-hydrated -- see
   * recordIfNew's comment on why this is marked *before* the hydration
   * check, not after). Mirrors StatusStrip's own former `lastRecordedPct`
   * ref, just as store state now that a ref can't be shared across two
   * components (StatusStrip + BatteryBadge). */
  lastRecordedPct: number | null;
  hydrate: () => Promise<void>;
  /** Records `pct` if it's new -- the same two-part guard StatusStrip's own
   * pair of effects used to enforce (hydration must have finished, and the
   * percent must have actually changed since the last recorded one). Safe to
   * call on every BLE status tick regardless of whether `pct` changed; it
   * only ever writes to `samples`/storage when it does. */
  recordIfNew: (pct: number, nowMs: number) => void;
}

export const useBatteryStore = create<BatteryState>((set, get) => ({
  hydrated: false,
  samples: [],
  lastRecordedPct: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const samples = await loadBatterySamples();
    set({ hydrated: true, samples });
  },

  recordIfNew: (pct, nowMs) => {
    if (pct < 0) return; // -1 == unavailable, see ble/protocol.ts Status.bat
    if (get().lastRecordedPct === pct) return;
    // Marked as seen even if hydration hasn't finished yet -- mirrors
    // StatusStrip's original ordering exactly (lastRecordedPct.current was
    // set before its setSamples updater's `prev === null` hydration check),
    // so a status tick that arrives before the persisted log has loaded is
    // silently skipped once, rather than retried the moment hydration
    // completes -- see loadBatterySamples' own call-site comment for why
    // that one-sample miss is an acceptable, documented tradeoff.
    set({ lastRecordedPct: pct });
    if (!get().hydrated) return;
    const prev = get().samples;
    const next = recordBatterySample(prev, { t: nowMs, pct });
    if (next !== prev) {
      set({ samples: next });
      saveBatterySamples(next);
    }
  },
}));
