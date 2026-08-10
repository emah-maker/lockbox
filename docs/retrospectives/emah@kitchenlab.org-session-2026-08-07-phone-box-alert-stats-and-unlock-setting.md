---
author: emah@kitchenlab.org
date: 2026-08-07
job: fully-delegate
synthesized:
---

# Postmortem: Box Alert Bug, App Icon, Advanced Stats/Visuals, Call-Unlock Setting

**Date**: 2026-08-07
**Duration**: Single extended session, spanning multiple resumed turns
**Objective**: Fix the box's incoming-call alert not working, diagnose the missing app icon, add an Advanced Stats toggle with per-session topic logging and a focus-time breakdown, add more visuals across all tabs, and add a new opt-in "unlock when called" setting.
**Outcome**: Success, with one workstream requiring a manager takeover after two stalled delegated attempts. All three deliverables landed, verified, and pushed to `origin/master`.

## Executive Summary

Ran `fully-delegate` end to end: diagnosed the call-alert bug's real root cause (the box's run loop never woke the backlight for an incoming-call overlay) before delegating anything, split the request into three parallel workstreams, and reviewed each child deliverable by independently re-running typecheck/tests/syntax checks rather than trusting the child's own report. Two workstreams (call-alert fix + new unlock-on-call setting; app-icon diagnosis) passed cleanly. The third (Advanced Stats + visuals) stalled twice — once on an infrastructure failure, once on a delegated retry that made no progress and left an unexplained dependency change behind — and was finished by MANdy directly after the human said "do it yourself." A final pre-submit re-diff (done specifically because submission is a trust boundary, not because anything seemed wrong) caught that the already-approved firmware fix had grown further without a coaching message ever announcing it, and that the repository's `origin/master` had diverged with real work from the user's other (Mac/Xcode) machine. Both were independently verified and reconciled before pushing.

## Quick RCA Card

**What failed**: A delegated child workstream reported a config fix as done ("added the jest setupFiles entry") without re-running the test it was supposed to fix, so the fix was inert and the same failure persisted across two separate attempts.
**Impact**: Wasted a full delegation cycle before MANdy caught it during a direct takeover; the actual bug (a mock file that must be registered via `jest.mock()`, not just listed in `setupFiles`) was non-obvious enough that "the config looks right" felt like sufficient evidence to the child, but wasn't.
**What should have happened**: Any claimed "fixed a failing test" work item should be evidenced by a fresh full re-run of the previously-failing command, not by a diff of the config that plausibly should fix it.
**What changes next time**: Treat "identical error message after a claimed fix" as a strong signal the fix never took effect, and re-verify test/build claims by rerunning the exact command rather than accepting the diff as self-evident.
**Example**: `app/package.json`'s `jest.setupFiles` was pointed directly at `@react-native-async-storage/async-storage/jest/async-storage-mock` (a plain module export) across two delegated attempts; `trend.test.ts` failed identically both times because nothing ever called `jest.mock()`.

## Architectural Impact

**Has Architectural Impact**: No

## Timeline of Events

### Phase 1: listen / understand-delegation-path / create-delegation-graph
- [done] **Action**: Read the actual firmware and app code before asking the human anything, and found the call-alert bug's real root cause (backlight never woken by `notify_call`) directly, rather than delegating pure diagnosis work.
- [done] **Action**: Noticed `project_context.md` claimed "not a git repository" and that on-device session logging had been "removed" — both contradicted by the live repo state (a real GitHub remote existed; `lock_log.py`/`SessionLog` were very much alive) — trusted current code over stale memory rather than acting on the outdated claim.
- [done] **Action**: Split the request into three parallel, file-disjoint workstreams instead of one broad one, specifically to avoid the kind of cross-agent file-collision risk documented in a prior learning about interrupted/partial web-artifact work.
- [done] **Action**: Attempted to open a real GitHub tracking issue for the delegation anchor; found no working API access (no `gh` CLI, no token; a claude-flow/ruflo "create issue" call silently returned a local-store stub, not a real issue) and correctly did not present that stub as a real issue — fell back to a local branch-naming anchor instead of fabricating tracker integration.

