# FRAIM

Follow this process:

0. **Preload deferred FRAIM tools when needed**:
   - If FRAIM MCP tools are unavailable because this host lazily loads deferred tool schemas, call `ToolSearch` once to load `fraim_connect`, `list_fraim_jobs`, `get_fraim_job`, `get_fraim_file`, `seekMentoring`.
   - Do the preload as one batched discovery step, not one search per tool.

1. **Confirm FRAIM activation**:
   Use this process only when the user explicitly invokes FRAIM, names a FRAIM job, asks what FRAIM job to run, or the active surface has already selected a FRAIM job. For ordinary requests, answer or work normally; do not scan FRAIM stubs first.

2. **Reach for graphify before Glob/Grep whenever you need project context**:
   Once FRAIM is active, this applies at every later step below that needs to understand how a part of this project works, what touches what, or what was already decided - matching a request to a job (step 3), the "no job matches, continue with normal tools" fallback in step 4, and executing a job or skill (step 6). Before defaulting to Glob/Grep or reading files one by one, check whether `graphify-out/graph.json` exists and query it first: `graphify query "<question>"` for broad context, `graphify path "<A>" "<B>"` for how two things relate, `graphify explain "<concept>"` for an unfamiliar module. This applies even when the user names specific files to look at - the graph often surfaces what else touches those files, which a targeted Read/Grep on just the named files would miss. `fraim/personalized-employee/rules/project_rules.md` has the full rule (staleness verification, citing `source_location`, refreshing with `--update`); read it once rather than restating its detail here.

3. **If the user did not specify a FRAIM job or topic after activation**:
   If local FRAIM job stubs are present in the workspace, inspect those first and match the request locally. Also inspect `fraim/personalized-employee/jobs/` for local overrides or repo-specific jobs. If local files are missing or you cannot inspect workspace files, call `list_fraim_jobs()` to view the full catalog, including any proxy-discoverable personalized jobs.

4. **Find the match**:
   If the user names an exact FRAIM job, call `get_fraim_job({ job: "<job-name>" })` directly. Otherwise, match the user's request to a FRAIM job from the local stub catalog, `fraim/personalized-employee/jobs/`, or the full `list_fraim_jobs()` response. If no exact or high-confidence job match exists: apply step 2 first if the request is itself a project-context question (not just a job-catalog lookup), then say that no FRAIM job matches and continue with normal tools or ask one concise clarification. Do not pick the nearest catalog job.

5. **Load the full content**:
   - For jobs, call `get_fraim_job({ job: "<matched-job-name>" })`.
   - For skills, use the content returned by `get_fraim_file(...)`.

6. **Execute**:
   - For jobs, follow the phased instructions and use `seekMentoring` when the job requires phase transitions.
   - For skills, apply the skill steps directly to the user's current context.
