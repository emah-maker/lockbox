---
author: emah@kitchenlab.org
date: 2026-08-11
job: fully-delegate
synthesized:
---

# Postmortem: Fold UI Claude Skills into FRAIM, Add Mobile Dev Skills

**Date**: 2026-08-11
**Duration**: single session, three parallel sub-agent runs plus one correction round
**Objective**: Port installed Claude Code UI-design and animation skills into
this project's FRAIM personalized layer, merging with existing FRAIM ux-design
skills where they overlap, and add FRAIM skills for Expo/React Native mobile
development to close the gap versus the existing ios/android/mobile skills.
**Outcome**: Success, with one correction round and one manager judgment call
overridden by the human afterward.

## Executive Summary

Delegated three independent `evolve-employee` runs (UI design skill, animation
skill, mobile dev skill), all editing disjoint files under
`fraim/personalized-employee/skills/`, in one fully parallel layer. Two passed
manager review on the first iteration. The third needed one correction:
manager review (not the sub-agent's own report) found a dangling cross
reference to a skill file that was never created, and an unrequested edit to
the shared `project_rules.md` adding a `graphify` usage policy. The correction
fixed the dangling reference and reverted the `graphify` addition. The human
then overrode that second judgment call and asked for the `graphify` bullet to
be kept, so it was restored verbatim.

## Quick RCA Card

**What failed**: The manager removed a `graphify` usage-policy bullet from
`project_rules.md` as out-of-scope scope creep during sub-agent review.
**Impact**: The human had to spend a coaching turn reversing a manager
decision that turned out to be wrong for what they actually wanted.
**What should have happened**: The manager should have flagged the unrequested
edit as a question for the human rather than unilaterally removing it, since
it was a defensible but non-obvious call (a real repo-wide rule change,
introduced by a sub-agent, but not necessarily unwanted).
**What changes next time**: When a sub-agent adds content that is technically
outside the literal brief but plausibly useful and already scoped to the
correct file, surface it as a flagged decision point in the same message
rather than resolving it unilaterally and only mentioning it after the fact.
**Example**: The `port-ui-design-skill` sub-agent's edit to
`fraim/personalized-employee/rules/project_rules.md` adding the `graphify`
query/path/explain/refresh policy.

## Architectural Impact

**Has Architectural Impact**: No

## Timeline of Events

### Phase 1: Listen and scope
- [done] Read `fraim/ai-employee/skills/` structure and confirmed it is
  sync-managed (overwritten by `fraim sync`), so the actual target had to be
  `fraim/personalized-employee/skills/`.
- [done] Found the existing precedent (`skills/cad/3d-modelling-consultant.md`)
  to use as the format template.
- [done] Surfaced scope questions to the human before graphing; manager
  coaching ("port ui and animations skills to fraim and merge with existing
  skills when possible") resolved scope toward breadth and merge.

### Phase 2: Delegation graph
- [done] Selected `evolve-employee` as the only catalog job whose intent
  matches authoring new skill artifacts.
- [done] Decomposed into three disjoint-file tasks so they could run in one
  parallel layer, per the fully-delegate parallelize-by-default principle.
- [done] Resolved the work anchor: `fraim/config.json` mode is
  `conversational`, so no branch, no worktree, no PR for any task.

### Phase 3: Execute
- [done] Spawned three background sub-agents, each running its own
  `fraim_connect` + `evolve-employee` job in full.
- [done] Independently verified each artifact by reading the full file rather
  than trusting the sub-agent's own report.
- [missed] First read of `port-ui-design-skill`'s output caught a dangling
  reference to a nonexistent sibling skill and an unrequested `project_rules.md`
  edit; both should have been questions to the human rather than a unilateral
  fix in one case.
- [done] Sent a targeted correction naming both defects precisely to the same
  sub-agent (resumed via SendMessage) rather than spawning a fresh run.
- [done] Independently re-verified the fix with `grep`, not by trusting the
  sub-agent's report a second time.

### Phase 4: Human review and reversal
- [done] Documented the removed `graphify` bullet as an open checklist item in
  the evidence file rather than silently deciding it.
- [missed] The human still had to explicitly say "keep it" after the fact,
  because the bullet had already been removed by the time they saw the
  evidence file.
- [done] Restored the bullet verbatim on coaching, updated both evidence files
  to record the reversal transparently, and re-verified with `grep`.

## Root Cause Analysis

### 1. Primary Cause
**Problem**: The manager unilaterally removed a sub-agent's unrequested
`project_rules.md` edit instead of flagging it as an open question.
**What drove it**: The `fully-delegate` guardrail "Human approval gates shared
state" was read as license to act (remove the out-of-scope change) rather
than as a reason to escalate the specific judgment call before acting. The
manager's own scope reasoning (this delegation's brief was three skill files,
not a graphify policy) was correct as far as it went, but it did not account
for the possibility that the human independently wanted that policy for
unrelated reasons.
**Corpus conflict**: None; no existing learning file entry endorsed removing
sub-agent additions unilaterally. This is a gap, not a conflict.
**Impact**: One extra coaching round; the fix itself was cheap (a paste-back),
but it consumed a full round-trip that a flagged question would have avoided.

### 2. Contributing Factors
**Problem**: The sub-agent that added the `graphify` bullet did so without
being asked, inside a task briefed narrowly as "port three skills."
**What drove it**: The sub-agent's own retrospective/evidence-writing step
likely generalized from noticing `graphify-out/graph.json` already existed in
the repo to deciding a policy bullet was implicitly in scope.
**Impact**: Introduced a second, larger review question (repo-wide policy
change) inside what was meant to be a narrow content-porting task.

## What Went Wrong

1. **Manager decided instead of asking**: removed the `graphify` bullet
   unilaterally rather than presenting it as a decision point before the
   human saw it, even though the evidence file's checklist did flag it.
2. **Sub-agent scope drift**: one of three sub-agents made a repo-wide rules
   change beyond its literal brief without flagging it as a separate
   proposal.

## What Went Right

1. **Parallel decomposition held**: three sub-agents editing disjoint files
   ran fully in parallel with no index/commit collision, confirming the
   dependency-graph read from `understand-delegation-path` was correct.
2. **Independent verification caught a real defect**: reading the full
   `ui-design-consultant.md` file (not trusting the sub-agent's summary)
   caught the dangling `expo-native-ui-patterns` reference before it reached
   the human.
3. **Targeted correction over fresh re-run**: resuming the same sub-agent via
   `SendMessage` with a precise two-item correction was cheaper and preserved
   context better than spawning a new agent for iteration 2.
4. **conversational-mode resolution was correct on the first try**: reading
   `fraim/config.json` before assuming a PR-based workflow avoided building
   an unnecessary branch/worktree/PR path for what turned out to be
   direct-in-place work.

## What I Almost Did Wrong But Caught

1. **Near-miss on trusting sub-agent self-reports**: both sub-agent completion
   reports read as fully confident and complete; reading the actual files
   instead of accepting the reports at face value is what caught the dangling
   reference and the scope-creep edit. If I had marked those nodes
   verified-complete from the reports alone, both defects would have reached
   the human's review undetected.

## Where Past Learnings Actually Fired

`fraim learning-usage offers --job fully-delegate --json` is not an available
command in this environment (`error: unknown command 'learning-usage'`), so
the offered-learnings list could not be retrieved and no firing can be
attested against it.

- None. No offered-learnings list was available to attest against in this
  environment; this is a tooling gap, not a claim that no learning fired.

## Lessons Learned

1. **Flag, don't just fix, unrequested-but-plausible sub-agent additions**:
   when a sub-agent adds something outside its literal brief that is not
   obviously wrong, present it to the human as a decision point in the same
   message rather than resolving it unilaterally, even when the manager's own
   read is "this is out of scope."
2. **Independent artifact verification is non-negotiable for delegated
   authoring work**: both real defects in this run were caught only by
   reading full files, not by trusting sub-agent completion reports.
3. **`fraim/config.json`'s `mode` field is the fast, authoritative way to
   resolve branch-vs-conversational work anchor questions**; check it before
   assuming a PR-based review surface.

## Agent Rule Updates Made to avoid recurrence

1. **None made directly**: per `fully-delegate`'s own instruction not to
   recommend capability hardening directly from a single run, this signal is
   left for `sleep-on-learnings` to evaluate in aggregate rather than acted on
   here.

## Enforcement Updates Made to avoid recurrence

1. **None made directly**: same reason as above.
