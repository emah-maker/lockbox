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
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
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
