// goalTargetParts.ts -- pure days/hours/minutes decomposition for a goal's
// target duration, split out of GoalForm.tsx so the arithmetic that decides
// what's *displayable* on the target wheels is unit-testable without
// rendering a component (this repo tests pure modules, not components --
// see goalProgress.test.ts). GoalForm.tsx owns everything about how these
// numbers become wheels; this module owns only the numbers.
//
// Why this exists: GoalForm.tsx used to show one giant hours wheel sized to
// the period's own max (0..744 for monthly -- see PERIOD_MAX_HOURS below),
// which WheelPicker.tsx renders with zero virtualization, so a monthly goal
// mounted ~745 animated rows. Composing the same range as Days + Hours +
// Minutes cuts that to 32 + 24 + 12 rows for monthly (8 + 24 + 12 for
// weekly) while still being able to express every value goals.ts's own
// bounds allow -- daily stays a plain Hours + Minutes pair (PERIOD_MAX_HOURS
// <= 24h), exactly as it worked before this module existed.
//
// goals.ts stays the ONLY authority on what's model-valid: nothing here
// changes MAX_*_TARGET_S or any validation. PERIOD_MAX_HOURS is DERIVED from
// those constants (not hardcoded as 24/168/744) for the same reason the
// original single-wheel version derived its own range from them -- raising
// e.g. MAX_MONTHLY_TARGET_S in goals.ts must never leave this picker unable
// to express a target the store would happily accept.
import { Goal, GoalPeriod, MAX_DAILY_TARGET_S, MAX_WEEKLY_TARGET_S, MAX_MONTHLY_TARGET_S } from './goals';

export const PERIOD_MAX_HOURS: Record<GoalPeriod, number> = {
  daily: Math.floor(MAX_DAILY_TARGET_S / 3600),
  weekly: Math.floor(MAX_WEEKLY_TARGET_S / 3600),
  monthly: Math.floor(MAX_MONTHLY_TARGET_S / 3600),
};

// Minutes reuse DashboardScreen's 5-minute step so setting "2h 30m" here
// feels identical to setting a lock duration there -- the single source of
// truth GoalForm.tsx's minute wheel (and its label strings) is built from.
export const MINUTE_STEP = 5;
export const MINUTE_VALUES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

/** Whether a period's range is wide enough that a Days wheel earns its own
 * spot (weekly's 168h and monthly's 744h both are; daily's 24h isn't) --
 * DERIVED from PERIOD_MAX_HOURS, not a hardcoded `period === 'monthly'`
 * check, so a future period (or a changed daily bound) automatically gets
 * the right wheel layout instead of needing this file edited to match. */
export function showsDaysWheel(period: GoalPeriod): boolean {
  return PERIOD_MAX_HOURS[period] > 24;
}

/** The largest whole number of days the Days wheel can show for `period` --
 * MAX_WEEKLY_TARGET_S (168h) and MAX_MONTHLY_TARGET_S (744h) both land on an
 * exact day boundary (7d/31d with 0h/0m left over), so this is always exact,
 * never a truncation that would itself make the max unreachable. */
export function maxDaysFor(period: GoalPeriod): number {
  return Math.floor(PERIOD_MAX_HOURS[period] / 24);
}

export interface GoalTargetParts {
  days: number;
  hours: number;
  minutes: number;
}

/** Snaps an arbitrary minute value onto the nearest MINUTE_STEP stop -- same
 * defensive snap the pre-split GoalForm.tsx applied to a targetS that didn't
 * originate from this wheel's own 5-minute grid (e.g. one written by the
 * dashboard's website/js twin, which has no such step). */
function snapMinutes(minutes: number): number {
  return MINUTE_VALUES.reduce((best, v) => (Math.abs(v - minutes) < Math.abs(best - minutes) ? v : best), 0);
}

/** {days, hours, minutes} -> seconds. Pure arithmetic, independent of
 * `period` -- the period only matters for deciding what range of parts is
 * REACHABLE (targetSToParts/clampPartsForPeriod below), not for the sum
 * itself. */
export function partsToTargetS(parts: GoalTargetParts): number {
  return parts.days * 86400 + parts.hours * 3600 + parts.minutes * 60;
}

/** seconds -> {days, hours, minutes} for `period`'s own wheel shape. Always
 * clamps into [0, PERIOD_MAX_HOURS[period] * 3600] first, so this never
 * decomposes a value the wheels couldn't have produced themselves (a
 * malformed/legacy targetS included) -- same "fail toward the safe side"
 * discipline goals.ts's own sanitizeOneGoal applies at its trust boundary.
 *
 * The subtle case: MAX_WEEKLY_TARGET_S (168h = 7d exactly) and
 * MAX_MONTHLY_TARGET_S (744h = 31d exactly) are both exact multiples of 24h,
 * so the only way to reach the true max is `{days: maxDaysFor(period), 0,
 * 0}` -- any leftover hours/minutes at that many days would overshoot it
 * (31d + 12h = 756h > 744h). This function enforces that by forcing
 * hours/minutes to 0 whenever the decomposed day count would hit
 * maxDaysFor(period), rather than ever returning a days/hours/minutes combo
 * whose sum exceeds the bound. */
export function targetSToParts(targetS: number, period: GoalPeriod): GoalTargetParts {
  const maxS = PERIOD_MAX_HOURS[period] * 3600;
  const clamped = Math.max(0, Math.min(targetS, maxS));
  const totalHours = Math.floor(clamped / 3600);
  const minutes = snapMinutes(Math.floor((clamped % 3600) / 60));

  if (!showsDaysWheel(period)) {
    // Daily (and any future period at or under 24h): a plain Hours +
    // Minutes pair, exactly the pre-split shape -- `days` is always 0 and
    // unused by GoalForm.tsx's rendering for this case.
    return { days: 0, hours: Math.min(totalHours, PERIOD_MAX_HOURS[period]), minutes };
  }

  const maxDays = maxDaysFor(period);
  const days = Math.min(maxDays, Math.floor(totalHours / 24));
  if (days >= maxDays) return { days: maxDays, hours: 0, minutes: 0 };
  return { days, hours: totalHours % 24, minutes };
}

/** Re-clamps an arbitrary (possibly out-of-range, possibly period-mismatched)
 * {days, hours, minutes} into a combination that's valid for `period` --
 * used both when the user changes the Days wheel itself (a day count that
 * newly hits maxDaysFor(period) must force hours/minutes back to 0, the same
 * moment it happens, not just cosmetically hide the now-invalid wheel
 * options) and when switching `period` altogether (the old three-way value
 * may not even fit the new period's bound at all, e.g. 20d monthly -> 7d0h0m
 * weekly). Implemented as compose-then-decompose through the SAME
 * targetSToParts clamp above, so there is exactly one place that decides
 * what's reachable -- this is never a second, independent clamp that could
 * drift out of sync with it. */
export function clampPartsForPeriod(parts: GoalTargetParts, period: GoalPeriod): GoalTargetParts {
  return targetSToParts(partsToTargetS(parts), period);
}

/** Convenience for GoalForm.tsx's initial-state derivation: decomposes an
 * existing goal's stored targetS (or a caller-supplied default, for a brand
 * new goal) into this module's wheel shape for that goal's own period. Kept
 * here (rather than inlined three times, once per useState initializer) so
 * the "which goal, which fallback" question is answered in exactly one
 * place. */
export function initialPartsFor(goal: Goal | undefined, defaultTargetS: number, defaultPeriod: GoalPeriod): GoalTargetParts {
  return targetSToParts(goal?.targetS ?? defaultTargetS, goal?.period ?? defaultPeriod);
}
