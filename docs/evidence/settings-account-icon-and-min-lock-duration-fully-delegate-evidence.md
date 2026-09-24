# DRAFT - Requires Human Approval

# Fully-Delegate: Settings Account Icon + Minimum Lock Duration

**Anchor**: conversational mode, no issue tracker configured for this task (`fraim/config.json`
sets `"mode": "conversational"`, no `repository` key). No branch, no commit, no PR -- all changes
sit in the working tree pending review.
**Date**: 2026-08-24

## Executive Summary

**Goal**: two independent Phone Box companion-app/firmware changes, delegated together: (1) move
Settings' always-visible Account section behind a tappable account icon opened in a modal, and
(2) prevent the lock timer from being settable to 0 minutes, on both the app's home screen and the
box firmware.

**Outcome**: Both delivered and independently re-verified. **Confidence: medium** -- one workstream
passed on first review with no changes needed; the other required a correction that, after two
coaching rounds did not land, the human explicitly instructed MANdy to apply directly rather than
continue delegating. See Risk Areas.

**What was built**:
- `app/src/screens/SettingsScreen.tsx`: header account icon (`person-circle-outline` signed out,
  `person-circle` in accent color signed in) opening a new `AccountModal` bottom sheet containing
  the existing `AccountSection` content, replacing the previously always-visible inline section.
- `firmware/lib/lock_config.py`: new `MIN_SECONDS = MIN_STEP * 60` (5-minute floor) constant.
- `firmware/lib/lock_controller.py`: `adjust()` and the BLE `"start"`/`"dur"` handlers now floor
  at `MIN_SECONDS` instead of `0`.
- `app/src/stats/stats.ts`: new `MIN_LOCK_SECONDS` export; `clampLockSeconds` floors at it.
- `app/src/screens/DashboardScreen.tsx`: the duration wheels can no longer land on 0h00m.
- `app/src/ui/WheelPicker.tsx`: resync effect fix required to make the above actually work visually
  (see Risk Areas -- this file was not in the original delegation brief).
- `app/src/stats/stats.test.ts`: updated/added floor assertions.

## Delegation Ledger

Two-node graph, single parallel layer (no dependency between them -- disjoint files):

| Task ID | Job | Persona | Depends On | Status |
|---|---|---|---|---|
| `account-icon-settings-reorg` | `feature-implementation` | `coder` | none | Verified-complete, iteration 1 |
| `min-lock-duration-enforcement` | `feature-implementation` | `coder` | none | Verified-complete, iteration 2 (manager-applied) |

## Missing Evidence

Neither sub-agent wrote its own `docs/evidence/*-feature-implementation-evidence.md` file -- both
reported their deliverables inline in chat only. This deviates from `feature-implementation`'s own
expected artifact contract and from this codebase's own convention (compare e.g.
`focus-goal-feature-implementation-evidence.md`). Recorded here rather than silently omitted, per
this phase's own instruction. All review verdicts below are therefore recorded directly in this
file instead of linked from a child evidence file.

## Review Verdicts (recorded here; no child evidence file or PR existed to record them on)

### `account-icon-settings-reorg` -- iteration 1, PASS

Verified by reading the full diff (not the child's summary alone) plus a regression sweep:
- `AccountModal` is a near-exact structural match to this app's one existing sheet-modal
  precedent, `CalendarScreen.tsx`'s `LabelPickerModal` (same `overlay.scrim`/`elevation.card`/
  `springs.default` tokens, same animation lifecycle, same `useReducedMotion` gating) -- correctly
  reused rather than forked.
- One deliberate deviation from that precedent (sheet background `color.bg` instead of
  `color.surface`) checked against `SettingsPrimitives.tsx`'s `Section` component and confirmed
  correct: it preserves the nested `AccountSection`'s own card as a visually distinct surface.
- `AccountSection`'s prop signature unchanged; no new dependencies added.
- `cd app && npx tsc --noEmit` -> clean.
- `cd app && npx jest` -> 12 suites / 115 tests passing.

### `min-lock-duration-enforcement` -- iteration 1, FAIL; iteration 2, PASS (manager-applied)

