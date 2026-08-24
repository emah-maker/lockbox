// servoAngle.ts -- pure clamp for the Settings screen's lock/unlock
// servo-angle entries (ServoAngleSection.tsx). Split out the same way
// overridePresses.ts is split from OverridePressSection.tsx --
// SettingsScreen.tsx's import graph pulls in useStore.ts (constructs a
// react-native-ble-plx BleManager at module load, which throws under Jest
// with no test double registered), so this module has zero react-native/
// store imports and loads cleanly in a plain Jest environment.
//
// Mirrors Box-code/lib/lock_config.py's fixed servo lock/unlock angle
// constants (45/0) and the [-90, 90] range the box itself clamps to -- keep
// SERVO_ANGLE_MIN/MAX in lockstep with the firmware side. protocol.ts
// hardcodes the same bounds independently rather than importing this module,
// the same "wire-parsing module stays UI-independent" reasoning it already
// applies to the accent-index upper bound.
export const SERVO_ANGLE_MIN = -90;
export const SERVO_ANGLE_MAX = 90;

export function clampServoAngle(value: number): number {
  return Math.max(SERVO_ANGLE_MIN, Math.min(SERVO_ANGLE_MAX, value));
}
