// theme.ts -- resolves a (mode, accent) pair into concrete colors for the UI.
// Kept as pure data (no React) so useStore only has to persist two small enum
// values (see useStore.ts setThemeMode/setAccent) instead of a whole color
// object, and every screen derives the same palette from `useTheme()`.
export type ThemeMode = 'dark' | 'light';
export type AccentKey =
  | 'mint'
  | 'coral'
  | 'amber'
  | 'sky'
  | 'violet'
  | 'rose'
  | 'teal'
  | 'indigo';

export interface ThemeColors {
  bg: string;
  surface: string;
  text: string;
  textDim: string;
  accent: string;
  accentText: string; // text/icon color placed on top of a filled `accent` surface
  danger: string;
  /** Text/icon color placed on top of a filled `danger` surface -- the same
   * role `accentText` plays for `accent`. DashboardScreen's Open button is
   * the one such fill in the app; it used to borrow `accentText`, which is
   * wrong twice over: that color is contrast-tuned against the ACCENT (dark
   * mode's variants are per-accent near-blacks, so "Open" rendered as dark
   * GREEN text on a red button under the mint accent), and its margin on
   * the danger red depends on which accent happens to be selected -- teal's
   * sat at 4.4988:1, just under the AA text minimum, purely by accident of a
   * pairing nobody designed. */
  dangerText: string;
  warn: string;
  // Fixed, accent-independent -- the BLE connection dot's "connected" color.
  // Same precedent as danger/warn: a status color that must read the same
  // way regardless of which accent is picked, mirroring Box-code's LockUI
  // (locked=red/closed=amber/unlocked=green never follow the box's own
  // accent setting either). Before this existed, the connected dot used
  // `accent` directly, so picking a non-green accent (coral, sky, ...) made
  // "connected" stop looking green.
  success: string;
}

type AccentColors = Pick<ThemeColors, 'accent' | 'accentText'>;
type ModeColors = Omit<ThemeColors, 'accent' | 'accentText'>;

// Mint/dark is the app's original look (see DashboardScreen's old hardcoded
// styles); it stays the default so upgrading users see no change.
//
// Per-mode accent audit (2026-08-15): a WCAG contrast pass found every one of
// the original 6 accents failed minimum text contrast (<3:1, most ~2:1-2.7:1)
// when drawn as TEXT on the light mode's bg/surface (#f5f6f8/#ffffff) -- they
// were tuned for dark mode only, where all 6 pass comfortably (5.6-11:1).
// `dark` below keeps those original hex values unchanged (upgrading users see
// no dark-mode change); `light` is a separately darkened/more-saturated
// variant of the SAME hue, each tuned to >=4.5:1 against both light.bg and
// light.surface (see the fully-delegate evidence file for the exact contrast
// numbers). Because the light-mode fills are now much darker/more saturated,
// the old near-black `accentText` no longer has enough contrast against them
// as a button-fill text color (computed ~3.3-3.8:1) -- white passes >=4.9:1
// against every light-mode fill, so light mode's accentText is white across
// the board while dark mode keeps its original per-accent near-black text.
//
// `teal` and `indigo` are new accent options (manager request) chosen to sit
// in hue gaps the original 6 leave open -- teal is a green-leaning cyan
// distinct from both mint (pure green) and sky (blue-leaning cyan); indigo is
// a deeper blue-violet distinct from both sky (cyan) and violet (lighter
// purple). Both were computed with the same per-mode contrast method as the
// original 6 from the start, so neither needed a later fix.
const ACCENTS: Record<ThemeMode, Record<AccentKey, AccentColors>> = {
  dark: {
    mint: { accent: '#22c55e', accentText: '#04210f' },
    coral: { accent: '#ef5350', accentText: '#2b0605' },
    amber: { accent: '#f2b84b', accentText: '#2b1300' },
    sky: { accent: '#38bdf8', accentText: '#001c2b' },
    violet: { accent: '#a78bfa', accentText: '#1c0f3d' },
    rose: { accent: '#fb7185', accentText: '#2b0511' },
    teal: { accent: '#2dd4bf', accentText: '#04211d' },
    indigo: { accent: '#818cf8', accentText: '#0d0f2b' },
  },
  light: {
    mint: { accent: '#167f3d', accentText: '#ffffff' },
    coral: { accent: '#de1814', accentText: '#ffffff' },
    amber: { accent: '#94640b', accentText: '#ffffff' },
    sky: { accent: '#0678ab', accentText: '#ffffff' },
    violet: { accent: '#774bf7', accentText: '#ffffff' },
    rose: { accent: '#e10626', accentText: '#ffffff' },
    teal: { accent: '#197c70', accentText: '#ffffff' },
    indigo: { accent: '#4c5bf5', accentText: '#ffffff' },
  },
};

