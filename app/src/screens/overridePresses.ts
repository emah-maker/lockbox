// overridePresses.ts -- pure index<->value conversions for the Settings
// screen's Override-presses horizontal wheel picker. Split out of
// SettingsScreen.tsx (a screen-only helper, so it stays beside its screen
// rather than moving to a generic folder) purely so it can be unit-tested
// without pulling in that file's import graph -- SettingsScreen.tsx
// transitively imports useStore.ts, which constructs a react-native-ble-plx
// BleManager at module load time, and that throws under Jest
// ("`new NativeEventEmitter()` requires a non-null argument") with no test
// double registered for it. This module has zero react-native/store imports,
// so it loads cleanly in a plain Jest environment.
//
// Mirrors firmware/lib/lock_config.py's OVR_MIN/OVR_MAX/OVR_STEP -- keep
// these in lockstep with the firmware side.
export const OVR_MIN = 5;
export const OVR_MAX = 500;
export const OVR_STEP = 5;
const OVR_STEPS = (OVR_MAX - OVR_MIN) / OVR_STEP;

// One label per wheel step (5, 10, 15, ... 500) -- built once at module scope
// since it never depends on props/state.
export const OVR_LABELS = Array.from({ length: OVR_STEPS + 1 }, (_, i) => String(OVR_MIN + i * OVR_STEP));

// `OverrideCustomEntry` (SettingsScreen.tsx) can commit any integer in
// [OVR_MIN, OVR_MAX], not just multiples of OVR_STEP -- clamp defensively so
// an off-grid value (e.g. a custom "137") still resolves to an in-range index
// (nearest step, "135") instead of an out-of-bounds one; same "app clamps
// too" belt-and-suspenders as clampLockSeconds.
export function overridePressIndex(value: number): number {
  return Math.max(0, Math.min(OVR_STEPS, Math.round((value - OVR_MIN) / OVR_STEP)));
}

export function overridePressValue(index: number): number {
  return OVR_MIN + index * OVR_STEP;
}