**Iteration 1** (child's own report claimed complete): 4 of 5 changed files were correct
(`lock_config.py`, all three `lock_controller.py` MIN_SECONDS hunks, `stats.ts`, `stats.test.ts`,
cleanly separated from an unrelated pre-existing screen-flip diff in `lock_controller.py` the child
correctly flagged as not its own). One real bug found by independently reading the diff:
`DashboardScreen.tsx`'s `onMinutesIndexChange` rejected an invalid 0h00m selection by returning the
exact same object reference from a `useState` updater, which makes React bail the re-render
entirely -- so the wheel would silently stay wherever the user's drag physically left it (visually
0) instead of snapping back as claimed. Coaching sent: return a new object reference on rejection.

**Iteration 2** (after a second round reported the fix "still not landing," the human instructed
MANdy to stop the coaching loop and apply the fix directly): re-deriving the bug from scratch found
the iteration-1 coaching was necessary but not sufficient. `WheelPicker.tsx`'s own resync
`useEffect` was gated on a `[selectedIndex]` dependency array. Even with a genuine parent
re-render, React only re-runs an effect when a *listed dependency's value* changes between renders
-- and in the reject case the value is deliberately unchanged, so the effect would still never
fire even after fixing the reference-equality issue in `DashboardScreen.tsx`. Fixed both files:
`DashboardScreen.tsx` returns `{ ...p }` on rejection (so the parent genuinely re-renders), and
`WheelPicker.tsx`'s resync effect now has no dependency array (runs after every render, guarded by
its own cheap internal ref-equality check) so it actually executes and corrects the wheel position
even when the prop's value didn't change.

Verified: `cd app && npx tsc --noEmit` -> clean. `cd app && npx jest` -> 12 suites / 115 tests
passing. **Caveat**: this is a code-level trace of the render/effect sequence, not an on-device or
simulator observation of the actual gesture -- no Expo dev-client/simulator was available in this
Hub session. The firmware side of this workstream (`lock_config.py`/`lock_controller.py`) also
remains unverified on physical hardware, per project convention (CircuitPython has no host runtime).

## Risk Areas

1. **`min-lock-duration-enforcement` required a manager-applied correction, not a clean child
   delegation.** Two coaching rounds on the same sub-agent did not resolve the `WheelPicker.tsx`
   issue; the human directed MANdy to fix it directly rather than continue the bounded-escalation
   loop. The human should scrutinize the `WheelPicker.tsx` change specifically (it was outside the
   original delegation brief's file list) and, if desired, decide whether the underlying child
   agent/job needs different instructions for this class of React effect-dependency bug going
   forward. A coaching-moment file was written for `sleep-on-learnings` to evaluate:
   `fraim/personalized-employee/learnings/raw/2026-08-24T01-00-00-verify-hook-resync-not-just-rerender.md`.
2. **No on-device/simulator UI walkthrough was performed** for either the new account-icon modal or
   the duration-wheel reject behavior -- no Expo dev-client/simulator was available in this
   execution environment. All verification is `tsc`/`jest`/code-trace only.
3. **Firmware changes are unverified on physical hardware**, per this project's standing
   convention (CircuitPython has no host runtime) -- `lock_config.py`/`lock_controller.py` changes
   need an on-device check before being considered fully proven.
4. **Neither sub-agent produced its own evidence file** (see Missing Evidence above) -- if this
   project wants per-child evidence files as a hard requirement going forward, the `coder` persona
   briefing should say so explicitly next time.

## Human Approval Checklist

- [ ] **Approve or reject both features as implemented** (files listed under "What was built").
      Nothing has been committed or pushed -- conversational mode, everything sits in the working
      tree pending your review.
- [ ] **Decide whether an on-device/simulator pass is required before considering this done**, given
      neither the app UI changes nor the firmware changes have been observed running (Risk Areas 2-3).
- [ ] **Review the `WheelPicker.tsx` change specifically** (Risk Area 1) since it was a manager-applied
      fix outside the original delegation brief, not a reviewed child deliverable.
- [ ] **If approved**: confirm whether you want these changes staged/committed now, and whether the
      two workstreams (Settings UI, min-lock-duration) should be one commit or two.
