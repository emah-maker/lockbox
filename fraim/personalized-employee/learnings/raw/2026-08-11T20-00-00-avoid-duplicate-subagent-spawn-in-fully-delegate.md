---
author: <developer email>
date: 2026-08-11
job: fully-delegate
context: conversational-session
---

# Coaching Moment: avoid-duplicate-subagent-spawn-in-fully-delegate

## What happened

After emitting the `create-delegation-graph` phase's `delegation_ledger` (three parallel
`feature-implementation` tasks: app-ui-rework, website-ui-rework, box-ui-rework), MANdy
also spawned three Agent-tool background agents itself (named app-ui-rework,
website-ui-rework, box-ui-rework), each briefed to run the same `feature-implementation`
job on the same surface. The FRAIM Hub's own orchestration layer independently spawned
its own real child agents (personas `mobile-dev`, `web-dev`, `firmware-dev`) from that
same ledger, per the `execute` phase's own text: "The orchestration layer handles
launching child jobs from the delegation ledger." The result: six agents, not three,
editing the same three sets of files concurrently with no worktree isolation
(conversational mode). Evidence surfaced across all three reviews: the app workstream
explicitly flagged a "sibling workstream... editing the same shared app/ files
concurrently"; the website workstream found an unclaimed, fully-built mobile
hamburger-nav (`website/js/nav.js`) and dashboard crossfade sitting in the tree with no
evidence file or attribution; the box workstream found and had to sequence around a
concurrent "color-transition engine" on `lock_ui.py`/`lock_config.py`. MANdy's own three
Agent-tool spawns were later reported by the harness as "stopped, no completion record"
- consistent with them being the orphaned source of that unclaimed work.

## Why it happened

MANdy read this project's `project_rules.md` bullet ("use Ruflo... spawn the delegation
graph's sub-agents as named agents in one batch, run_in_background: true") as an
instruction that MANdy itself must perform the spawning via the Agent tool. It did not
cross-reference that against the `fully-delegate` job's own `execute` phase text, read
moments later, which states the orchestration layer (not MANdy) launches child jobs from
the ledger MANdy emits. Both instructions were followed literally without noticing they
described two different actors doing the same spawning step, which is a real conflict,
not a complementary pairing.

## What was learned

When a job's own phase instructions say "the orchestration layer handles launching child
jobs," a project rule about "spawning sub-agents as named agents" should be read as
describing what that orchestration layer's spawn looks like (or as scoped to a
non-`fully-delegate` context), not as a second, manual spawn step for MANdy to also
perform after emitting the ledger.

## What will be done to recover

None needed this run beyond what already happened: all three duplicate collisions were
independently verified as non-destructive (attribute-disjoint or file-disjoint from the
real workstream's own edits), and the orphaned website contribution was disclosed to the
human rather than silently absorbed or discarded. No further action required unless the
human decides to remove the unclaimed hamburger-nav/crossfade code.

## Systematic ways to avoid recurrence

- Existing rule, job, skill, or template that should have prevented this: the
  `fully-delegate` job's `execute` phase step 1 ("The orchestration layer handles
  launching child jobs from the delegation ledger... Do not do the research or drafting
  yourself") already says this, but a manager reading `create-delegation-graph`'s own
  step 5 ("Emit the delegation ledger... then stop and wait for child deliverables to
  arrive") right next to project_rules.md's Agent-tool-spawn bullet can still read both
  as required.
- Suggested hardening: `project_rules.md`'s Ruflo bullet for `fully-delegate` should
  state explicitly whether MANdy must ALSO spawn via the Agent tool after emitting the
  ledger, or whether ledger emission alone is sufficient and the Agent-tool spawn
  instructions apply only when no external orchestration layer is present. As written,
  it is genuinely ambiguous between "this is how the Hub's orchestration layer works
  under the hood" and "you must do this yourself."
- Future prevention gate: before spawning any Agent-tool sub-agent inside a
  `fully-delegate` run, check whether a delegation ledger was already emitted via
  `seekMentoring` for the current job; if so, wait one turn for a child-deliverable
  coaching message before spawning anything directly, since a real orchestration layer
  may already be acting on that ledger.

## Ways to detect and recover quickly without manager guidance

- Detection signal: a child deliverable's own report or evidence file names a
  "concurrent editor," "sibling workstream," or unattributed change to files the
  delegation ledger scoped to a task MANdy also spawned directly.
- Recovery path: re-open the `execute` phase instructions, confirm whether the
  orchestration layer is independently active, and if so, stop resuming or relaunching
  any duplicate Agent-tool spawns for the remaining ledger tasks.

## What the agent should have done

After emitting the delegation ledger via `seekMentoring`, wait for the first child
deliverable to arrive before spawning anything via the Agent tool. If a real child
deliverable arrives without MANdy having spawned it, that is direct proof the
orchestration layer is handling spawning already, and MANdy should not also spawn.
