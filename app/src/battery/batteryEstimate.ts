// batteryEstimate.ts -- turns the raw battery-percent samples StatusStrip
// records off the box's live BLE status into a "time remaining" estimate.
// Pure/no-deps core (same style as ../stats/trend.ts, unit-testable without
// React or AsyncStorage), plus a thin persistence pair at the bottom so the
// sample log survives an app restart -- StatusStrip is the only caller of
// those, and this keeps useStore.ts (which already owns every other piece
// of BLE-derived state) untouched, per this task's file-ownership split.
import { getJSON, setJSON } from '../storage/storage';

export interface BatterySample {
  t: number; // epoch ms
  pct: number; // 0..100
}

// Caps both how far back a discharge fit ever looks and how much this log
// can grow -- a box connected for weeks without a restart would otherwise
// accumulate one sample per status tick with a status.bat *change* forever.
const MAX_SAMPLE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_SAMPLES = 500;

// The window a discharge-rate fit is drawn from -- recent enough to reflect
// how the box is actually being used right now (a session-heavy day drains
// faster than an idle one), not a whole week smoothed together.
const RECENT_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const MIN_SAMPLES_FOR_RATE = 3;
// A step this large between two samples is a real charge (plugged in), not
// sensor noise/rounding on an otherwise-flat reading -- see
// dischargeRatePerHour's charging detection and jump-skipping below.
const CHARGE_JUMP_PCT = 1;

/** Appends `sample` to `samples`, pruning anything older than
 * MAX_SAMPLE_AGE_MS and capping the result at MAX_SAMPLES (dropping the
 * oldest first). Drops the sample entirely -- returning `samples` unchanged
 * -- if it carries no new information: the same percent as the last
 * recorded sample (nothing to fit a slope from) or a timestamp that doesn't
 * move the log forward (a stale/out-of-order status tick, which a slope fit
 * assumes never happens). */
export function recordBatterySample(samples: BatterySample[], sample: BatterySample): BatterySample[] {
  const last = samples[samples.length - 1];
  if (last && (last.pct === sample.pct || sample.t <= last.t)) return samples;
  const cutoff = sample.t - MAX_SAMPLE_AGE_MS;
  const next = [...samples, sample].filter((s) => s.t >= cutoff);
  if (next.length > MAX_SAMPLES) next.splice(0, next.length - MAX_SAMPLES);
  return next;
}

/** %/hour discharge rate (positive = draining), fit by least-squares slope
 * over the most recent samples rather than a naive two-point delta -- a
 * single noisy/rounded reading at either end of a two-point fit can swing
 * the estimate wildly; a line fit through several points damps that out.
 * Returns null when there isn't enough data, the fit is flat/rising, or the
 * box looks to be actively charging right now. */
export function dischargeRatePerHour(samples: BatterySample[]): number | null {
  if (samples.length < 2) return null;
  const latestT = samples[samples.length - 1].t;
  const recent = samples.filter((s) => s.t >= latestT - RECENT_WINDOW_MS);
  const usable = recent.length >= MIN_SAMPLES_FOR_RATE ? recent : samples;
  if (usable.length < 2) return null;

  // Charging is detected, not assumed: a real jump up right at the end of
  // the window (not a single-point blip buried earlier in it) means the box
  // is gaining charge *now*, so there is no discharge rate to report.
  const last = usable[usable.length - 1];
  const secondLast = usable[usable.length - 2];
  if (last.pct - secondLast.pct > CHARGE_JUMP_PCT) return null;

  // Skip any point that's a sharp upward jump from its predecessor -- a
  // brief plug-in/unplug earlier in the window shouldn't skew the fitted
  // discharge line even though the box is net discharging overall.
  const pts = usable.filter((s, i) => i === 0 || s.pct - usable[i - 1].pct <= CHARGE_JUMP_PCT);
  if (pts.length < 2) return null;

  const t0 = pts[0].t;
  const xs = pts.map((s) => (s.t - t0) / 3_600_000); // hours since the first usable sample
  const ys = pts.map((s) => s.pct);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null; // every usable point landed at the same x (timestamp) -- no slope to fit
  const slope = num / den; // %/hour, negative while discharging
  if (slope >= 0) return null; // fit came out flat or rising -- nothing usefully "draining" to report
  return -slope;
}

/** Milliseconds of runtime left at the current `pct`, or null if unknown
 * (no usable discharge rate) or the box looks to be charging. `pct < 0`
 * (Status.bat's own "unavailable" convention, see ble/protocol.ts) always
 * returns null. */
export function estimateRemainingMs(samples: BatterySample[], pct: number): number | null {
  if (pct < 0) return null;
  const rate = dischargeRatePerHour(samples);
  if (rate === null || rate <= 0) return null;
  return (pct / rate) * 3_600_000;
}

/** Formats a runtime estimate the way a user reads it at a glance -- days+
 * hours, whole hours, or whole minutes, never mixing more than two units.
 * Null in, null out (propagates estimateRemainingMs's "unknown" straight
 * through) and null for anything under a minute (nothing worth showing). */
export function formatRemaining(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return null;
  if (totalMinutes < 60) return `~${totalMinutes}m left`;
  const totalHours = Math.round(ms / 3_600_000);
  if (totalHours < 24) return `~${totalHours}h left`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `~${days}d ${hours}h left` : `~${days}d left`;
}

// ----- persistence -----
// Thin wrapper over storage.ts, kept here (not useStore.ts) so StatusStrip
// can load/save the sample log without this task touching the BLE store.
const BATTERY_SAMPLES_KEY = 'batterySamples';

export function loadBatterySamples(): Promise<BatterySample[]> {
  return getJSON<BatterySample[]>(BATTERY_SAMPLES_KEY, []);
}

export function saveBatterySamples(samples: BatterySample[]): Promise<void> {
  return setJSON(BATTERY_SAMPLES_KEY, samples);
}
