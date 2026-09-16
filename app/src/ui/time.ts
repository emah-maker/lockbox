// time.ts -- display-only time formatting: an 'HH:MM' clock-time string, as
// used for a goal reminder's time-of-day (GoalRow.tsx, GoalReminderControl.tsx,
// settings/NotificationsSection.tsx) and quiet-hours boundaries (also
// NotificationsSection.tsx), plus the short "1h 20m" duration phrasing the
// two reminder planners put in a notification body. Split out once those call
// sites had all converged on the same few lines with comments
// cross-referencing each other -- exactly the situation a shared helper
// exists for, rather than a fourth copy.
//
// This module imports NOTHING, which is what makes it usable from
// goals/goalNotificationPlan.ts and schedule/sessionReminderPlan.ts. Both are
// pure leaves that each kept a private shortDuration specifically to avoid
// importing stats/stats.ts's formatDuration, whose module drags in a
// dependency chain they deliberately don't have. Nothing here is that; the
// avoidance was of the chain, not of sharing.
//
// Lives here, not in goals/goalReminders.ts, on purpose: that module's own
// header describes itself as dependency-free (no RN, no Date, no locale) so
// it stays unit-testable and import-cycle-free from goals.ts. This is
// `Date`/locale-dependent DISPLAY logic, which is a different axis entirely
// -- it belongs beside this app's other presentation-only helpers (see
// ui/a11y.ts for the same kind of split), not folded into a module that
// exists specifically to avoid this.
/** `locale` exists so tests can pin a known format. Production callers omit
 * it and get the device's own locale, which is the whole point of formatting
 * through Intl rather than hand-rolling a 12h clock -- a 24h-locale user
 * should see 17:30, not 5:30 PM. Without the parameter the only way to assert
 * the midnight/noon behavior this module exists for would be to reconstruct
 * the expectation with the same Intl call, which asserts nothing. */
export function formatClockTime(value: string, locale?: string | string[]): string {
  const [h, m] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Short "1h 20m" / "45m" phrasing for a reminder body.
 *
 * Deliberately not stats/stats.ts's formatDuration, which zero-pads the
 * minutes ("1h 05m") and can return "0m": this one drops a zero minutes
 * component entirely ("1h", not "1h 00m") and floors at "1m", because a
 * notification saying "0m left" would be worse than saying nothing. The two
 * are different strings for different surfaces, not a duplicate pair.
 */
export function shortDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

// ---------------------------------------------------------------------------
// 12-hour clock parts, for the time-of-day WHEELS (ui/ClockWheels.tsx).
//
// Every time-of-day picker in this app used to be a 00-23 hour wheel, which
// asked a user reading "9:00 AM" everywhere else in the app -- every summary
// line, every chip, every notification body, all of them formatted through
// formatClockTime above -- to do the 24-hour translation themselves at the one
// moment they were actually choosing the value. These two functions are the
// whole conversion, kept here beside formatClockTime (and in this module
// specifically because it imports nothing, so schedule/ and goals/ can use
// them too) rather than open-coded at each wheel.
//
// Storage does not change: 'HH:MM' 24-hour remains the only on-the-wire and
// in-store shape (Goal.notifyAt/notifyTimes, ScheduledSession.time,
// quietStart/quietEnd), because the validators and planners that consume it
// are unchanged and the website dashboard writes the same strings.
// ---------------------------------------------------------------------------

export type ClockPeriod = 'AM' | 'PM';

/**
 * Hour labels for a 12-hour wheel, in the order a clock actually rolls over:
 * 12, 1, 2 ... 11.
 *
 * That ordering is load-bearing, not cosmetic. Each label's INDEX is exactly
 * `hour24 % 12`, so the wheel index and the clock hour are the same number and
 * the AM/PM flip is a plain +/-12 -- no lookup table, and no special case for
 * the two values a hand-rolled 1..12 conversion always gets wrong (12 AM is
 * hour 0, 12 PM is hour 12, and both of them sit at index 0 here).
 */
export const HOUR_12_LABELS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

/** A 0-23 hour as the wheel index (0-11, where 0 is the "12" slot) and the
 * period an AM/PM selector shows. Normalizes out-of-range input rather than
 * throwing: the callers are pickers parking a wheel, and a wheel always has
 * to land somewhere valid. */
export function hourToClock12(hour24: number): { hourIndex: number; period: ClockPeriod } {
  const h = ((Math.trunc(hour24) % 24) + 24) % 24;
  return { hourIndex: h % 12, period: h < 12 ? 'AM' : 'PM' };
}

/** The exact inverse of hourToClock12: a wheel index (0-11) plus a period back
 * to a 0-23 hour. */
export function clock12ToHour(hourIndex: number, period: ClockPeriod): number {
  const i = ((Math.trunc(hourIndex) % 12) + 12) % 12;
  return period === 'PM' ? i + 12 : i;
}

/** 'HH:MM' -> numbers, tolerating the malformed/absent value every picker in
 * this app already guarded against separately (a time written by the website
 * dashboard, or a field that hasn't been set yet). `fallback` is the caller's
 * own default -- a quiet-hours boundary opens at midnight, a reminder at 9am
 * -- so this can replace their private parseTime copies without changing what
 * any of them do when the value is unusable. */
export function parseClockTime(value: string | undefined, fallback: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '') ?? /^(\d{1,2}):(\d{2})$/.exec(fallback);
  if (!match) return { hour: 0, minute: 0 };
  // Wrapped, not clamped. '24:00' is midnight, and clamping it to 23:00 would
  // quietly move the value an hour rather than reading it -- worth getting
  // right because these fields have a SECOND writer (the website dashboard)
  // whose bounds this module does not control. The minute has no equivalent
  // rollover to do, since a wrapping minute would have to carry into the
  // hour; an out-of-range one is malformed, so it clamps.
  return {
    hour: parseInt(match[1], 10) % 24,
    minute: Math.min(59, parseInt(match[2], 10)),
  };
}

/** Numbers -> the zero-padded 'HH:MM' 24-hour string everything downstream
 * validates and stores. The counterpart of parseClockTime, and the reason a
 * 12-hour picker needs no other conversion on the way out. */
export function formatClock24(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
