// GoalReminderControl.test.tsx -- regression test for the "+ Add time"
// silent-collapse bug: openPicker(-1) used to always reset the new-entry
// draft to the hardcoded DEFAULT_NOTIFY_AT ('09:00'), regardless of which
// times the goal already had. A user who turned "Remind me" on (seeding
// ['09:00']), tapped "+ Add time", and tapped "Add" without touching the
// wheel got a picker that opened already showing '09:00' -- identical to
// the existing chip -- so commitDraft's own
// `Array.from(new Set(next)).sort()` silently collapsed the two-entry
// ['09:00','09:00'] back down to one, and the picker closed as though it
// had worked. No error, no toast: the user believed they'd added a second
// reminder and hadn't.
//
// The fix has two halves, tested separately below:
//  (a) nextAvailableDraftTime seeds a new entry to a time that ISN'T
//      already taken (one hour after the latest existing entry, with the
//      edge cases an end-of-day entry and a fully dense list need).
//  (b) commitDraft now detects a genuine collision (the deduped list is
//      shorter than what was about to be committed) and surfaces a message
//      instead of closing as though the commit succeeded.
//
// Rendered (not just the pure helper) for the "yields two distinct
// entries" and "collision surfaces an error" cases, since those are
// exactly the user-visible behaviors the bug report is about -- a
// pure-function test alone wouldn't prove the component's own commitDraft
// actually calls it, or actually blocks on a collision.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { GoalReminderControl, nextAvailableDraftTime } from './GoalReminderControl';
import { resolveTheme } from '../theme/theme';

// Same stand-in GoalForm.test.tsx/SettingsScreen.test.tsx use: jest-expo's
// expo-font mock trips over @expo/vector-icons' own font-loaded check
// outside a real native runtime, and this control's icon-free chain
// doesn't need a real one for anything this file checks.
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const theme = resolveTheme('dark', 'mint');

// Every tree this file mounts, unmounted in afterEach -- same reasoning
// GoalForm.test.tsx's own `mounted` gives (WheelPicker/AnimatedPressable
// pending Animated timings firing after Jest tears the environment down).
const mounted: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
});

/** A thin controlled-component harness standing in for what GoalForm/
 * GoalFormGroups actually do: hold `times` (and the other fields
 * GoalReminderControl needs) in real React state and feed each `on*Change`
 * callback straight back into it, so pressing "Add" in the rendered tree
 * really does flow through to a re-rendered chip row -- exactly what a
 * real user tapping through the form would see. */
function Harness({ initialTimes }: { initialTimes: string[] }) {
  const [notify, setNotify] = React.useState(true);
  const [times, setTimes] = React.useState<string[]>(initialTimes);
  const [days, setDays] = React.useState<number[] | undefined>(undefined);
  const [onlyIfBehind, setOnlyIfBehind] = React.useState(false);
  return (
    <GoalReminderControl
      notify={notify}
      times={times}
      days={days}
      onlyIfBehind={onlyIfBehind}
      onNotifyChange={setNotify}
      onTimesChange={setTimes}
      onDaysChange={setDays}
      onOnlyIfBehindChange={setOnlyIfBehind}
      onWheelActiveChange={() => {}}
      color={theme}
    />
  );
}

function mountHarness(initialTimes: string[]) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Harness initialTimes={initialTimes} />);
  });
  mounted.push(tree);
  return tree;
}

/** AnimatedPressable wraps Animated.createAnimatedComponent(Pressable), so
 * every chip's edit button shows up several times over in `findAll` -- once
 * per layer of that wrapping, all forwarding the same accessibilityLabel/
 * onPress straight through. Deduped here to one TestInstance per DISTINCT
 * label, in first-seen (i.e. render) order, so a count or an index-based
 * press actually corresponds to one chip rather than one wrapper layer. */
function uniqueChipEditNodes(tree: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance[] {
  const hits = tree.root.findAll(
    (n) =>
      typeof n.props?.accessibilityLabel === 'string' &&
      /^Reminder at .+, edit$/.test(n.props.accessibilityLabel) &&
      typeof n.props?.onPress === 'function',
  );
  const seen = new Set<string>();
  const unique: TestRenderer.ReactTestInstance[] = [];
  for (const n of hits) {
    const label = n.props.accessibilityLabel as string;
    if (!seen.has(label)) {
      seen.add(label);
      unique.push(n);
    }
  }
  return unique;
}

/** Every chip's own "Reminder at ..., edit" accessibilityLabel, in render
 * order (which is `times`' own sorted order -- see GoalReminderControl's
 * chip row). Counted rather than parsed: the exact clock-format text is
 * locale-dependent (Intl inside formatClockTime), so only the COUNT and
 * the fixed "Reminder at ..., edit" shape are asserted on here, never a
 * specific formatted time string. */
function chipEditLabels(tree: TestRenderer.ReactTestRenderer): string[] {
  return uniqueChipEditNodes(tree).map((n) => n.props.accessibilityLabel as string);
}

function pressByLabel(tree: TestRenderer.ReactTestRenderer, accessibilityLabel: string) {
  const hits = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === accessibilityLabel && typeof n.props?.onPress === 'function',
  );
  expect(hits.length).toBeGreaterThan(0);
  act(() => hits[0].props.onPress());
}

/** Opens the inline edit picker for the Nth rendered chip (0-indexed, in
 * chipEditLabels' own order) without depending on that chip's
 * locale-formatted label text. */
