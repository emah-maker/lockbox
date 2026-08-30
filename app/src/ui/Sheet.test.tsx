// Sheet.test.tsx -- regression tests for three bugs in this bottom-sheet
// primitive, all described in Sheet.tsx's own comments:
//
// 1. `size="large"` used to set a fixed height (85% of screen), so every
//    large sheet opened as a near-full-screen panel of empty space no matter
//    how little content it actually held. `maxHeight` is the right knob --
//    it caps how big the sheet may grow, it doesn't force it that big.
//
// 2. The body's own swipe-to-dismiss has to claim the gesture in the CAPTURE
//    phase (to beat the body ScrollView's rubber-band), gated behind
//    `dragBodyToDismiss`, `scrollEnabled`, being scrolled to the top, and a
//    slop/direction check -- get any one of those wrong and either an
//    ordinary scroll-back-up gets eaten as a dismiss, or a WheelPicker-
//    bearing sheet's wheel can never be spun (see `dragBodyToDismiss`'s own
//    doc comment).
//
// 3. Releasing a swipe that's already committed to dismiss (past
//    DISMISS_DISTANCE) has to ride the sheet the rest of the way down first
//    and only call `onClose` once that animation actually finishes -- calling
//    it synchronously used to hand straight to the `visible` effect, whose
//    exit target (SHEET_TRAVEL, 56px) sits ABOVE wherever the swipe had
//    already dragged the sheet to, yanking it back up mid-fade.
//
// These drive the real component through react-test-renderer, same as
// WheelPicker.test.tsx/SettingsScreen.test.tsx.
import React from 'react';
import { Animated, Dimensions, StyleSheet, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Sheet } from './Sheet';

const frame = { x: 0, y: 0, width: 320, height: 640 };
const insets = { top: 0, left: 0, right: 0, bottom: 0 };

const mounted: TestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  // Fake timers throughout, same defensive reason WheelPicker.test.tsx gives
  // for its own corrective-scroll backstop: Sheet's entrance/exit springs
  // schedule real requestAnimationFrame work (a Timeout under the hood, see
  // react-native/jest/setup.js), and a callback firing after teardown would
  // re-render an unmounted tree. None of these tests ever advance these
  // timers -- the entrance spring is irrelevant to what's asserted below and
  // is simply left pending, harmless, until the afterEach clears it.
  jest.useFakeTimers();
});

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function renderSheet(props: Partial<React.ComponentProps<typeof Sheet>> = {}) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <Sheet visible onClose={() => {}} {...props}>
          <Text>content</Text>
        </Sheet>
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree!);
  return tree!;
}

/** The View carrying the sheet's own maxHeight/height -- identified by the
 * `onLayout` it alone takes (Sheet.tsx measures ONLY this View, to know how
 * far "off the bottom" a committed swipe has to travel). */
function sheetPanel(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((n) => typeof n.props?.onLayout === 'function')[0];
}

/** The body-drag View -- carries `onMoveShouldSetResponderCapture`, the
 * wrapped, capture-phase prop PanResponder.create()'s own `panHandlers`
 * puts on every host node it's spread onto (verified against
 * node_modules/react-native/Libraries/Interaction/PanResponder.js), whether
 * or not the config passed to `create()` actually supplied a
 * `onMoveShouldSetPanResponderCapture` entry -- the wrapped prop is present
 * either way and just falls through to `false` if it wasn't. That means
 * this prop name alone does NOT tell bodyPan's View apart from headerPan's
 * (both carry it, via Sheet.tsx's shared `dragHandlers`) -- so instead of
 * `findAll`-ing for the prop directly, this walks up from the one place
 * that unambiguously belongs to the body: its ScrollView, identified by
 * `keyboardShouldPersistTaps="handled"` (a prop Sheet.tsx sets nowhere
 * else). */
function bodyPanNode(tree: TestRenderer.ReactTestRenderer) {
  const scrollView = tree.root.findAll((n) => n.props?.keyboardShouldPersistTaps === 'handled')[0];
  let node = scrollView.parent;
  while (node && typeof node.props?.onMoveShouldSetResponderCapture !== 'function') {
    node = node.parent;
  }
  if (!node) throw new Error('body PanResponder View not found');
  return node;
}

