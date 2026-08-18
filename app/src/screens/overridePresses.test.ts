// overridePresses.test.ts -- covers the index<->value conversions behind the
// Override-presses horizontal wheel picker (SettingsScreen.tsx's
// `OverridePressPicker`). Split into its own module specifically so this
// logic is importable without SettingsScreen.tsx's react-native-ble-plx
// import chain (see overridePresses.ts's header comment).
import { overridePressIndex, overridePressValue, OVR_MIN, OVR_MAX, OVR_STEP } from './overridePresses';

describe('overridePressIndex / overridePressValue', () => {
  it('maps the min and max values to the first/last wheel index', () => {
    expect(overridePressIndex(OVR_MIN)).toBe(0);
    expect(overridePressIndex(OVR_MAX)).toBe((OVR_MAX - OVR_MIN) / OVR_STEP);
  });

  it('round-trips every on-grid value back to itself', () => {
    for (let v = OVR_MIN; v <= OVR_MAX; v += OVR_STEP) {
      expect(overridePressValue(overridePressIndex(v))).toBe(v);
    }
  });

  it('rounds an off-grid value (reachable via OverrideCustomEntry) to the nearest step', () => {
    // 137 is 26.4 steps above OVR_MIN -- rounds down to 26 (value 135), not up.
    expect(overridePressIndex(137)).toBe(26);
    expect(overridePressValue(overridePressIndex(137))).toBe(135);
    // 138 is 26.6 steps above OVR_MIN -- rounds up to 27 (value 140).
    expect(overridePressIndex(138)).toBe(27);
    expect(overridePressValue(overridePressIndex(138))).toBe(140);
  });

  it('clamps out-of-range values instead of returning an out-of-bounds index', () => {
    expect(overridePressIndex(OVR_MIN - 50)).toBe(0);
    expect(overridePressIndex(OVR_MAX + 50)).toBe((OVR_MAX - OVR_MIN) / OVR_STEP);
  });
});
