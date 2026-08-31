// GoalForm.test.tsx -- regression test for the "editing goal B shows goal
// A's leftover field values" bug.
//
// GoalForm seeds every one of its fields (topic, period, target
// days/hours/minutes, weekday chips, reminder times/days, "only if behind")
// from its `initial` prop ONLY via useState's mount-time initial argument --
// there is no effect anywhere in this file that re-derives state when
// `initial` changes on an ALREADY-MOUNTED instance. That's fine as long as a
// caller remounts GoalForm whenever it's about to edit a conceptually
// different goal -- which is exactly what GoalsSection.tsx's own header
// documents ISN'T automatic: its form Sheet's `children` (GoalForm included)
// stay mounted across the Sheet's own open/close cycles, since ui/Sheet.tsx
// passes `children` to its <Modal> unconditionally and only the modal's
// native visibility toggles. GoalsSection.tsx fixes this with
// `key={editingGoal?.id ?? 'new'}` on its own <GoalForm> -- forcing exactly
// the remount a real identity change needs.
//
// This test proves the mechanism that fix depends on, directly against
// GoalForm (no GoalsSection/GoalRow involved, so no need to stand up their
// BLE/icon dependencies for a check that's really about this file): with a
// stable `key`, a changed `initial` prop leaves the target wheel showing the
// PREVIOUS goal's value (documenting why GoalsSection can't skip the key);
// with a `key` that changes alongside `initial` -- the real fix -- the
// wheel correctly reports the NEW goal's own value.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { GoalForm } from './GoalForm';
import { WheelPicker } from '../ui/WheelPicker';
import { TopicChip } from './GoalTopicChips';
import { Goal, MAX_DAILY_TARGET_S } from '../goals/goals';
import { resolveTheme } from '../theme/theme';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
// Same stand-in SettingsScreen.test.tsx uses, and needed here for the same
// reason: jest-expo's expo-font mock (loadedNativeFonts) trips over
// @expo/vector-icons' own font-loaded check outside a real native runtime.
// This form reaches an icon through ui/FormDisclosure's chevron, which is
// what collapses its optional field groups -- an opaque leaf as far as this
// test is concerned, which only ever asks a WheelPicker for its index.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Feather: 'Feather', MaterialIcons: 'MaterialIcons' }));

const theme = resolveTheme('dark', 'mint');

const goal = (id: string, targetS: number): Goal => ({
  id,
  topic: null,
  period: 'daily',
  targetS,
  createdAt: 0,
  updatedAt: 0,
  archived: false,
});

// Every tree this file mounts, unmounted in afterEach. FormDisclosure's
// chevron runs a 160ms Animated.timing on each expand/collapse, which it
// stops in an unmount-only effect (see its own header) -- but only if
// something actually unmounts it. Left mounted, the tests below that press a
// disclosure row finish while that timing is still scheduling frames, and it
// fires after Jest has torn the environment down: a torn-down-environment
// stack plus an update-not-wrapped-in-act warning, printed over a PASSING
// run. Same `mounted`/afterEach shape ui/Sheet.test.tsx and
// ui/WheelPicker.test.tsx already use for their own pending animations.
const mounted: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
});

const goalA = goal('goal-a', 3600); // 1h00m
const goalB = goal('goal-b', 7200); // 2h00m

function renderForm(tree: TestRenderer.ReactTestRenderer | null, formKey: string, initial: Goal) {
  const element = (
    <GoalForm
      key={formKey}
      initial={initial}
      customLabels={[]}
      themeMode="dark"
      color={theme}
      error={null}
      submitLabel="Save goal"
      onSubmit={() => {}}
      onCancel={() => {}}
      onWheelActiveChange={() => {}}
    />
  );
  if (!tree) {
    let created: TestRenderer.ReactTestRenderer;
    act(() => {
      created = TestRenderer.create(element);
    });
    mounted.push(created!);
    return created!;
  }
  act(() => tree.update(element));
  return tree;
}

function hoursWheelIndex(tree: TestRenderer.ReactTestRenderer) {
  const wheels = tree.root
    .findAllByType(WheelPicker)
    .filter((n) => n.props.accessibilityLabel === 'Goal target, hours');
  expect(wheels).toHaveLength(1);
  return wheels[0].props.selectedIndex;
}

describe('reusing one GoalForm instance across a changed `initial`', () => {
  it('leaves the wheel on the previous goal when the key does not change', () => {
    let tree = renderForm(null, 'stable-key', goalA);
    expect(hoursWheelIndex(tree)).toBe(1);

    // Same key -- React reuses the instance. This documents the constraint
    // GoalsSection.tsx's own key fix exists to route around, it isn't
    // itself a bug in GoalForm (which owns no notion of "which goal am I
    // currently showing" beyond its own mount-time seed).
    tree = renderForm(tree, 'stable-key', goalB);
    expect(hoursWheelIndex(tree)).toBe(1);
  });

  it('shows the new goal once the key changes with it -- the real fix', () => {
    let tree = renderForm(null, goalA.id, goalA);
    expect(hoursWheelIndex(tree)).toBe(1);

    tree = renderForm(tree, goalB.id, goalB);
    expect(hoursWheelIndex(tree)).toBe(2);
  });
});

