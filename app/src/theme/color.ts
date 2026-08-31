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

/** True for the one color notation every function in this module can do
 * arithmetic on: `#RGB` or `#RRGGBB`. Deliberately narrower than what React
 * Native itself renders (it also takes `rgb()`, `hsl()` and the CSS color
 * names) -- see `expandHex` below for why the app needs the narrower form
 * anyway, and stats/customLabels.ts's sanitizeCustomLabels for the boundary
 * that enforces it on untrusted input. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** `#RGB` -> `#RRGGBB`, leaving an already-6-digit value alone.
 *
 * Every function below indexes the string two characters at a time, so the
 * shorthand form -- which React Native renders perfectly well, and which the
 * website's own color inputs can emit -- silently produced NaN: `#abc` parses
 * channel 0 as `ab`, channel 1 as `c` (12, not 204), and channel 2 as the
 * empty string. withAlpha has the same shape problem in reverse, since it
 * appends two hex digits to whatever it is given. Normalizing once, here, is
 * what lets the rest of this module assume six digits. */
export function expandHex(hex: string): string {
  const h = hex.replace('#', '');
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

/** WCAG 2.x sRGB relative luminance for a hex color.
 *
 * Non-hex input resolves to mid-gray's luminance rather than NaN. This runs
 * underneath every "which ink reads on this chip" decision in the app
 * (topics.ts's readableTextColor), and a NaN there doesn't throw -- it makes
 * every `>` comparison false, so bestTextOn silently stops measuring and
 * always returns its first argument. A defined midpoint keeps the choice a
 * real one; the boundary that stops unrenderable colors getting this far is
 * sanitizeCustomLabels. */
function luminance(hex: string): number {
  if (!isHexColor(hex)) return 0.2158; // luminance of #808080
  const h = expandHex(hex).replace('#', '');
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
  // Expanded first: appending two alpha digits to `#abc` yields `#abcXX`, a
  // 5-digit body React Native reads as nothing at all, so the style is
  // dropped and the element renders untinted. `#aabbccXX` is what was meant.
  // A value that isn't hex has no 8-digit form to build, so it is returned
  // untouched -- still whatever it was, rather than mangled into something
  // that definitely can't render.
  return isHexColor(hex) ? `${expandHex(hex)}${a}` : hex;
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
  // Same expansion (and same non-hex passthrough) as withAlpha above: without
  // it a shorthand input composites to '#NaNNaNNaN'.
  if (!isHexColor(hex) || !isHexColor(base)) return hex;
  const fg = expandHex(hex).replace('#', '');
  const bg = expandHex(base).replace('#', '');
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
