// Unit tests for the BLE wire-contract codecs. Run with `npm test` (jest-expo).
import {
  parseSettings,
  encodeSettings,
  Settings,
  cmdSetLabels,
  BLE_LABEL_MAX_COUNT,
  BLE_LABEL_NAME_MAX_LEN,
} from './protocol';

const FULL: Settings = { ovr: 25, auto: 1, sleep: 20, bright: 50, unlk: 0, ucal: 1, thm: 1, acc: 3 };

describe('encodeSettings / parseSettings round-trip', () => {
  it('round-trips every field, including ucal, thm, and acc', () => {
    const parsed = parseSettings(encodeSettings(FULL));
    expect(parsed).toEqual(FULL);
  });

  it('defaults ucal, thm, and acc to 0 when the firmware payload omits them (pre-upgrade box)', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0}');
    expect(parsed?.ucal).toBe(0);
    expect(parsed?.thm).toBe(0);
    expect(parsed?.acc).toBe(0);
  });

  it('coerces a truthy ucal to exactly 1', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0,"ucal":1}');
    expect(parsed?.ucal).toBe(1);
  });

  it('clamps an out-of-range acc index instead of forwarding garbage to the box', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0,"acc":99}');
    // Upper bound is 7 (8 accents: mint/coral/amber/sky/violet/rose/teal/indigo,
    // see ACCENT_KEYS in ../theme/theme.ts) -- was 5 before teal/indigo were added.
    expect(parsed?.acc).toBe(7);
  });

  it('treats any thm value other than 1 as dark (0)', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0,"thm":7}');
    expect(parsed?.thm).toBe(0);
  });

  // Production readiness review, Low: "asymmetric input clamping between BLE
  // encode/parse paths" -- cmdStart/cmdSetDuration always clamped their
  // numeric input, but encodeSettings used to JSON.stringify(s) verbatim. A
  // NaN in any numeric field would serialize as a bare `NaN` token, which
  // isn't valid JSON, aborting the box's parse of the entire settings write.
  it('sanitizes NaN/non-finite numeric fields instead of emitting invalid JSON', () => {
    const withNaN: Settings = { ...FULL, ovr: NaN, sleep: Infinity, bright: -Infinity };
    const encoded = encodeSettings(withNaN);
    expect(() => JSON.parse(encoded)).not.toThrow();
    const parsed = parseSettings(encoded);
    expect(parsed?.ovr).toBe(0);
    expect(parsed?.sleep).toBe(0);
    expect(parsed?.bright).toBe(0);
  });

  it('floors non-integer numeric fields the same way cmdStart/cmdSetDuration do', () => {
    const encoded = encodeSettings({ ...FULL, ovr: 25.7, bright: 50.2 });
    const parsed = parseSettings(encoded);
    expect(parsed?.ovr).toBe(25);
    expect(parsed?.bright).toBe(50);
  });
});

describe('parseSettings defensive parsing', () => {
  it('returns null on garbled JSON', () => {
    expect(parseSettings('{"ovr":25,'))
      .toBeNull();
  });
});

describe('cmdSetLabels', () => {
  it('encodes the label catalog as raw JSON with compact i/n/c keys', () => {
    const labels = [{ id: 'custom:abc', name: 'Reading', color: '#e11d48' }];
    expect(cmdSetLabels(labels)).toBe(JSON.stringify([{ i: 'custom:abc', n: 'Reading', c: '#e11d48' }]));
  });

  it('round-trips an empty catalog', () => {
    expect(cmdSetLabels([])).toBe('[]');
  });

  it('truncates a name past BLE_LABEL_NAME_MAX_LEN so the box never receives an over-length one', () => {
    const labels = [{ id: 'custom:1', name: 'A Very Long Custom Label Name', color: '#e11d48' }];
    const [encoded] = JSON.parse(cmdSetLabels(labels));
    expect(encoded.n).toBe('A Very Long '.slice(0, BLE_LABEL_NAME_MAX_LEN));
    expect(encoded.n.length).toBe(BLE_LABEL_NAME_MAX_LEN);
  });

  it('caps the catalog at BLE_LABEL_MAX_COUNT entries', () => {
    const labels = Array.from({ length: BLE_LABEL_MAX_COUNT + 3 }, (_, i) => ({
      id: `custom:${i}`,
      name: `Label ${i}`,
      color: '#e11d48',
    }));
    const decoded = JSON.parse(cmdSetLabels(labels));
    expect(decoded).toHaveLength(BLE_LABEL_MAX_COUNT);
    expect(decoded[0].i).toBe('custom:0');
  });
});
