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

  it('a rejected VoiceOver increment does not double-fire once its scroll settles', () => {
    // renderFixed's selectedIndex never moves (the parent fully rejects
    // every change, GoalForm-clamp-style), so the trailing
    // onMomentumScrollEnd a real animated scrollTo(next, true) fires once it
    // lands is the only thing left to re-enter commit() here.
    const onChange = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <WheelPicker labels={LABELS} selectedIndex={3} onChange={onChange} accessibilityLabel="w" />,
      );
    });
    mounted.push(tree!);
    const outer = tree!.root.findAll((n) => typeof n.props?.onAccessibilityAction === 'function')[0];
    const sv = tree!.root.findAll((n) => n.props?.snapToInterval === WHEEL_ITEM_SIZE)[0];

    act(() => outer.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(4);

    // selectedIndex is still 3 (the parent ignored the change): pre-fix,
    // commit() saw index (4) !== selectedIndex (3) and fired a second,
    // spurious onChange(4) plus a second haptic for the one gesture.
    act(() => sv.props.onMomentumScrollEnd(scrollEvent(4 * WHEEL_ITEM_SIZE)));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// The mirror of the correctingRef races above: isBusyRef is set the instant a
// drag begins and was cleared ONLY inside commit(). If the event that runs
// commit() never arrives -- a flick whose trailing onMomentumScrollEnd a
// platform declines to emit, or a drag whose native gesture recognizer is
// CANCELLED rather than ended (cancellation fires no scroll-lifecycle event
// at all) -- isBusyRef stayed true for the life of the component, and the
// resync effect's `if (isBusyRef.current || ...) return;` silently swallowed
// every future selectedIndex change. Not a glitch: a permanently dead wheel,
// which is what "the time picker still freezes sometimes" actually was.
describe('a dropped scroll-lifecycle event cannot wedge the wheel forever', () => {
  /** A parent driven from OUTSIDE the wheel's own onChange -- a paired wheel
   * wrapping around, a box-sync tick, a reset. Harness above only ever reacts
   * to onChange, which can't express "the world moved on while wedged". */
  function renderControlled(initial: number) {
    let tree: TestRenderer.ReactTestRenderer;
    const render = (i: number) => (
      <WheelPicker
        labels={LABELS}
        selectedIndex={i}
        onChange={() => {}}
        accessibilityLabel="test wheel"
      />
    );
    act(() => {
      tree = TestRenderer.create(render(initial));
    });
    mounted.push(tree!);
    const sv = () => tree!.root.findAll((n) => n.props?.snapToInterval === WHEEL_ITEM_SIZE)[0];
    return {
      tree: tree!,
      props: () => sv().props,
      update: (next: number) => act(() => tree!.update(render(next))),
    };
  }

  it('recovers when a flick never gets its trailing onMomentumScrollEnd', () => {
    const { props, update } = renderControlled(3);

    act(() => props().onScrollBeginDrag());
    // Released while still coasting, so commit() correctly defers -- and the
    // event it defers to is exactly the one being dropped here.
    act(() => props().onScrollEndDrag(scrollEvent(172, 2.5)));

    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    update(7);

    // Pre-fix: [] -- scrollTo was never called again, ever.
    expect(scrolledOffsets()).toContain(7 * WHEEL_ITEM_SIZE);
  });

  it('recovers when a drag begin gets no end event at all', () => {
    const { props, update } = renderControlled(3);

    act(() => props().onScrollBeginDrag());
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    update(9);

    expect(scrolledOffsets()).toContain(9 * WHEEL_ITEM_SIZE);
  });

  it('does not fire its backstop while a normal settle is still pending', () => {
    const { props } = renderControlled(3);

    act(() => props().onScrollBeginDrag());
    act(() => props().onScrollEndDrag(scrollEvent(172, 2.5)));
    // The momentum event arrives normally, well inside the settle window.
    act(() => props().onMomentumScrollEnd(scrollEvent(4 * WHEEL_ITEM_SIZE)));
    const afterSettle = scrolledOffsets().length;

    // The disarmed backstop must not now force a spurious extra scroll.
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(scrolledOffsets().length).toBe(afterSettle);
  });

  it('never re-aims the native view via contentOffset after mount', () => {
    // contentOffset is forwarded straight to the native scroll view, so
    // recomputing it from a live selectedIndex was a SECOND, unguarded channel
    // repositioning the same ScrollView the resync effect guards -- including
    // out from under a live touch, which is how a gesture gets cancelled and
    // the wedge above gets triggered in the first place.
    const { props, update } = renderControlled(3);
    const mountOffset = props().contentOffset;

    act(() => props().onScrollBeginDrag()); // finger down
    update(8); // a paired wheel / box-sync tick lands mid-drag

    expect(props().contentOffset).toBe(mountOffset);
    expect(props().contentOffset).toEqual({ x: 0, y: 3 * WHEEL_ITEM_SIZE });
  });
});

describe('the resync effect does not race its own scroll', () => {
  // The resync effect issues an ANIMATED scrollTo, which owns the ScrollView
  // for the ~250-300ms it runs. Until it claimed correctingRef the way
  // commit()'s correction always has, it was the one scrollTo in the
  // component that could be re-entered while still in flight: a second
  // external selectedIndex change arriving inside that window fired a second
  // overlapping scroll onto the same view -- the two-imperative-scrolls fight
  // this whole file exists to prevent.
  //
  // Reachable from an HOURS drag specifically: hours is the only wheel whose
  // onChange rewrites its sibling's value (DashboardScreen's 0h00m guard
  // bumps minutes to 5), so one hours commit forces a change on an *idle*
  // wheel -- neither isBusyRef nor correctingRef set -- and a box-sync tick
  // is a second, drag-independent source that can land right behind it.
  function renderControlled(initial: number) {
    let tree: TestRenderer.ReactTestRenderer;
    const render = (i: number) => (
      <WheelPicker
        labels={LABELS}
        selectedIndex={i}
        onChange={() => {}}
        accessibilityLabel="test wheel"
      />
    );
    act(() => {
      tree = TestRenderer.create(render(initial));
    });
    mounted.push(tree!);
    const sv = () => tree!.root.findAll((n) => n.props?.snapToInterval === WHEEL_ITEM_SIZE)[0];
    return {
      props: () => sv().props,
      update: (next: number) => act(() => tree!.update(render(next))),
    };
  }

  it('does not stack a second scroll when a new value lands mid-resync', () => {
    const { update } = renderControlled(3);

    update(5); // e.g. the sibling-wheel clamp an hours commit forces
    expect(scrolledOffsets()).toEqual([5 * WHEEL_ITEM_SIZE]);

    // Second external change, while that scroll is still animating -- no
    // trailing onMomentumScrollEnd has arrived yet.
    update(7);
    expect(scrolledOffsets()).toEqual([5 * WHEEL_ITEM_SIZE]);
  });

  it('catches up to the newest value once the in-flight scroll lands', () => {
    const { props, update } = renderControlled(3);

    update(5);
    update(7); // deferred, not dropped

    // The first scroll lands, firing its own trailing momentum event.
    act(() => props().onMomentumScrollEnd(scrollEvent(5 * WHEEL_ITEM_SIZE)));

    expect(scrolledOffsets()).toEqual([5 * WHEEL_ITEM_SIZE, 7 * WHEEL_ITEM_SIZE]);
  });

  it('catches up even if the trailing momentum event never arrives', () => {
    const { update } = renderControlled(3);

    update(5);
    update(7);

    // Backstop only -- CORRECTION_SETTLE_MS rescues a dropped event.
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(scrolledOffsets()).toEqual([5 * WHEEL_ITEM_SIZE, 7 * WHEEL_ITEM_SIZE]);
  });
});
