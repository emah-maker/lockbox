/* =========================================================================
   theme.js -- plain-JS port of app/src/theme/theme.ts's MODES/ACCENTS/
   resolveTheme, so the website dashboard can render with the exact
   themeMode + accent a signed-in user has actually chosen in the Phone Box
   app (synced to users/{uid}/settings/app -- see app/src/store/
   useSettingsStore.ts's SyncableSettings) instead of a fixed website-only
   palette. Defaults (dark/mint) match that store's own
   SYNCABLE_SETTINGS_DEFAULTS, so a signed-out visitor (login.html) or a
   pre-sync moment sees exactly what a fresh app install would show.
   ========================================================================= */

const ACCENTS = {
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

const MODES = {
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

export const DEFAULT_THEME_MODE = 'dark';
export const DEFAULT_ACCENT = 'mint';

export function resolveTheme(mode, accent) {
  const modeColors = MODES[mode] || MODES[DEFAULT_THEME_MODE];
  const accentColors = (ACCENTS[mode] || ACCENTS[DEFAULT_THEME_MODE])[accent] || ACCENTS[DEFAULT_THEME_MODE][DEFAULT_ACCENT];
  return { ...modeColors, ...accentColors };
}

/** Alpha-composites `hex` over `baseHex` at `alpha` (0..1) and returns the
 * resulting opaque hex -- used to paint a heatmap cell the same way the app's
 * `withAlpha(c.accent, intensity)` does over a solid surface, but pre-blended
 * so the website can pick a guaranteed-readable text color for the result
 * (see focusStats.js's readableTextColor) rather than assuming the app's own
 * fixed accentText clears contrast at every intensity. */
export function compositeHex(hex, baseHex, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  const chan = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const mix = (i) => Math.round(chan(hex, i) * a + chan(baseHex, i) * (1 - a));
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(0))}${toHex(mix(1))}${toHex(mix(2))}`;
}
