// ClockWheels.test.tsx -- the shared time-of-day picker, driven through the
// real component.
//
// Two things are under test, and they are the two things the change that
// introduced this file was asked to deliver:
//
//   1. The picker speaks 12-hour AM/PM while the VALUE stays 'HH:MM'
//      24-hour. Every assertion below is on the string handed to onChange,
//      because that string is what goals.ts / scheduledSessions.ts validate
//      and what the website dashboard also writes -- a picker that shows the
//      right thing and emits the wrong thing would pass a screenshot review
//      and corrupt every stored reminder.
//
//   2. The outer-scroll lock is told which gesture is asking. A caller that
//      loses the 'drag' phase re-enables its own scroll in the middle of any
//      drag longer than 600ms, which is half of the original "the time picker
//      freezes" report (see useWheelScrollLock in WheelPicker.tsx).
//
// Driven through accessibilityLabel rather than rendered text, for the same
// reason GoalReminderControl.test.tsx does: the summary strings around this
// control go through Intl and are locale-dependent, while these labels are
// fixed.
import TestRenderer, { act } from 'react-test-renderer';
import { ClockWheels } from './ClockWheels';
import { WheelLockPhase } from './WheelPicker';
import { HOUR_12_LABELS } from './time';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));

const mounted: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  mounted.splice(0).forEach((t) => act(() => t.unmount()));
});

type Lock = { active: boolean; phase?: WheelLockPhase };

function mount(value: string, opts: { minuteStep?: number; fallback?: string } = {}) {
  const onChange = jest.fn();
  const locks: Lock[] = [];
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ClockWheels
        value={value}
        onChange={onChange}
        accessibilityPrefix="Start time"
        onWheelActiveChange={(active, phase) => locks.push({ active, phase })}
        {...opts}
      />,
    );
  });
  mounted.push(tree);
  return { tree, onChange, locks };
}

/** The wheel whose accessibilityLabel ends in `suffix`. Its
 * accessibilityValue.text is what a screen reader announces, i.e. the label
 * the wheel is currently parked on. */
function wheel(tree: TestRenderer.ReactTestRenderer, suffix: 'hour' | 'minute') {
  const hits = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === `Start time, ${suffix}` && typeof n.props?.onChange === 'function',
  );
  expect(hits).toHaveLength(1);
  return hits[0];
}

function shownOn(tree: TestRenderer.ReactTestRenderer, suffix: 'hour' | 'minute'): string {
  const hits = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === `Start time, ${suffix}` && !!n.props?.accessibilityValue,
  );
  expect(hits.length).toBeGreaterThan(0);
  return hits[0].props.accessibilityValue.text as string;
}

/** The AM or PM segment. Both are plain buttons, so `selected` is the only
 * thing distinguishing the active one.
 *
 * Takes the OUTERMOST match, the same dedupe GoalReminderControl.test.tsx
 * does: AnimatedPressable forwards accessibilityLabel/onPress down through
 * Pressable to the host View, so one segment is three matching nodes. */
function period(tree: TestRenderer.ReactTestRenderer, p: 'AM' | 'PM') {
  const hits = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === `Start time, ${p}` && typeof n.props?.onPress === 'function',
  );
  expect(hits.length).toBeGreaterThan(0);
  return hits[0];
}

function selectedPeriod(tree: TestRenderer.ReactTestRenderer): 'AM' | 'PM' {
  const am = period(tree, 'AM').props.accessibilityState?.selected;
  const pm = period(tree, 'PM').props.accessibilityState?.selected;
  // Exactly one, always -- a picker showing neither (or both) is showing a
  // value the user cannot read.
  expect([am, pm]).toEqual(am ? [true, false] : [false, true]);
  return am ? 'AM' : 'PM';
}

describe('what the picker shows for a stored 24-hour value', () => {
  it('shows every hour of the day as a 12-hour clock reading', () => {
    for (let h = 0; h < 24; h++) {
      const { tree } = mount(`${String(h).padStart(2, '0')}:30`);
      expect(shownOn(tree, 'hour')).toBe(HOUR_12_LABELS[h % 12]);
      expect(selectedPeriod(tree)).toBe(h < 12 ? 'AM' : 'PM');
      expect(shownOn(tree, 'minute')).toBe('30');
      act(() => tree.unmount());
      mounted.pop();
    }
  });

  it('never shows a 24-hour hour label', () => {
    // The actual regression this file exists to prevent: the three pickers
    // this component replaced all offered 13..23 as wheel labels.
    const { tree } = mount('17:45');
    const labels = tree.root
      .findAll((n) => String(n.type) === 'Text' && typeof n.props?.children === 'string')
      .map((n) => n.props.children as string);
    expect(labels).toContain('5');
    for (const l of labels) {
      const n = Number(l);
      if (!Number.isNaN(n)) expect(n).toBeLessThanOrEqual(55); // minutes go to 55; hours stop at 12
      if (!Number.isNaN(n) && HOUR_12_LABELS.includes(l)) expect(n).toBeLessThanOrEqual(12);
    }
    expect(labels).not.toContain('17');
  });

  it('shows midnight as 12 AM and noon as 12 PM, not 0 and 12', () => {
    const midnight = mount('00:00');
    expect(shownOn(midnight.tree, 'hour')).toBe('12');
    expect(selectedPeriod(midnight.tree)).toBe('AM');

    const noon = mount('12:00');
    expect(shownOn(noon.tree, 'hour')).toBe('12');
    expect(selectedPeriod(noon.tree)).toBe('PM');
  });

  it('parks an off-grid minute on the nearest wheel stop', () => {
    // The website dashboard writes reminder times with no 5-minute step.
    expect(shownOn(mount('09:07').tree, 'minute')).toBe('05');
    expect(shownOn(mount('09:58').tree, 'minute')).toBe('55');
  });

  it('parks on the caller\'s own fallback when the value is unusable', () => {
    const quiet = mount('', { fallback: '00:00' });
    expect(shownOn(quiet.tree, 'hour')).toBe('12');
    expect(selectedPeriod(quiet.tree)).toBe('AM');

    const reminder = mount('garbage', { fallback: '09:00' });
    expect(shownOn(reminder.tree, 'hour')).toBe('9');
    expect(selectedPeriod(reminder.tree)).toBe('AM');
  });
});

