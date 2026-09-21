// animationCleanup.test.tsx -- pins the thing this app's animated components
// rely on without saying so: React Native stops an in-flight JS-driven
// animation by itself when the component driving it unmounts.
//
// This file exists because the opposite was believed. Five components
// (ui/AnimatedFill, screens/home/ProgressRing, screens/stats/GoalRing,
// screens/stats/InteractiveTopicDonut, and ui/Sheet's three transitions)
// start an Animated timing/spring and never stop it, and two others
// (ui/FormDisclosure, screens/home/FocusHero) carry an explicit
// `useEffect(() => () => v.stopAnimation(), [v])` added to fix exactly that
// -- with comments describing frames driven against a detached node and
// torn-down-environment stacks under Jest. The five were about to be
// "fixed" the same way. They did not need it, and neither did the two:
//
//   AnimatedProps.__detach()      (on unmount)
//     -> AnimatedStyle.__removeChild -> AnimatedStyle.__detach()
//       -> AnimatedValue.__removeChild -> AnimatedValue.__detach()
//         -> AnimatedValue.stopAnimation()   <-- Animated/nodes/AnimatedValue.js
//           -> TimingAnimation.stop()
//
// So the last animated prop reading a value going away is already what
// stops that value's animation. The tests below are the executable form of
// that trace: the value freezes where it was, schedules no further frames,
// and -- because stop() ends the animation with `{finished: false}` -- any
// completion callback guarded on `finished` never fires. Sheet's is the one
// that mattered: its callbacks are setPresented(false) and onClose(), and
// both are so guarded.
//
// Kept as a test rather than a comment because it is an assumption about a
// DEPENDENCY, silently load-bearing for seven components, and the cheapest
// possible warning if a React Native upgrade ever changes it.
import { useEffect, useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Animated, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

import { AnimatedFill } from './AnimatedFill';
import { Sheet } from './Sheet';
import { ProgressRing } from '../screens/home/ProgressRing';
import { GoalRing } from '../screens/stats/GoalRing';
import { InteractiveTopicDonut } from '../screens/stats/InteractiveTopicDonut';

/** ProgressRing seeds its Animated.Value AT `progress` and only tweens a
 * CHANGE, so -- unlike the other three, which start at 0 and animate up to
 * their prop -- mounting it at a fixed value starts nothing. It used to
 * appear to: the mount effect tweened `clamped` to `clamped`, a
 * zero-distance timing that called Animated.timing and satisfied the
 * assertions below while never actually running, which made this row of the
 * table vacuous. (That no-op is now skipped outright -- see ProgressRing's
 * PROGRESS_EPSILON, which exists to stop a 1Hz countdown re-arming a 400ms
 * JS tween to move the arc a fraction of a pixel.) Driving a real change
 * after mount is what gives this row an in-flight animation to freeze. */
function ProgressRingWithChange() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setProgress(0.8);
  }, []);
  return <ProgressRing progress={progress} color="#4ade80" trackColor="#1f2937" />;
}

/** Every component that starts a JS-driven Animated.timing on mount, with
 * how long that timing runs. All four are forced onto the JS driver:
 * AnimatedFill animates height/width-percent and the three rings animate
 * SVG strokeDashoffset, none of which the native driver supports. */
const TIMED: [name: string, render: () => React.ReactElement, durationMs: number][] = [
  ['AnimatedFill', () => <AnimatedFill axis="height" toValue={100} style={{}} color="#4ade80" />, 500],
  ['ProgressRing', () => <ProgressRingWithChange />, 400],
  ['GoalRing', () => <GoalRing ratio={0.8} color="#4ade80" trackColor="#1f2937" />, 450],
  [
    'InteractiveTopicDonut',
    () => (
      <InteractiveTopicDonut
        segments={[
          { key: 'work', focusS: 3600, color: '#4ade80' },
          { key: 'study', focusS: 1800, color: '#60a5fa' },
        ]}
        selectedKey={null}
        onSelect={() => {}}
      />
    ),
    500,
  ],
];

const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 0, left: 0, right: 0, bottom: 0 };

