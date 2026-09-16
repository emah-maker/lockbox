// Unit tests for the shared 'HH:MM' clock-time formatter. Run with `npm test`
// (jest-expo). Covers the midnight/noon boundary cases specifically because
// those are where a hand-rolled 12h formatter is most likely to disagree with
// `toLocaleTimeString` (00:xx and 12:xx both need to read as 12, not 0).
//
// The exact-string cases pin `en-US` rather than relying on the runner's own
// locale. They used to assert '9:00 AM' against whatever Intl defaulted to,
// which passes on a US-configured machine and fails on a 24h one -- the
// assertions were really testing the runner's configuration as much as this
// module. Pinning keeps the midnight/noon coverage meaningful anywhere.
//
// The locale-agnostic block below is the part that must hold in EVERY locale,
// so it deliberately omits the argument and exercises the same default path
// production uses.
import {
  HOUR_12_LABELS,
  clock12ToHour,
  formatClock24,
  formatClockTime,
  hourToClock12,
  parseClockTime,
} from './time';

describe('formatClockTime', () => {
  describe('en-US formatting (locale pinned so this is reproducible)', () => {
    it('formats an ordinary morning time', () => {
      expect(formatClockTime('09:00', 'en-US')).toBe('9:00 AM');
    });

    it('formats an ordinary afternoon time', () => {
      expect(formatClockTime('17:30', 'en-US')).toBe('5:30 PM');
    });

    it('reads midnight as 12 AM, not 0 AM', () => {
      expect(formatClockTime('00:05', 'en-US')).toBe('12:05 AM');
    });

    it('reads noon as 12 PM, not 0 PM', () => {
      expect(formatClockTime('12:00', 'en-US')).toBe('12:00 PM');
    });

    it('formats the last minute of the day', () => {
      expect(formatClockTime('23:59', 'en-US')).toBe('11:59 PM');
    });
  });

  describe('a 24h locale still round-trips the hour', () => {
    it('keeps midnight and noon distinct where both print as a bare hour', () => {
      // de-DE has no AM/PM, so 00:05 and 12:05 can only differ by the hour
      // itself -- this is the case a 12h-only assertion would never catch.
      expect(formatClockTime('00:05', 'de-DE')).not.toBe(formatClockTime('12:05', 'de-DE'));
      expect(formatClockTime('00:05', 'de-DE')).toContain('05');
    });
  });

  describe('default locale (the path production actually takes)', () => {
    it('distinguishes midnight from noon whatever the device locale is', () => {
      expect(formatClockTime('00:05')).not.toBe(formatClockTime('12:05'));
    });

    it('distinguishes morning from evening whatever the device locale is', () => {
      expect(formatClockTime('09:00')).not.toBe(formatClockTime('21:00'));
    });

    it('renders the minutes, and never NaN, for every hour of the day', () => {
      for (let h = 0; h < 24; h++) {
        const out = formatClockTime(`${String(h).padStart(2, '0')}:07`);
        expect(out).toContain('07');
        expect(out).not.toContain('NaN');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// The 12-hour parts behind ui/ClockWheels.tsx.
//
// The round-trip is the whole contract: the app stores 'HH:MM' 24-hour, the
// picker shows a 12-hour index plus AM/PM, and a value that survives a trip
// through the picker untouched must come back out byte-identical. 12 AM (hour
// 0) and 12 PM (hour 12) get their own cases because they are where every
// hand-rolled 12-hour conversion goes wrong, and because the app's wheel
// shows a bare "12" for both.
// ---------------------------------------------------------------------------

describe('HOUR_12_LABELS', () => {
  it('reads as a clock, so each index IS the hour modulo 12', () => {
    expect(HOUR_12_LABELS).toHaveLength(12);
    expect(HOUR_12_LABELS[0]).toBe('12');
    for (let i = 1; i < 12; i++) expect(HOUR_12_LABELS[i]).toBe(String(i));
  });
});

describe('hourToClock12 / clock12ToHour', () => {
  it('round-trips every hour of the day exactly', () => {
    for (let h = 0; h < 24; h++) {
      const { hourIndex, period } = hourToClock12(h);
      expect(clock12ToHour(hourIndex, period)).toBe(h);
    }
  });

  it('puts midnight and noon both on the "12" slot, told apart by the period', () => {
    expect(hourToClock12(0)).toEqual({ hourIndex: 0, period: 'AM' });
    expect(hourToClock12(12)).toEqual({ hourIndex: 0, period: 'PM' });
    expect(clock12ToHour(0, 'AM')).toBe(0);
    expect(clock12ToHour(0, 'PM')).toBe(12);
  });

  it('splits AM from PM at noon, not at 1pm', () => {
    expect(hourToClock12(11).period).toBe('AM');
    expect(hourToClock12(12).period).toBe('PM');
    expect(hourToClock12(23)).toEqual({ hourIndex: 11, period: 'PM' });
  });

  it('agrees with the label a user actually reads, for every hour', () => {
    // Cross-checked against formatClockTime, which is what every summary
    // line, chip and notification body in the app already shows -- the
    // mismatch between those and the old 00-23 wheel is why this exists.
    for (let h = 0; h < 24; h++) {
      const { hourIndex, period } = hourToClock12(h);
      const shown = formatClockTime(formatClock24(h, 30), 'en-US');
      expect(shown).toBe(`${HOUR_12_LABELS[hourIndex]}:30 ${period}`);
    }
  });

  it('flipping the period alone moves the value exactly 12 hours', () => {
    for (let h = 0; h < 24; h++) {
      const { hourIndex, period } = hourToClock12(h);
      const flipped = clock12ToHour(hourIndex, period === 'AM' ? 'PM' : 'AM');
      expect(Math.abs(flipped - h)).toBe(12);
    }
  });

  it('normalizes rather than throwing on out-of-range input', () => {
    // The callers are wheels parking themselves; a wheel always has to land
    // somewhere valid.
    expect(hourToClock12(24)).toEqual({ hourIndex: 0, period: 'AM' });
    expect(hourToClock12(-1).hourIndex).toBeGreaterThanOrEqual(0);
    expect(clock12ToHour(12, 'AM')).toBe(0);
    expect(clock12ToHour(-1, 'AM')).toBeGreaterThanOrEqual(0);
  });
});

describe('parseClockTime / formatClock24', () => {
  it('round-trips every minute of the day', () => {
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m++) {
        const s = formatClock24(h, m);
        expect(parseClockTime(s, '09:00')).toEqual({ hour: h, minute: m });
      }
    }
  });

  it('zero-pads, since that is the stored shape the validators accept', () => {
    expect(formatClock24(9, 5)).toBe('09:05');
    expect(formatClock24(0, 0)).toBe('00:00');
    expect(formatClock24(23, 59)).toBe('23:59');
  });

  it('falls back per caller when the value is absent or malformed', () => {
    // Each replaced copy had its own hardcoded default: a reminder opens at
    // 9am, a quiet-hours boundary at midnight.
    expect(parseClockTime(undefined, '09:00')).toEqual({ hour: 9, minute: 0 });
    expect(parseClockTime(undefined, '00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseClockTime('', '09:00')).toEqual({ hour: 9, minute: 0 });
    expect(parseClockTime('not a time', '00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseClockTime('9', '09:00')).toEqual({ hour: 9, minute: 0 });
  });

  it('accepts an unpadded hour, which the website dashboard can write', () => {
    expect(parseClockTime('9:05', '00:00')).toEqual({ hour: 9, minute: 5 });
  });

  it('wraps a 24 hour to midnight instead of clamping it to 23', () => {
    // These fields have a second writer (the website dashboard), so reading
    // '24:00' as 23:00 would silently move the value an hour.
    expect(parseClockTime('24:00', '09:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseClockTime('24:30', '09:00')).toEqual({ hour: 0, minute: 30 });
  });

  it('survives the full picker pipeline for every on-grid value', () => {
    // formatClock24 -> parseClockTime -> hourToClock12 -> clock12ToHour ->
    // formatClock24 is exactly what happens when a user opens a picker and
    // commits without changing anything. It must be the identity.
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) {
        const stored = formatClock24(h, m);
        const { hour, minute } = parseClockTime(stored, '09:00');
        const { hourIndex, period } = hourToClock12(hour);
        expect(formatClock24(clock12ToHour(hourIndex, period), minute)).toBe(stored);
      }
    }
  });
});
