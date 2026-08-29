// time.ts -- display-only formatting for an 'HH:MM' clock-time string, as
// used for a goal reminder's time-of-day (GoalRow.tsx, GoalReminderControl.tsx,
// settings/NotificationsSection.tsx) and quiet-hours boundaries (also
// NotificationsSection.tsx). Split out once those three call sites had all
// converged on the same few lines with comments cross-referencing each
// other -- exactly the situation a shared helper exists for, rather than a
// fourth copy.
//
// Lives here, not in goals/goalReminders.ts, on purpose: that module's own
// header describes itself as dependency-free (no RN, no Date, no locale) so
// it stays unit-testable and import-cycle-free from goals.ts. This is
// `Date`/locale-dependent DISPLAY logic, which is a different axis entirely
// -- it belongs beside this app's other presentation-only helpers (see
// ui/a11y.ts for the same kind of split), not folded into a module that
// exists specifically to avoid this.
export function formatClockTime(value: string): string {
  const [h, m] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