### Phase 2: execute
- [done] **Action**: Reviewed each returned/failed child deliverable by re-running `tsc`, `jest`, and (for firmware) `py_compile` myself, and cross-checking the BLE wire contract line-by-line between the app and firmware, rather than accepting either child's own validation table at face value.
- [done] **Action**: Correctly classified a mid-response connection drop and a Claude safety-classifier false-positive as infrastructure failures, not content-quality failures — did not run a correction/coaching cycle against either, per the project's own prior-documented distinction between infra and quality failures.
- [missed] **Action**: When the second delegated retry of the stats workstream made no progress and introduced an unexplained `call-observer` package dependency, this was correctly flagged as suspicious in the moment — but it took a full extra turn (and a "VERIFY everything again" prompt) before connecting it to the possibility of an external cause; it was not resolved until the final submit-step re-diff and `git fetch` revealed the user's own separate Mac/Xcode machine had pushed real config work to the same GitHub remote.
- [done] **Action**: After two stalls on the same node, took the human's explicit "do it yourself" as authorization to implement directly rather than issuing a third delegated retry, and implemented the fix with the same rigor as reviewing a child's work (re-ran full typecheck/test suite, wrote a matching evidence file).
- [done] **Action**: While implementing the jest fix myself, found and corrected that the prior delegated attempt's fix was non-functional (see Quick RCA Card) — verified by actually re-running the previously-failing test, not by inspecting the config alone.

### Phase 3: document-learnings / submit
- [done] **Action**: Before compiling the synthesis evidence file, re-ran a full diff of the entire repository rather than assuming the last-reviewed state was still current — this is what caught the firmware's further uncoached growth (alert flash + hold-screen-awake) and the diverged `origin/master`.
- [done] **Action**: Named the missing evidence file for the app-icon node explicitly (diagnosis-only, no artifact) instead of silently omitting it from the synthesis document.
- [done] **Action**: Correctly followed the direct-default-branch submit rule (current branch was `master`) — did not stage, commit, or push during the `submit` phase itself; presented the evidence bundle and waited for an explicit approve-and-push decision.

