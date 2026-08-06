# FRAIM

Follow this process:

0. **Preload deferred FRAIM tools when needed**:
   - If FRAIM MCP tools are unavailable because this host lazily loads deferred tool schemas, call `ToolSearch` once to load `fraim_connect`, `list_fraim_jobs`, `get_fraim_job`, `get_fraim_file`, `seekMentoring`.
   - Do the preload as one batched discovery step, not one search per tool.

1. **Confirm FRAIM activation**:
   Use this process only when the user explicitly invokes FRAIM, names a FRAIM job, asks what FRAIM job to run, or the active surface has already selected a FRAIM job. For ordinary requests, answer or work normally; do not scan FRAIM stubs first.

2. **If the user did not specify a FRAIM job or topic after activation**:
   If local FRAIM job stubs are present in the workspace, inspect those first and match the request locally. Also inspect `fraim/personalized-employee/jobs/` for local overrides or repo-specific jobs. If local files are missing or you cannot inspect workspace files, call `list_fraim_jobs()` to view the full catalog, including any proxy-discoverable personalized jobs.

3. **Find the match**:
   If the user names an exact FRAIM job, call `get_fraim_job({ job: "<job-name>" })` directly. Otherwise, match the user's request to a FRAIM job from the local stub catalog, `fraim/personalized-employee/jobs/`, or the full `list_fraim_jobs()` response. If no exact or high-confidence job match exists, say that no FRAIM job matches and continue with normal tools or ask one concise clarification. Do not pick the nearest catalog job.

4. **Load the full content**:
   - For jobs, call `get_fraim_job({ job: "<matched-job-name>" })`.
   - For skills, use the content returned by `get_fraim_file(...)`.

5. **Execute**:
   - For jobs, follow the phased instructions and use `seekMentoring` when the job requires phase transitions.
   - For skills, apply the skill steps directly to the user's current context.
