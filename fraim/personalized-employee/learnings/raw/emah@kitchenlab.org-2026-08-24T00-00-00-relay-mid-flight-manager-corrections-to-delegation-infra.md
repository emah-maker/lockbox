---
author: emah@kitchenlab.org
date: 2026-08-24
job: fully-delegate
context: conversational-session
---

# Coaching Moment: relay-mid-flight-manager-corrections-to-delegation-infra

## What happened

During the `execute` phase of a `fully-delegate` run, MANdy received manager coaching from the
human that changed the design of one item (the tag-picker's cancel-gesture animation) already
delegated to a running child task (`box-tag-picker-and-angle-setting`, persona firmware-dev).
MANdy recorded the corrected design via `seekMentoring` findings (a "correction" field describing
the new red-fill-bar design in detail) and told the human it would "apply this when I review the
box deliverable, or route it as a correction if that work already started against the old flash
design." When the child's deliverable arrived, it implemented the *original* pre-correction
design in full. MANdy sent a targeted correction back via `seekMentoring`. When the human later
asked for status twice ("how is the cancel bar doing" / "it is not going"), `ListAgents` showed
no running or reachable child agent at all, and the working tree still contained the
pre-correction code. MANdy then implemented the fully-specified correction directly rather than
continue waiting.

## Why it happened

MANdy's mid-flight correction was recorded only as manager-side `seekMentoring` findings text,
with no mechanism to confirm it actually reached the child task before that task's own execution
window closed, and no mechanism to detect afterward whether it had been relayed. The `execute`
phase's own instructions describe an "orchestration layer" that "handles launching child jobs
from the delegation ledger," implying corrections flow through the same layer, but nothing in the
phase instructions describes how a *correction to an already-delegated, in-flight* task is
supposed to reach that child, as distinct from the initial ledger dispatch. MANdy treated
"I recorded the correction in findings" as equivalent to "the child will see this," which turned
out false, and had no check in between (e.g. re-confirming the child's brief, or polling agent
state) before the child's deliverable arrived already built against the stale brief.

## What was learned

A correction to a task that has already been dispatched to a child needs either (a) a confirmed
relay to that specific running child before assuming it will be incorporated, or (b) the manager
should expect iteration 1 to still reflect the pre-correction brief and treat that as the normal,
first correction cycle rather than a surprise -- but either way, "recorded in my own findings" is
not sufficient evidence the correction reached the child, especially in a conversational-mode run
with no visible child-agent registry to confirm against.

## What will be done to recover

Already done this run: independently verified (via `ListAgents`, which showed zero reachable
agents) that no child was actually working the iteration-2 correction, then implemented the
fully-specified fix directly rather than continue issuing corrections into what was effectively a
void. Documented the direct authorship accurately in the evidence file
(`docs/evidence/tag-picker-gestures-and-servo-angle-settings-fully-delegate-evidence.md`) rather
than attributing it to the firmware-dev persona, and flagged that the child's own evidence file
is now stale relative to the shipped code.

## Systematic ways to avoid recurrence

- Existing rule, job, skill, or template that should have prevented this: none found -- the
  `execute` phase covers receiving a child's first deliverable and coaching a *failed* iteration,
  but has no explicit step for a correction issued to a task that is still in flight (not yet
  returned), nor a way to verify that correction was actually relayed before the child's
  deliverable arrives.
- Suggested hardening: the `execute` phase should add an explicit sub-step for "mid-flight
  correction to an in-progress child": confirm relay (e.g. `ListAgents`/an equivalent liveness
  check) before assuming the update was received, and if no live child is confirmed, treat the
  next deliverable's iteration count as still 1 against the *original* brief rather than being
  surprised when it doesn't reflect the correction.
- Future prevention gate: before reporting a manager coaching update as "will apply this to the
  in-flight task," check for a live, addressable agent for that task (`ListAgents`) at the time
  the correction is issued, not only after the fact when the human asks for status.

## Ways to detect and recover quickly without manager guidance

- Detection signal: the human asks for status on a specific corrected item more than once in a
  short span ("how is X doing" followed by "it is not going") -- treat the second nudge as a
  strong signal to check for a stalled/absent delegation process immediately via `ListAgents`,
  rather than repeating the same "still waiting" response.
- Recovery path: `ListAgents` to check for any reachable child; if none exists and the correction
  is already fully specified (as it was here, from the manager's own prior `seekMentoring`
  findings), implement it directly rather than re-issuing the same correction into an apparently
  stalled pipeline a third time.

## What the agent should have done

At the moment the mid-flight correction was recorded, check for a live child agent for that task
before telling the human "I'll apply this... or route it as a correction if that work already
started" -- that phrasing assumed a relay mechanism existed without confirming it. Once the
human's second status nudge arrived, `ListAgents` should have been the very first action (it was,
but only on the second nudge, not the first).
