---
author: emah@kitchenlab.org
date: 2026-08-10
job: fully-delegate
context: conversational-session
---

# Coaching Moment: propose-concrete-values-for-vague-adjustability-asks

## What happened

The user asked to make the box's override/force-open click-count setting "more adjustable." The
manager (me) delegated a flat range widening (5-100, step 1) without proposing the concrete step
design to the user first. The user rejected it and specified the actual design they wanted: a
progressive step scale (5, then 10, then 25, then 50 as the value grows) with a higher ceiling.

## Why it happened

"More adjustable" was treated as "finer flat step + wider range" -- the simplest interpretation --
without surfacing that interpretation as a proposal before implementing. The listen-phase clarifying
question I did ask ("which settings should become adjustable") targeted *which* setting, not *how*
that setting's granularity should scale. A request to make a numeric control "more adjustable" is
underspecified on the step-curve shape (flat vs. progressive), not just the range, and I didn't
recognize that as a second axis of ambiguity worth a concrete proposal.

## What was learned

When a request asks to make a numeric setting "more adjustable" with no explicit step/curve
specified, propose a concrete step design (not just a wider flat range) before implementing, since
"more adjustable" has at least two independent axes (range and step curve) that can each be wrong.

## What will be done to recover

Already recovered: re-ran the implementation with the user's exact staircase (5/10/25/50 by range)
and a hard ceiling constraint (single-byte NVM storage caps it at 255), verified via diff read,
grep, tsc, and jest. See `docs/evidence/settings-adjustability-and-call-flash-fully-delegate-evidence.md`.

## Systematic ways to avoid recurrence

- Existing rule, job, skill, or template that should have prevented this: the `active-listening`
  skill's "extract requirements, no solutioning" step asks for testable acceptance criteria, but
  doesn't explicitly prompt for a *default proposal* on ambiguous numeric-control shape when the
  user hasn't specified one -- none found that covers this specifically.
- Suggested hardening: when a delegated task involves widening/narrowing a numeric setting with no
  explicit step curve given, the `listen` or `understand-delegation-path` phase should require
  stating the proposed step design (flat vs. progressive, and why) as part of the reflected
  understanding, not just the setting name and range.
- Future prevention gate: before delegating any numeric-range/step change, include a one-line
  "step design: <flat step N> or <progressive: A/B/C>" statement in the manager's understanding
  recap, so the user has a concrete thing to correct before implementation starts.

## Ways to detect and recover quickly without manager guidance

- Detection signal: the user's correction names specific numbers ("5, 10, 25, 50") rather than a
  vague "no, different" -- that specificity signals they already had a concrete design in mind that
  wasn't elicited.
- Recovery path: re-open the `listen` phase's reflected-understanding step, restate the corrected
  concrete design back to the user in the same message as the fix, and re-verify against any hard
  constraints (like storage width) before re-delegating.

## What the agent should have done

Before delegating, state explicitly: "I'll widen the range and use a flat step of N unless you want
a progressive step (fine control at low values, coarser at high values) -- let me know which," then
wait for a one-word confirmation, rather than picking the simpler flat-step interpretation silently.
