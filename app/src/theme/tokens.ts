// tokens.ts -- small shared design tokens (spacing/radius) so new UI work
// draws from one scale instead of adding another one-off magic number.
// Existing screens' StyleSheets keep their current literal values (this is
// not a sweeping rename); new or touched styles should reference these.
export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

// typeScale -- role-based text styles (fontSize/fontWeight/letterSpacing/lineHeight)
// so tracking/leading follow Apple's size-specific rule instead of being left
// unset: large display numbers and headings get tight leading and slightly
// negative tracking (letters read too far apart at that size otherwise);
// body/caption text gets relaxed leading and ~0 tracking. Spread the matching
// role into an existing style object (`h1: { ...typeScale.title, color }`)
// rather than replacing screens' own style keys.
export const typeScale = {
  display: { fontSize: 40, fontWeight: '800', letterSpacing: -0.5, lineHeight: 42 } as const,
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.3, lineHeight: 32 } as const,
  sectionTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.1, lineHeight: 20 } as const,
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0, lineHeight: 17 } as const,
  body: { fontSize: 14, fontWeight: '400', letterSpacing: 0, lineHeight: 20 } as const,
  caption: { fontSize: 12, fontWeight: '600', letterSpacing: 0.1, lineHeight: 15 } as const,
} as const;

// opacity -- shared disabled-state opacity, so "disabled" reads the same
// everywhere instead of each screen picking its own number (Dashboard's
// useDisabledFade used 0.35; SettingsPrimitives' Button used 0.5 -- an
// inconsistency flagged in the production readiness review, Low). 0.35 is
// the canonical value; Button now matches it too.
export const opacity = {
  disabled: 0.35,
} as const;

// overlay -- shared modal-scrim color, so a sheet/modal backdrop (e.g.
// CalendarScreen's LabelPickerModal) draws from one place instead of a
// hardcoded '#000' literal (production readiness review, Low).
export const overlay = {
  scrim: '#000',
} as const;

// elevation -- shared shadow so card-like surfaces read with a little depth
// instead of a flat fill. Mirrors the shadow values already used on the
// slider thumb in SettingsPrimitives.tsx.
export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  } as const,
  // Tighter/smaller shadow than `card` above -- tuned for a small draggable
  // control (SettingsPrimitives.tsx's SliderRow thumb) rather than a full
  // surface, so it's kept as its own token instead of force-fitting `card`
  // (production readiness review, Low: this shadow was previously
  // hardcoded inline, bypassing tokens.ts entirely).
  thumb: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  } as const,
} as const;

// springs -- shared spring physics so every settle in the app comes from one
// place instead of each file redefining the same numbers (AnimatedPressable.tsx,
// SettingsPrimitives.tsx's SliderRow, and CalendarScreen.tsx's tag-picker sheet
// each independently hardcoded an identical { stiffness: 300, damping: 30,
// mass: 1 } before this token existed). Matches the apple-design skill's
// "critically damped, no overshoot" default UI-settle spring: damping ratio
// here is 30 / (2*sqrt(300*1)) ~= 0.87 -- just under critical, so it settles
// quickly with no visible bounce. `useNativeDriver` is deliberately left off
// this shared object since it varies per call site (off wherever a spring
// drives a non-transform property like `width`).
export const springs = {
  default: { stiffness: 300, damping: 30, mass: 1 } as const,
} as const;
