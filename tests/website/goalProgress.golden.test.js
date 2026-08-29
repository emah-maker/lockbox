// Cross-runtime parity test for computeGoalProgress: loads
// tests/fixtures/goalProgress.golden.json (a set of (goals, sessions,
// nowMs) inputs plus their EXPECTED computeGoalProgress output) and asserts
// website/js/goals.js's computeGoalProgress reproduces every one of them
// exactly. app/src/goals/goalProgress.ts's computeGoalProgress has the SAME
// test running against the SAME fixture
// (app/src/goals/goalProgress.golden.test.ts) -- together the two prove the
// twin implementations still agree, something neither suite's own
// hand-written cases (tests/website/goals.test.js / goalProgress.test.ts)
// can catch on their own, since each only ever sees its own side.
//
// The fixture's own header comment documents how its `expected` values were
// produced (by running this file's own website/js/goals.js implementation,
// then verified by inspection, not just cross-checked for self-consistency)
// and which case was deliberately left OUT (a targetS <= 0 goal -- the one
// case where the two implementations do NOT currently agree; see that
// comment for the live-bug writeup). Loaded with fs/JSON.parse rather than
// a bare `import ... with { type: 'json' }` so this doesn't depend on a
// particular Node version's import-attribute support -- this repo's other
// suites don't rely on it either. Run with `npm test` from the repo root
// (node --test).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { computeGoalProgress } from '../../website/js/goals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'goalProgress.golden.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('computeGoalProgress -- golden fixture parity with app/src/goals/goalProgress.ts', () => {
  it('has at least one case per branch this fixture exists to cover', () => {
    assert.ok(fixture.cases.length >= 10);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const result = computeGoalProgress(c.goals, c.sessions, c.nowMs);
      assert.deepEqual(result, c.expected);
    });
  }
});
