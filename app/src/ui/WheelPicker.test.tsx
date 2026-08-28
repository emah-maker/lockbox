// WheelPicker.test.tsx -- regression tests for the "wheel glitches and
// freezes sometimes" bug.
//
// commit() used to clear isBusyRef in the same tick it *started* its
// corrective scrollTo(). scrollTo() has no completion callback, so that
// declared the settle resolved while the correction was still animating: if
// commit()'s onChange landed on a different selectedIndex in the next render
// (a paired wheel's clamp, a box-sync tick), the external-resync effect saw
// an unguarded wheel and fired a *second* animated scrollTo into the middle
// of the first. Two imperative scrolls fighting over one ScrollView is the
// jitter, and -- when one interrupts the other badly enough to wedge the
// gesture responder -- the freeze.
//
// These drive the real component through react-test-renderer and assert on
// the exact sequence of scrollTo() calls, since that ordering *is* the bug.
import React from 'react';
import { ScrollView } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { WheelPicker, WHEEL_ITEM_SIZE } from './WheelPicker';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));

const LABELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** contentOffset `y`, plus the release velocity commit() reads to decide
 * whether momentum will settle the snap itself. */
function scrollEvent(y: number, velocity = 0) {
  return { nativeEvent: { contentOffset: { x: 0, y }, velocity: { x: 0, y: velocity } } } as any;
}

/** A controlled parent, like the real ones: DashboardScreen's 0h00m guard and
 * GoalForm's setDaysClamped both answer a drag with a *different* index than
 * the one the wheel reported. That disagreement is what the resync effect
 * exists to reconcile -- and what used to race the corrective scroll. */
function Harness({ clamp }: { clamp?: (i: number) => number }) {
  const [value, setValue] = React.useState(3);
  return (
    <WheelPicker
      labels={LABELS}
      selectedIndex={value}
      onChange={(i) => setValue(clamp ? clamp(i) : i)}
      accessibilityLabel="test wheel"
    />
  );
}

let scrollTo: jest.SpyInstance;
const mounted: TestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  // Fake timers throughout: commit() arms a 400ms correction backstop, and a
  // real one firing after teardown re-renders an unmounted tree.
  jest.useFakeTimers();
  // The ScrollView instance method the component calls imperatively -- the
  // single observable side effect of both the correction and the resync.
  scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  // Unmount first: the component's own cleanup cancels its pending timer.
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
  scrollTo.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

function renderWheel(clamp?: (i: number) => number) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Harness clamp={clamp} />);
  });
  mounted.push(tree!);
  // The inner ScrollView, identified by a prop only it carries.
  const scrollView = tree!.root.findAll((n) => n.props?.snapToInterval === WHEEL_ITEM_SIZE)[0];
  return { tree: tree!, props: () => scrollView.props };
}

/** Offsets passed to scrollTo, in call order. */
function scrolledOffsets() {
  return scrollTo.mock.calls.map((c: any[]) => c[0]?.y);
}