function pressEditChip(tree: TestRenderer.ReactTestRenderer, index: number) {
  const hits = uniqueChipEditNodes(tree);
  expect(hits.length).toBeGreaterThan(index);
  act(() => hits[index].props.onPress());
}

/** The picker's own commit ("Add "/"Update ") button, located by its fill
 * color (styles.pickerBtn + {backgroundColor: color.accent, ...}) rather
 * than by its label text, which embeds the same locale-dependent formatted
 * time chipEditLabels avoids. The Cancel button next to it never sets
 * backgroundColor, so this is unambiguous. */
function pressCommit(tree: TestRenderer.ReactTestRenderer) {
  const hits = tree.root.findAll(
    (n) =>
      typeof n.props?.onPress === 'function' &&
      Array.isArray(n.props?.style) &&
      n.props.style.some((s: unknown) => !!s && typeof s === 'object' && (s as { backgroundColor?: string }).backgroundColor === theme.accent),
  );
  expect(hits.length).toBeGreaterThan(0);
  act(() => hits[0].props.onPress());
}

/** The hour WheelPicker inside the open time picker. */
function hourWheel(tree: TestRenderer.ReactTestRenderer) {
  const hits = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === 'Reminder time, hour' && typeof n.props?.onChange === 'function',
  );
  expect(hits.length).toBe(1);
  return hits[0];
}

/** Flattens a Text node's `children` (a bare string, or the array JSX
 * produces for `{a} {b}`) into one string, so the fixed, non-formatted
 * collision message can be searched for regardless of how React grouped
 * its pieces. */
function textOf(node: TestRenderer.ReactTestInstance): string {
  const c = node.props?.children;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : '')).join('');
  return '';
}

function hasText(tree: TestRenderer.ReactTestRenderer, needle: string): boolean {
  return tree.root.findAll((n) => String(n.type) === 'Text' && textOf(n).includes(needle)).length > 0;
}

describe('adding a second reminder without touching the wheel', () => {
  // THIS TEST FAILS AGAINST THE PRE-FIX CODE: openPicker(-1) used to seed
  // the draft to the hardcoded DEFAULT_NOTIFY_AT ('09:00') regardless of
  // `times`, so with times already at ['09:00'], pressing "Add" produced
  // ['09:00', '09:00'] -> deduped to ['09:00'] -- one entry, not two.
  // Fixed, it passes because nextAvailableDraftTime seeds something else
  // entirely.
  it('actually produces two distinct reminder times', () => {
    const tree = mountHarness(['09:00']);
    expect(chipEditLabels(tree)).toHaveLength(1);

    pressByLabel(tree, 'Add another reminder time');
    // Commit immediately -- no wheel interaction at all, exactly the
    // failure scenario's step 3 ("taps Add without scrolling the wheel").
    pressCommit(tree);

    expect(chipEditLabels(tree)).toHaveLength(2);
  });
});

describe('nextAvailableDraftTime', () => {
  it('falls back to the default reminder time when the list is empty', () => {
    expect(nextAvailableDraftTime([])).toBe('09:00');
  });

  it('never returns a time already in the list', () => {
    const times = ['09:00', '13:30', '18:00'];
    expect(times).not.toContain(nextAvailableDraftTime(times));
  });

  it('seeds one hour after the latest existing entry in the common case', () => {
    expect(nextAvailableDraftTime(['09:00'])).toBe('10:00');
    expect(nextAvailableDraftTime(['09:00', '10:00'])).toBe('11:00');
  });

  it('does not wrap past midnight into an invalid 24:00, or into an earlier taken time', () => {
    // Latest entry is 23:00 -- a naive "+1 hour" would be "24:00", not a
    // valid clock time at all.
    const withLateEntry = nextAvailableDraftTime(['23:00']);
    expect(withLateEntry).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    expect(withLateEntry).not.toBe('23:00');

    // Densely packed near both the start of the day and the end: the
    // forward search from latest+1h has nowhere left to land (23:50 + 1h
    // overflows the day), so it must fall back to scanning from midnight
    // -- and must skip the already-taken 00:00/00:05 rather than
    // returning one of them.
    expect(nextAvailableDraftTime(['00:00', '00:05', '23:50'])).toBe('00:10');
  });

  it('still returns some value for a fully dense day rather than throwing', () => {
    const fullDay: string[] = [];
    for (let m = 0; m < 24 * 60; m += 5) {
      fullDay.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
    expect(() => nextAvailableDraftTime(fullDay)).not.toThrow();
    expect(typeof nextAvailableDraftTime(fullDay)).toBe('string');
  });
});

describe('a deliberate collision surfaces an error instead of silently collapsing', () => {
  it('editing a chip to match another existing entry keeps both entries and shows a message', () => {
    const tree = mountHarness(['09:00', '10:00']);
    expect(chipEditLabels(tree)).toHaveLength(2);

    // Open the second chip's (10:00) own edit picker, drag its hour wheel
    // down to 9 -- matching the OTHER chip, '09:00' -- and try to commit.
    pressEditChip(tree, 1);
    act(() => hourWheel(tree).props.onChange(9));
    pressCommit(tree);

    // Still two entries: the collision was rejected, not silently deduped
    // down to one, and the picker's own error message is now showing.
    expect(chipEditLabels(tree)).toHaveLength(2);
    expect(hasText(tree, 'You already have a reminder at that time.')).toBe(true);
  });
});
