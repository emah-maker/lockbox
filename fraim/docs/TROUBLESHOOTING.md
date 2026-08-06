# FRAIM Troubleshooting Guide

Use this guide when FRAIM is installed but discovery, sync, MCP, or job execution is not behaving correctly.

## Start Here

Run these first:

```bash
npx fraim@latest --version
npx fraim@latest doctor --test-mcp
```

Then inspect the local project state:

```bash
ls fraim
ls fraim/ai-employee/jobs
ls fraim/ai-manager/jobs
ls fraim/personalized-employee
```

Important:

- Current FRAIM uses **jobs** as the primary execution unit.
- If you see old advice referring to `fraim/workflows/`, treat it as outdated.
- The current synced job stubs live under `fraim/ai-employee/jobs/` and `fraim/ai-manager/jobs/`.

## Most Common Problems

| Problem | Fastest First Move |
| --- | --- |
| FRAIM command not found | Use `npx fraim@latest ...` |
| IDE cannot connect to FRAIM | Run `npx fraim@latest doctor --test-mcp` |
| Agent cannot find jobs | Run `npx fraim@latest sync`, then restart the IDE |
| Synced content looks stale | Run `npx fraim@latest sync` |
| Personalized changes do not seem to apply | Verify files live under `fraim/personalized-employee/` |
| Agent keeps asking for workflows | Ask it to `List FRAIM jobs` instead |

---

## FRAIM Command Not Found

### Symptoms

```bash
fraim: command not found
```

### Fix

Use `npx` immediately:

```bash
npx fraim@latest setup
npx fraim@latest init-project
```

Keep using the `npx fraim@latest ...` form in docs and shell examples.

---

## Windows npm 11 Reports `ECOMPROMISED` / `Lock compromised`

### Symptoms

- Windows 11 with npm 11 reports `npm error code ECOMPROMISED`.
- The IDE says the FRAIM MCP server failed to connect.
- The IDE config contains `npx -y fraim-framework@latest mcp`.

### Fix

Regenerate the IDE MCP config:

```bash
npx fraim@latest add-ide
npx fraim@latest doctor --test-mcp
```

Current FRAIM configs launch MCP through a stable FRAIM latest launcher. The launcher still resolves the latest published FRAIM package so MCP keeps running current code, but the IDE no longer calls `npx ... @latest` directly on every MCP start.

If `doctor --test-mcp` still reports a direct `@latest` MCP config, remove the old FRAIM MCP block from the IDE config and rerun `add-ide`.

---

## `fraim/` Directory Not Created Or Looks Incomplete

### Symptoms

- `npx fraim@latest init-project` completed but local FRAIM folders are missing
- `fraim/` exists but does not contain expected directories

### Fix

1. Make sure you are in the repo root:

```bash
pwd
```

2. Run initialization again:

```bash
npx fraim@latest init-project
```

3. Verify expected directories:

```bash
ls fraim
```

Expected core entries:

- `fraim/config.json`
- `fraim/personalized-employee/`
- `fraim/ai-employee/`
- `fraim/ai-manager/`
- `fraim/docs/`
- user scripts under `~/.fraim/scripts/`

If initialization still fails, inspect command output and rerun with your shell history or captured logs.

---

## IDE Cannot Connect To FRAIM

### Symptoms

- The IDE says FRAIM is unavailable
- MCP tools do not appear
- The agent cannot call FRAIM tools

### Fix

1. Run:

```bash
npx fraim@latest doctor --test-mcp
```

2. If FRAIM was not added to the IDE yet:

```bash
npx fraim@latest add-ide
```

3. If it was added already, re-run `npx fraim@latest add-ide` and then fully restart the IDE.

4. Confirm the IDE has the FRAIM MCP entry in its config.

5. If the setup looks correct but the IDE still cannot see FRAIM, restart the entire IDE, not just the current window.

---

## Agent Cannot Find A Job

### Symptoms

- The agent says a job does not exist
- The agent asks for workflows instead of jobs
- Local job stubs seem missing

### Fix

1. Refresh local synced content:

```bash
npx fraim@latest sync
```

2. Check that job stubs exist:

```bash
ls fraim/ai-employee/jobs
ls fraim/ai-manager/jobs
```

3. Restart the IDE after sync. Some IDEs only refresh MCP-visible content on startup.

4. Ask the agent:

```text
List FRAIM jobs
```

5. If you know the exact job name, ask for it directly:

```text
Run the feature-implementation job for issue #123
```

### Important Path Update

Old path:

```text
fraim/workflows/
```

Current paths:

