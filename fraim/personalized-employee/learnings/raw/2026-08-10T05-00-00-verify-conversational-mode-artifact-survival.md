---
author: <developer email>
date: 2026-08-10
job: fully-delegate
context: conversational-session
---

# Coaching Moment: verify-conversational-mode-artifact-survival

## What happened

While running `fully-delegate` for the lock-duration-picker feature, a delegated sub-agent
self-reported the implementation complete and verified (tsc clean, jest green). Independent
manager verification (`git status` + grep on the claimed files) found the artifact completely
absent from the working tree. This was not a one-off: two other, unidentified concurrent processes
were separately found to have implemented the exact same feature in the same shared, uncommitted
working tree during the same time window (confirmed via two independent pre-existing evidence files
for the identical feature), and the target files were silently reverted to their pre-feature
baseline at least twice during the run. A near-identical collision was independently documented the
same day for an unrelated "focus goal" feature in this same project folder.

## Why it happened

`fraim/config.json` sets `"mode": "conversational"` for this project, and the `set-up-workspace`
skill's own guardrail routes conversational-mode work to "the current folder in place" with no
branch or worktree isolation. That guidance did not anticipate this project's actual environment:
the folder lives under active OneDrive sync, and multiple Claude Code / FRAIM sessions appear able
to run concurrently against it. The skipped gate was assuming a sub-agent's self-report (or even a
peer agent's captured diff) reflects current on-disk state without an independent, timestamped
re-check — "verify before advancing" was being applied to correctness of design, not to the more
basic question of whether the artifact still physically exists at time of manager review.

## What was learned

In a conversational-mode (no-worktree-isolation) delegation, especially inside a sync-managed
folder, the manager must independently re-verify an artifact's presence immediately before
recording a verdict, not just its content-correctness, and must treat "self-reported complete" as
unverified until that direct disk check passes at that moment.

## What will be done to recover

The artifact was recovered: the manager re-applied only the verified-correct hunks directly
(excluding an unrelated bundled feature from a different concurrent process) and re-ran `npx tsc
--noEmit` and `npx jest` itself immediately before writing the final verdict, confirming the files
were modified on disk at time of writing. The fully-delegate evidence file
(`docs/evidence/lock-duration-picker-fully-delegate-evidence.md`) documents the collision and flags
committing the change as an open human-approval item specifically to reduce the window in which it
could be silently lost again.

## Systematic ways to avoid recurrence

- Existing rule, job, skill, or template that should have prevented this: `set-up-workspace.md`'s
  conversational-mode branch ("work directly in the current folder... present changes for local
  review") assumes single-writer access to that folder; it has no clause addressing concurrent
  sessions or sync-managed folders.
- Suggested hardening: extend `set-up-workspace.md` (or add a `fully-delegate` execute-phase step)
  so that conversational mode explicitly requires a fresh `git status`/content check on every claimed
  artifact immediately before the manager records a verdict, and recommends the human be asked
  whether worktree isolation should be the default when the project folder is detected as
  sync-managed (OneDrive/Dropbox/Google Drive path patterns) or when a second collision of this kind
  occurs in the same project.
- Future prevention gate: before any `seekMentoring` call marking an `execute`-phase node
  verified-complete, require (and ideally have the tooling enforce) that the evidence includes a
  freshly-run `git status`/grep timestamp for every claimed changed file, not just a sub-agent's
  self-report.

## Ways to detect and recover quickly without manager guidance

- Detection signal: a sub-agent's completion report cites file paths and test output but the
  manager has not itself run a command against the current working tree since that report arrived;
  or a second/third pre-existing evidence file already exists for the same feature slug.
- Recovery path: run `git status --porcelain` and a targeted `grep` for the claimed symbol/function
  names in the claimed files before writing any verdict; if absent, ask the sub-agent to hand over
  exact captured content (diff or full file text) rather than re-attempting a blind write, then apply
  it directly and re-verify with the project's own build/test commands.

## What the agent should have done

Run the independent `git status`/grep check on the claimed artifact the moment the first completion
report arrived, before doing anything else with it (including before drafting a response to the
human) -- rather than only discovering the gap after some elapsed time and a second read.
