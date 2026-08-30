// GoalFormExtras.test.ts -- weekdaySummary, the one-line reading of a
// weekday selection shown on a COLLAPSED ui/FormDisclosure row. It matters
// more than a formatter usually would: while a group is collapsed this
// string is the only thing saying which days are selected, so a wrong answer
// here is a goal that silently appears to be something it isn't.
//
// A .ts file, not .tsx: only the pure helper is imported, so this needs no
// renderer and no @expo/vector-icons stand-in.
import { weekdaySummary } from './GoalFormExtras';

describe('weekdaySummary', () => {
  // goals.ts treats undefined, [] and all seven as the same thing ("every
  // day"). The summary has to read identically for all three, or a goal
  // would appear to change simply by round-tripping through the form.
  it('reads every equivalent form of "no restriction" the same way', () => {
    expect(weekdaySummary(undefined)).toBe('Every day');
    expect(weekdaySummary([])).toBe('Every day');
    expect(weekdaySummary([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(weekdaySummary([6, 5, 4, 3, 2, 1, 0])).toBe('Every day');
  });

  it('names the two selections people actually make', () => {
    expect(weekdaySummary([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(weekdaySummary([5, 4, 3, 2, 1])).toBe('Weekdays');
    expect(weekdaySummary([0, 6])).toBe('Weekends');
  });

  // 0 = Sunday, matching this app's one Sunday-start convention
  // (Goal.daysOfWeek, goalProgress.ts's weeklyWindow, Date#getDay).
  it('lists anything else in weekday order, Sunday first', () => {
    expect(weekdaySummary([3, 1])).toBe('Mo, We');
    expect(weekdaySummary([6, 0, 3])).toBe('Su, We, Sa');
  });

  it('tolerates a duplicated day rather than listing it twice', () => {
    expect(weekdaySummary([1, 1, 3])).toBe('Mo, We');
  });
});
