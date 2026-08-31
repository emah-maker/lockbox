// Tests for overrideTimeout.ts -- the tenths-of-a-second bounds and display
// formatting behind the Settings screen's "Override window" control.
//
// The thing worth testing here is the unit. Every other numeric setting in
// this app is in the unit it is displayed in; this one travels in tenths and
// renders in seconds, so a conversion applied twice, or not at all, produces
// a plausible-looking number (1s vs 10s vs 0.1s) rather than an obvious one.
import {
  OVR_TIMEOUT_MIN_TENTHS,
  OVR_TIMEOUT_MAX_TENTHS,
  OVR_TIMEOUT_OPTIONS_TENTHS,
  clampOverrideTimeoutTenths,
  formatOverrideTimeout,
} from './overrideTimeout';

describe('clampOverrideTimeoutTenths', () => {
  it('leaves an in-range value alone', () => {
    expect(clampOverrideTimeoutTenths(15)).toBe(15);
  });

  it('clamps to the floor rather than allowing a window nothing can be pressed within', () => {
    expect(clampOverrideTimeoutTenths(0)).toBe(OVR_TIMEOUT_MIN_TENTHS);
    expect(clampOverrideTimeoutTenths(-40)).toBe(OVR_TIMEOUT_MIN_TENTHS);
  });

  it('clamps to the ceiling', () => {
    expect(clampOverrideTimeoutTenths(9999)).toBe(OVR_TIMEOUT_MAX_TENTHS);
  });

  it('rounds a fractional value -- the wire and the NVM byte are both integers', () => {
    expect(clampOverrideTimeoutTenths(12.4)).toBe(12);
    expect(clampOverrideTimeoutTenths(12.6)).toBe(13);
  });

  // NaN reaching the box would be clamped there anyway, but it would render
  // as "NaNs" in the UI first.
  it('falls back to the firmware default (1.0s) for a non-finite value', () => {
    expect(clampOverrideTimeoutTenths(NaN)).toBe(10);
    expect(clampOverrideTimeoutTenths(Infinity)).toBe(10);
  });
});

describe('formatOverrideTimeout', () => {
  it('renders whole seconds without a trailing .0', () => {
    expect(formatOverrideTimeout(10)).toBe('1s');
    expect(formatOverrideTimeout(20)).toBe('2s');
    expect(formatOverrideTimeout(50)).toBe('5s');
  });

  it('renders a half step with one decimal', () => {
    expect(formatOverrideTimeout(5)).toBe('0.5s');
    expect(formatOverrideTimeout(15)).toBe('1.5s');
  });

  it('clamps before formatting, so an out-of-range value never renders', () => {
    expect(formatOverrideTimeout(0)).toBe('0.3s');
    expect(formatOverrideTimeout(9999)).toBe('10s');
  });
});

describe('the preset options', () => {
  it('are all inside the bounds the box enforces', () => {
    for (const t of OVR_TIMEOUT_OPTIONS_TENTHS) {
      expect(t).toBeGreaterThanOrEqual(OVR_TIMEOUT_MIN_TENTHS);
      expect(t).toBeLessThanOrEqual(OVR_TIMEOUT_MAX_TENTHS);
      // A preset that the box would clamp is a chip the user can tap and
      // then watch snap to something else on the next read-back.
      expect(clampOverrideTimeoutTenths(t)).toBe(t);
    }
  });

  it('include the firmware default, so a fresh box shows an active chip', () => {
    expect(OVR_TIMEOUT_OPTIONS_TENTHS).toContain(10);
  });

  it('are ascending and unique', () => {
    const sorted = [...OVR_TIMEOUT_OPTIONS_TENTHS].sort((a, b) => a - b);
    expect(OVR_TIMEOUT_OPTIONS_TENTHS).toEqual(sorted);
    expect(new Set(OVR_TIMEOUT_OPTIONS_TENTHS).size).toBe(OVR_TIMEOUT_OPTIONS_TENTHS.length);
  });
});
