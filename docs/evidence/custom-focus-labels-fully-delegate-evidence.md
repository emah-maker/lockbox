# Evidence — Custom Focus Labels + Retroactive Session Tagging (fully-delegate)

**Issue:** custom-focus-labels (local anchor — conversational mode, no issue-tracker/repository configured for this task)
**Job:** fully-delegate (manager)
**Date:** 2026-08-10
**Status:** DRAFT — Requires Human Approval

## Summary

Delivered the requested feature: users can now create their own focus labels (coexisting
with the 6 existing built-in topics), picking the color themselves at creation time, and can
retroactively tag or retag any past session from the Calendar day-list, not just a session
that is currently running. Scope was app-only (`app/src`); no firmware changes. Confidence:
**medium** — the deliverable itself passed independent verification on first inspection, but
it did not arrive through a clean single-agent delegation: a second, unrelated `claude`
process was found live-editing the same files mid-run (see Risk Areas), and the manager's own
spawned sub-agent produced zero artifacts as a result.

## Work Completed

| Task | Persona | Job | Iterations | Verdict |
|------|---------|-----|-----------|---------|
| custom-focus-labels-implementation | mobile-dev (nominal) | feature-implementation | 1 | pass |

Single task, no dependency layer.

### Deliverables
- `app/src/stats/customLabels.ts` (new) — `CustomLabel` type, `LABEL_SWATCHES`, `resolveTopic`, `allLabelChoices`, `topicBreakdownWithCustom`, `dominantTopicWithCustom`
- `app/src/stats/customLabels.test.ts` (new)
- `app/src/stats/sessionHistory.test.ts` (new)
- `app/src/stats/topics.ts` — extracted `readableTextColor()` for reuse by customLabels.ts; built-ins otherwise untouched
- `app/src/stats/sessionHistory.ts` — `applyTopicUpdate()` / `retagSession()` for editing a past session's topic in place
- `app/src/store/useSettingsStore.ts` — `customLabels` joined `SyncableSettings`; `addCustomLabel`/`renameCustomLabel`/`removeCustomLabel` actions
- `app/src/store/useStore.ts` — `retagSession` action wired to the sessionHistory helper
- `app/src/sync/firestoreSync.ts`, `app/src/sync/settingsSyncBridge.ts` — `customLabels` carried through the existing last-write-wins settings sync
- `app/src/screens/CalendarScreen.tsx` — per-session topic row is now tappable, opens a `LabelPickerModal` (built-ins + custom labels + "Clear tag")
- `app/src/screens/DashboardScreen.tsx` — live-tagging chips widened to `allLabelChoices()` instead of the fixed 6
- `app/src/screens/SettingsScreen.tsx` — new "Custom labels" section: add (name + 12-swatch color picker), rename, delete (with a confirmation dialog explaining orphaned past sessions)
- `app/src/screens/StatsScreen.tsx` — topic breakdown widened to `topicBreakdownWithCustom()`

### Missing Evidence
- **No sub-agent evidence file exists** for this task. The manager's own spawned sub-agent
  (named `mobile-dev` in the delegation ledger) produced no artifacts — it correctly detected a
  file-write collision on its very first `Edit` call and paused without writing anything. The
  actual deliverable above was produced by a second, independent `claude` process discovered
  live-editing the same files, whose identity and originating request this manager could not
  fully establish (see Risk Areas). There is therefore no linkable per-sub-agent evidence
  document; this manager evidence file and the working-tree diff are the only record.

## Key Findings

