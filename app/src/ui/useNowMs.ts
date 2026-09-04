// useNowMs.ts -- the one clock this app has. Nothing in src/ ever ticks:
// there is no setInterval and no AppState listener anywhere else in the
// codebase (grep confirms both), so a `useMemo` that reads `Date.now()`
// (directly, or through a helper's `nowMs = Date.now()` default parameter)
// only recomputes when one of its OTHER dependencies happens to change
// reference -- sessions/goals/customLabels/excludedTopicKeys. A "current
// day" or "current window" value computed that way freezes at whatever
// instant it last ran and silently goes stale: a daily goal met by a 23:50
// session still reads "met" at 10am the next day, because nothing ever told
// React to re-render just because time passed. This hook is that missing
// tick, meant to be read into a memo's own dependency array (see
// screens/stats/GoalsProgressView.tsx and screens/StatsScreen.tsx) so those
// memos recompute on a schedule instead of only on unrelated state changes.
//
// Interval default is 60s. Every current consumer (goal day/window
// boundaries, streak-vs-today comparisons, the 7-day trend/heatmap) only
// cares about which calendar day or which goal window `now` falls in, never
// about sub-minute precision -- a screen that's been open for 40 seconds
// showing a value that's 40 seconds stale is invisible to a user; showing
// yesterday's goal state 40 seconds into the new day is the actual bug this
// hook exists to close. A minute is frequent enough to close that window
// promptly and coarse enough not to re-render an open Stats/Goals screen on
// every single frame for no visible benefit.
//
// The interval alone isn't enough on a phone, though: a device that's been
// asleep (or the app backgrounded) for 8 hours wakes up with `nowMs` still
// holding whatever it was 8 hours ago, and would keep showing that for up to
// one whole `intervalMs` after the user unlocks the screen. So this also
// listens for RN's `AppState` `change` event and refreshes immediately the
// moment the app becomes 'active' again, rather than waiting out the rest of
// the interval. Symmetrically, the interval is torn down (not just left
// running) whenever the app isn't 'active' -- there is no screen visible to
// benefit from a re-render while backgrounded, so ticking then would only
// burn battery.
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export const DEFAULT_NOW_MS_INTERVAL = 60_000;

export function useNowMs(intervalMs: number = DEFAULT_NOW_MS_INTERVAL): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Mirrors AppState.currentState in a ref (not state) purely so the
  // 'change' handler below can tell whether it's transitioning INTO active
  // (start ticking) versus already active (nothing to do) without adding a
  // second effect dependency -- it's read, never rendered from.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const start = () => {
      if (intervalId != null) return;
      intervalId = setInterval(() => setNowMs(Date.now()), intervalMs);
    };

    if (appStateRef.current === 'active') start();

    const subscription = AppState.addEventListener('change', (nextState) => {
      const enteringForeground = nextState === 'active' && appStateRef.current !== 'active';
      appStateRef.current = nextState;
      if (nextState === 'active') {
        if (enteringForeground) {
          // Don't wait out the rest of the interval to correct a value that
          // may now be hours stale.
          setNowMs(Date.now());
        }
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      subscription.remove();
    };
  }, [intervalMs]);

  return nowMs;
}
