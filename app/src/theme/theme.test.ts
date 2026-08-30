// Unit tests for the theme layer's pure color math -- color.ts's contrast
// helpers, dayHeat.ts's heat-tinted day number (the one place in this app
// where text lands on a TRANSLUCENT accent fill and so cannot just use
// `accentText`), and the fixed status colors in theme.ts's palette.
// Everything here is pure hex math, so nothing renders. Run with `npm test`.
import { ACCENT_KEYS, DEFAULT_ACCENT, DEFAULT_THEME_MODE, resolveTheme, THEME_MODES } from './theme';
import type { AccentKey, ThemeMode } from './theme';
import { bestTextOn, blendOver, contrastRatio, withAlpha } from './color';
import { ALPHA_FOR_LEVEL, dayNumColor } from './dayHeat';

// WCAG AA for normal-sized text. The day number is a 13px label, so it is
// "normal" text by that standard, not "large".
const AA_TEXT = 4.5;

describe('contrastRatio', () => {
  it('spans the full 1..21 range at the extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#7f7f7f', '#7f7f7f')).toBeCloseTo(1, 5);
  });

  it('is symmetric in its arguments', () => {
    expect(contrastRatio('#22c55e', '#0b0b0c')).toBeCloseTo(contrastRatio('#0b0b0c', '#22c55e'), 10);
  });
});

