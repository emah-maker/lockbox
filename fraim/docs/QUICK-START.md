# FRAIM Quick Start Guide

Get from zero to a useful FRAIM run in a few minutes.

## What FRAIM Is

FRAIM helps you manage AI agents with more rigor.

Instead of:
- "Looks good"
- "I think the tests passed"
- "I changed some code"

FRAIM pushes agents toward:
- explicit jobs
- phased execution
- evidence before signoff
- better review discipline

The primary unit in FRAIM is a **job**.

- A **job** is the thing you run.
- A **phase** is a gate inside the job.
- A **skill** is reusable execution guidance a job can include.
- A **rule** is an always-on constraint.

## Install

Recommended:

```bash
npx fraim@latest setup --key=<your-fraim-key>
```

## Choose A Mode

`npx fraim@latest setup` will ask you which mode you want.

| Mode | Use It When | What You Get |
| --- | --- | --- |
| `Conversational` | You want FRAIM guidance but no code-hosting or issue-tracker integration yet | Jobs, mentoring, rules, docs, and manual output handling |
| `Integrated` | One platform handles both code and issues | Everything in Conversational plus platform-aware PR/MR or issue flows |
| `Split` | Code and issue tracking live on different platforms | Everything in Integrated plus cross-platform linking |

Recommendation: start with `Integrated` if your team already uses one platform for both code and issues. Otherwise start with `Conversational`.

## Initialize A Project

If setup did not already initialize the current repo:

```bash
npx fraim@latest init-project
```

That creates or refreshes:

- `fraim/config.json`
- `fraim/personalized-employee/`
- `fraim/ai-employee/`
- `fraim/ai-manager/`
- `fraim/docs/`
- user scripts under `~/.fraim/scripts/`

If this repo still has legacy project content under `.fraim/`, run the one-time migration command before normal work:

```bash
npx fraim@latest migrate-project-fraim
```

## First Things To Ask Your Agent

Once your IDE is connected to FRAIM:

1. `Onboard this project`
2. `List FRAIM jobs`
3. Ask for the specific job you need

Good examples:

- `Run the feature-specification job for issue #123`
- `Run the technical-design job for this approved spec`
- `Run the feature-implementation job for issue #123`
- `Personalize my employee`
- `Run the follow-your-mentor manager job if the agent drifted`
- `Run the analyze-why-you-messed-up manager job after a significant miss`
- `Which FRAIM job should I use for this request?`

## Which Job Should I Use?

Use this as the default map:

| If you need to... | Start with this job |
| --- | --- |
| Clarify requirements, user stories, UX, or acceptance criteria | `feature-specification` |
| Turn an approved spec into an implementation plan | `technical-design` |
| Build or fix code, docs, config, or delivery artifacts | `feature-implementation` |
| Add or improve tests first | `test-execution` |
| Validate browser behavior end-to-end | `browser-application-validation` |
| Check UI fit and finish across breakpoints | `ui-polish-validation` |
| Verify delivered behavior against the spec | `implementation-feature-review` |
| Verify the code matches the approved design | `implementation-design-review` |
| Make the employee do things your way, learn a new capability, stop repeating a mistake, or adapt to a new environment | `evolve-employee` |
| Capture learnings after completion | `issue-retrospective` |
| Recover when the agent drifted or skipped the correct phase | `follow-your-mentor` |
| Generate a root-cause analysis after a notable mistake | `analyze-why-you-messed-up` |

If you want a visual of the full job surface before choosing:

- open the FRAIM Brain at `https://fraim.wellnessatwork.me/fraim-brain`
- use the "Your Brain" view with your FRAIM API key to see the jobs and skills your own usage activates
- use `https://fraim.wellnessatwork.me/analytics` to see personalized usage trends, top components, and where your activity is concentrated

## Common Paths

### Larger Feature

Use this path:

1. `feature-specification`
2. `technical-design`
3. `feature-implementation`
4. A review job
5. `issue-retrospective`

### Small Bug Fix

Usually:

1. `feature-implementation`
2. A review job if needed
3. `issue-retrospective`

If the agent ignored the correct phase or process during the fix, insert `follow-your-mentor` before resuming execution.

### UI Change

Usually:

1. `feature-specification` if UX is still changing
2. `technical-design` if implementation details matter
3. `feature-implementation`
4. `ui-polish-validation` or `browser-application-validation`
5. Review job

## What The AI Mentor Does

The AI Mentor helps the agent stay in the right phase.

It should:

- explain the current phase
- require evidence before advancing
- tell the agent what is missing
- help recover if the agent drifted or skipped a gate

If the agent seems lost, tell it to follow FRAIM and ask the mentor again.

If the drift is material, use the manager coaching job by name:

- `follow-your-mentor` when the agent needs to get back to the correct phase and resume under mentor guidance
- `analyze-why-you-messed-up` when the agent needs a concise root-cause analysis and a durable learning artifact

Opinionated note: `follow-your-mentor` is the current exposed job name, so the docs should use it. As plain-English product language, `follow-the-process` would be cleaner and more scalable because it explains the purpose better and is less personality-specific. If you rename later, I would keep the current job as a compatibility alias rather than hard-cutting it.

## Keep Local FRAIM Content Fresh

Run this when you want refreshed synced content:

```bash
npx fraim@latest sync
```

This updates local job stubs, skills, rules, docs, and scripts.

## Add FRAIM To Another IDE

```bash
npx fraim@latest add-ide
```

Or target a specific IDE:

```bash
npx fraim@latest add-ide --ide claude
npx fraim@latest add-ide --ide cursor
```

## If Something Breaks

Start here:

```bash
npx fraim@latest doctor --test-mcp
```

Then open `TROUBLESHOOTING.md`.

## Next Reading

- Need the full model and command reference: `USER-GUIDE.md`
- Need founder-stage job selection: `GuideToFRAIMForFounders.md`
- Need debugging help: `TROUBLESHOOTING.md`