const MODES: Record<ThemeMode, ModeColors> = {
  dark: {
    bg: '#0b0b0c',
    surface: '#17181b',
    text: '#ffffff',
    textDim: '#9aa0a6',
    danger: '#ef4444',
    dangerText: '#1a0303', // 5.27:1 on #ef4444 -- see ThemeColors.dangerText
    warn: '#f2b84b',
    success: '#22c55e',
  },
  light: {
    bg: '#f5f6f8',
    surface: '#ffffff',
    text: '#111318',
    textDim: '#5b6167',
    danger: '#dc2626',
    // White, not the dark mode's near-black: light mode's danger red is
    // darker, so the polarity flips exactly the way it already does for
    // accentText between the two modes. 4.83:1 on #dc2626 (near-black would
    // only reach ~4.1:1 there).
    dangerText: '#ffffff',
    warn: '#b45309',
    // Darkened from the original #16a34a (2026-08-28 light-mode pass). The
    // per-accent contrast audit above never covered the three fixed status
    // colors, and `success` was the one that failed: #16a34a reads 3.3:1 on
    // light.surface and 3.05:1 on light.bg -- fine as a dot/ring GRAPHIC,
    // but it is also used as TEXT (DaySheet's "goal met" chips), where it
    // was well under the 4.5:1 minimum. #0d6e31 is the same hue taken deep
    // enough to pass everywhere it's drawn: 6.38:1 on surface, 5.9:1 on bg,
    // and 5.09:1 even on the 15%-tinted chip fill it sits inside. Dark mode
    // keeps #22c55e unchanged (already 7.8-8.6:1 there).
    success: '#0d6e31',
  },
};

export const THEME_MODES: ThemeMode[] = ['dark', 'light'];
export const ACCENT_KEYS = Object.keys(ACCENTS.dark) as AccentKey[];

// Accent hex for a given mode -- lets a picker show each option's actual
// resolved color swatch instead of a bare text label. Mode-aware since
// light/dark now use different hex values per accent (see the ACCENTS
// contrast-audit comment above); a picker must show whichever one will
// actually apply in the currently-selected mode. See SettingsScreen's
// accent Chip.
export function accentSwatch(mode: ThemeMode, key: AccentKey): string {
  return ACCENTS[mode][key].accent;
}

export const ACCENT_LABELS: Record<AccentKey, string> = {
  mint: 'Mint',
  coral: 'Coral',
  amber: 'Amber',
  sky: 'Sky',
  violet: 'Violet',
  rose: 'Rose',
  teal: 'Teal',
  indigo: 'Indigo',
};

export function resolveTheme(mode: ThemeMode, accent: AccentKey): ThemeColors {
  return { ...MODES[mode], ...ACCENTS[mode][accent] };
}

/** Blends a hex color toward the given alpha via RN's 8-digit hex alpha
 * support, e.g. for a meter's unfilled track (a lighter step of the fill's
 * own color) or a heatmap cell's intensity. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

// --- Contrast helpers -------------------------------------------------
// `withAlpha` above makes it easy to draw a translucent accent fill, but a
// translucent fill breaks the one assumption `accentText` is built on: that
// text sits on the accent at FULL strength. At 25% the fill is almost
// entirely `bg`, so the near-black (dark mode) / white (light mode)
// accentText lands on a near-black / near-white surface and disappears --
// measured 1.33-1.53:1 across all 8 accents in both modes, i.e. invisible.
// These two let a caller with a translucent fill work out what the pixel
// actually resolves to and pick the readable text color for it, instead of
// guessing from the un-composited accent. Used by ui/calendar/DayCell.tsx's
// heat-tinted day number; kept here beside withAlpha since this is the same
// problem from the other end.

/** WCAG 2.x sRGB relative luminance for a 6-digit hex color. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  let sum = 0;
  const weights = [0.2126, 0.7152, 0.0722];
  for (let i = 0; i < 3; i++) {
    const v = parseInt(h.substr(i * 2, 2), 16) / 255;
    sum += weights[i] * (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  }
  return sum;
}

/** WCAG 2.x contrast ratio (1..21) between two opaque hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composites `hex` at `alpha` over the opaque `base`, returning the opaque
 * hex the screen will actually show -- the inverse question to withAlpha's.
 * `alpha` is clamped to 0..1 the same way withAlpha clamps it. */
export function blendOver(hex: string, base: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const fg = hex.replace('#', '');
  const bg = base.replace('#', '');
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const f = parseInt(fg.substr(i * 2, 2), 16);
    const b = parseInt(bg.substr(i * 2, 2), 16);
    out += Math.round(f * a + b * (1 - a))
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

/** Whichever of the two candidates reads better against `bg`. Ties go to
 * the first, so a caller can pass its preferred color first. */
export function bestTextOn(bg: string, first: string, second: string): string {
  return contrastRatio(second, bg) > contrastRatio(first, bg) ? second : first;
}
