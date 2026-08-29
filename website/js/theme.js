/* =========================================================================
   theme.js -- plain-JS port of app/src/theme/theme.ts's MODES/ACCENTS/
   resolveTheme, so the website dashboard can render with the exact
   themeMode + accent a signed-in user has actually chosen in the Phone Box
   app (synced to users/{uid}/settings/app -- see app/src/store/
   useSettingsStore.ts's SyncableSettings) instead of a fixed website-only
   palette. Defaults (dark/mint) match that store's own
   SYNCABLE_SETTINGS_DEFAULTS, so a signed-out visitor (login.html) or a
   pre-sync moment sees exactly what a fresh app install would show.

   applyTheme (below) also lives here rather than in dashboard.js: it is the
   one place besides resolveTheme/compositeHex that turns theme data into
   something paintable, so keeping all three together means a theme change
   never has to touch two files. It takes only the resolved theme object,
   not an `els` ref -- unlike the panel modules' render functions, it paints
   document.documentElement's own custom properties, not a subtree dashboard.js
   owns.
   ========================================================================= */
import { readableTextColor } from './focusStats.js';

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
// Exposed for accountPanel.js's appearance picker -- reads the same ACCENTS
// table resolveTheme does, rather than a second hardcoded accent list, so a
// new accent added above is picked up here for free.
export const ACCENT_NAMES = Object.keys(ACCENTS.dark);

export function resolveTheme(mode, accent) {
  const modeColors = MODES[mode] || MODES[DEFAULT_THEME_MODE];
  const accentColors = (ACCENTS[mode] || ACCENTS[DEFAULT_THEME_MODE])[accent] || ACCENTS[DEFAULT_THEME_MODE][DEFAULT_ACCENT];
  return { ...modeColors, ...accentColors };
}

// Alpha-composites are the right tool for --accent-soft below (it always
// paints over one known surface, the card), but a hairline border is drawn
// against several different surfaces on the dashboard (--card, --bg, --card-2
// -- see dashboard.css's table rules, input outlines, and popover borders)
// and pasting one opaque baked-in shade would go wrong wherever the actual
// surface differs from the base color picked at the time. A real translucent
// color sidesteps that: it stays correct against *any* surface underneath
// it, the way CSS alpha compositing already works for free.
function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Paints the resolved theme onto CSS custom properties (dashboard.css reads
 * these) rather than keeping color logic duplicated in both CSS and JS --
 * dashboard.js's calendar heatmap is the one place that also needs the raw
 * hex values in JS (to alpha-composite per-cell), which is why it keeps its
 * own `theme` reference around rather than reading these properties back.
 *
 * --border/--border-soft used to be left at styles.css's dark-only literals
 * (white at 16%/7%), which is invisible once the page goes light. They're
 * derived from t.text instead of a second pair of literals so they flip
 * automatically with the mode: t.text is white in dark mode (reproducing
 * the old literals exactly) and near-black in light mode, giving a dark
 * hairline on a light surface instead of a white one nobody can see. */
export function applyTheme(t) {
  const root = document.documentElement.style;
  root.setProperty('--bg', t.bg);
  root.setProperty('--bg-2', t.bg);
  root.setProperty('--card', t.surface);
  root.setProperty('--card-2', t.surface);
  root.setProperty('--text', t.text);
  root.setProperty('--text-2', t.textDim);
  root.setProperty('--text-3', t.textDim);
  root.setProperty('--unlocked', t.accent);
  root.setProperty('--unlocked-2', t.accent);
  root.setProperty('--locked', t.danger);
  root.setProperty('--locked-2', t.danger);
  root.setProperty('--closed', t.warn);
  // Unlike --accent-text (an authored per-accent pairing, see the ACCENTS
  // table above), --locked has no such hand-picked partner -- dashboard.css
  // used to just hardcode `color: #fff` on top of it. That happens to clear
  // WCAG AA against the light-mode danger red (#dc2626, 4.83:1) but fails it
  // against the dark-mode one (#ef4444, 3.76:1) -- measured via
  // focusStats.js's own contrast math. readableTextColor picks the higher-
  // contrast of black/white for whichever danger red the resolved theme
  // actually has, the same way it already does for the calendar heatmap.
  root.setProperty('--locked-text', readableTextColor(t.danger));
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-text', t.accentText);
  root.setProperty('--accent-soft', compositeHex(t.accent, t.surface, 0.12));
  root.setProperty('--border', hexToRgba(t.text, 0.16));
  root.setProperty('--border-soft', hexToRgba(t.text, 0.07));
  // The nav and the mobile drawer live outside `.dash`, so dashboard.css's
  // scoped light-mode overrides never applied to them and they kept
  // styles.css's dark literals -- in light mode that left the wordmark
  // (color: var(--text), now near-black) sitting on a near-black bar. These
  // five repoint that chrome onto the resolved theme; styles.css still
  // carries the old literals as the defaults, so index.html is unaffected.
  root.setProperty('--surface', t.surface);          // mobile drawer fill
  root.setProperty('--nav-bg', hexToRgba(t.bg, 0.86));
  root.setProperty('--nav-bg-scrolled', hexToRgba(t.bg, 0.96));
  root.setProperty('--nav-mark', t.textDim);         // brand glyph + toggle hover ring
  root.setProperty('--wash', hexToRgba(t.text, 0.05));
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
