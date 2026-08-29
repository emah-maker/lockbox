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
import { formatClockTime } from './time';

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
