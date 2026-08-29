// color.ts -- pure color math. No palette, no RN, no theme: just hex in, hex
// or number out, so it is unit-testable under plain node and can be used by
// anything (theme.ts's palette, the calendar's heat cells, topics.ts's series
// colors) without either of those depending on the others.
//
// Split out of theme.ts, which is the PALETTE (which colors exist, and how a
// mode + accent resolve into a ThemeColors). These functions don't know about
// any of that. Keeping them here is also what let stats/topics.ts's
// `readableTextColor` stop carrying its own second copy of the luminance and
// contrast-ratio math -- before this module there were two implementations of
// both in the app alone, with `contrastRatio` even taking different argument
// types in each (hex pair here, luminance pair there).

/** WCAG 2.x sRGB relative luminance for a 6-digit hex color. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  let sum = 0;
  const weights = [0.2126, 0.7152, 0.0722];
  for (let i = 0; i < 3; i++) {
    const v = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    sum += weights[i] * (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  }
  return sum;
}

/** WCAG 2.x contrast ratio (1..21) between two opaque hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
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

/** Composites `hex` at `alpha` over the opaque `base`, returning the opaque
 * hex the screen will actually show -- the inverse question to withAlpha's.
 * `alpha` is clamped to 0..1 the same way withAlpha clamps it.
 *
 * Exists because a translucent fill breaks the assumption a paired "text on
 * this color" token is built on: that the text sits on the color at FULL
 * strength. At 25% the fill is almost entirely the base, so a token picked
 * against the un-composited color lands on something close to the background
 * and disappears. Composite first, then ask what reads on the result. */
export function blendOver(hex: string, base: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const fg = hex.replace('#', '');
  const bg = base.replace('#', '');
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const f = parseInt(fg.slice(i * 2, i * 2 + 2), 16);
    const b = parseInt(bg.slice(i * 2, i * 2 + 2), 16);
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
