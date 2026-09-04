// useNowMs.test.tsx -- regression tests for useNowMs.ts's own header: this
// hook exists because nothing else in the app ever ticks, so these pin the
// four behaviors that header promises -- interval-driven advancement,
// staying silent while backgrounded, an immediate refresh on foreground
// (the "phone woke up 8 hours later" case), and full teardown on unmount.
//
// No renderHook helper in this codebase's test setup (same note
// screens/home/useHomeGoalRing.test.tsx makes) -- same react-test-renderer +
// tiny harness component pattern, and fake timers throughout for the same
// reason Sheet.test.tsx gives: a real setInterval firing after teardown
// would re-render (or, here, schedule work on) an unmounted tree.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useNowMs } from './useNowMs';

const mounted: TestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  // react-native/jest/setup.js mocks AppState as a plain object (not the
  // real class), with `currentState` left as an unconfigured jest.fn() --
  // production always boots 'active', so tests set it explicitly rather
  // than relying on that mock's default.
  (AppState as unknown as { currentState: string }).currentState = 'active';
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

/** Grabs the 'change' handler this hook's mount registered, so a test can
 * simulate an AppState transition the same way the real emitter would
 * invoke it -- the jest-preset mock never fires it on its own. */
function latestAppStateHandler(): (state: string) => void {
  const addEventListener = AppState.addEventListener as jest.Mock;
  const call = addEventListener.mock.calls[addEventListener.mock.calls.length - 1];
  return call[1];
}

function renderNowMs(intervalMs?: number) {
  let latest: number | undefined;
  function Harness() {
    latest = useNowMs(intervalMs);
    return null;
  }
  act(() => {
    mounted.push(TestRenderer.create(<Harness />));
  });
  return {
    get value() {
      return latest!;
    },
  };
}

describe('useNowMs', () => {
  it('advances after the interval elapses', () => {
    const start = Date.now();
    const hook = renderNowMs(1_000);
    expect(hook.value).toBe(start);
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(hook.value).toBeGreaterThan(start);
  });

  it('does not tick while the app is backgrounded', () => {
    (AppState as unknown as { currentState: string }).currentState = 'background';
    const start = Date.now();
    const hook = renderNowMs(1_000);
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(hook.value).toBe(start);
  });

  it('refreshes immediately on returning to the foreground, without waiting for the interval', () => {
    (AppState as unknown as { currentState: string }).currentState = 'background';
    const start = Date.now();
    const hook = renderNowMs(60_000);
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(hook.value).toBe(start);

    // Simulate the device waking up hours later, well under one interval's
    // worth of elapsed wall-clock ticks, and the OS reporting 'active'.
    const laterMs = start + 8 * 60 * 60 * 1000;
    jest.setSystemTime(laterMs);
    const handler = latestAppStateHandler();
    act(() => {
      handler('active');
    });
    expect(hook.value).toBe(laterMs);
  });

  it('stops ticking again once the app backgrounds after having been active', () => {
    const start = Date.now();
    const hook = renderNowMs(1_000);
    const handler = latestAppStateHandler();
    act(() => {
      handler('background');
    });
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(hook.value).toBe(start);
  });

  it('clears its interval and AppState subscription on unmount', () => {
    const removeSpy = jest.fn();
    (AppState.addEventListener as jest.Mock).mockReturnValueOnce({ remove: removeSpy });
    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');

    let tree: TestRenderer.ReactTestRenderer;
    function Harness() {
      useNowMs(1_000);
      return null;
    }
    act(() => {
      tree = TestRenderer.create(<Harness />);
    });
    act(() => {
      tree.unmount();
    });

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
