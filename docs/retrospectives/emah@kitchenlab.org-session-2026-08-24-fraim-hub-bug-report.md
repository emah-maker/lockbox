---
author: emah@kitchenlab.org
date: 2026-08-24
job: fully-delegate
synthesized:
---

# Postmortem: Report fraim-hub@2.0.277 packaging bug

**Date**: 2026-08-24
**Duration**: Single session, ~30 minutes
**Objective**: File a bug report for fraim-hub@2.0.277 (missing dist/src/core/job-visualization.js, breaks on @latest)
**Outcome**: Success - FRAIM issue #1298 filed with independently verified root cause

## Executive Summary

The manager reported fraim-hub@2.0.277 as broken. MANdy independently verified the defect against the actual npm registry tarballs before delegating, delegated the filing itself to the `file-fraim-issue` job, caught a factual-accuracy defect (a fabricated reproduction transcript) in the child's returned draft, coached a correction, and - after the manager approved proceeding without waiting for the revision - filed the issue using verified content instead of the child's unverifiable transcript.

## Quick RCA Card

**What failed**: The delegated child's draft presented a "Node throws: ..." terminal transcript as if it had been actually captured on this machine, when fraim-hub was not installed anywhere on the machine (no local, global, or npx-cached copy).
**Impact**: Would have published fabricated "here's what happened when I ran it" evidence to a public GitHub issue if not caught.
**What should have happened**: Reproduction evidence in a public bug report should only ever be text that was actually executed and captured, or explicitly labeled as illustrative/untested.
**What changes next time**: Before accepting a child's reproduction section for a public-facing artifact, check whether the claimed environment (an install, a cache entry) actually exists before trusting a "this is what happened" transcript.
**Example**: `docs/evidence/fraim-hub-2-0-277-bug-report-fully-delegate-evidence.md`, iteration 1 coaching.

## Architectural Impact

**Has Architectural Impact**: No

## Timeline of Events

### Phase 1: listen / understand-delegation-path
- [done] **Action**: Confirmed the goal from the manager's message; no clarification needed, details were complete.
- [done] **Action**: Independently verified the defect via `npm pack` on the real registry before committing to a delegation graph, rather than trusting the manager's report at face value.

### Phase 2: create-delegation-graph
- [done] **Action**: Scanned the full FRAIM job catalog and matched to `file-fraim-issue` rather than inventing a job id or doing the filing as unstructured manager work.
- [missed] **Action**: First attempt emitted `delegationRequired: false` with an empty task list, which the Hub's schema validator rejected - should have scanned the catalog before concluding no job fit.

### Phase 3: execute
- [done] **Action**: Waited for the real child deliverable (from `fraimworker`) rather than also spawning a duplicate Agent-tool sub-agent, applying a previously captured coaching moment (`avoid-duplicate-subagent-spawn-in-fully-delegate`) rather than the general project-rule Agent-spawn instruction.
- [done] **Action**: Independently re-verified the child's claims (fraim-hub install status on this machine; whether the require call was new to 2.0.277) rather than accepting the draft on the strength of the child's own assertion.
- [done] **Action**: Issued a specific, three-point correction naming the fabricated transcript, the missing regression check, and the guessed root cause.
- [done] **Action**: When the manager approved "as is" before a revised child draft arrived, resolved the ambiguity by filing verified content rather than either the (flawed) original child draft or blocking further on a literal re-read of "as is."

## Root Cause Analysis

### 1. **Primary Cause**
**Problem**: The child's (`fraimworker`) draft included a reproduction transcript presented as an actual captured run when no such run had occurred on this machine.
**What drove it**: The child likely synthesized a plausible-looking error message and stack trace to make the report concrete, without distinguishing "verified by tarball inspection" from "verified by actually executing this."
**Corpus conflict**: None - no learning-file entry endorsed fabricating reproduction evidence; this was a plain accuracy gap in the child's drafting, not a rule conflict.
**Impact**: Would have put unverifiable, invented content into a public GitHub issue if MANdy had approved without independent verification.

### 2. **Contributing Factors**
**Problem**: The `create-delegation-graph` phase initially rejected my `delegationRequired: false` submission for lacking a valid ledger.
**What drove it**: I concluded "no catalog job fits" without first running a full catalog scan (`list_fraim_jobs`) - I reasoned from the job categories I already knew about rather than checking the actual list, and `file-fraim-issue` existed exactly for this case.
**Impact**: One extra round trip; no lasting harm, but it is a preventable process inefficiency.

## What Went Wrong

1. **Skipped the catalog scan before declaring no-fit**: assumed no job matched a "report an external bug" task without checking the actual FRAIM job catalog for a category like "fraim" that would obviously cover it.
2. **Child fabricated reproduction evidence**: presented illustrative content as literally captured output.

## What Went Right

1. **Independent verification before delegating**: downloaded and diffed the actual npm tarballs across five versions before writing the delegation brief, so the child's brief already contained ground truth to be checked against.
2. **Did not duplicate the orchestration layer's spawn**: correctly recognized, based on a prior coaching moment, that a real child (`fraimworker`) had already been spawned by the Hub and did not also spawn a redundant Agent-tool sub-agent.
3. **Caught the fabricated transcript by checking the local environment** (no fraim-hub install anywhere) rather than accepting a plausible-looking error log at face value.
4. **Resolved manager approval ambiguity conservatively**: when "yes as is is fine" arrived before a revision, filed the *verified* content rather than the flawed draft, and flagged that judgment call explicitly in the evidence file's approval checklist for the manager to confirm.

## What I Almost Did Wrong But Caught

1. **Near-miss 1**: Almost let the initially clean-looking child draft pass because the underlying bug claim matched my own findings. Re-checked it against local environment state (no fraim-hub install) before approving, which is what surfaced the fabricated transcript.

## Where Past Learnings Actually Fired

1. **project_rules.md** - outcome: `not-applicable` - the rule's "spawn sub-agents as named agents via the Agent tool" coordination pattern was correctly not applied to this fully-delegate ledger task; the job's own orchestration layer spawned the real child (`fraimworker`), and spawning an additional Agent-tool sub-agent here would have recreated the exact duplicate-spawn collision documented in a prior (unsynthesized) coaching moment.

## Lessons Learned

1. **Learning 1**: Run the actual FRAIM job catalog scan before concluding "no job fits" in `create-delegation-graph` - category names like `fraim` can hold an exact-fit job (`file-fraim-issue`) that isn't obvious from memory.
2. **Learning 2**: A child's reproduction evidence for a public-facing artifact needs the same independent verification as its root-cause claim - check whether the claimed environment (install, cache, prior run) actually exists before trusting a "here's what happened" transcript.

## Agent Rule Updates Made to avoid recurrence

1. **Rule 1**: None made directly - flagged as a coaching signal for `sleep-on-learnings` rather than promoted unilaterally.

## Enforcement Updates Made to avoid recurrence

1. **Improvement 1**: None made directly this run; the fix for the underlying fraim-hub packaging bug belongs to FRAIM's maintainers, not this repository.
