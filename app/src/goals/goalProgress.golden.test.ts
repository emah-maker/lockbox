// Cross-runtime parity test for computeGoalProgress: loads
// tests/fixtures/goalProgress.golden.json (a set of (goals, sessions,
// nowMs) inputs plus their EXPECTED computeGoalProgress output) and asserts
// this file's computeGoalProgress reproduces every one of them exactly.
// website/js/goals.js's computeGoalProgress has the SAME test running
// against the SAME fixture (tests/website/goalProgress.golden.test.js) --
// together the two prove the twin implementations still agree, something
// neither suite's own hand-written cases (goalProgress.test.ts /
// tests/website/goals.test.js) can catch on their own, since each only ever
// sees its own side.
//
// The fixture's own header comment documents how its `expected` values were
// produced (by running the real website/js/goals.js implementation, then
// verified by inspection, not just cross-checked for self-consistency) and
// which case was deliberately left OUT (a targetS <= 0 goal -- the one case
// where the two implementations do NOT currently agree; see that comment
// and this task's report for the live-bug writeup).
//
// Regenerating after a deliberate math change: write a throwaway script
// that imports computeGoalProgress from website/js/goals.js, runs it over
// the same (goals, sessions, nowMs) triples, and re-verify each output by
// hand against the new intended semantics before overwriting the fixture --
// see goalProgress.golden.json's own header for the full recipe. Never
// regenerate by running THIS file's own computeGoalProgress -- that would
// make the fixture agree with whichever side happened to change, silently
// erasing the parity check.
import { computeGoalProgress, GoalProgressResult } from './goalProgress';
import { Goal } from './goals';
import { LoggedSession } from '../stats/sessionHistory';
import fixtureJson from '../../../tests/fixtures/goalProgress.golden.json';

interface GoldenCase {
  name: string;
  nowMs: number;
  goals: Goal[];
  sessions: LoggedSession[];
  expected: GoalProgressResult[];
}

const fixture = fixtureJson as unknown as { cases: GoldenCase[] };

describe('computeGoalProgress -- golden fixture parity with website/js/goals.js', () => {
  it('has at least one case per branch this fixture exists to cover', () => {
    // A sanity floor, not a precise count -- guards against the fixture
    // file silently losing cases (e.g. a bad merge) without pinning its
    // exact length here too.
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of fixture.cases) {
    it(`${c.name}`, () => {
      const result = computeGoalProgress(c.goals, c.sessions, c.nowMs);
      expect(result).toEqual(c.expected);
    });
  }
});
