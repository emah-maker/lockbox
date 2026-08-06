<!-- FRAIM_AGENT_ADAPTER_START -->
## FRAIM

This repository uses FRAIM.

- The FRAIM discovery catalog lives under `fraim/`.
- Jobs under `fraim/ai-employee/jobs/` and `fraim/ai-manager/jobs/` are FRAIM's primary execution units. Treat them like first-class workflows when deciding how to execute work.
- Skills under `fraim/ai-employee/skills/` are reusable capabilities that jobs compose.
- Rules under `fraim/ai-employee/rules/` are always-on constraints and conventions.
- Repo-specific overrides and learning artifacts live under `fraim/personalized-employee/` and take precedence over synced baseline content.
- Use FRAIM when the user explicitly invokes FRAIM, names a FRAIM job, asks what FRAIM job to run, or the active surface has already selected a FRAIM job.
- For ordinary requests, answer or work normally. Do not scan FRAIM stubs first.
- If the user names an exact FRAIM job, call `get_fraim_job({ job: "<job-name>" })` directly.
- When FRAIM routing is active but the job is not exact, scan the job stubs under `fraim/ai-employee/jobs/` and `fraim/ai-manager/jobs/` to identify the most appropriate job. Read stub filenames and their Intent/Outcome sections before using catalog tools.
- Once you identify the relevant job, call `get_fraim_job({ job: "<job-name>" })` to get the full phased instructions.
- If no exact or high-confidence job match exists, say that no FRAIM job matches and continue with normal tools or ask one concise clarification.
- For deeper capability detail, call `get_fraim_file({ path: "skills/<category>/<skill-name>.md" })` or `get_fraim_file({ path: "rules/<category>/<rule-name>.md" })`.
- Read `fraim/personalized-employee/rules/project_rules.md` if it exists before doing work.
- When users ask for next step recommendations, use recommend-next-job skill under `fraim/ai-employee/skills/` to gather context before suggesting jobs.

> [!IMPORTANT]
> **Job stubs are for discovery only.** When a user mentions or references any file under `fraim/ai-employee/jobs/` or `fraim/ai-manager/jobs/`, do NOT attempt to execute the job from the stub content. The stub only shows intent and phase names. Always call `get_fraim_job({ job: "<job-name>" })` first to get the full phased instructions before doing any work.
<!-- FRAIM_AGENT_ADAPTER_END -->
