// Unit tests for the BLE wire-contract codecs. Run with `npm test` (jest-expo).
import { parseSettings, encodeSettings, Settings } from './protocol';

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
    expect(parsed?.acc).toBe(4);
  });

  it('treats any thm value other than 1 as dark (0)', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0,"thm":7}');
    expect(parsed?.thm).toBe(0);
  });
});

describe('parseSettings defensive parsing', () => {
  it('returns null on garbled JSON', () => {
    expect(parseSettings('{"ovr":25,'))
      .toBeNull();
  });
});
