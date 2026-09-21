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
import { Animated, ScrollView, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { WheelLockPhase, WheelPicker, WHEEL_ITEM_SIZE, useWheelScrollLock } from './WheelPicker';

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

// ---------------------------------------------------------------------------
// The animation itself: "the wheel's scrolling animation freezes."
//
// Every fix above this line hardened the GESTURE path -- the imperative
// scrollTo calls, the busy/correcting flags, the dropped lifecycle events.
// None of them touched the actual cause of the stall a user sees while
// dragging, which was that the per-item Animated graphs (subtract + two
// interpolations) and the Animated.event scroll handler were being rebuilt in
// the render body on EVERY render. Under useNativeDriver those are native
// nodes attached by identity, so each render detached the old graph and
// attached a new one -- and RN's deferred cleanup then ran
// __restoreDefaultValues() on the OLD node after the new one was already
// attached, resetting that view's opacity/transform to its static style.
// That is the stall-then-jump.
//
// Re-renders mid-drag are not an edge case here, they are how the call sites
// work: onDragStart itself flips the enclosing sheet's scroll-lock state, so
// the rebuild landed at the exact moment a drag began.
//
// These tests assert the invariant by COUNTING node construction, because
// that is the thing that must not happen again: re-inlining the
// interpolations would restore the original bug while leaving every other
// test in this file green.
describe('the animated graph is not rebuilt by a re-render', () => {
  // Stable, like every real call site's (HOUR_12_LABELS is module-level,
  // ClockWheels memoizes its minute labels, DashboardScreen's are consts).
  function Repainter({ labels = LABELS }: { labels?: string[] }) {
    // A parent that re-renders WheelPicker without changing its value --
    // exactly what the scroll-lock flip does at every call site.
    const [n, setN] = React.useState(0);
    return (
      <>
        <Text accessibilityLabel="repaint" onPress={() => setN((x) => x + 1)}>
          {n}
        </Text>
        <WheelPicker labels={labels} selectedIndex={3} onChange={() => {}} accessibilityLabel="test wheel" />
      </>
    );
  }

  let subtract: jest.SpyInstance;
  let event: jest.SpyInstance;

  /** Spies armed BEFORE the mount, so the mount's own construction is
   * counted -- that count is the baseline every assertion below is relative
   * to. */
  function renderRepainter(labels?: string[]) {
    subtract = jest.spyOn(Animated, 'subtract');
    event = jest.spyOn(Animated, 'event');
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Repainter labels={labels} />);
    });
    mounted.push(tree!);
    const repaint = () => {
      const hit = tree!.root.findAll((x) => x.props?.accessibilityLabel === 'repaint' && x.props?.onPress)[0];
      act(() => hit.props.onPress());
    };
    const relabel = (next: string[]) => act(() => tree!.update(<Repainter labels={next} />));
    const scrollView = tree!.root.findAll((n) => n.props?.snapToInterval === WHEEL_ITEM_SIZE)[0];
    return { tree: tree!, repaint, relabel, props: () => scrollView.props };
  }

  afterEach(() => {
    subtract?.mockRestore();
    event?.mockRestore();
  });

  it('builds exactly one item graph per label at mount', () => {
    renderRepainter();
    expect(subtract).toHaveBeenCalledTimes(LABELS.length);
    expect(event).toHaveBeenCalledTimes(1);
  });

  it('builds no new graphs when the parent re-renders it mid-value', () => {
    const { repaint } = renderRepainter();
    subtract.mockClear();
    event.mockClear();

    repaint();
    repaint();
    repaint();

    // The whole fix, in one assertion: three re-renders, zero rebuilt nodes.
    expect(subtract).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });

  it('builds no new graphs across a full drag-and-settle', () => {
    const { repaint, props } = renderRepainter();
    subtract.mockClear();

    act(() => props().onScrollBeginDrag(scrollEvent(120)));
    repaint(); // the lock flip a real call site performs right here
    act(() => props().onScrollEndDrag(scrollEvent(160)));
    act(() => props().onMomentumScrollEnd(scrollEvent(160)));

    expect(subtract).not.toHaveBeenCalled();
  });

  it('does not rebuild for a new labels array of the same length', () => {
    // Identity changes, geometry does not -- what a call site deriving its
    // labels inline produces on every single render.
    const { relabel } = renderRepainter();
    subtract.mockClear();

    relabel([...LABELS]);
    expect(subtract).not.toHaveBeenCalled();
  });

  // The Animated.subtract count above covers itemStyles, which is the memo
  // the scroll ANIMATION depends on. These two cover the other half: under a
  // null allowlist RN's AnimatedProps keys non-style props by IDENTITY, so a
  // single inline object literal or inline labels.map() in the render body
  // re-creates the whole AnimatedProps -- and with it the native scroll
  // event's detach/attach -- however stable the handler itself is. Asserted
  // on prop identity because that IS the composite key RN compares.
  it('hands the scroll view the same contentContainerStyle across re-renders', () => {
    const { repaint, props } = renderRepainter();
    const before = props().contentContainerStyle;
    repaint();
    expect(props().contentContainerStyle).toBe(before);
  });

  it('hands the scroll view the same children array across re-renders', () => {
    const { repaint, props } = renderRepainter();
    const before = props().children;
    repaint();
    expect(props().children).toBe(before);
  });

  it('keeps each item view identical across re-renders', () => {
    // The consequence of the children memo, stated in terms of what is
    // actually animated: re-rendering must not hand any item a new element,
    // and therefore not a new style object either.
    const { repaint, props } = renderRepainter();
    const before = (props().children as { props: { style: unknown } }[]).map((c) => c.props.style);
    repaint();
    const after = (props().children as { props: { style: unknown } }[]).map((c) => c.props.style);
    expect(after).toHaveLength(LABELS.length);
    after.forEach((style, i) => expect(style).toBe(before[i]));
  });

  it('still rebuilds when the wheel geometry actually changes', () => {
    // The memo must not be stale-wrong: a different number of items is a
    // different graph, and GoalForm swaps its hour labels outright when the
    // goal period changes.
    const { relabel } = renderRepainter();
    subtract.mockClear();

    relabel([...LABELS, '10', '11']);
    expect(subtract).toHaveBeenCalledTimes(LABELS.length + 2);
  });
});

