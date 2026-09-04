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
// the same (goals, sessions, nowLocal/startedAtLocal triples converted to ms
// via `new Date(...).getTime()` -- see goalProgress.golden.json's header),
// and re-verify each output by hand against the new intended semantics
// before overwriting the fixture -- see goalProgress.golden.json's own
// header for the full recipe. Keep any new or edited boundary-sensitive
// timestamp in *Local parts form, not a raw epoch-ms literal -- that's what
// made monthly_window_year_rollover_december permanently fail outside
// Pacific. Never regenerate by running THIS file's own computeGoalProgress
// -- that would make the fixture agree with whichever side happened to
// change, silently erasing the parity check.
import { computeGoalProgress, GoalProgressResult } from './goalProgress';
import { Goal } from './goals';
import { LoggedSession } from '../stats/sessionHistory';
import { CustomLabel } from '../stats/customLabels';
import fixtureJson from '../../../tests/fixtures/goalProgress.golden.json';

// `now`/`startedAt` in the fixture are LOCAL-TIME-relative (the window math
// anchors to local midnight/week-start/month-start), so the fixture gives
// them as `nowLocal`/`startedAtLocal` [year, monthIndex, day, hour, minute,
// second, ms] tuples instead of raw epoch ms -- see goalProgress.golden.json's
// own header for why. Converting via the local Date constructor here (not
// Date.UTC) means this runs in whatever timezone the test process is in,
// same as goalProgress.ts's own window math, so the two stay in lockstep
// regardless of the machine's timezone. A case may still carry a plain
// numeric `nowMs`/`startedAt` where that's safe (see the fixture header) --
// support both forms.
type LocalParts = [number, number, number, number?, number?, number?, number?];

function localPartsToMs(parts: LocalParts): number {
  const [y, mo, d, h = 0, mi = 0, s = 0, ms = 0] = parts;
  return new Date(y, mo, d, h, mi, s, ms).getTime();
}

interface GoldenSession extends Omit<LoggedSession, 'startedAt'> {
  startedAt?: number;
  startedAtLocal?: LocalParts;
}

interface GoldenCase {
  name: string;
  nowMs?: number;
  nowLocal?: LocalParts;
  goals: Goal[];
  sessions: GoldenSession[];
  labels?: CustomLabel[];
  excludedTopicKeys?: string[];
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
      const nowMs = c.nowLocal ? localPartsToMs(c.nowLocal) : c.nowMs!;
      const sessions: LoggedSession[] = c.sessions.map((s) => ({
        ...s,
        startedAt: s.startedAtLocal ? localPartsToMs(s.startedAtLocal) : s.startedAt!,
      }));
      const result = computeGoalProgress(c.goals, sessions, nowMs, c.labels ?? [], c.excludedTopicKeys ?? []);
      expect(result).toEqual(c.expected);
    });
  }
});
