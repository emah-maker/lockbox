---
author: emah@kitchenlab.org
date: 2026-08-10
job: fully-delegate
synthesized:
---

# Postmortem: Set Lock Duration From the Phone App

**Date**: 2026-08-10
**Duration**: single session
**Objective**: Let the user set how long the box locks for from the companion phone app, not just the on-device touchscreen swipe timer.
**Outcome**: Success

## Executive Summary

The requested feature was small and well-scoped: the BLE/firmware plumbing to lock the box for a
set duration already existed end-to-end (`startLock(seconds)` -> `start:<seconds>` opcode), it was
just never called from the app UI. A duration picker was added to `DashboardScreen.tsx` and wired
to that existing action, with a small unit-tested clamp helper in `stats.ts`. The code itself
required no correction cycles. What made this run notable was environment instability: this shared,
OneDrive-synced project folder had multiple other Claude Code / FRAIM sessions independently
implementing this exact same feature concurrently, causing the delegated sub-agent's work to be
silently wiped twice before the manager applied and verified a final version directly. The human
confirmed after the fact that this concurrency is intentional, not accidental.

## Quick RCA Card

**What failed**: A delegated sub-agent's file edits were silently reverted to baseline twice during
execution, and the sub-agent's own completion report claimed the feature was on disk when it was not.
**Impact**: Could have resulted in the manager reporting "done" to the human on the strength of a
sub-agent's self-report alone, when the artifact did not actually exist at that moment.
**What should have happened**: The manager independently re-verifies artifact presence on disk
immediately before recording any verdict, treating self-reports as unverified until checked.
**What changes next time**: Do exactly that check the moment a completion report arrives, before
drafting any response, and expect it to sometimes fail in this project specifically, since
concurrent sessions in this folder are a known, intentional condition, not an anomaly.
**Example**: `git status --porcelain` + `grep startLock DashboardScreen.tsx` returned no matches for
a change the sub-agent had just reported as complete and verified.

## Architectural Impact

**Has Architectural Impact**: No

## Timeline of Events

### Phase 1: Listen / scope
- [done] **Action**: Read the BLE protocol contract, firmware opcode handler, store, and existing
  screens directly rather than asking the user for design details -- confirmed the feature was
  UI-only and fully unambiguous from code alone.

### Phase 2: Delegate
- [done] **Action**: Spawned one `developer` sub-agent with a brief containing exact file paths,
  line-level context, and the constraint to run in conversational mode (no branch/commit/PR).

### Phase 3: Execute / verify
- [missed then done] **Action**: First accepted a completion report from the sub-agent, then
  independently checked the working tree and found the artifact absent -- caught before reporting
  anything to the human as complete.
- [done] **Action**: Coached the sub-agent to stop writing into a moving target and hand over exact
  captured content instead of guessing.
- [done] **Action**: Applied only the lock-duration-relevant hunks directly, deliberately excluding
  an unrelated "focus goal" feature bundled into the same captured snapshot by yet another concurrent
  process, which would have referenced a non-existent module and broken the build.
- [done] **Action**: Independently re-ran `npx tsc --noEmit` and the full `npx jest` suite before
  recording the verdict.

### Phase 4: Document / submit / feedback
- [done] **Action**: Wrote the fully-delegate evidence file naming the concurrency incident as the
  primary risk, with an explicit human-approval item asking whether the concurrency was intentional.
- [done] **Action**: Presented the deliverable in-thread (artifact set, no PR -- conversational mode)
  rather than fabricating a PR that doesn't exist for this delegation.
- [done] **Action**: On approval, re-verified the three files were still modified on disk immediately
  before staging and committing (commit `51cff79`), then re-verified `git status` was clean
  afterward.
- [done] **Action**: Human confirmed the concurrency is expected/intentional; updated the evidence
  file's approval checklist to record that resolution rather than leaving it open.

## Root Cause Analysis

### 1. **Primary Cause**
**Problem**: A sub-agent (and, by extension, the manager if it had trusted the report) nearly treated
"I verified this and it's correct" as equivalent to "this exists on disk right now," in a folder
where a second read of the same file minutes later showed materially different content.
**What drove it**: The `set-up-workspace` skill's conversational-mode branch ("work directly in the
current folder... no branch, no worktree") is written assuming single-writer access to that folder.
Nothing in the phase instructions up to that point required a fresh, timestamped existence check
immediately before recording a verdict -- "verify before advancing" was being read as verifying
design/content correctness, not physical presence at the moment of judgment.
**Corpus conflict**: None found -- this is a gap in existing guidance (conversational mode has no
clause for concurrent-session or sync-managed-folder collision), not a case where an existing rule
endorsed the wrong behavior.
**Impact**: Nearly cost a full iteration cycle and could have resulted in a false "complete" report
to the human if the manager had not independently checked.

