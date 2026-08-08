// theme.ts -- resolves a (mode, accent) pair into concrete colors for the UI.
// Kept as pure data (no React) so useStore only has to persist two small enum
// values (see useStore.ts setThemeMode/setAccent) instead of a whole color
// object, and every screen derives the same palette from `useTheme()`.
export type ThemeMode = 'dark' | 'light';
export type AccentKey = 'mint' | 'coral' | 'amber' | 'sky' | 'violet';

export interface ThemeColors {
  bg: string;
  surface: string;
  text: string;
  textDim: string;
  accent: string;
  accentText: string; // text/icon color placed on top of a filled `accent` surface
  danger: string;
  warn: string;
}

type AccentColors = Pick<ThemeColors, 'accent' | 'accentText'>;
type ModeColors = Omit<ThemeColors, 'accent' | 'accentText'>;

// Mint/dark is the app's original look (see DashboardScreen's old hardcoded
// styles); it stays the default so upgrading users see no change.
const ACCENTS: Record<AccentKey, AccentColors> = {
  mint: { accent: '#22c55e', accentText: '#04210f' },
  coral: { accent: '#ef5350', accentText: '#2b0605' },
  amber: { accent: '#f2b84b', accentText: '#2b1300' },
  sky: { accent: '#38bdf8', accentText: '#001c2b' },
  violet: { accent: '#a78bfa', accentText: '#1c0f3d' },
};

const MODES: Record<ThemeMode, ModeColors> = {
  dark: {
    bg: '#0b0b0c',
    surface: '#17181b',
    text: '#ffffff',
    textDim: '#9aa0a6',
    danger: '#ef4444',
    warn: '#f2b84b',
  },
  light: {
    bg: '#f5f6f8',
    surface: '#ffffff',
    text: '#111318',
    textDim: '#5b6167',
    danger: '#dc2626',
    warn: '#b45309',
  },
};

export const THEME_MODES: ThemeMode[] = ['dark', 'light'];
export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

export const ACCENT_LABELS: Record<AccentKey, string> = {
  mint: 'Mint',
  coral: 'Coral',
  amber: 'Amber',
  sky: 'Sky',
  violet: 'Violet',
};

export function resolveTheme(mode: ThemeMode, accent: AccentKey): ThemeColors {
  return { ...MODES[mode], ...ACCENTS[accent] };
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
