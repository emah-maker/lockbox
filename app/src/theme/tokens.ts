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
