// useHomeGoalRing.test.tsx -- regression test for the 'sessionCount' Home
// ring source counting an excludeFromTotals-tagged session.
//
// Every other input this hook feeds into computeIdleRingState (rollingAverageS,
// streakCurrent, streakLongest, the goal ratios, baselineFocusS) is run
// through stats/customLabels.ts's exclusion rule (labels/excludedTopicKeys)
// before it reaches idleRingState.ts -- see this hook's own header/inline
// comments. `todaySessionCount` (idleRingSources.ts) was the one exception:
// it takes no labels/excludedTopicKeys of its own, and the hook used to hand
// it the raw, unfiltered `sessions` array, so a session tagged with an
// excludeFromTotals label (e.g. "Sleep") still inflated the 'sessionCount'
// ring source's count even though the exact same session correctly does NOT
// count toward the daily goal's own Goal.targetSessions (goalProgress.ts's
// computeGoalProgress) that count is compared against.
//
// No renderHook helper in this codebase's test setup (grep confirms no other
// test file uses one) -- same react-test-renderer + tiny harness component
// pattern this screen's own FocusHero.test.tsx already uses to pin a bug in
// a sibling Home-ring computation.
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useHomeGoalRing } from './useHomeGoalRing';
import type { Goal } from '../../goals/goals';
import type { LoggedSession } from '../../stats/sessionHistory';
import type { CustomLabel } from '../../stats/customLabels';
import type { IdleRingState } from './idleRingState';

const mounted: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
});

const session = (startedAt: number, topic?: string): LoggedSession => ({
  startedAt,
  plannedS: 600,
  actualS: 600,
  outcome: 'completed',
  topic,
});

const dailyGoal: Goal = {
  id: 'goal:daily',
  topic: null,
  period: 'daily',
  targetS: 3600,
  targetSessions: 5,
  createdAt: 0,
  updatedAt: 0,
  archived: false,
};

function renderRing(sessions: LoggedSession[], customLabels: CustomLabel[], excludedTopicKeys: string[]) {
  let idleRing: IdleRingState | undefined;
  function Harness() {
    const { idleRing: r } = useHomeGoalRing({
      sessions,
      todayFocusS: sessions.reduce((sum, s) => sum + s.actualS, 0),
      goals: [dailyGoal],
      customLabels,
      excludedTopicKeys,
      themeMode: 'dark',
      ringBaselineWindow: 'week',
      ringSourceKind: 'sessionCount',
      ringGoalId: null,
      ringShowTopicMix: false,
    });
    idleRing = r;
    return null;
  }
  act(() => {
    mounted.push(TestRenderer.create(<Harness />));
  });
  return idleRing!;
}

// Module-scope, stable references -- matching the real app, where Zustand
// selectors keep the same array/reference until the underlying data
// actually changes. An inline `[]`/`[goal]` literal below would be a fresh
// reference every render and would mask the very bug this describe block
// exists to catch: if useHomeGoalRing's memos depend on nowMs (via
// useNowMs.ts) rather than one of these references changing, only a stable
// reference proves the clock -- not an unrelated prop -- is what triggered
// the recompute.
const PACE_GOALS: Goal[] = [dailyGoal];
const PACE_SESSIONS: LoggedSession[] = [];
const STABLE_LABELS: CustomLabel[] = [];
const STABLE_EXCLUDED: string[] = [];

describe('useHomeGoalRing pace source clock', () => {
  // Same fake-timer + explicit AppState setup as useNowMs.test.tsx itself --
  // this hook's own regression tests -- since the bug this proves fixed is
  // that nothing without a real ticking clock ever revisited these memos.
  beforeEach(() => {
    jest.useFakeTimers();
    (AppState as unknown as { currentState: string }).currentState = 'active';
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('moves expectedS/progress across a single day without sessions/goals/labels ever changing reference', () => {
    // 9am: matches this task's own worked example -- a 1-hour (3600s) daily
    // goal expects 225s done by 9am (paceFractionOfDay's 08:00-24:00 window).
    const morning = new Date(2026, 0, 15, 9, 0, 0).getTime();
    jest.setSystemTime(morning);

    let idleRing: IdleRingState | undefined;
    function Harness() {
      const { idleRing: r } = useHomeGoalRing({
        sessions: PACE_SESSIONS,
        todayFocusS: 1800,
        goals: PACE_GOALS,
        customLabels: STABLE_LABELS,
        excludedTopicKeys: STABLE_EXCLUDED,
        themeMode: 'dark',
        ringBaselineWindow: 'week',
        ringSourceKind: 'pace',
        ringGoalId: null,
        ringShowTopicMix: false,
      });
      idleRing = r;
      return null;
    }
    act(() => {
      mounted.push(TestRenderer.create(<Harness />));
    });

    expect(idleRing?.pace?.expectedS).toBeCloseTo(225);

    // 8pm the same day -- same worked example's 2700s expected. No prop
    // passed to the hook above changes at all; only wall-clock time (and
    // useNowMs's own 60s interval tick, which actually fires the re-render)
    // moves. Sets the fake clock to one tick-interval before 8pm, then
    // advances exactly that interval, so the tick's own Date.now() lands
    // precisely on `evening` instead of one interval past it.
    const evening = new Date(2026, 0, 15, 20, 0, 0).getTime();
    jest.setSystemTime(evening - 60_000);
    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(idleRing?.pace?.expectedS).toBeCloseTo(2700);
    expect(idleRing?.progress).toBeCloseTo(1800 / 2700);
  });
});

describe('useHomeGoalRing sessionCount source', () => {
  it('does not count a session tagged with an excludeFromTotals label', () => {
    const sleepLabel: CustomLabel = { id: 'custom:sleep', name: 'Sleep', color: '#334155', excludeFromTotals: true };
    const sessions = [
      session(Date.now(), 'custom:sleep'), // excluded -- must not count
      session(Date.now()),
      session(Date.now()),
    ];
    const ring = renderRing(sessions, [sleepLabel], []);
    expect(ring.sessionCount?.count).toBe(2);
  });

  it('does not count a session tagged with an excluded built-in topic', () => {
    const sessions = [
      session(Date.now(), 'reading'), // excluded built-in topic -- must not count
      session(Date.now()),
    ];
    const ring = renderRing(sessions, [], ['reading']);
    expect(ring.sessionCount?.count).toBe(1);
  });

  it('counts every session when nothing is excluded', () => {
    const sessions = [session(Date.now()), session(Date.now())];
    const ring = renderRing(sessions, [], []);
    expect(ring.sessionCount?.count).toBe(2);
  });
});
