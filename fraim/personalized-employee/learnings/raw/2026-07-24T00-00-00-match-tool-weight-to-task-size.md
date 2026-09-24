---
author: <developer email>
date: 2026-07-24
context: conversational-session
kind: success-moment
trigger: user-validation
---

# Success Moment: match-tool-weight-to-task-size

## What happened

Asked to "update preferences to use Ruflo in conjunction with the FRAIM MCPs to
be more token-efficient," the agent treated it as the lightweight memory edit it
actually was: it read the existing `tool-usage-both` memory first, then recorded
the new preference as a *separate, cross-linked* `fraim-ruflo-token-efficiency`
memory plus a single MEMORY.md index line — rather than duplicating it into the
existing file or bloating that file. It also declined the heavyweight machinery
dangled in the ambient prompt: no shared-browser launch, no `swarm_init`, no
wrapping the trivial edits in MCP/`terminal_execute` calls. The manager then ran
`recognize-good-work` on this decision, validating it.

## Why it was the right call

Matching tooling weight to task size — doing a small, well-scoped edit with the
lightest correct tool and ignoring irrelevant ambient boilerplate — is itself the
token-efficiency the task asked for, and it avoids the failure mode of spawning
swarms/browsers a task does not need.

## How to reproduce the win

When a request is a small, well-scoped config/preference/memory edit — especially
when ambient instructions offer heavyweight tools (browser, swarm) the task does
not require — do the minimal correct action and skip the machinery. For memory
specifically: read the existing file before writing, and create a new
cross-linked file for a genuinely distinct topic instead of bloating an existing
one. Before spawning a swarm or browser, first ask "does this task actually need
it?"