describe('blendOver', () => {
  it('returns the base at alpha 0 and the color itself at alpha 1', () => {
    expect(blendOver('#22c55e', '#0b0b0c', 0)).toBe('#0b0b0c');
    expect(blendOver('#22c55e', '#0b0b0c', 1)).toBe('#22c55e');
  });

  it('clamps out-of-range alpha the same way withAlpha does', () => {
    expect(blendOver('#22c55e', '#0b0b0c', -1)).toBe('#0b0b0c');
    expect(blendOver('#22c55e', '#0b0b0c', 5)).toBe('#22c55e');
  });

  it('produces a 6-digit hex, unlike withAlpha which produces 8', () => {
    expect(blendOver('#ffffff', '#000000', 0.5)).toMatch(/^#[0-9a-f]{6}$/);
    expect(withAlpha('#ffffff', 0.5)).toMatch(/^#[0-9a-f]{8}$/);
  });
});

describe('bestTextOn', () => {
  it('picks the higher-contrast candidate', () => {
    expect(bestTextOn('#ffffff', '#ffffff', '#000000')).toBe('#000000');
    expect(bestTextOn('#000000', '#ffffff', '#000000')).toBe('#ffffff');
  });

  it('breaks a tie in favour of the first (preferred) candidate', () => {
    expect(bestTextOn('#7f7f7f', '#ffffff', '#ffffff')).toBe('#ffffff');
  });
});

describe('dayNumColor', () => {
  it('reads the plain text color on an unfilled cell', () => {
    for (const mode of THEME_MODES) {
      const theme = resolveTheme(mode, 'mint');
      expect(dayNumColor(theme, 0)).toBe(theme.text);
    }
  });

  it('keeps accentText on a level-4 cell, where the fill is the accent at full strength', () => {
    for (const mode of THEME_MODES) {
      for (const accent of ACCENT_KEYS) {
        const theme = resolveTheme(mode, accent);
        expect(dayNumColor(theme, 4)).toBe(theme.accentText);
      }
    }
  });

  it('clears AA text contrast for every accent, mode, and heat level', () => {
    // This is the regression the helper exists for: the old
    // `focusS > 0 ? accentText : text` rule measured 1.33-1.53:1 on a
    // level-1 cell, i.e. an unreadable day number on any day with focus time.
    for (const mode of THEME_MODES) {
      for (const accent of ACCENT_KEYS) {
        const theme = resolveTheme(mode, accent);
        for (const level of [1, 2, 3, 4] as const) {
          const fill = blendOver(theme.accent, theme.bg, ALPHA_FOR_LEVEL[level]);
          // 3:1 rather than 4.5 -- levels 1-3 are a translucent tint, and at
          // level 3 neither candidate can reach 4.5 against every accent. The
          // old rule bottomed out at 1.33:1, which is the regression this pins.
          expect(contrastRatio(dayNumColor(theme, level), fill)).toBeGreaterThan(3);
        }
      }
    }
  });

  it('beats the old accentText-everywhere rule on the low heat levels', () => {
    for (const mode of THEME_MODES) {
      for (const accent of ACCENT_KEYS) {
        const theme = resolveTheme(mode, accent);
        for (const level of [1, 2] as const) {
          const fill = blendOver(theme.accent, theme.bg, ALPHA_FOR_LEVEL[level]);
          expect(contrastRatio(dayNumColor(theme, level), fill)).toBeGreaterThan(
            contrastRatio(theme.accentText, fill),
          );
        }
      }
    }
  });
});

describe('fixed status colors', () => {
  it('clears AA text contrast on `surface`, where all four are drawn as text', () => {
    // Every danger/warn/success TEXT site in the app renders inside a
    // SettingsPrimitives `Section` card or a `Sheet` body -- both `surface`.
    // `success` is the one that used to fail: as light mode's original
    // #16a34a it sat at 3.3:1 here, because the per-accent contrast audit in
    // theme.ts never covered the three fixed status colors.
    for (const mode of THEME_MODES) {
      const theme = resolveTheme(mode, 'mint');
      for (const key of ['text', 'textDim', 'danger', 'warn', 'success'] as const) {
        expect(contrastRatio(theme[key], theme.surface)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('clears AA text contrast on `bg` for the two colors that are drawn there', () => {
    // Only text/textDim are used as text directly on the page background
    // (screen headings, captions, weekday labels). `danger` reaches `bg`
    // only as a BUTTON FILL (DashboardScreen's Open), where the readable-
    // text question is about accentText on top of it, checked below.
    for (const mode of THEME_MODES) {
      const theme = resolveTheme(mode, 'mint');
      for (const key of ['text', 'textDim'] as const) {
        expect(contrastRatio(theme[key], theme.bg)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('keeps dangerText readable on the danger fill', () => {
    // DashboardScreen's Open button. This used to borrow `accentText`, whose
    // margin here varied by accent and bottomed out at 4.4988:1 under teal.
    for (const mode of THEME_MODES) {
      const theme = resolveTheme(mode, 'mint');
      expect(contrastRatio(theme.dangerText, theme.danger)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('does not let dangerText vary with the selected accent', () => {
    for (const mode of THEME_MODES) {
      const values = new Set(ACCENT_KEYS.map((a) => resolveTheme(mode, a).dangerText));
      expect(values.size).toBe(1);
    }
  });

  it('keeps accentText readable on the accent fill for every accent', () => {
    for (const mode of THEME_MODES) {
      for (const accent of ACCENT_KEYS) {
        const theme = resolveTheme(mode, accent);
        expect(contrastRatio(theme.accentText, theme.accent)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});

// themeMode and accent are ACCOUNT settings, synced through
// users/{uid}/settings/app and written by both this app and the website
// dashboard. Their rule type-checks rather than enumerating values, on
// purpose -- so adding an accent doesn't need a rules deploy. That makes
// "a value this build has never heard of" a state the app WILL meet in the
// field the first time the other client ships one, and `ACCENTS[mode][accent]`
// on an unknown mode is a TypeError thrown from the first render of every
// themed screen.
describe('resolveTheme with a value this build does not know', () => {
  const unknownMode = 'system' as unknown as ThemeMode;
  const unknownAccent = 'chartreuse' as unknown as AccentKey;

  it('falls back to the default mode instead of throwing', () => {
    expect(() => resolveTheme(unknownMode, 'mint')).not.toThrow();
    expect(resolveTheme(unknownMode, 'mint')).toEqual(resolveTheme(DEFAULT_THEME_MODE, 'mint'));
  });

  it('falls back to the default accent instead of rendering a colorless theme', () => {
    // Not just "doesn't throw": spreading an undefined accent yields an
    // object missing `accent`/`accentText` entirely, which paints invisible
    // text rather than crashing -- the harder failure to notice.
    const theme = resolveTheme('dark', unknownAccent);
    expect(theme).toEqual(resolveTheme('dark', DEFAULT_ACCENT));
    expect(theme.accent).toBeDefined();
  });

  it('falls back on both at once', () => {
    expect(resolveTheme(unknownMode, unknownAccent)).toEqual(resolveTheme(DEFAULT_THEME_MODE, DEFAULT_ACCENT));
  });

  // The defaults have to be values this build actually knows, or the fallback
  // is a second way to reach the same crash.
  it('has defaults inside its own tables', () => {
    expect(THEME_MODES).toContain(DEFAULT_THEME_MODE);
    expect(ACCENT_KEYS).toContain(DEFAULT_ACCENT);
  });
});
