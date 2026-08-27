---
author: emah@kitchenlab.org
date: 2026-08-25
job: fully-delegate
context: conversational-session
---

# Coaching Moment: verify-repo-state-not-notification-status

## What happened

A delegated `coder` sub-agent (feature-implementation job, single-line fix to
`DashboardScreen.tsx`'s duration-picker default) was launched in the background. Before it
reported back, a harness task-notification arrived saying the task's status was `stopped` with
"no completion record found" and warning the work might have been lost. Shortly after, a
manager-coaching message arrived relaying what it said was the coder's own completion report,
claiming the fix, validation, and evidence file were all done. Rather than trusting either signal
at face value, the actual repository was checked directly (`git diff`, `git status`, reading the
evidence file) before recording a verdict -- and the work had in fact landed correctly.

## Why it happened

Two contradictory signals arrived about the same background task: a harness-level "stopped /
unconfirmed" notification, and a narrative "completed" report. Neither is ground truth by itself --
the notification can lag or misreport a task that actually finished, and a forwarded "manager
coaching" report is prose from another layer, not a verified fact. The correct heuristic is that
neither should be accepted directly; only the artifacts the task claims to have produced (files,
diffs, evidence docs) are ground truth.

## What was learned

When a background sub-agent's completion status is ambiguous or contradicted by a harness signal,
verify by reading the actual repository/artifact state before accepting or rejecting the reported
deliverable -- never gate the verdict on the notification text or the relayed narrative alone.

## What will be done to recover

No recovery needed this time -- verification confirmed the work was correct before the manager
verdict was recorded in `docs/evidence/lock-duration-default-fully-delegate-evidence.md`. The
verification step (diff scope, constant cross-check, stale-evidence-file check for duplicate-spawn
pollution) is documented there as the model for future runs.

## Systematic ways to avoid recurrence

- Existing rule: the `execute` phase's own guardrail ("Do not mark a node verified based only on
  the child agent's assertion") already covers this for the *child's* report, but did not
  explicitly address a *harness* status signal (`stopped`/no completion record) that itself turns
  out to be unreliable. None found for that specific case.
- Suggested hardening: the `execute` phase step 1 ("Receive child deliverables") could note that a
  harness completion-status notification is also not ground truth and should be reconciled against
  actual repo/artifact state exactly like a child's self-report is.
- Future prevention gate: before recording any verdict, require at least one direct read of a
  claimed artifact path (file content, `git diff`, or test output) rather than accepting either the
  notification status or the relayed report text alone.

## Ways to detect and recover quickly without manager guidance

- Detection signal: a task-notification status of `stopped`/`failed`/"no completion record found"
  arriving before or alongside a narrative "completed" report for the same task.
- Recovery path: go straight to the repo (`git status`, `git diff`, read the claimed evidence file
  path) before calling `seekMentoring` with any verdict; treat both the notification and the
  narrative report as unverified claims until then.

## What the agent should have done

This is what was done: independently verified the actual file contents and evidence file before
accepting the deliverable, rather than either discarding the work as lost (trusting the "stopped"
notification) or accepting it uncritically (trusting the relayed "completed" report).
