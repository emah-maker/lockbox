// Unit tests for the servo-angle clamp. Run with `npm test` (jest-expo).
import { clampServoAngle, SERVO_ANGLE_MIN, SERVO_ANGLE_MAX } from './servoAngle';

describe('clampServoAngle', () => {
  it('passes through an in-range value unchanged', () => {
    expect(clampServoAngle(45)).toBe(45);
    expect(clampServoAngle(0)).toBe(0);
    expect(clampServoAngle(-45)).toBe(-45);
  });

  it('clamps above SERVO_ANGLE_MAX', () => {
    expect(clampServoAngle(200)).toBe(SERVO_ANGLE_MAX);
    expect(clampServoAngle(91)).toBe(SERVO_ANGLE_MAX);
  });

  it('clamps below SERVO_ANGLE_MIN', () => {
    expect(clampServoAngle(-200)).toBe(SERVO_ANGLE_MIN);
    expect(clampServoAngle(-91)).toBe(SERVO_ANGLE_MIN);
  });

  it('preserves the exact boundary values', () => {
    expect(clampServoAngle(SERVO_ANGLE_MIN)).toBe(SERVO_ANGLE_MIN);
    expect(clampServoAngle(SERVO_ANGLE_MAX)).toBe(SERVO_ANGLE_MAX);
  });
});
