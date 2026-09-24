# DRAFT - Requires Human Approval

# Fully-Delegate: Dashboard Lock-Duration Picker Default

**Anchor**: conversational mode, no issue tracker configured for this task (`fraim/config.json`
sets `"mode": "conversational"`). No branch, no commit, no PR -- the change sits in the working
tree pending review.
**Date**: 2026-08-25

## Executive Summary

**Goal**: the user reported that the app's lock-duration picker forces the box's clock to an
unexpected/arbitrary time value, and asked for the default to be pushed back to 5 minutes.

**Root cause**: `app/src/screens/DashboardScreen.tsx`'s duration-picker state was initialized to
`{ hours: 0, minutes: 25 }`. Because that picker pushes a live BLE preview to the box as soon as it
mounts, opening the app on a fresh connection moved the box's clock off its own correct 5-minute
boot default (`firmware/lib/lock_config.py`'s `DEFAULT_SECONDS = 5 * 60`) up to 25 minutes -- the
"forces you to a random number" behavior described.

**Outcome**: Delivered and independently re-verified. **Confidence: high** -- single node, passed
on first iteration, no correction needed.

**What was built**: `app/src/screens/DashboardScreen.tsx` line 113, initializer changed from
`{ hours: 0, minutes: 25 }` to `{ hours: 0, minutes: 5 }`. One line changed, nothing else.

## Delegation Ledger

Single-node graph, no dependencies:

| Task ID | Job | Persona | Depends On | Status |
|---|---|---|---|---|
| `fix-duration-picker-default` | `feature-implementation` | `coder` | none | Verified-complete, iteration 1 |

## Sub-Agent Review Surface

### `fix-duration-picker-default` -- iteration 1, PASS

- **Evidence file**: [`docs/evidence/dashboard-duration-default-feature-implementation-evidence.md`](./dashboard-duration-default-feature-implementation-evidence.md)
- **Pull request**: none -- conversational mode on `master`; the working-tree diff is the review
  artifact.
- **Verdict**: accept.

Verified independently (not on the child's self-report alone -- the background-task runner had
flagged this run as possibly interrupted before its completion message arrived, so the repository
state was checked directly rather than trusted):
- `git diff` confirms exactly one line changed in one file: `DashboardScreen.tsx:113`, matching the
  brief precisely.
- The new default (5 minutes / 300s) matches `firmware/lib/lock_config.py`'s `DEFAULT_SECONDS` and
  `app/src/stats/stats.ts`'s `MIN_LOCK_SECONDS`, both already 300s.
- `clampLockSeconds`, the box-sync effect, and the six pre-existing uncommitted `firmware/lib/*.py`
  files (unrelated in-progress hardware work) are all untouched, confirmed via `git status`.
- Checked for duplicate sub-agent pollution (a previously recorded failure mode for this job): no
  duplicate evidence file or diff was produced; the other `lock-duration-picker-*` evidence files
  present in `docs/evidence/` predate this session (2026-08-10) and are unrelated.
- Child reported `tsc --noEmit` clean and the full `jest` suite passing (12 suites / 115 tests, no
  regressions), with no new test added -- reasonable, since no component-render test harness exists
  in this repo for any screen.

## Risk Areas

None. Single-line, non-structural default-value change with no logic path altered.

## Human Approval Checklist

- [ ] Review the one-line diff in `app/src/screens/DashboardScreen.tsx` (line 113).
- [ ] Confirm the 5-minute default is the value you want the app to open on (matches the box's own
      boot default).
- [ ] Since this repo is in conversational mode, no commit/push has been made -- explicitly approve
      committing this change (and to which branch) if you want it persisted.