// --- The decluttering contract -------------------------------------------
//
// The optional field groups (label, active days, session count, reminders)
// are collapsed by default and only ONE can be open at a time -- that is the
// whole reason the form stopped being a single tall stack of every control.
// Asserted through GoalTopicChips' TopicChip, which is mounted only while
// the "Counts" group is expanded: FormDisclosure UNMOUNTS a collapsed
// group's children rather than hiding them (see its own header), so the
// chip's presence is a direct read of that.
function pressRow(tree: TestRenderer.ReactTestRenderer, accessibilityLabel: string) {
  const hits = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === accessibilityLabel && typeof n.props?.onPress === 'function',
  );
  expect(hits.length).toBeGreaterThan(0);
  act(() => hits[0].props.onPress());
}

describe('optional field groups', () => {
  it('starts with every group collapsed', () => {
    const tree = renderForm(null, 'collapsed', goalA);
    expect(tree.root.findAllByType(TopicChip)).toHaveLength(0);
    // The target wheels are NOT behind a disclosure -- they are the goal's
    // primary field, and hiding them would trade clutter for indirection.
    expect(hoursWheelIndex(tree)).toBe(1);
  });

  it('expands one group on tap and collapses it again', () => {
    const tree = renderForm(null, 'toggle', goalA);
    // The row announces itself as "<label>, <summary>" (FormDisclosure).
    pressRow(tree, 'Counts, All focus time');
    expect(tree.root.findAllByType(TopicChip).length).toBeGreaterThan(0);
    pressRow(tree, 'Counts, All focus time');
    expect(tree.root.findAllByType(TopicChip)).toHaveLength(0);
  });

  it('closes the open group when another one is opened', () => {
    const tree = renderForm(null, 'accordion', goalA);
    pressRow(tree, 'Counts, All focus time');
    expect(tree.root.findAllByType(TopicChip).length).toBeGreaterThan(0);
    pressRow(tree, 'Reminders, Off');
    expect(tree.root.findAllByType(TopicChip)).toHaveLength(0);
  });
});

// The weekly/monthly Days wheel shrinks Hours/Minutes to a single "0" once
// Days is maxed, so the wheels can never build a value past the period's
// bound. Daily has the same boundary one wheel to the left --
// MAX_DAILY_TARGET_S is exactly 24h, and hourLabelsFor('daily') includes
// "24h" so that max is reachable -- but only the Days half was guarded, so
// daily let the wheels reach 24h05m with the submit button still enabled.
describe('daily target wheels cannot build a value past the daily maximum', () => {
  const wheels = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(WheelPicker);
  const dailyGoal: Goal = { ...goal('goal-daily', 3600), period: 'daily' };

  const mountDaily = () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GoalForm
          initial={dailyGoal}
          customLabels={[]}
          themeMode="dark"
          color={theme}
          error={null}
          submitLabel="Save goal"
          onSubmit={() => {}}
          onCancel={() => {}}
          onWheelActiveChange={() => {}}
        />,
      );
    });
    mounted.push(tree);
    return tree;
  };

  it('offers only "00m" once Hours is at the daily maximum', () => {
    const tree = mountDaily();
    // Daily has two wheels: [hours, minutes].
    const [hoursWheel] = wheels(tree);
    act(() => hoursWheel.props.onChange(24)); // 24h
    const [, minutesWheel] = wheels(tree);
    expect(minutesWheel.props.labels).toEqual(['00m']);
  });

  it('forces Minutes back to 0 when Hours is scrolled to the maximum', () => {
    const tree = mountDaily();
    let [hoursWheel, minutesWheel] = wheels(tree);
    act(() => minutesWheel.props.onChange(1)); // 05m first
    [hoursWheel, minutesWheel] = wheels(tree);
    act(() => hoursWheel.props.onChange(24)); // then 24h -- 24h05m would overshoot
    [hoursWheel, minutesWheel] = wheels(tree);
    // Index 0 of a single-entry ['00m'] list, i.e. zero minutes.
    expect(minutesWheel.props.selectedIndex).toBe(0);
    expect(minutesWheel.props.labels).toEqual(['00m']);
  });

  it('still lets the exact daily maximum be reached', () => {
    // 24h00m == MAX_DAILY_TARGET_S must stay selectable; the guard shrinks
    // Minutes, it does not cap Hours below the max.
    const tree = mountDaily();
    const [hoursWheel] = wheels(tree);
    expect(hoursWheel.props.labels).toContain(`${MAX_DAILY_TARGET_S / 3600}h`);
  });
});