/** requestAnimationFrame is a `declare function` in React Native's types,
 * which TypeScript will not let a test reassign -- reached through
 * globalThis so it can be wrapped and put back. */
const rafHost = globalThis as unknown as {
  requestAnimationFrame: (cb: (time: number) => void) => number;
};

let timing: jest.SpyInstance;
let rafCount: number;
let realRaf: (cb: (time: number) => void) => number;

beforeEach(() => {
  jest.useFakeTimers();
  // Calls through. This is only how the test gets a handle on the
  // Animated.Value the component keeps in a ref -- there is no way in from
  // outside. What is asserted is the value's own behaviour, not that some
  // method was called on it.
  timing = jest.spyOn(Animated, 'timing');
  // A running JS timing re-arms itself every frame (TimingAnimation.onUpdate
  // tail-calls requestAnimationFrame while __active), so "no new frames" is
  // the direct signal that it is no longer running -- a frozen VALUE alone
  // could also mean a frame that happened to compute the same number.
  rafCount = 0;
  realRaf = rafHost.requestAnimationFrame;
  rafHost.requestAnimationFrame = (cb: (time: number) => void) => {
    rafCount++;
    return realRaf(cb);
  };
});

afterEach(() => {
  rafHost.requestAnimationFrame = realRaf;
  timing.mockRestore();
  jest.useRealTimers();
});

function mount(element: React.ReactElement) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree!;
}

describe('unmounting stops an in-flight JS-driven timing', () => {
  it.each(TIMED)('%s', (_name, render, durationMs) => {
    const tree = mount(render());
    expect(timing).toHaveBeenCalled();
    const value = timing.mock.calls[0][0] as { __getValue(): number };

    // Partway in, so the freeze below is a real freeze at a mid-flight
    // number and not the trivial case of a timing that never started.
    act(() => {
      jest.advanceTimersByTime(Math.round(durationMs / 5));
    });
    const mid = value.__getValue();
    expect(mid).toBeGreaterThan(0);

    act(() => {
      tree.unmount();
    });
    const framesAtUnmount = rafCount;
    // Well past the far end of the timing -- where, if it were still
    // running, it would walk the rest of the way to its target.
    act(() => {
      jest.advanceTimersByTime(durationMs * 4);
    });

    expect(value.__getValue()).toBe(mid);
    expect(rafCount).toBe(framesAtUnmount);
  });
});

describe('Sheet does not call back into a tree that is gone', () => {
  const sheet = (visible: boolean, onClose: () => void, onOpened: () => void) => (
    <SafeAreaProvider initialMetrics={{ frame, insets }}>
      <Sheet visible={visible} onClose={onClose} onOpened={onOpened} title="T">
        <Text>body</Text>
      </Sheet>
    </SafeAreaProvider>
  );

  it('drops the entrance completion when the host screen unmounts mid-enter', () => {
    const onClose = jest.fn();
    const onOpened = jest.fn();
    // Mounted and the entrance spring started, but no frame has run yet --
    // under fake timers this spring settles inside its very first one, so
    // "mid-flight" here means before that frame rather than after it.
    const tree = mount(sheet(true, onClose, onOpened));
    expect(onOpened).not.toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(onOpened).not.toHaveBeenCalled();
  });

  it('drops the exit completion when the host screen unmounts mid-exit', () => {
    // The one with teeth: this transition's completion callback is
    // setPresented(false), a state update, and a swipe-dismissed sheet's is
    // onClose() -- the caller's own handler. Either arriving after the tree
    // is gone is a bug the guard on `finished` quietly prevents.
    const onClose = jest.fn();
    const onOpened = jest.fn();
    const tree = mount(sheet(true, onClose, onOpened));
    act(() => {
      jest.advanceTimersByTime(2000); // let it finish opening
    });

    act(() => {
      tree.update(sheet(false, onClose, onOpened));
    });
    act(() => {
      jest.advanceTimersByTime(16); // one frame into the exit
    });
    expect(tree.toJSON()).toBeTruthy(); // still presented, still animating out

    act(() => {
      tree.unmount();
    });
    const framesAtUnmount = rafCount;
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(rafCount).toBe(framesAtUnmount);
  });
});
