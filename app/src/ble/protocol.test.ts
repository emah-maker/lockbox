// Unit tests for the BLE wire-contract codecs. Run with `npm test` (jest-expo).
import {
  parseStatus,
  parseHistoryEntries,
  parseSettings,
  encodeSettings,
  Settings,
  cmdSetLabels,
  BLE_LABEL_MAX_COUNT,
  BLE_LABEL_NAME_MAX_LEN,
  cmdSetPendingTopic,
} from './protocol';

const FULL: Settings = { ovr: 25, auto: 1, sleep: 20, bright: 50, unlk: 0, ucal: 1, thm: 1, acc: 3, flip: 1, langle: 45, uangle: 0, ovrt: 10 };

describe('encodeSettings / parseSettings round-trip', () => {
  it('round-trips every field, including ucal, thm, acc, and flip', () => {
    const parsed = parseSettings(encodeSettings(FULL));
    expect(parsed).toEqual(FULL);
  });

  it('defaults ucal, thm, acc, and flip to 0 when the firmware payload omits them (pre-upgrade box)', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0}');
    expect(parsed?.ucal).toBe(0);
    expect(parsed?.thm).toBe(0);
    expect(parsed?.acc).toBe(0);
    expect(parsed?.flip).toBe(0);
  });

  it('defaults langle/uangle to the box\'s fixed pre-upgrade constants (45/0) when the payload omits them', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0}');
    expect(parsed?.langle).toBe(45);
    expect(parsed?.uangle).toBe(0);
  });

  // `ovrt` is in tenths, and a box on firmware older than the field sends
  // none at all. Falling back to 0 would render as "0.0s" and, echoed back,
  // be clamped by the box to a floor the user never chose.
  it("defaults ovrt to the box's own pre-upgrade constant (1.0s = 10 tenths) when the payload omits it", () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0}');
    expect(parsed?.ovrt).toBe(10);
  });

  it('clamps ovrt into [3, 100] tenths at both parse and encode time', () => {
    expect(parseSettings('{"ovrt":0}')?.ovrt).toBe(3);
    expect(parseSettings('{"ovrt":9999}')?.ovrt).toBe(100);
    expect(parseSettings(encodeSettings({ ...FULL, ovrt: 0 }))?.ovrt).toBe(3);
    expect(parseSettings(encodeSettings({ ...FULL, ovrt: 9999 }))?.ovrt).toBe(100);
  });

  it('keeps ovrt an integer in tenths on the wire -- never seconds, never a float', () => {
    const encoded = encodeSettings({ ...FULL, ovrt: 15 });
    expect(JSON.parse(encoded).ovrt).toBe(15);
    expect(encoded).toContain('"ovrt":15');
  });

  it('preserves a legitimate 0 langle instead of falling back to the 45 default', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0,"langle":0}');
    expect(parsed?.langle).toBe(0);
  });

  it('round-trips negative angles', () => {
    const encoded = encodeSettings({ ...FULL, langle: -90, uangle: -45 });
    const parsed = parseSettings(encoded);
    expect(parsed?.langle).toBe(-90);
    expect(parsed?.uangle).toBe(-45);
  });

  it('clamps an out-of-range langle/uangle to [-90, 90] instead of forwarding garbage to the box', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0,"langle":200,"uangle":-200}');
    expect(parsed?.langle).toBe(90);
    expect(parsed?.uangle).toBe(-90);
  });

  it('coerces a truthy flip to exactly 1', () => {
    const parsed = parseSettings('{"ovr":25,"auto":1,"sleep":20,"bright":50,"unlk":0,"flip":1}');
    expect(parsed?.flip).toBe(1);
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

  it('sanitizes a non-finite langle/uangle to their own defaults (45/0), not 0 for both', () => {
    const withNaN: Settings = { ...FULL, langle: NaN, uangle: Infinity };
    const encoded = encodeSettings(withNaN);
    const parsed = parseSettings(encoded);
    expect(parsed?.langle).toBe(45);
    expect(parsed?.uangle).toBe(0);
  });

  it('clamps an out-of-range langle/uangle at encode time too', () => {
    const encoded = encodeSettings({ ...FULL, langle: 500, uangle: -500 });
    const parsed = parseSettings(encoded);
    expect(parsed?.langle).toBe(90);
    expect(parsed?.uangle).toBe(-90);
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

describe('cmdSetPendingTopic', () => {
  it('round-trips a real topic id unchanged', () => {
    expect(cmdSetPendingTopic('custom:abc')).toBe('custom:abc');
  });

  it('encodes null as the empty-string "nothing pending" sentinel', () => {
    expect(cmdSetPendingTopic(null)).toBe('');
  });
});


// A garbled-but-parseable frame is the case these parsers exist for (see
// protocol.ts's "the radio can hand us partial/garbled JSON"). The danger is
// not a throw -- JSON.parse is already wrapped -- it is a field that comes
// back as NaN and is then carried, silently, into durable storage.
describe('parseStatus hardening', () => {
  const frame = (over: Record<string, unknown>) =>
    JSON.stringify({ st: 'running', rem: 10, set: 60, bat: 50, tp: '', fw: '1.0', ...over });

  it('reports an unreadable battery as the -1 sentinel, never NaN', () => {
    // NaN here defeats both of useBatteryStore.recordIfNew's skip guards
    // (`pct < 0` and `lastRecordedPct === pct`, and NaN equals nothing), so
    // every status tick would append another NaN to the persisted sample log.
    for (const bad of ['--', 'n/a', {}, [1, 2], null]) {
      expect(parseStatus(frame({ bat: bad }))!.bat).toBe(-1);
    }
  });

  it('still reports a genuine 0% battery as 0, not as the -1 sentinel', () => {
    expect(parseStatus(frame({ bat: 0 }))!.bat).toBe(0);
  });

  it('rejects a frame whose state is not one of the four BoxStates', () => {
    expect(parseStatus(frame({ st: 'paused' }))).toBeNull();
    expect(parseStatus(frame({ st: '' }))).toBeNull();
    expect(parseStatus(frame({ st: 3 }))).toBeNull();
  });

  it('accepts every real BoxState', () => {
    for (const st of ['idle', 'closed', 'running', 'done']) {
      expect(parseStatus(frame({ st }))!.st).toBe(st);
    }
  });
});

describe('parseHistoryEntries hardening', () => {
  it('reports an unreadable end-time as the -1 "never synced" sentinel, never NaN', () => {
    // buildLoggedSessions branches on `t < 0`, which NaN fails -- so a NaN
    // here became `startedAt: NaN` in the durable session log, a session that
    // day-buckets as 'NaN-NaN-NaN' and uploads under a doc id containing NaN.
    const [entry] = parseHistoryEntries(JSON.stringify([{ p: 1500, a: 1500, c: 1, t: 'oops' }]));
    expect(entry.t).toBe(-1);
    expect(Number.isNaN(entry.t)).toBe(false);
  });

  it('keeps a real epoch timestamp intact', () => {
    const [entry] = parseHistoryEntries(JSON.stringify([{ p: 1500, a: 1500, c: 1, t: 1700000000 }]));
    expect(entry.t).toBe(1700000000);
  });
});

// firestore.rules' sessions `create` rule type-checks every field
// (startedAt/plannedS/actualS `is int` and `>= 0`, topic.size() <= 200). A
// value that fails any of those isn't a slightly-wrong session -- the doc is
// refused, which fails the whole writeBatch, which fails syncSessions, the
// FIRST step of runMigrationAndSync. Settings, goals and scheduled sessions
// never reconcile either, and since the record stays in local storage every
// later sync retries it and fails identically. One malformed frame otherwise
// ends the account's sync for good, so the bound belongs here at the parser.
describe('parser output stays inside what firestore.rules will accept', () => {
  it('floors fractional durations and timestamps to whole seconds', () => {
    const [e] = parseHistoryEntries(JSON.stringify([{ p: 1500.5, a: 1500.25, c: 1, t: 1700000000.9 }]));
    expect(Number.isInteger(e.p)).toBe(true);
    expect(Number.isInteger(e.a)).toBe(true);
    expect(Number.isInteger(e.t)).toBe(true);
    expect(e).toEqual({ p: 1500, a: 1500, c: 1, t: 1700000000 });
  });

  it('still floors toward the -1 sentinel rather than away from it', () => {
    const [e] = parseHistoryEntries(JSON.stringify([{ p: 60, a: 60, c: 0, t: 'x' }]));
    expect(e.t).toBe(-1);
  });

  it('caps an over-length topic echo, which is not display-only', () => {
    // tp becomes this device's pending tag, which becomes a logged session's
    // topic, which is uploaded -- so an unbounded string here reaches a rule
    // that bounds it at 200.
    const frame = JSON.stringify({ st: 'running', rem: 1, set: 1, bat: 1, tp: 'x'.repeat(500), fw: '1.0' });
    expect(parseStatus(frame)!.tp).toHaveLength(200);
  });

  it('caps an over-length firmware string', () => {
    const frame = JSON.stringify({ st: 'idle', rem: 0, set: 0, bat: 1, tp: '', fw: 'v'.repeat(500) });
    expect(parseStatus(frame)!.fw.length).toBeLessThanOrEqual(32);
  });

  it('leaves an ordinary topic id and version untouched', () => {
    const frame = JSON.stringify({ st: 'running', rem: 1, set: 1, bat: 1, tp: 'custom:abc123', fw: '1.2.0' });
    const parsed = parseStatus(frame)!;
    expect(parsed.tp).toBe('custom:abc123');
    expect(parsed.fw).toBe('1.2.0');
  });
});