```text
fraim/ai-employee/jobs/
fraim/ai-manager/jobs/
```

---

## Synced Content Looks Stale

### Symptoms

- Docs or job stubs do not match current FRAIM behavior
- The agent still references old terminology

### Fix

Run:

```bash
npx fraim@latest sync
```

Then restart the IDE.

If the repo contains checked-in copies of synced content and they look stale, remove those tracked copies from your normal editing flow and rely on fresh sync output plus your personalized overrides.

---

## Personalized Overrides Do Not Apply

### Symptoms

- You created a local rule or job change but the agent still follows the base guidance

### Verify The Right Location

Personalized content should live under:

- `fraim/personalized-employee/jobs/`
- `fraim/personalized-employee/skills/`
- `fraim/personalized-employee/rules/`
- `fraim/personalized-employee/templates/`

### Fix

1. Confirm the file is in the personalized directory, not the synced directory.
2. Confirm the file name and category path are correct.
3. Restart the IDE if discovery still looks stale.
4. If you created the file manually and the agent still misses it, try using `npx fraim@latest override` to scaffold the right location.

Example:

```bash
npx fraim@latest override --inherit jobs/product-building/feature-implementation.md
```

---

## `npx fraim@latest sync` Fails

### Symptoms

- Sync errors
- Missing synced docs or job stubs after sync

### Fix

1. Check connectivity.
2. Verify the FRAIM API key is present in config.
3. Run:

```bash
npx fraim@latest sync
```

4. Then re-run:

```bash
npx fraim@latest doctor --test-mcp
```

If sync succeeds but the IDE still behaves as if nothing changed, restart the IDE.

---

## The Agent Keeps Asking For Workflows

### Symptoms

- The agent says `list workflows`
- The agent expects `get_fraim_workflow`
- Older docs or prompts are still in circulation

### Fix

Use job-first language:

- `List FRAIM jobs`
- `Which FRAIM job should I use for this task?`
- `Run the feature-specification job`
- `Run the feature-implementation job`

Historical references to workflows may still appear in retrospectives, RFCs, or older conversations. Those are not the current user-facing mental model.

---

## Job Path Confusion

### Use These Defaults

| Situation | Start Here |
| --- | --- |
| Need requirements clarified | `feature-specification` |
| Need the build plan | `technical-design` |
| Need the thing implemented | `feature-implementation` |
| Need tests first | `test-execution` |
| Need browser validation | `browser-application-validation` |
| Need UI fit-and-finish validation | `ui-polish-validation` |
| Need spec-alignment review | `implementation-feature-review` |
| Need design-alignment review | `implementation-design-review` |

If you are still unsure, ask the agent to recommend the next job explicitly.

## Manager Coaching Jobs

Use these when the problem is process drift or a notable miss, not just normal delivery work.

| Situation | Job |
| --- | --- |
| The agent skipped phases or drifted from the correct path | `follow-your-mentor` |
| You want a concise RCA and durable learning after a notable mistake | `analyze-why-you-messed-up` |

Suggested wording:

- `Run the follow-your-mentor manager job before continuing`
- `Run the analyze-why-you-messed-up manager job for this miss`

Naming opinion:

- `follow-your-mentor` is the right name to document today because it is the actual exposed job name.
- `follow-the-process` would be a better long-term display name because it is clearer to end users and less personality-dependent.
- If renamed later, keep `follow-your-mentor` as an alias for compatibility.

## Legacy `.fraim` Migration

If the repo still uses a project-level `.fraim/` directory, run the one-time migration command:

```bash
npx fraim@latest migrate-project-fraim
```

I confirmed this command is exposed in CLI help:

```bash
npx fraim@latest --help
npx fraim@latest migrate-project-fraim --help
```

Use this before normal project work if the repository still depends on legacy project `.fraim/` content.

---

## Platform Or Token Problems

### Symptoms

- GitHub, GitLab, Azure DevOps, or Jira integration does not work
- PR or issue automation is missing

### Fix

Re-run setup for the platform you need:

```bash
npx fraim@latest setup --github
npx fraim@latest setup --gitlab
npx fraim@latest setup --ado
npx fraim@latest setup --jira
```

Then re-run:

```bash
npx fraim@latest doctor --test-mcp
```

If you only need FRAIM guidance and not platform automation yet, use Conversational mode.

---

## Fast Recovery Checklist

If something feels wrong and you want the shortest reset path:

1. `npx fraim@latest doctor --test-mcp`
2. `npx fraim@latest sync`
3. restart the IDE
4. ask: `List FRAIM jobs`
5. ask for the exact job you need
