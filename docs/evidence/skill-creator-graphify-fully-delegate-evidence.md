# Evidence — FRAIM Skill Uses Graphify for Context Search (fully-delegate)

**Issue:** skill-creator-graphify (local anchor — conversational mode, no issue-tracker/repository workflow used for this task)
**Job:** fully-delegate (manager)
**Date:** 2026-08-15
**Status:** DRAFT — Requires Human Approval

## Summary

Delegated goal: use the skill-creator skill to audit and refine "the skill md file" so FRAIM
uses graphify when searching for project context. Confidence: **medium** — the fix now has
behavioral proof it works, but it took a correction round: the first pass looked right on
inspection and was not, and only a manager-prompted behavioral test (round 2) caught that.

## Delegation Decision

No child FRAIM job was spawned (`delegationRequired: false`). The delegated instruction named a
specific Claude Code tool to use (the `skill-creator` skill), not a FRAIM job, and no catalog job
fits "edit a local Claude Code routing-skill markdown file." This was direct manager work.

| Task | Persona | Job | Iterations | Verdict |
|------|---------|-----|-----------|---------|
| audit-refine-fraim-skill-for-graphify | manager (direct) | none (skill-creator, not a FRAIM job) | 2 | pass |

## What Was Found

- `fraim/personalized-employee/rules/project_rules.md` (lines ~114-146) already has a detailed,
  repo-specific rule: every FRAIM job phase that needs to understand "how does X work" / "what
  touches Y" / "what did we already decide about Z" must query `graphify-out/graph.json` via
  `graphify query` / `graphify path` / `graphify explain` before falling back to Glob/Grep, and
  refresh the graph with `--update` at job completion. That rule is comprehensive.
- The gap: `.claude/skills/fraim/SKILL.md` is the local Claude Code skill actually invoked
  whenever FRAIM activates in this session (its 5 steps: preload deferred tools, confirm
  activation, find local job stubs, load full content, execute). It never mentioned graphify or
  context-searching, so the project_rules.md rule was only reachable if something separately
  told the agent to go read that file at the right moment.
- `.claude/skills/graphify/SKILL.md` (the third-party graphify skill itself, the install target)
  was identified and explicitly ruled out as something to modify for this task.

## Deliverable

- `.claude/skills/fraim/SKILL.md` (final, post-correction) — step 2, immediately after "confirm
  FRAIM activation" and before any job-matching or fallback logic: whenever a later step needs
  project context, check for `graphify-out/graph.json` and prefer a graphify query over
  Glob/Grep/file-by-file reads, then points to `fraim/personalized-employee/rules/project_rules.md`
  for the full existing rule (staleness verification, `source_location` citation, `--update`
  refresh) instead of duplicating it. Explicitly covers the "no job matches, continue with normal
  tools" fallback and the "user named specific files" case (see Risk Areas for why both needed to
  be named explicitly).

## Correction Round (see `docs/evidence/skill-creator-graphify-fully-delegate-feedback.md`)

The human's response to the first pass was "that sounds about right, currently I am not sure if
graphify is used" — read as a request for empirical proof, not just reassurance. The manager
spawned a fresh, blind subagent (no memory of authoring the edit) with a realistic FRAIM-invoking
prompt that names specific files ("explain how override-click handling works in
`Box-code/lib/lock_controller.py` and `lock_ui.py`").

- **Before the fix**: the subagent noticed `graphify-out/` existed but went straight to
  Glob/Grep/Read anyway. Root cause: the original addition was appended at the end of the file
  (as step 6) and framed as applying to "steps 2-3 and step 5," but the actual exit path the
  subagent took was step 3's "no job matches, continue with normal tools" fallback — a clean
  off-ramp that a trailing, cross-referenced addendum doesn't visibly attach to. The subagent also
  reasoned that a request naming specific files was a "targeted lookup," not the kind of
  open-ended question the addition described.
- **Fix**: moved the instruction to step 2 (right after activation, before matching/fallback can
  exit early), named the "no job match" fallback explicitly, and closed the specific-files
  rationalization.
- **After the fix**: re-ran the identical blind prompt. The subagent ran actual `graphify query`
  and `graphify explain` commands before reading any source file.
- **Unrelated bug surfaced by both test runs**: `graphify-out/.graphify_python` carries a leading
  UTF-8 BOM that breaks direct invocation of the saved interpreter path (`graphify query` fails
  until `python -m graphify` is used instead, or the BOM is stripped). Not fixed here — it's a
  bug in the third-party graphify skill's own path-saving step, not in the file this task edited
  — but worth knowing since it makes the very first `graphify` invocation in a fresh environment
  look like a failure.

## Process Note (skill-creator scope)

The skill-creator skill's full workflow (interview, draft, spawn parallel with-skill/baseline
test subagents, grade against assertions, generate an eval-viewer benchmark, run the trigger-
description optimization loop) is built for creating a new skill or a significant overhaul. This
was a 1-step, minimal addition to an existing 25-line internal routing skill with no prior
test/eval infrastructure and nothing to benchmark against. The manager applied skill-creator's
underlying writing principles instead (keep it lean, explain the why, match the file's existing
terse imperative numbered-step style, cross-reference rather than duplicate project_rules.md) and
skipped the eval/benchmark harness as disproportionate to the change size. Flagged here as a
judgment call for the human to review, not hidden.

## Validation

- Read the target file before each edit (required before any edit).
- Applied the edits; the tool confirmed each applied successfully.
- No test suite applies to this file (a routing-instructions skill, not code), so verification
  used a blind behavioral test instead of inspection: a fresh subagent, with no memory of writing
  the edit, run against an identical realistic prompt before and after the fix, with its literal
  tool-call order reported back. This is the actual validation for the final deliverable — the
  round-1 "verification by inspection" is documented above as the thing that failed, not as valid
  evidence.

## Risk Areas

**audit-refine-fraim-skill-for-graphify** needed 2 iterations. What the human should scrutinize:
this is a live example of inspection-based review missing a real gap in an instruction file — the
first version read as correct and was not. The correction is now behaviorally verified, but only
against one test prompt; a differently-phrased request could still find another gap the same way
the "named specific files" framing did on round 1.

## Human Approval Checklist

1. Approve committing this change — nothing has been committed or pushed; the edit is live in
   the working tree on `master` (conversational mode: no branch/PR was created for this task).
2. Confirm the target file was the right one. If a different skill or rule file was actually
   intended, say so and this manager will redo the edit there instead.
3. Confirm skipping skill-creator's full eval/benchmark loop (test subagents, eval viewer,
   trigger-description optimization) was the right call for a change this size, or ask for it to
   be run if you want the triggering behavior formally validated.
4. Optional: fix the unrelated `graphify-out/.graphify_python` BOM bug surfaced during testing
   (separate from this task's scope, but it will make the first `graphify` call after a fresh
   `/graphify` build look like it failed until `python -m graphify` is used or the BOM is
   stripped).
