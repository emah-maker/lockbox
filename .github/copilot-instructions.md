<!-- FRAIM_AGENT_ADAPTER_START -->
## FRAIM

- Use `fraim/` as the repository's FRAIM catalog.
- FRAIM jobs are the primary execution units and should be treated like first-class workflows.
- FRAIM skills are reusable capabilities jobs compose.
- FRAIM rules are always-on constraints and conventions.
- Repo-specific overrides and learnings live under `fraim/personalized-employee/`.
- Use FRAIM when the user explicitly invokes FRAIM, names a FRAIM job, asks what FRAIM job to run, or the active surface has already selected a FRAIM job.
- For ordinary requests, answer or work normally. Do not scan FRAIM stubs first.
- If the user names an exact FRAIM job, fetch that full job directly with FRAIM MCP tools.
- When FRAIM routing is active but the job is not exact, use local stubs to identify which job to invoke before fetching full content with FRAIM MCP tools.
- If no exact or high-confidence job match exists, say that no FRAIM job matches and continue with normal tools or ask one concise clarification.
- **Job stubs are for discovery only.** Never execute a job from stub content - always call `get_fraim_job({ job: "<job-name>" })` first.
<!-- FRAIM_AGENT_ADAPTER_END -->
