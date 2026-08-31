// Unit tests for the pure color math. Run with `npm test` (jest-expo).
//
// Focused on the non-6-digit-hex inputs every function here used to turn
// silently into NaN: `#abc` (which React Native itself renders fine) and
// values that are not hex at all, which can reach these functions through a
// custom label's color -- see stats/customLabels.ts's sanitizeCustomLabels.
import { contrastRatio, withAlpha, blendOver, bestTextOn, isHexColor, expandHex } from './color';

describe('isHexColor', () => {
  it('accepts the two notations the rest of this module can do math on', () => {
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#AABBCC')).toBe(true);
  });

  it('rejects everything else, including colors React Native would render', () => {
    for (const v of ['red', 'rgb(1,2,3)', '#ab', '#abcd', '#aabbccdd', 'aabbcc', '', null, undefined, 42]) {
      expect(isHexColor(v)).toBe(false);
    }
  });
});

describe('expandHex', () => {
  it('expands the shorthand form to six digits', () => {
    expect(expandHex('#abc')).toBe('#aabbcc');
  });

  it('leaves an already-six-digit value alone', () => {
    expect(expandHex('#aabbcc')).toBe('#aabbcc');
  });
});

describe('contrastRatio', () => {
  it('gives black-on-white the WCAG maximum', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('treats the shorthand form as the color it actually is', () => {
    // Previously '#fff' parsed channel 1 as 'f' and channel 2 as '', so this
    // came back NaN rather than 21.
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
  });

  it('never returns NaN for a non-hex color', () => {
    expect(Number.isFinite(contrastRatio('red', '#ffffff'))).toBe(true);
  });
});

describe('bestTextOn', () => {
  it('still measures rather than defaulting to its first argument on shorthand hex', () => {
    // A NaN contrast makes every `>` comparison false, which silently turns
    // this into "always return `first`" -- the failure mode being guarded.
    expect(bestTextOn('#fff', '#ffffff', '#0b0b0b')).toBe('#0b0b0b');
    expect(bestTextOn('#000', '#0b0b0b', '#ffffff')).toBe('#ffffff');
  });
});

describe('withAlpha', () => {
  it('appends the alpha byte to a six-digit color', () => {
    expect(withAlpha('#aabbcc', 1)).toBe('#aabbccff');
    expect(withAlpha('#aabbcc', 0)).toBe('#aabbcc00');
  });

  it('expands the shorthand form first, so the result is a renderable 8-digit hex', () => {
    // '#abc' + 'ff' is '#abcff', a 5-digit body React Native drops entirely.
    expect(withAlpha('#abc', 1)).toBe('#aabbccff');
  });

  it('passes a non-hex color straight through rather than mangling it', () => {
    expect(withAlpha('red', 0.5)).toBe('red');
  });

  it('clamps alpha to 0..1', () => {
    expect(withAlpha('#aabbcc', 5)).toBe('#aabbccff');
    expect(withAlpha('#aabbcc', -5)).toBe('#aabbcc00');
  });
});

describe('blendOver', () => {
  it('returns the base at alpha 0 and the color at alpha 1', () => {
    expect(blendOver('#ffffff', '#000000', 0)).toBe('#000000');
    expect(blendOver('#ffffff', '#000000', 1)).toBe('#ffffff');
  });

  it('composites the shorthand form instead of producing "#NaNNaNNaN"', () => {
    expect(blendOver('#fff', '#000', 1)).toBe('#ffffff');
    expect(blendOver('#fff', '#000', 0.5)).toBe('#808080');
  });

  it('passes a non-hex color through rather than producing an unrenderable string', () => {
    expect(blendOver('red', '#000000', 0.5)).toBe('red');
  });
});
