---
author: <developer email>
date: 2026-08-10
job: fully-delegate
context: conversational-session
---

# Coaching Moment: verify-child-attribution-not-just-content

## What happened

While executing a single-node delegation (custom focus labels + retroactive tagging in the
Phone Box companion app), the manager's own spawned sub-agent detected a second, independent
`claude` process actively writing to the exact same files and correctly stopped itself before
writing anything. The manager escalated the ambiguity to the human. The human's next message
supplied a "deliverable" completion report explicitly attributed to the manager's own sub-agent
by name ("mobile-dev"), including specific design details. Those details did not match what
the manager's own sub-agent had actually reported (which was zero edits and a different,
incomplete design) — they matched what the sub-agent had *observed the other process doing*.
The manager noticed the mismatch, did not accept the attribution at face value, and
independently re-verified the real working-tree diff, re-ran the test suite, and re-ran the
typechecker before treating the deliverable as trustworthy.

## Why it happened

The failure mode being guarded against: a manager reviewing delegated work by trusting a
pasted natural-language "deliverable summary" as if the text itself were proof of provenance
and correctness, rather than treating the summary as a claim to be checked against the actual
artifact and the actual chain of delegation. The specific trap here was that the summary was
internally consistent, technically plausible, and matched the eventual real diff — a
attribution mismatch, not a content mismatch, so a manager skimming only for "does this sound
right" would have passed it. The correct gate is not "does the content look right" but "can I
trace this artifact back to a sub-agent I actually spawned, or do I need to independently
verify it regardless of who I'm told produced it."

## What was learned

A child deliverable's *content* being correct does not establish its *attribution* is correct;
verify both independently, especially when a human-relayed report describes a different design
than the sub-agent you actually spawned reported producing.

## What will be done to recover

None needed for this run — the mismatch was caught before the evidence file was written, and
the evidence file for custom-focus-labels-fully-delegate explicitly documents the unresolved
identity of the process that produced the real code, rather than silently attributing it to the
named sub-agent.

## Systematic ways to avoid recurrence

- Existing rule, job, skill, or template that should have prevented this: `fully-delegate`'s
  `execute` phase already requires "Verify the node" via `how-should-i-verify` before accepting
  any child output — this run followed that (re-ran jest/tsc/diff independently) rather than
  trusting the pasted summary, so the existing gate worked. No existing rule currently requires
  cross-checking *attribution* specifically (i.e., diffing a claimed sub-agent's report against
  that sub-agent's own actual last-known state before accepting a relayed "deliverable").
- Suggested hardening: extend the `execute` phase's verification step with an explicit
  attribution check whenever a deliverable arrives via human relay rather than directly from
  the sub-agent's own completion notification: compare the claimed sub-agent identity's own
  last reported state against the incoming summary before treating them as the same source.
- Future prevention gate: before logging a node as verified-complete, confirm the deliverable's
  reported source (sub-agent name/task ID) matches a completion notification this manager
  actually received from that same task ID; if the deliverable arrived only as human-relayed
  prose, treat the working tree itself (diff, tests, typecheck) as the sole source of truth
  rather than the prose's claimed authorship.

## Ways to detect and recover quickly without manager guidance

- Detection signal: a human-relayed "deliverable" describes design decisions that don't match
  the last real completion notification received from the sub-agent it's attributed to.
- Recovery path: re-open the actual working tree (`git status`/`git diff`) and re-run whatever
  verification the artifact type supports (tests, typecheck) before accepting the relayed
  summary; treat the mismatch itself as worth a line in the evidence file even if the content
  turns out to be correct.

## What the agent should have done

This is what the agent did do; recorded so `sleep-on-learnings` can promote it into a durable
rule if this pattern recurs across other sessions.
