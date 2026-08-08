---
author: emah@kitchenlab.org
date: 2026-08-07
job: mobile-app-development
context: conversational-session
---

# Coaching Moment: jest-mock-file-needs-registration

## What happened

A delegated sub-agent (and, on the same node's next attempt, another pass) tried to fix a
failing `trend.test.ts` (`[@RNC/AsyncStorage]: NativeModule: AsyncStorage is null`) by adding
`"@react-native-async-storage/async-storage/jest/async-storage-mock"` directly to the `jest`
block's `setupFiles` array in `app/package.json`. The test still failed identically afterward.
MANdy, taking the node over directly after two stalls, found the real fix: that mock file is a
plain `module.exports = asMock` object, not a self-installing mock, so simply listing it as a
`setupFiles` entry just executes it as an inert script — nothing calls `jest.mock()`, so the
real native module is still what gets imported. The fix was to create `app/jest.setup.js`
containing an explicit `jest.mock('@react-native-async-storage/async-storage', () =>
require('@react-native-async-storage/async-storage/jest/async-storage-mock'))`, and point
`setupFiles` at that instead.

## Why it happened

The failed fix pattern-matched on "the docs mention this file for Jest integration" and
"listing files in setupFiles is how you wire up test environment setup" without checking what
the file actually exports or how Jest's mock registry actually intercepts a module import.
`setupFiles` entries are just scripts that run before the test framework loads -- they only
affect global state if the script itself does something (like call `jest.mock`), and this
particular file does not. The gap was never verified with an actual test run after the change
was made in the delegated attempt that introduced it; the "fix" was asserted, not re-tested,
so the same failure persisted across two separate passes before being caught.

## What was learned

A file recommended for Jest setup is not automatically a self-installing mock -- check whether
it calls `jest.mock()`/`jest.setMock()` itself, or whether it merely exports a mock object that
something else has to register; when in doubt, actually re-run the failing test after the fix
rather than trusting that "the setupFiles entry is now present" is equivalent to "the mock is
now active."

## What will be done to recover

Already recovered in this session: `app/jest.setup.js` now does the explicit `jest.mock(...)`
call, `app/package.json`'s `setupFiles` points at it, and `npx jest` was re-run to confirm
`trend.test.ts` and the full suite (5/5 suites, 28/28 tests) actually pass, not just that the
config looks plausible.

## Systematic ways to avoid recurrence

- Existing rule, job, skill, or template that should have prevented this: none found --
  `how-should-i-verify`/`delegated-job-review-mapping` both call for build/test evidence, but
  neither explicitly warns against accepting "I added the setupFiles entry" as equivalent to
  "I confirmed the test now passes."
- Suggested hardening: the `feature-implementation`/`mobile-app-development` review dimensions
  in `delegated-job-review-mapping` could add an explicit line under evidence requirements:
  "a claimed test/config fix must be evidenced by a fresh, full re-run of the previously failing
  command, not just a diff of the config."
- Future prevention gate: before marking any "fixed a failing test" work item done, re-run the
  specific failing test command and paste its fresh output (not the pre-fix output, not an
  assumption) into the evidence.

## Ways to detect and recover quickly without manager guidance

- Detection signal: the exact same error message/stack trace appears after a "fix" was applied
  -- that is a strong signal the fix never actually took effect, not that the underlying issue
  is merely stubborn.
- Recovery path: re-read the file that was supposedly wired up (does it call `jest.mock`/
  `jest.setMock`, or export a plain object?), then check `npx jest --showConfig` to confirm the
  setup file is even in the resolved config, before assuming the mock content itself is wrong.

## What the agent should have done

Re-run `npx jest src/stats/trend.test.ts` immediately after editing `app/package.json`'s
`setupFiles`, seen the identical failure, and used that as the signal to inspect what the mock
file actually does (a plain export, not a `jest.mock()` call) instead of reporting the fix as
done based on the config change alone.
