---
status: DRAFT - Requires Human Approval
anchor: fraim-hub-2-0-277-bug-report
job: fully-delegate
date: 2026-08-24
---

# Evidence: Report fraim-hub@2.0.277 packaging bug

## Executive Summary
Goal: file a bug report against the FRAIM GitHub repo for `fraim-hub@2.0.277`, which is broken because `dist/src/core/job-visualization.js` is missing from the published npm package while `dist/src/ai-hub/server.js` requires it.

Outcome: confirmed the defect independently (downloaded and inspected the actual npm tarballs for 2.0.277, 2.0.276, 2.0.270, 2.0.260, 2.0.250), identified the precise root cause (a `package.json` `files`-allowlist omission), and filed [FRAIM issue #1298](https://github.com/mathursrus/FRAIM/issues/1298).

Confidence: **medium**. One correction cycle occurred (see Risk Areas) - not a first-iteration pass, but no human escalation was needed.

## Delegation
No FRAIM catalog job matched a repo-code-change decomposition; the task was a single atomic external action. Candidate job `file-fraim-issue` was delegated via the ledger emitted in `create-delegation-graph`. The FRAIM Hub's own orchestration layer independently ran that job through a real child (`fraimworker`) rather than a manually spawned Agent-tool sub-agent, consistent with the `execute` phase's stated orchestration model and with a prior coaching moment (`avoid-duplicate-subagent-spawn-in-fully-delegate`) against spawning a duplicate.

## Sub-agent Work and Review

| Task | Job | Persona/Child | Verdict | Iteration | Artifact |
|---|---|---|---|---|---|
| file-fraim-hub-2-0-277-bug | file-fraim-issue | fraimworker | Corrected then approved by human override | 2 | [Issue #1298](https://github.com/mathursrus/FRAIM/issues/1298) |

**Iteration 1 (FAIL - targeted correction):** The child's draft correctly identified the missing file and matched MANdy's independent finding, but had three defects:
1. Presented a "Node throws: ..." terminal transcript and require-stack as if actually captured on this machine. MANdy verified fraim-hub is not installed locally, globally, or in the npx cache here, so the transcript could not have been a real captured run - it was a fabricated/illustrative block presented as fact.
2. Checked file presence across versions (absent in 2.0.276, 2.0.271, 2.0.277) but did not check whether the `require("../core/job-visualization")` call itself was present in those earlier versions, leaving the "is this a new regression" question unresolved.
3. Root cause given as a vague "build/packaging omission" rather than the specific mechanism.

MANdy independently verified: the require call is new to 2.0.277 (absent in 2.0.276, 2.0.270, 2.0.260, 2.0.250), and the mechanism is that `package.json`'s `files` array lists `dist/src/core/*.js` files individually rather than including the directory wholesale (unlike `dist/src/ai-hub/`), so the new file was silently dropped on publish. Coaching sent back to the child with these three specific corrections; filing was blocked pending revision.

**Iteration 2:** Before a revised child draft arrived, the human (manager) reviewed MANdy's coaching and instructed: "yes as is is fine" - approving proceeding without waiting for the re-drafted child submission. MANdy filed the issue directly using the verified content (real tarball-inspection repro steps, the confirmed-new-in-2.0.277 regression framing, and the files-allowlist root cause) rather than the child's unverifiable synthesized transcript, so the accuracy concern from iteration 1 did not reach the public tracker.

## Risk Areas
- **Filed content diverges from the child's literal draft.** The human approved "as is" in a context where MANdy had just flagged specific inaccuracies in that draft. MANdy resolved the ambiguity by filing accurate, previously-verified content covering the same substance rather than the child's fabricated transcript, on the reasoning that the human's intent was "stop iterating, ship it" rather than "publish the fabricated evidence verbatim." Human should confirm this reading was correct.
- **No repository code change was needed or made.** This job's deliverable is entirely external (a GitHub issue in FRAIM's own repo), so nothing in this repository was touched, no branch/worktree was provisioned, and no PR exists here to review.

## Human Approval Checklist
- [ ] Confirm the filed issue content ([#1298](https://github.com/mathursrus/FRAIM/issues/1298)) is what you intended by "yes as is is fine," given it differs from the child's literal draft in the ways described above.
- [ ] No other shared-state actions were taken; nothing further requires sign-off for this run.

## Job Catalog Gap Signal
No gap identified. `file-fraim-issue` fit this need exactly. A coaching moment was not filed for a catalog gap; the correction was about content accuracy in one child submission, not missing tooling.
