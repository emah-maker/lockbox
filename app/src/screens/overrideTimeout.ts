// overrideTimeout.ts -- pure bounds/format helpers for the Settings screen's
// "Override window" control (BoxBehaviorSection.tsx). Split out of the screen
// for the same reason overridePresses.ts and servoAngle.ts are: SettingsScreen
// transitively imports useStore.ts, which constructs a react-native-ble-plx
// BleManager at module load and throws under Jest with no test double. This
// module has zero react-native/store imports, so it loads in a plain Jest
// environment.
//
// THE UNIT. The box stores this in a single NVM byte and the BLE settings
// payload is all integers, so the value travels in TENTHS of a second
// (protocol.ts's `ovrt`) and is only ever rendered as seconds. Everything in
// this module is in tenths except formatOverrideTimeout's output -- that
// asymmetry is the whole reason the conversion lives in one file instead of
// being open-coded at each call site.
//
// Mirrors firmware/lib/lock_config.py's OVR_TIMEOUT_MIN_TENTHS/
// OVR_TIMEOUT_MAX_TENTHS -- keep these in lockstep with the firmware side.
// protocol.ts hardcodes the same bounds independently rather than importing
// this module, the same "wire-parsing module stays UI-independent" reasoning
// it already applies to the servo-angle and accent-index bounds.
export const OVR_TIMEOUT_MIN_TENTHS = 3;
export const OVR_TIMEOUT_MAX_TENTHS = 100;

// What the chip row offers. Not the full 3..100 range as a wheel: this is a
// "how much slack do I get between presses" dial, and the meaningful
// distinctions are coarse. The box clamps anything else that reaches it, so
// the presets are a UI convenience rather than the enforced set.
export const OVR_TIMEOUT_OPTIONS_TENTHS = [5, 10, 15, 20, 30, 50];

export function clampOverrideTimeoutTenths(tenths: number): number {
  if (!Number.isFinite(tenths)) return 10; // the firmware's own default, 1.0s
  return Math.max(OVR_TIMEOUT_MIN_TENTHS, Math.min(OVR_TIMEOUT_MAX_TENTHS, Math.round(tenths)));
}

/** Tenths -> a short display string: 5 -> "0.5s", 10 -> "1s", 15 -> "1.5s".
 * Whole seconds drop the ".0" so the common presets read as "1s"/"2s" rather
 * than the noisier "1.0s"/"2.0s". */
export function formatOverrideTimeout(tenths: number): string {
  const t = clampOverrideTimeoutTenths(tenths);
  return `${t % 10 === 0 ? String(t / 10) : (t / 10).toFixed(1)}s`;
}