### 2. **Contributing Factors**
**Problem**: The project folder lives under active OneDrive sync, which is a plausible additional
mechanism (beyond concurrent agent sessions) for files to be rewritten outside of any single
process's control.
**What drove it**: Conversational mode was selected for this project without an explicit accounting
for sync-managed-folder or multi-session risk in the mode's own documentation.
**Impact**: Makes the failure mode harder to fully diagnose (agent-vs-agent collision vs. sync
overwrite are difficult to distinguish from inside a single session), though the mitigation
(independent re-verification before every verdict) is the same regardless of exact cause.

## What Went Wrong

1. **Sub-agent self-report trusted at first pass**: the initial phase-execute completion report was
   nearly accepted before an independent check revealed the artifact was missing.
2. **A bundled, unrelated feature arrived attached to the requested one**: the concurrent process's
   captured diff included an unrelated "focus goal" integration that would have silently broken the
   build if applied wholesale instead of hunk-by-hunk.

## What Went Right

1. **Independent verification caught the gap before it reached the human**: `git status` + `grep`
   immediately falsified the sub-agent's "complete" report, and this was caught inside the manager's
   own review step rather than downstream.
2. **The sub-agent itself behaved well under the same conditions**: when it discovered its edit
   target had changed underneath it, it stopped, verified rather than blindly rewrote, and handed
   over verbatim captured tool output instead of a memory-reconstructed guess when asked.
3. **Triangulation across three independent implementations** (mine, and two other unidentified
   concurrent processes' pre-existing evidence files) converged on the same design and passed the
   same tests, which materially increased confidence in the final result despite the chaos.
4. **No commit was made until explicit human approval**, even though the instability created real
   pressure to "just lock it in" proactively -- held the line on the project's commit policy.

## What I Almost Did Wrong But Caught

1. **Near-miss**: Nearly applied the sub-agent's full captured `git diff` for `DashboardScreen.tsx`
   verbatim, which included an unrelated "focus goal" feature block (new imports from a
   `../stats/focusGoal` module that does not exist in this delegation's scope). Caught by re-reading
   the diff against the actual current baseline file and against the original brief before applying
   anything, at which point the scope mismatch was obvious. Applied only the lock-duration-relevant
   hunks instead.

## Where Past Learnings Actually Fired

No offer record was available for this job: the installed `fraim` CLI in this environment does not
expose a `learning-usage` subcommand (`fraim learning-usage offers --job fully-delegate --json`
returned `unknown command 'learning-usage'`). Per the attestation skill's guardrail, no firing is
invented in the absence of a real offered-list record.

- None. No offered-entry record was available to attest against for this job.

## Lessons Learned

1. **Learning 1**: In a conversational-mode delegation, a sub-agent's (or peer agent's) completion
   report is a claim, not a fact, until the manager independently checks the actual working tree at
   that moment -- especially in a project where concurrent sessions in the same folder are an
   accepted, ongoing condition rather than an edge case.
2. **Learning 2**: When applying content captured/described by another agent (a diff, a "here's what
   I found" report), verify it against the *current* state of the target file and the *actual* scope
   of the brief before applying it wholesale -- a captured snapshot from a shared, concurrently-edited
   folder may already contain scope creep from an unrelated process.

## Agent Rule Updates Made to avoid recurrence

1. **Rule 1**: None written as a durable rule in this session -- captured as a coaching moment
   (`fraim/personalized-employee/learnings/raw/emah@kitchenlab.org-2026-08-10T05-00-00-verify-conversational-mode-artifact-survival.md`)
   for `sleep-on-learnings`/`organizational-learning-synthesis` to evaluate and promote if the pattern
   recurs again.

## Enforcement Updates Made to avoid recurrence

1. **Improvement 1**: None applied directly to `set-up-workspace.md` or the `fully-delegate` job
   definition in this session -- the coaching moment above proposes extending conversational-mode
   guidance with an explicit "re-verify before recording a verdict" gate, but per this project's own
   learning-hygiene rule, a single incident is a signal for aggregate synthesis, not a unilateral rule
   change by the run that observed it.
