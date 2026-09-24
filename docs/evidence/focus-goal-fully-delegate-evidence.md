# DRAFT - Requires Human Approval

# Fully-Delegate: Configurable Focus Goal

**Anchor**: conversational mode, no issue tracker configured for this task (`fraim/config.json`
sets `"mode": "conversational"`; no `gh` CLI / GitHub API access available in this environment).
**Date**: 2026-08-10

## Executive Summary

**Goal**: Add a user-configurable, recurring focus goal to the Phone Box companion app (metric type
and target chosen by the user, not hardcoded), with live progress shown on the dashboard.

**Outcome**: Success. The feature is fully implemented, independently re-verified, and ready for
human review. **Confidence: medium**, not because of any defect in the delivered code (which is
clean on every check performed), but because of an unusual delegation anomaly documented below that
the human should be aware of.

**What was built**:
- `app/src/stats/focusGoal.ts` + `focusGoal.test.ts`: pure helper computing progress toward a
  goal (`metric: 'time' | 'sessions'`, `period: 'day' | 'week'`, numeric `target`) from the existing
  local session log.
- `app/src/store/useSettingsStore.ts`: local-only `focusGoal` field + `setFocusGoal` action.
- `app/src/screens/FocusGoalSection.tsx`: new Settings UI (metric/period chips, numeric target
  input, Set/Update/Clear), wired into `SettingsScreen.tsx`.
- `app/src/screens/DashboardScreen.tsx`: live progress bar/caption in the existing Focus card,
  rendered only when a goal is configured.
- **Known limitation, by design**: the goal setting is local-only for this iteration. It is not
  added to the Firestore settings sync allowlist, so it does not currently follow the user to
  another device. This was a hard constraint I set in the delegation brief, because the Firestore
  sync files were being actively rewritten by an unrelated concurrent process for the duration of
  this job (see Risk Areas). Adding sync support is natural follow-up work once that lands.

## Delegation Ledger

Single-node graph (one workstream, no dependencies):

| Task ID | Job | Persona | Depends On | Status |
|---|---|---|---|---|
| `focus-goal-feature` | `feature-implementation` | `mobile-dev` | none | Verified-complete (see Attribution Anomaly) |

## Attribution Anomaly (read before anything else)

The sub-agent I spawned for this task (named `mobile-dev`) **made zero Edit/Write calls**. Twice,
before writing anything, it re-checked `git status` on its assigned files and found that this exact
feature (down to near-identical design rationale and phrasing, e.g. the "local-only, excluded from
the sync allowlist" reasoning) was already mid-implementation by another live process in this same
working directory. Both times it correctly stood down rather than racing or merging against a
moving target, and reported back for a decision. I instructed it to stand down permanently on the
second occurrence.

The actual deliverable -- `docs/evidence/focus-goal-feature-implementation-evidence.md` and the code
it describes -- was produced by that other, unidentified process, not by my named sub-agent. Given
how closely its reasoning and file choices mirror what I would have briefed (including citing the
same project retrospectives I had already read), the most likely explanation is that this manager
session was resumed once already earlier in this conversation (an interrupted background research
task from before the resume was reported back as "stopped" rather than "completed"), and an earlier,
now-orphaned instance of this same fully-delegate run had already gotten as far as briefing and
spawning its own implementation agent before the interruption -- which then kept running
independently, unaware the manager session restarted. I cannot fully confirm this, but functionally
it does not matter: I did not accept the deliverable on trust. I independently re-read all the code
and re-ran every verification command myself before recording a verdict (see the Manager Verdict
section I appended directly to `docs/evidence/focus-goal-feature-implementation-evidence.md`).

**This is the second run in a row on this project where an unidentified concurrent process was found
live-editing the same working directory during a `fully-delegate` run** (see
`docs/retrospectives/session-2026-08-10-custom-focus-labels.md` for the first).
This time the concurrency was broader: in addition to the Firestore sync-merge refactor already
known about, a `SettingsScreen.tsx` component-extraction refactor, a full lock-duration-picker
feature (app + firmware), and website dashboard files were all in flux in the same working directory
at various points. Recommend treating this as a standing environment risk worth the human's direct
attention (see Human Approval Checklist), independent of this feature's own quality.

## Review Verdict (recorded on the sub-agent's own review surface)

Full verdict, independent re-verification steps, and re-run command output are recorded directly in
`docs/evidence/focus-goal-feature-implementation-evidence.md` under "Manager Verdict (fully-delegate,
MANdy)", per this job's "review where the work is" principle. Summary: **ACCEPTED**, first iteration,
no correction cycle needed.

Independent commands I re-ran myself (not paraphrased from any child's report):
```
cd app && npx tsc --noEmit         -> clean, 0 errors
cd app && npx jest                 -> 9 suites passed, 66 tests passed, 0 failed
cd app && npx jest src/stats/focusGoal.test.ts  -> 6/6 passed
```

## Risk Areas

1. **Working-tree concurrency during this run** (see Attribution Anomaly above). No data was lost
   and no file collision occurred -- every process involved, including my own sub-agent, checked
   before writing and yielded rather than overwrote. But this happened by discipline, not by
   structural protection (conversational mode provisions no per-agent worktree isolation). Worth a
   direct conversation with the human about whether multiple Claude Code sessions are intentionally
   running against this same OneDrive-synced folder, and if so, whether worktree isolation should
   become the default for this project's `fully-delegate` runs.
2. **No on-device/simulator UI walkthrough was performed** for the new Settings screen or Dashboard
   progress bar -- flagged explicitly in the feature evidence file as a real gap (no Expo dev-client
   or simulator available in this execution environment), not a silent skip. The manual code
   read-through in that file's Bug Bash Findings section substitutes but does not replace an actual
   on-screen check.
3. **Local-only persistence is a real product limitation**, not just an implementation shortcut: a
   user who sets a goal on one device and later signs in on another will not see it. This is
   surfaced in the UI only implicitly (no in-app messaging that goals don't sync) -- worth a decision
   from the human on whether that needs a visible caveat in the Settings UI before shipping, or
   whether it's acceptable to fix silently once sync support is added.

## Human Approval Checklist

- [ ] **Approve or reject the feature as implemented** (files listed under "What was built" above).
      No commit, branch, or push has been made -- this is conversational mode, so everything is
      sitting in the working tree pending your review.
- [ ] **Decide whether to add a "goals don't sync across devices yet" caveat to the Settings UI**,
      or accept the silent limitation until sync support is added later (Risk Area 3).
- [ ] **Decide how to handle the concurrency risk** (Risk Area 1): is another Claude Code session
      expected to be running against this same folder right now, and should future `fully-delegate`
      runs on this project default to worktree isolation to prevent silent collision risk
      structurally rather than relying on each agent's own discipline?
- [ ] **If approved**: confirm whether you want me to stage and commit these changes now, and if so,
      whether to exclude the concurrent lock-duration/sync-merge/website changes from the same commit
      or bundle them (they are unrelated features that happened to land in the same working tree at
      the same time).

## Sub-Agent Evidence Links

- `docs/evidence/focus-goal-feature-implementation-evidence.md` (implementation evidence + my
  appended Manager Verdict)
