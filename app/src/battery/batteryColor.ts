// batteryColor.ts -- theme-aware battery status color (>=50 accent / >=20
// warn / else danger / <0 textDim, Box-code/lib/lock_ui.py's
// update_battery_view thresholds). Used to live as a private copy inside
// StatusStrip.tsx; promoted here once home/BatteryBadge.tsx needed the exact
// same rule, so the two call sites can't drift apart the way "each screen
// keeps its own tiny display helper" duplication tends to invite.
//
// Deliberately NOT folded into batteryEstimate.ts, which is kept
// dependency- and theme-free on purpose (see that file's own header
// comment) so it stays trivially unit-testable without a React/theme
// import -- this one small function is the only piece that actually needs
// ThemeColors, so it gets its own leaf module instead.
import type { useTheme } from '../theme/useTheme';

export function batteryColor(pct: number, t: ReturnType<typeof useTheme>): string {
  if (pct < 0) return t.textDim;
  if (pct >= 50) return t.accent;
  if (pct >= 20) return t.warn;
  return t.danger;
}
