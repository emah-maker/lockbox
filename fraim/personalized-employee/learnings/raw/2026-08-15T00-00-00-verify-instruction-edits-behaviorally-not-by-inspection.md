---
author: <developer email>
date: 2026-08-15
job: fully-delegate
context: conversational-session
---

# Coaching Moment: verify-instruction-edits-behaviorally-not-by-inspection

## What happened

MANdy edited `.claude/skills/fraim/SKILL.md` to add a step telling FRAIM to prefer `graphify`
over Glob/Grep when it needs project context, self-reviewed the diff by inspection (matched the
file's existing style, cross-referenced `project_rules.md` without duplicating it), and reported
the task done with high confidence. The user's actual response was "that sounds about right,
currently I am not sure if graphify is used" - a direct signal that reading the diff was not the
same as knowing it worked. A blind before/after subagent test (identical FRAIM-invoking prompt,
fresh context, no memory of writing the edit) then showed the original edit did not fire: the
subagent noticed `graphify-out/` existed but went straight to Glob/Grep/Read anyway.

## Why it happened

The edit was an instruction-only change to a routing/prompt file, not code, so there was no
test suite to run and "verification" collapsed to re-reading the diff and judging it plausible.
That is a category error: a routing instruction's correctness is a claim about a *reader's*
future behavior, not about the text itself, and text can look correct while failing to attach to
the actual decision point a fresh reader hits. The specific miss: the new step was appended at
the end of the file and framed as pertaining to "steps 2-3 and step 5," but the real failure path
was step 3's "no job matches, continue with normal tools" exit - a clean off-ramp out of the flow
that a trailing, cross-referenced addendum does not visibly attach to. Inspection-only review
cannot catch this class of gap because the reviewer already knows the intended reading.

## What was learned

For any edit to an instruction/prompt/skill file meant to change an agent's behavior, "I read
the diff and it looks right" is not verification; only running the instruction blind (a fresh
subagent or session with no memory of authoring it) against a realistic prompt proves the
behavior actually changed, and the strongest test cases are the ones with a plausible-sounding
reason to skip the new behavior (e.g. "the user already named specific files, so this isn't an
open-ended context question").

## What will be done to recover

Already done this run: restructured the graphify step to fire immediately after activation
confirmation (before any job-matching or fallback branch can exit early), explicitly named the
"continue with normal tools" fallback as in-scope, and closed the "user named specific files"
rationalization. Re-ran the identical blind test and confirmed the subagent now runs actual
`graphify query`/`explain` commands before touching source files.

## Systematic ways to avoid recurrence

- Existing rule, job, skill, or template that should have prevented this: none found - the
  `fully-delegate` job's verification steps (`how-should-i-verify`, review maps) are written for
  reviewing *child* deliverables, not for a manager's own direct instruction-file edits, so there
  was no built-in prompt to behaviorally test this class of change.
- Suggested hardening: when a `fully-delegate` (or any) run's deliverable is itself an
  instruction/prompt/skill file rather than code or a document, the verification step should
  default to "spawn a blind test run against the new instruction with a realistic prompt" rather
  than "read the diff," the same way code changes default to running tests rather than reading
  the diff and asserting it looks correct.
- Future prevention gate: before marking any instruction-file edit verified, ask "what is the
  first place a fresh reader could exit the file without reaching this instruction?" and design
  a test prompt that walks exactly that path, including a plausible-sounding reason to bail out
  early (specific inputs, an apparent exact match elsewhere, etc).

## Ways to detect and recover quickly without manager guidance

- Detection signal: the user expresses uncertainty about whether a change actually works, even
  mild uncertainty ("not sure if X is used") rather than an explicit bug report - treat this as a
  request for empirical proof, not just reassurance.
- Recovery path: spawn a fresh subagent with the exact prompt that should exercise the new
  instruction, with no context about having written it, and read back its literal tool-call order
  before responding to the human.

## What the agent should have done

Before reporting the original edit as done, run the same blind before/after test proactively -
spawn a subagent with a realistic FRAIM-invoking, context-seeking prompt and check whether it
actually reached for graphify, instead of relying on inspection of the diff and the plausibility
of the instruction's wording.