describe('a corrective scroll is not raced by the resync effect', () => {
  it('issues only the correction while it is still animating', () => {
    // Any index >= 4 is rejected and forced back to 0 -- the shape of
    // GoalForm's "days hit its max, zero the siblings" clamp.
    const { props } = renderWheel((i) => (i >= 4 ? 0 : i));

    act(() => props().onScrollBeginDrag());
    act(() => {
      // Released between items: rounds to index 4, 12px off that snap point,
      // so commit() corrects to 160 AND reports 4 -- which the parent rejects.
      props().onScrollEndDrag(scrollEvent(172));
    });

    // Pre-fix this was [160, 0]: the resync effect fired immediately, aiming
    // at the clamped index while the correction to 160 was still running.
    expect(scrolledOffsets()).toEqual([160]);
  });

  it('lets the resync run once the correction lands', () => {
    const { props } = renderWheel((i) => (i >= 4 ? 0 : i));

    act(() => props().onScrollBeginDrag());
    act(() => props().onScrollEndDrag(scrollEvent(172)));
    expect(scrolledOffsets()).toEqual([160]);

    // The correction's own trailing momentum event: now on the snap point.
    act(() => props().onMomentumScrollEnd(scrollEvent(160)));

    // Deferred, not dropped -- the wheel still ends up parked on the index
    // the caller actually chose (0), just sequentially instead of racing.
    expect(scrolledOffsets()).toEqual([160, 0]);
  });

  it('still resyncs if the trailing momentum event never arrives', () => {
    const { props } = renderWheel((i) => (i >= 4 ? 0 : i));

    act(() => props().onScrollBeginDrag());
    act(() => props().onScrollEndDrag(scrollEvent(172)));
    expect(scrolledOffsets()).toEqual([160]);

    // A platform that doesn't emit onMomentumScrollEnd for a programmatic
    // scroll must not leave the guard stuck -- that would be a *new* freeze,
    // with the wheel permanently ignoring its caller.
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(scrolledOffsets()).toEqual([160, 0]);
  });

  it('does not defer anything when the settle needs no correction', () => {
    const { props } = renderWheel((i) => (i >= 4 ? 0 : i));

    act(() => props().onScrollBeginDrag());
    act(() => {
      // Landed exactly on index 4's snap point: no correction to protect, so
      // the resync to the clamped index should go out immediately.
      props().onScrollEndDrag(scrollEvent(160));
    });

    expect(scrolledOffsets()).toEqual([0]);
  });

  it('a new drag supersedes an in-flight correction', () => {
    const { props } = renderWheel((i) => (i >= 4 ? 0 : i));

    act(() => props().onScrollBeginDrag());
    act(() => props().onScrollEndDrag(scrollEvent(172)));
    const afterFirst = scrolledOffsets().length;

    // Finger back down before the correction finished: the wheel belongs to
    // the gesture now, and nothing should scroll out from under it.
    act(() => props().onScrollBeginDrag());
    act(() => props().onScrollEndDrag(scrollEvent(80)));

    // Only the second drag's own commit (index 2, already on its snap point,
    // accepted by the clamp) -- no leftover correction fired mid-gesture.
    expect(scrolledOffsets().length).toBe(afterFirst);
  });
});

describe('unchanged behavior', () => {
  /** Uncontrolled: selectedIndex never moves, so the resync effect stays out
   * of the way and these assert commit()'s reporting alone. */
  function renderFixed(onChange: (i: number) => void) {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <WheelPicker labels={LABELS} selectedIndex={3} onChange={onChange} accessibilityLabel="w" />,
      );
    });
    mounted.push(tree!);
    return tree!.root.findAll((n) => n.props?.snapToInterval === WHEEL_ITEM_SIZE)[0];
  }

  it('reports the released index to the caller', () => {
    const onChange = jest.fn();
    const sv = renderFixed(onChange);

    act(() => sv.props.onScrollBeginDrag());
    act(() => sv.props.onScrollEndDrag(scrollEvent(172)));

    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('commits a single release exactly once', () => {
    const onChange = jest.fn();
    const sv = renderFixed(onChange);

    act(() => sv.props.onScrollBeginDrag());
    act(() => sv.props.onScrollEndDrag(scrollEvent(160)));
    // iOS runs its own settle pass after a low-velocity release, so this
    // fires for the same physical gesture -- committedRef dedupes it.
    act(() => sv.props.onMomentumScrollEnd(scrollEvent(160)));

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('defers to momentum on a fast flick instead of committing early', () => {
    const onChange = jest.fn();
    const sv = renderFixed(onChange);

    act(() => sv.props.onScrollBeginDrag());
    act(() => sv.props.onScrollEndDrag(scrollEvent(172, 2.5))); // still coasting

    expect(onChange).not.toHaveBeenCalled();
  });
});
