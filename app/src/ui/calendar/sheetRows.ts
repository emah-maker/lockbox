// sheetRows.ts -- the row shape shared by this folder's two picker sheets.
//
// LabelPickerSheet.tsx (pick one tag for a session) and CalendarStreaksSheet.tsx
// (toggle which goals' streaks the calendar shows) are deliberately different
// components -- single-pick-and-close versus multi-select-and-stay-open -- but
// they draw the same list: a color dot, a flexed label, and a trailing
// affordance, at the same 12px vertical padding.
//
// That padding is load-bearing rather than incidental: with a 20px label line
// it lands the row at exactly the 44pt minimum touch target, in lists where a
// mis-tap retags the wrong session or hides the wrong goal. Both files carried
// the number with a comment pointing at the other one, which is precisely the
// arrangement that lets one of them get nudged and the other not.
//
// Styles only -- no component. The two sheets' rows differ in what they put
// after the label (a check glyph and a "Not counted" pill versus a checkbox)
// and in what a press means, so sharing the container would mean a prop for
// every one of those differences.
import { StyleSheet } from 'react-native';
import { typeScale } from '../../theme/tokens';

export const sheetRowStyles = StyleSheet.create({
  list: { marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowLabel: {
    fontSize: 15,
    flex: 1,
    letterSpacing: typeScale.body.letterSpacing,
    lineHeight: typeScale.body.lineHeight,
  },
});
