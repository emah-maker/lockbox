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
import { Goal } from '../goals/goals';
import { resolveTheme } from '../theme/theme';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));

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
