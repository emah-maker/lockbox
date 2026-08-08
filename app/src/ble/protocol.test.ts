// Unit tests for the BLE wire-contract codecs. Run with `npm test` (jest-expo).
import { parseSettings, encodeSettings, Settings } from './protocol';

const FULL: Settings = { ovr: 25, auto: 1, sleep: 20, bright: 50, unlk: 0, ucal: 1 };

describe('encodeSettings / parseSettings round-trip', () => {
  it('round-trips every field, including ucal', () => {
    const parsed = parseSettings(encodeSettings(FULL));
    expect(parsed).toEqual(FULL);
  });

  it('defaults ucal to 0 when the firmware payload omits it (pre-upgrade box)', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0}');
    expect(parsed?.ucal).toBe(0);
  });

  it('coerces a truthy ucal to exactly 1', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0,"ucal":1}');
    expect(parsed?.ucal).toBe(1);
  });
});

describe('parseSettings defensive parsing', () => {
  it('returns null on garbled JSON', () => {
    expect(parseSettings('{"ovr":25,'))
      .toBeNull();
  });
});