- **Design**: custom labels are stored as a separate `CustomLabel[]` catalog (not merged into
  `topics.ts`'s fixed table), referenced from `LoggedSession.topic` by a `custom:`-prefixed id
  so it can never collide with a built-in `TopicKey` string. `resolveTopic()` is the single
  place that decides whether a stored topic string is a built-in, a live custom label, or an
  orphaned reference to a deleted one.
- **Retroactive tagging** matches a session by its `(startedAt, plannedS, actualS)` identity,
  which is safe because `sessionHistory.ts`'s existing ingest-time dedup already guarantees
  `(startedAt, plannedS)` is unique per stored session.
- **Sync**: the custom-label catalog rides the existing `SyncableSettings` last-write-wins
  channel used for theme/accent/toggles — no new sync mechanism was introduced.
- **Color**: fully user-picked (12-swatch grid in Settings), no auto-assignment, per the
  human's explicit direction.

## Validation

- `npx jest` (run independently by the manager, in `app/`) — 7/7 suites, 52/52 tests passing.
  Matches the number self-reported by the deliverable; not taken on faith.
- `npx tsc --noEmit` (run independently by the manager, in `app/`) — clean.
- Full `git diff` of every touched file read line-by-line by the manager against the two
  stated requirements (coexistence, user-picked color) and the retroactive-tagging UX; no
  discrepancies found between the self-reported summary and the actual diff.
- **Not validated**: no RN simulator/device was available in this session, so none of the new
  UI (Settings label management, the Calendar retag modal, the widened Dashboard chips) has
  been visually exercised. This is a host-side-only verification pass (types, unit tests,
  manual diff reading), stated plainly per project rules.

## Risk Areas (nodes that needed more than one pass)

**custom-focus-labels-implementation** did not fail its review, but it did not arrive through
a normal single-sub-agent execution:

1. The manager spawned one sub-agent (`mobile-dev`) via the Agent tool to run
   `feature-implementation` on this task. Before that agent's first edit landed, a second,
   independent `claude` process was discovered actively writing to the exact same files
   (`topics.ts`, `sessionHistory.ts`, `useSettingsStore.ts`, plus a new `customLabels.ts`) in
   this same working directory. Process-list inspection showed it running under a different
   PID with its own MCP subprocess tree, started roughly 90 seconds before the manager's own
   sub-agent was spawned.
2. The manager's sub-agent correctly stopped itself at the first sign of collision (an `Edit`
   tool rejection: "File has been modified since read") and made no writes of its own — this
   worked as intended and prevented a corrupted merge of two designs.
3. The manager escalated the ambiguity to the human twice before proceeding, since it could not
   determine on its own whether the second process was a legitimate parallel session
   (e.g. another window of the human's own) or something else. The human's follow-up message
   supplied a "deliverable" summary attributed to `mobile-dev` that, on inspection, actually
   described the second process's work, not the manager's own sub-agent's (which had produced
   nothing). The manager did not accept that attribution at face value: it independently
   re-verified the actual working-tree diff, re-ran the test suite, and re-ran the typechecker
   itself before treating the deliverable as trustworthy, rather than relying solely on the
   pasted summary.
4. By the time of final verification, the second process had exited on its own and no further
   concurrent writes were observed.

**What the human should scrutinize**: the true origin of the second `claude` process is still
not confirmed by this manager — only inferred from process metadata and the fact that its
output matches the requested feature well. If that process was not something the human
intentionally started (e.g. a background daemon, an automated worker, or another window they
forgot about), its ability to write unsupervised into this working tree is worth investigating
independently of whether this particular output happens to be correct.

## Human Approval Checklist
1. Approve committing this batch of changes — nothing has been committed or pushed; changes
   are live in the working tree on `master` (conversational mode: no branch/PR was created for
   this task).
2. Confirm the identity of the second `claude` process that produced the actual code (see Risk
   Areas) — was this a session you started intentionally? If not, investigate before treating
   unsupervised concurrent writers to this project folder as routine.
3. Plan a manual smoke test on a dev-client build/simulator before treating the UI (Settings
   label create/rename/delete, Calendar retag modal, Dashboard chips) as ship-ready — nothing
   visual has been exercised in this session.
4. Decide whether the cross-device retag-sync gap (retagging a past session updates local state
   everywhere but is not re-pushed to Firestore, unlike the label catalog itself, which does
   sync) needs to be closed now or tracked as a follow-up.
5. Confirm the orphaned-label-on-delete behavior (a deleted custom label's past sessions render
   as untagged rather than being reattributed or blocked) matches your expectations.
