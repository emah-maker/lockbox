# Feedback for skill-creator-graphify - fully-delegate Workflow

## Round 1 Feedback
*Received: 2026-08-15 (conversation)*

### Comment 1 - ADDRESSED
- **Author**: <developer email>
- **Type**: conversation_feedback
- **File**: .claude/skills/fraim/SKILL.md
- **Comment**: "that sounds about right, currently I am not sure if graphify is used"
- **Status**: ADDRESSED

**How addressed**: Treated as a request to empirically verify the change rather than take it on
faith. Ran a blind behavioral test: spawned a fresh subagent with no memory of writing the edit,
gave it a FRAIM-invoking prompt that names specific files ("explain how override-click handling
works in firmware/lib/lock_controller.py and lock_ui.py"), and had it report its exact tool-call
order back.

**First test (against the original edit)**: confirmed the concern was valid. The subagent noticed
`graphify-out/` existed but went straight to Glob/Grep/Read anyway. Root cause: the original step 6
was appended at the end of the file, framed as pertaining to "steps 2-3 and step 5," but the actual
failure path was step 3's "no job matches, continue with normal tools" exit - a clean off-ramp that
didn't visibly route through the trailing step 6. The subagent also rationalized that a request
naming specific files was a "targeted lookup," not the kind of open-ended question step 6 described.

**Fix applied**: moved the graphify instruction to step 2, immediately after "confirm FRAIM
activation" and before any job-matching or fallback logic, so it can't be skipped by exiting early.
Made it explicit that the "no job matches, continue with normal tools" fallback counts as needing
project context too, and explicitly closed the "user named specific files" loophole (the graph
often surfaces what else touches those files, which a targeted Read/Grep would miss).

**Re-test (against the fixed edit, same exact prompt)**: the subagent ran actual `graphify query`
and `graphify explain` commands before reading source files. Confirmed working end to end.

**Unrelated bug surfaced by both test runs**: `graphify-out/.graphify_python` has a leading UTF-8
BOM that breaks direct invocation of the saved interpreter path (`graphify query` fails with "file
not found" until the BOM is stripped or `python -m graphify` is used instead). Both test subagents
hit this and worked around it. Not fixed as part of this task (out of scope: it's a bug in the
third-party graphify skill's own path-saving step, not in the FRAIM routing file), but surfaced here
since it caused every test run to fail once before succeeding.