// ---------------------------------------------------------------------------
// The other half of the freeze: the outer-scroll lock.
//
// A WheelPicker inside a same-axis ScrollView needs that ancestor to stop
// scrolling for the duration of a drag (see the onDragStart/onDragEnd prop
// comments). Five files hand-rolled that lock, and all five armed ONE flat
// 600ms backstop from whichever signal arrived first -- so any drag lasting
// longer than 600ms tripped it MID-DRAG, handing the ancestor's scroll back
// under a live finger and re-rendering the wheels while they were moving.
//
// Nothing tested it, in any of the five copies. These do.
describe('useWheelScrollLock', () => {
  /** The hook's setter, captured out of the render so the test can call it
   * with the (active, phase) pair a real wheel row passes -- no RN prop has
   * that signature to smuggle it through. */
  let setLock: (active: boolean, phase?: WheelLockPhase) => void;

  function Harnessed() {
    const { wheelActive, setWheelActive } = useWheelScrollLock();
    setLock = setWheelActive;
    return (
      <Text accessibilityLabel="lock" accessibilityState={{ selected: wheelActive }}>
        {String(wheelActive)}
      </Text>
    );
  }

  function renderLock() {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Harnessed />);
    });
    mounted.push(tree!);
    const node = () => tree!.root.findAll((n) => n.props?.accessibilityLabel === 'lock')[0];
    return {
      tree: tree!,
      set: (active: boolean, phase?: WheelLockPhase) => act(() => setLock(active, phase)),
      locked: () => node().props.accessibilityState.selected as boolean,
    };
  }

  it('holds the lock for a drag far longer than the tap window', () => {
    // The exact regression: 600ms into a real scrub, all five copies unlocked.
    const { set, locked } = renderLock();
    set(true, 'drag');
    expect(locked()).toBe(true);
    act(() => jest.advanceTimersByTime(1500));
    expect(locked()).toBe(true);
    act(() => jest.advanceTimersByTime(1500));
    expect(locked()).toBe(true);
  });

  it('releases a tap-phase lock on the short window', () => {
    // A touch that never becomes a drag is normally released by the row's own
    // onTouchEnd; this is the backstop for one of those being dropped.
    const { set, locked } = renderLock();
    set(true, 'touch');
    act(() => jest.advanceTimersByTime(601));
    expect(locked()).toBe(false);
  });

  it('defaults to the tap window when no phase is given', () => {
    const { set, locked } = renderLock();
    set(true);
    act(() => jest.advanceTimersByTime(601));
    expect(locked()).toBe(false);
  });

  it('a second touch during a drag does not shorten the drag window', () => {
    // A second finger landing on the wheel row calls (true, 'touch') while a
    // drag is live. Re-arming the short window there would re-create the
    // mid-drag unlock this hook exists to remove.
    const { set, locked } = renderLock();
    set(true, 'drag');
    set(true, 'touch');
    act(() => jest.advanceTimersByTime(1500));
    expect(locked()).toBe(true);
  });

  it('still releases eventually, so a dropped release cannot wedge a sheet', () => {
    // The whole reason the backstop is finite: the app backgrounded mid-drag
    // by an incoming call fires no synthetic touch-end, and a permanently
    // scrollEnabled={false} sheet puts Save/Cancel out of reach.
    const { set, locked } = renderLock();
    set(true, 'drag');
    act(() => jest.advanceTimersByTime(4001));
    expect(locked()).toBe(false);
  });

  it('releases immediately when told to, and stays released', () => {
    const { set, locked } = renderLock();
    set(true, 'drag');
    set(false);
    expect(locked()).toBe(false);
    act(() => jest.advanceTimersByTime(5000));
    expect(locked()).toBe(false);
  });

  it('re-locks with a fresh drag window after a release', () => {
    const { set, locked } = renderLock();
    set(true, 'drag');
    set(false);
    set(true, 'drag');
    act(() => jest.advanceTimersByTime(1500));
    expect(locked()).toBe(true);
  });

  it('cancels its backstop on unmount', () => {
    // SettingsScreen's own copy needed a bug fix for exactly this: switching
    // tabs mid-drag left the timer armed, and it fired setWheelActive(false)
    // on an unmounted screen 600ms later.
    //
    // Asserted on the pending-timer count, not on a React warning: React
    // dropped the "setState on an unmounted component" warning in 18.3, so a
    // console.error assertion here cannot fail whether the cleanup exists or
    // not. The armed timer is the thing the cleanup is actually responsible
    // for, and it is directly observable.
    const { tree, set } = renderLock();
    set(true, 'drag');
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    act(() => tree.unmount());
    mounted.length = 0;
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The caller's lock is released even when the gesture never ends.
//
// A native pan recognizer that is CANCELLED rather than ended invokes neither
// onScrollEndDrag nor onMomentumScrollEnd -- so onDragEnd never fired, and
// the enclosing sheet stayed scrollEnabled={false} until the CALLER's own
// backstop rescued it. That backstop has to be long (useWheelScrollLock's
// 4000ms drag window) so a legitimate long scrub can't trip it, which made it
// a poor rescuer. This component's own watchdog knows sooner.
//
// The pair of tests matters as much as either alone: firing from the watchdog
// unconditionally would release a SIBLING wheel's live drag, because a paired
// row (hours + minutes) shares one lock.
describe('onDragEnd for a gesture that never ends', () => {
  function renderWithDragSpy() {
    const onDragEnd = jest.fn();
    const onDragStart = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <WheelPicker
          labels={LABELS}
          selectedIndex={3}
          onChange={() => {}}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          accessibilityLabel="test wheel"
        />,
      );
    });
    mounted.push(tree!);
    const sv = tree!.root.findAll((n) => n.props?.snapToInterval === WHEEL_ITEM_SIZE)[0];
    return { onDragStart, onDragEnd, props: () => sv.props };
  }

  it('releases the lock when a drag gets no end event at all', () => {
    const { onDragEnd, props } = renderWithDragSpy();
    act(() => props().onScrollBeginDrag(scrollEvent(120)));
    expect(onDragEnd).not.toHaveBeenCalled();

    // The cancelled gesture: nothing else ever arrives.
    act(() => jest.advanceTimersByTime(4001));
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('does not release twice when the finger lifted normally', () => {
    // A fast flick defers its settle to onMomentumScrollEnd, and arms the
    // 900ms backstop in case that event is dropped. onDragEnd has already
    // fired at that point -- firing again from the backstop would release
    // whatever drag is live 900ms later, i.e. the paired wheel's.
    const { onDragEnd, props } = renderWithDragSpy();
    act(() => props().onScrollBeginDrag(scrollEvent(120)));
    act(() => props().onScrollEndDrag(scrollEvent(150, 1.2)));
    expect(onDragEnd).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(2000));
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('does not release twice for a slow release either', () => {
    const { onDragEnd, props } = renderWithDragSpy();
    act(() => props().onScrollBeginDrag(scrollEvent(120)));
    act(() => props().onScrollEndDrag(scrollEvent(160)));
    act(() => props().onMomentumScrollEnd(scrollEvent(160)));
    act(() => jest.advanceTimersByTime(5000));
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('releases each fresh gesture on its own', () => {
    const { onDragEnd, props } = renderWithDragSpy();
    act(() => props().onScrollBeginDrag(scrollEvent(120)));
    act(() => props().onScrollEndDrag(scrollEvent(160)));
    expect(onDragEnd).toHaveBeenCalledTimes(1);

    act(() => props().onScrollBeginDrag(scrollEvent(160)));
    act(() => props().onScrollEndDrag(scrollEvent(200)));
    expect(onDragEnd).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Two holes that survived every earlier fix, because every earlier fix
// guarded ISSUING a scroll and neither of these is about issuing one.
//
// A wheel with spies on the three callbacks a caller actually wires up.
// Uncontrolled on purpose: what matters below is what the component reports
// and when, not where a parent decides to park it.
function renderSpyWheel(selectedIndex = 3) {
  const onChange = jest.fn();
  const onDragStart = jest.fn();
  const onDragEnd = jest.fn();
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <WheelPicker
        labels={LABELS}
        selectedIndex={selectedIndex}
        onChange={onChange}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        accessibilityLabel="spy wheel"
      />,
    );
  });
  mounted.push(tree!);
  const matches = tree!.root.findAll((n) => n.props?.snapToInterval === WHEEL_ITEM_SIZE);
  const scrollView = matches[0];
  const scrollHost = matches.find((n) => typeof n.props?.onScroll === 'function');
  if (!scrollHost) throw new Error('no node carries onScroll as a function');
  return {
    tree: tree!,
    props: () => scrollView.props,
    fireScroll: (e: unknown) => scrollHost.props.onScroll(e),
    onChange,
    onDragStart,
    onDragEnd,
  };
}

/** One frame of a drag that is still moving, followed by `ms` of time.
 *
 * Fired through the node that carries onScroll as a plain FUNCTION. The
 * outer Animated.ScrollView holds it as an AnimatedEvent object instead --
 * the native-driver attach -- and the function further down the tree is
 * AnimatedEvent's own __getHandler() result, i.e. exactly what RN invokes
 * when a scroll frame arrives. Going through it is what exercises the JS
 * `listener` the watchdog's liveness signal rides on. */
function scrollFrame(w: ReturnType<typeof renderSpyWheel>, y: number, ms: number) {
  act(() => {
    w.fireScroll(scrollEvent(y));
    jest.advanceTimersByTime(ms);
  });
}

describe('a settle belonging to an abandoned scroll is not the live drag settle', () => {
  it('ignores an onMomentumScrollEnd that lands while a finger is down', () => {
    const w = renderSpyWheel();

    // Gesture 1 releases off-snap, so commit() leaves a corrective animated
    // scrollTo in flight.
    act(() => w.props().onScrollBeginDrag());
    act(() => w.props().onScrollEndDrag(scrollEvent(172)));
    expect(scrolledOffsets()).toEqual([160]);
    w.onChange.mockClear();
    scrollTo.mockClear();

    // Gesture 2 grabs the wheel before that correction finishes.
    // onScrollBeginDrag's cancelCorrecting() clears the FLAG, but nothing in
    // JS can cancel an animation already running inside the native view.
    act(() => w.props().onScrollBeginDrag());

    // ...so it lands anyway, mid-drag. Pre-fix this committed an index the
    // finger was merely passing through: onChange fired with it, and a fresh
    // corrective scrollTo went out UNDER the live touch.
    act(() => w.props().onMomentumScrollEnd(scrollEvent(160)));

    expect(w.onChange).not.toHaveBeenCalled();
    expect(scrolledOffsets()).toEqual([]);
  });

  it('leaves the drag watchdog armed, so a cancelled gesture still releases', () => {
    // The damaging half, and the one measured to strand the caller's lock:
    // that stale commit() also ran clearBusy(), disarming BUSY_MAX_DRAG_MS.
    // A gesture CANCELLED by the platform fires neither onScrollEndDrag nor
    // onMomentumScrollEnd, so the watchdog is the only thing left that can
    // report the release -- and it had just been switched off.
    const w = renderSpyWheel();

    act(() => w.props().onScrollBeginDrag());
    act(() => w.props().onScrollEndDrag(scrollEvent(172)));
    act(() => w.props().onScrollBeginDrag());
    act(() => w.props().onMomentumScrollEnd(scrollEvent(160)));
    w.onDragEnd.mockClear();

    // Gesture 2 is now cancelled: nothing else will ever arrive for it.
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(w.onDragEnd).toHaveBeenCalledTimes(1);
  });
});

describe('the drag watchdog measures from activity, not from the gesture start', () => {
  it('does not release a drag that is still moving past BUSY_MAX_DRAG_MS', () => {
    // A slow scrub of a long wheel (the ~100-step Override-presses picker,
    // or a deliberate hour scrub) runs past 4s without trying. The watchdog
    // used to fire anyway and do precisely the damage it exists to prevent:
    // hand the caller's scroll lock back under a live finger, and un-gate
    // the resync effect to scrollTo into the touch still driving the view.
    const w = renderSpyWheel();
    act(() => w.props().onScrollBeginDrag());

    for (let i = 0; i < 30; i++) scrollFrame(w, 120 + i, 200); // 6s, still moving

    expect(w.onDragEnd).not.toHaveBeenCalled();
    expect(scrolledOffsets()).toEqual([]);
  });

  it('still rescues a gesture that goes quiet -- and sooner than before', () => {
    const w = renderSpyWheel();
    act(() => w.props().onScrollBeginDrag());
    for (let i = 0; i < 30; i++) scrollFrame(w, 120 + i, 200);

    // The frames stop and no release ever arrives -- a cancelled gesture.
    // Recovery is now keyed to the silence, not to a fixed 4s from the
    // start, so it lands one BUSY_ACTIVITY_MS later instead.
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(w.onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('re-claims the caller lock while the drag is live, but not after release', () => {
    // useWheelScrollLock arms its own BUSY_MAX_DRAG_MS window once, at
    // onDragStart, and never refreshes it -- so the same start-relative
    // deadline dropped the sheet's scroll lock mid-scrub. Re-claiming keeps
    // it rolling; every call site's onDragStart is idempotent.
    const w = renderSpyWheel();
    act(() => w.props().onScrollBeginDrag());
    expect(w.onDragStart).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 15; i++) scrollFrame(w, 120 + i, 200); // 3s of drag
    expect(w.onDragStart.mock.calls.length).toBeGreaterThan(1);

    // After the finger lifts, the coast is this wheel's own animation -- it
    // must NOT keep extending a lock the caller was already told to drop.
    act(() => w.props().onScrollEndDrag(scrollEvent(500, 2))); // fast flick
    const claimsAtRelease = w.onDragStart.mock.calls.length;
    for (let i = 0; i < 15; i++) scrollFrame(w, 500 + i, 200);

    expect(w.onDragStart).toHaveBeenCalledTimes(claimsAtRelease);
  });
});
