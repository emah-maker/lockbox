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
