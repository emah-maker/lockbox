// Unit tests for the shared 'HH:MM' clock-time formatter. Run with `npm test`
// (jest-expo). Covers the midnight/noon boundary cases specifically because
// those are where a hand-rolled 12h formatter is most likely to disagree with
// `toLocaleTimeString` (00:xx and 12:xx both need to read as 12, not 0).
import { formatClockTime } from './time';

describe('formatClockTime', () => {
  it('formats an ordinary morning time', () => {
    expect(formatClockTime('09:00')).toBe('9:00 AM');
  });

  it('formats an ordinary afternoon time', () => {
    expect(formatClockTime('17:30')).toBe('5:30 PM');
  });

  it('reads midnight as 12 AM, not 0 AM', () => {
    expect(formatClockTime('00:05')).toBe('12:05 AM');
  });

  it('reads noon as 12 PM, not 0 PM', () => {
    expect(formatClockTime('12:00')).toBe('12:00 PM');
  });

  it('formats the last minute of the day', () => {
    expect(formatClockTime('23:59')).toBe('11:59 PM');
  });
});