describe('what the picker emits', () => {
  it('emits 24-hour HH:MM, keeping the period it was already on', () => {
    const { tree, onChange } = mount('17:30');
    act(() => wheel(tree, 'hour').props.onChange(3)); // the "3" slot, still PM
    expect(onChange).toHaveBeenCalledWith('15:30');
  });

  it('keeps an AM hour in the morning', () => {
    const { tree, onChange } = mount('09:00');
    act(() => wheel(tree, 'hour').props.onChange(3));
    expect(onChange).toHaveBeenCalledWith('03:00');
  });

  it('emits hour 0 for 12 AM and hour 12 for 12 PM', () => {
    // The two values a hand-rolled 1..12 conversion gets wrong.
    const am = mount('09:00');
    act(() => wheel(am.tree, 'hour').props.onChange(0));
    expect(am.onChange).toHaveBeenCalledWith('00:00');

    const pm = mount('21:00');
    act(() => wheel(pm.tree, 'hour').props.onChange(0));
    expect(pm.onChange).toHaveBeenCalledWith('12:00');
  });

  it('moves the value exactly 12 hours when the period is tapped', () => {
    const { tree, onChange } = mount('09:15');
    act(() => period(tree, 'PM').props.onPress());
    expect(onChange).toHaveBeenCalledWith('21:15');
  });

  it('crosses noon and midnight correctly on a period tap', () => {
    const toNoon = mount('00:00');
    act(() => period(toNoon.tree, 'PM').props.onPress());
    expect(toNoon.onChange).toHaveBeenCalledWith('12:00');

    const toMidnight = mount('12:00');
    act(() => period(toMidnight.tree, 'AM').props.onPress());
    expect(toMidnight.onChange).toHaveBeenCalledWith('00:00');
  });

  it('does nothing when the already-selected period is tapped', () => {
    // Not merely redundant: emitting here would snap an off-grid stored
    // minute on a tap the user reads as a no-op, and fire a store write.
    const { tree, onChange } = mount('09:07');
    act(() => period(tree, 'AM').props.onPress());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('snaps an off-grid minute once the user does commit a real change', () => {
    const { tree, onChange } = mount('09:07');
    act(() => period(tree, 'PM').props.onPress());
    // 07 was never a reachable wheel stop; the value must not keep a minute
    // the wheel isn't showing.
    expect(onChange).toHaveBeenCalledWith('21:05');
  });

  it('emits every on-grid minute unchanged', () => {
    const { tree, onChange } = mount('09:00');
    for (let i = 0; i < 12; i++) {
      act(() => wheel(tree, 'minute').props.onChange(i));
      expect(onChange).toHaveBeenLastCalledWith(`09:${String(i * 5).padStart(2, '0')}`);
    }
  });

  it('honors a non-default minute step', () => {
    const { tree, onChange } = mount('09:00', { minuteStep: 15 });
    expect(
      tree.root.findAll((n) => String(n.type) === 'Text' && n.props?.children === '45'),
    ).toHaveLength(1);
    act(() => wheel(tree, 'minute').props.onChange(3));
    expect(onChange).toHaveBeenCalledWith('09:45');
  });
});

describe('the outer-scroll lock handoff', () => {
  it('reports the drag phase, so a long drag cannot trip the caller\'s backstop', () => {
    const { tree, locks } = mount('09:00');
    act(() => wheel(tree, 'hour').props.onDragStart());
    expect(locks).toContainEqual({ active: true, phase: 'drag' });
  });

  it('claims the gesture on touch and releases it if no drag follows', () => {
    const { tree, locks } = mount('09:00');
    const row = tree.root.findAll((n) => typeof n.props?.onTouchStart === 'function')[0];
    act(() => row.props.onTouchStart());
    expect(locks).toContainEqual({ active: true, phase: 'touch' });
    act(() => row.props.onTouchEnd());
    expect(locks[locks.length - 1].active).toBe(false);
  });

  it('releases the lock when a drag ends', () => {
    const { tree, locks } = mount('09:00');
    act(() => wheel(tree, 'minute').props.onDragStart());
    act(() => wheel(tree, 'minute').props.onDragEnd());
    expect(locks[locks.length - 1].active).toBe(false);
  });

  it('does not lock the outer scroll for an AM/PM tap', () => {
    // The toggle sits outside the touch-capturing row on purpose: it is a tap
    // target, so claiming the enclosing scroll for it would be claiming a
    // gesture it never needs.
    const { tree, locks } = mount('09:00');
    act(() => period(tree, 'PM').props.onPress());
    expect(locks).toHaveLength(0);
  });
});