/** A minimal-but-real PanResponder touchHistory for a single finger that has
 * moved by exactly (dx, dy) since the gesture began. A hand-built
 * `{dy, dx}` gestureState can't be hand to the rendered View's own prop
 * directly: `onMoveShouldSetResponderCapture` only takes a native event and
 * recomputes gestureState itself from `event.touchHistory`
 * (PanResponder.js's `_updateGestureStateOnMove`/TouchHistoryMath) -- this
 * is the shape that makes that recomputation land on exactly (dx, dy). */
function touchMove(dy: number, dx: number, ts = 100) {
  return {
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: ts,
      touchBank: [
        {
          touchActive: true,
          currentTimeStamp: ts,
          currentPageX: dx,
          currentPageY: dy,
          previousPageX: 0,
          previousPageY: 0,
        },
      ],
    },
  } as any;
}

describe('size does not pin a fixed height', () => {
  const windowHeight = Dimensions.get('window').height;

  it('size="auto" caps maxHeight at 80% of the window, with no fixed height', () => {
    const tree = renderSheet({ size: 'auto' });
    const style = StyleSheet.flatten(sheetPanel(tree).props.style);

    expect(style.height).toBeUndefined();
    expect(style.maxHeight).toBeCloseTo(windowHeight * 0.8);
  });

  it('size="large" only raises that cap to 90% -- it must not set a fixed height', () => {
    const tree = renderSheet({ size: 'large' });
    const style = StyleSheet.flatten(sheetPanel(tree).props.style);

    // Pre-fix, size="large" set `height: windowHeight * 0.85` here, which is
    // what made every large sheet open as a near-full-screen panel of empty
    // space regardless of how little content it actually held.
    expect(style.height).toBeUndefined();
    expect(style.maxHeight).toBeCloseTo(windowHeight * 0.9);
  });
});

describe('body swipe-to-dismiss gating', () => {
  it('captures a clear downward drag with default props', () => {
    const tree = renderSheet();
    const capture = bodyPanNode(tree).props.onMoveShouldSetResponderCapture;

    expect(capture(touchMove(40, 0))).toBe(true);
  });

  it('does not capture when dragBodyToDismiss is false', () => {
    const tree = renderSheet({ dragBodyToDismiss: false });
    const capture = bodyPanNode(tree).props.onMoveShouldSetResponderCapture;

    expect(capture(touchMove(40, 0))).toBe(false);
  });

  it('does not capture when scrollEnabled is false', () => {
    const tree = renderSheet({ scrollEnabled: false });
    const capture = bodyPanNode(tree).props.onMoveShouldSetResponderCapture;

    expect(capture(touchMove(40, 0))).toBe(false);
  });

  it('does not capture a mostly-horizontal drag', () => {
    const tree = renderSheet();
    const capture = bodyPanNode(tree).props.onMoveShouldSetResponderCapture;

    expect(capture(touchMove(12, 40))).toBe(false);
  });

  it('does not capture a drag below the 8px slop', () => {
    const tree = renderSheet();
    const capture = bodyPanNode(tree).props.onMoveShouldSetResponderCapture;

    expect(capture(touchMove(4, 0))).toBe(false);
  });
});

describe('a committed swipe rides down before calling onClose', () => {
  it('does not close synchronously on release -- only once the exit animation finishes', () => {
    // Sheet.tsx's dismissWithMomentum rides the sheet off-screen via
    // Animated.timing (everywhere else in Sheet.tsx uses Animated.spring),
    // so stubbing just `timing` isolates exactly this path without engaging
    // the real requestAnimationFrame loop -- these tests never advance fake
    // timers, so a real spring/timing here would just hang mid-animation
    // forever instead of settling.
    const finishCallbacks: Array<(r: { finished: boolean }) => void> = [];
    jest.spyOn(Animated, 'timing').mockImplementation(
      () =>
        ({
          start: (cb?: (r: { finished: boolean }) => void) => {
            if (cb) finishCallbacks.push(cb);
          },
          stop: () => {},
          reset: () => {},
        }) as any,
    );

    const onClose = jest.fn();
    const tree = renderSheet({ onClose });
    const body = bodyPanNode(tree).props;

    act(() => {
      body.onResponderGrant(touchMove(0, 0));
      body.onResponderMove(touchMove(150, 0)); // past DISMISS_DISTANCE (100px)
      body.onResponderRelease(touchMove(150, 0));
    });

    // The release committed to a dismiss and kicked off the (mocked) exit
    // animation, but must not have told the caller to close yet -- pre-fix,
    // this fired here, synchronously, before the sheet had actually reached
    // the bottom of the screen.
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      finishCallbacks.forEach((cb) => cb({ finished: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