### Phase 4: address-feedback
- [done] **Action**: On a bare "Approved." with no explicit push authorization, did not treat that as permission to push — asked the human directly whether to commit/push and whether to investigate the stray dependency first, since plain approval and an explicit "approve and push" are different actions with different blast radii on a repo with a real remote.
- [done] **Action**: On receiving explicit "yes commit all changes to github," reviewed the diff for secrets before staging, excluded an obviously-stray zero-byte untracked file from the commit rather than including it or silently deleting it, and used a real (not fabricated) multi-line commit message describing the actual heterogeneous change set.
- [done] **Action**: When `git push` was rejected (non-fast-forward), fetched and inspected the diverging remote commits before merging — confirmed they were genuine, benign work (Android/Expo config additions with a macOS-only `fsevents` dependency, clearly from the user's other machine) rather than blindly force-pushing or blindly merging without looking.
- [done] **Action**: Re-ran typecheck and the full test suite again after the merge, before pushing, rather than assuming a clean auto-merge was sufficient evidence.

## Root Cause Analysis

### 1. **Primary Cause**
**Problem**: A delegated child claimed a jest-config fix was complete without re-running the test it targeted.
**What drove it**: The failed fix pattern-matched on "the AsyncStorage package's docs mention this file for Jest integration" and "adding an entry to `setupFiles` is how Jest environment setup is wired" without checking what the referenced file actually does (a plain `module.exports`, not a self-installing mock) or confirming the fix against a fresh test run.
**Corpus conflict**: None found directly, though this is a close cousin of the already-documented `verify-delegated-web-artifacts-integrate` lesson ("presence of files/config is not evidence; a claim must be verified by loading/running it") — that lesson was about front-end integration specifically and hadn't yet been generalized to "test/config fixes must be evidenced by a fresh run of the previously-failing command."
**Impact**: One wasted delegation cycle; caught only because MANdy took the node over directly and re-ran the suite as a matter of course.

### 2. **Contributing Factors**
**Problem**: An unexplained file/dependency change (the `call-observer` package addition) sat unattributed for several turns before its real source was identified.
**What drove it**: The working directory is inside OneDrive and syncs with the user's other machine outside of git entirely; git-level investigation (diffing what a delegated sub-agent had touched) could not see that channel, so the natural first hypothesis (a sub-agent introduced it) was reasonable but incomplete until `git fetch` surfaced the actual diverged commits from that other machine.
**Impact**: A few turns of the change being flagged as an open risk in the evidence file rather than correctly attributed sooner; no actual harm, since it was independently verified as safe (typecheck clean) before either explanation was confirmed.

## What Went Wrong

1. **A delegated "fix" was accepted by the sub-agent as done without a fresh re-run of the specific failing test**, letting the same defect survive two attempts.
2. **The `call-observer` mystery took longer to resolve than necessary** because the OneDrive-sync + separate-machine possibility wasn't considered until the git push itself forced a `git fetch`.
3. **No real GitHub issue could be opened** for the delegation anchor (no `gh` CLI, no API token) — worked around by using a local branch-name anchor and being explicit about the gap, rather than fabricating a tracker integration.

## What Went Right

1. **Root-cause diagnosis before delegating**: reading the actual firmware run loop first (not just the bug report) found the real defect (backlight never woken) and let every downstream task brief be concrete instead of speculative.
2. **Never accepted a child's own validation table as sufficient**: every "pass" in this run was backed by MANdy independently re-running `tsc`, `jest`, `py_compile`, or a manual line-by-line contract diff — including two full re-verification passes at the human's request that found no regressions, and one unprompted pre-submit re-diff that did find something.
3. **Correct infra-vs-quality failure classification**: a connection drop and a safety-classifier false positive were both logged and retried/accepted as infrastructure noise rather than triggering an unnecessary correction-coaching cycle against content that was actually fine.
4. **Escalated and adapted after a bounded number of stalls**: after two non-productive delegated attempts on the same node, accepted the human's direction to take it over directly rather than issuing a third blind retry, and matched the takeover's rigor to a normal review (evidence file, full re-verification) rather than treating self-implementation as exempt from the same bar.
5. **Careful, non-destructive git handling under real divergence**: investigated a rejected push instead of force-pushing, correctly identified genuine unrelated remote work, merged cleanly, and re-verified before pushing.

## What I Almost Did Wrong But Caught

1. **Almost treated a bare "Approved." as authorization to push**: caught that plain approval and an explicit "approve and push" are different actions in the review-handoff contract this job uses, and asked the human directly which was meant, rather than assuming the more consequential action was implied.
2. **Almost let the `call-observer` addition go without further scrutiny once it stopped seeming to matter functionally** (typecheck stayed clean): kept it flagged as an open risk in every subsequent evidence update rather than quietly dropping it once it stopped being an active blocker, which is what ultimately kept it visible enough to get resolved at the git-push step.

## Where Past Learnings Actually Fired

1. **Pattern**: `verify-delegated-web-artifacts-integrate` (a prior learning: presence of files is not evidence a multi-file deliverable is actually integrated/correct) — fired repeatedly this run: every child deliverable, including the ones that reported success, was independently re-verified (typecheck, full test suite, manual cross-file contract diff) rather than accepted on the strength of an evidence file's own claims. This is also what caught the non-functional jest-mock fix and the uncoached firmware growth before submission.
2. **Pattern**: `match-tool-weight-to-task-size` (a prior learning: do the minimal correct action, don't reach for heavyweight machinery a task doesn't need) — fired when, after two delegation stalls on a single, now well-understood, narrowly-scoped remaining task (one config fix + one screen's UI), MANdy implemented it directly with plain Edit/Write/Bash tools rather than spinning up a third delegated agent run for a task that no longer needed that weight.

## Lessons Learned

1. **A claimed test/config fix is not verified until the specific previously-failing command has been re-run and shown to pass** — a plausible-looking diff is not evidence.
2. **An unexplained file change in a synced working directory may come from outside git entirely** (a cloud-synced folder shared with another machine) — when a change can't be attributed to any known agent action, consider that possibility explicitly rather than only auditing git/agent history.
3. **Plain approval and an explicit "approve and push"/"approve and merge" are different authorizations** and should be treated as such even when a human's phrasing is casual ("Approved.") — ask rather than infer the more consequential action.
4. **A rejected non-fast-forward push is a signal to investigate, not to force**: fetching and reading the diverging commits before merging turned what could have been a scary conflict into a clean, well-understood merge.

## Agent Rule Updates Made to avoid recurrence

1. **None proposed as durable rule changes from this single run**, per this job's own guardrail against promoting a per-incident coaching moment directly into a rule; the jest-mock-verification gap was captured as a standalone coaching moment (`fraim/personalized-employee/learnings/raw/emah@kitchenlab.org-2026-08-07T17-30-00-jest-mock-file-needs-registration.md`) for `sleep-on-learnings` to evaluate in aggregate.

## Enforcement Updates Made to avoid recurrence

1. **None made this run.** If "claimed test fix not re-verified by an actual re-run" recurs in a future run, it's a concrete candidate for an explicit evidence requirement in `delegated-job-review-mapping`'s feature-implementation dimension (see the coaching moment's own hardening suggestion).
