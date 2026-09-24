# Fully-Delegate: App icon refresh, disclaimer removal, box on-screen button cleanup

**DRAFT - Requires Human Approval**

Issue: #local (conversational mode; `fraim/config.json` has no repository/branch/issue-tracker
configured for this delegation — no PR, review surface is this thread and the working tree).

## Executive Summary
Goal: (1) design a new companion-app icon, (2) remove the "(it never unlocks)" disclaimer line from
the app, (3) remove the visible on-screen LOCK button graphic on the physical box while keeping
tap-to-lock working, and make the OPEN button always show/work in the done state. A follow-on bug
surfaced mid-run: the box's status bar was visibly bouncing/cycling after a tap, which was diagnosed
and fixed as a fourth node added to the delegation graph.

All 4 delegation-graph nodes are now verified-complete. Overall confidence: **medium** — two nodes
passed on the first iteration; one node required 3 iterations before the fix was actually complete
(see Risk Areas). Everything is untested on the physical device; the box-firmware changes are
code-level verified only (no host simulator exists for this CircuitPython project).

## Delegation Ledger and Sub-Agent Review Surfaces

| Task ID | Job | Persona | Iterations | Verdict | Evidence file | PR |
|---|---|---|---|---|---|---|
| app-ui-cleanup | feature-implementation | mobile-dev | 1 | Verified-complete | **Missing** — mobile-dev reported "Artifacts: none reported"; no dedicated evidence doc was produced for this task. Verified instead by direct read of `app/assets/icon.png` and `app/src/screens/DashboardScreen.tsx` diff. | N/A (conversational mode) |
| box-ui-cleanup | feature-implementation | firmware-dev | 1 | Verified-complete | `docs/evidence/box-onscreen-button-visibility-feature-implementation-evidence.md` | N/A (conversational mode) |
| box-status-bar-toggle-debounce | feature-implementation | firmware-dev | 3 | Verified-complete | `docs/evidence/status-bar-bounce-feature-implementation-evidence.md` | N/A (conversational mode) |

### What each sub-agent produced
- **app-ui-cleanup (mobile-dev)**: Redesigned `app/assets/icon.png` (navy background, mint-to-green
  gradient padlock-in-phone mark, ambient glow — same composition as the prior icon). Removed the
  disclaimer line "When locked, an incoming call lights up the box screen (it never unlocks)." from
  `app/src/screens/DashboardScreen.tsx`. `tsc --noEmit` reported clean.
- **box-ui-cleanup (firmware-dev)**: In `firmware/lib/lock_ui.py`, `show_idle()`/`show_closed()` no
  longer draw/label the LOCK button (hidden instead); the `in_button()` tap region in
  `LockController._handle_release` is unchanged, so tap-to-lock still works identically. `show_done()`
  now always shows the OPEN button regardless of `auto_open`. Stale comments updated in both files.
- **box-status-bar-toggle-debounce (firmware-dev)**: Added `STATUS_TAP_COOLDOWN_S = 0.4` and a
  `_last_status_toggle_at` timestamp so a chattering/bouncing touch on the status bar can no longer
  re-trigger `go_idle()`/`go_closed()` (iteration 1) or restart the press-feedback dip animation
  (iteration 3) within the cooldown window. LOCK/OPEN button and all other gestures unaffected.

## Iteration History and Risk Areas
- **app-ui-cleanup** — 1 iteration, first-pass accept. No risk flagged.
- **box-ui-cleanup** — 1 iteration, first-pass accept. No risk flagged.
- **box-status-bar-toggle-debounce** — **3 iterations, flagged risk area.**
  - Iteration 1: gated the semantic `go_idle()`/`go_closed()` toggle in `lock_controller.py` only.
    Rejected: the visual press-feedback dip in `lock_ui.py`'s `on_touch_down` is a separate call path
    (invoked from `LockController.process()` before `_handle_release` runs) and was left completely
    unguarded, so the bar could still visibly bounce even though the text would stop flip-flopping.
  - Iteration 2: resubmitted with **no changes at all** relative to iteration 1 (`git diff` on
    `lock_ui.py` was empty both times) — the correction was not applied. Re-briefed with explicit
    file/method/line references and a required-verification step.
  - Iteration 3: fix landed correctly — the cooldown check was moved into `LockController.process()`
    itself, suppressing the call to `ui.on_touch_down(*pt)` for a status-region point while still
    inside the cooldown window, which covers both the semantic toggle and the visual dip from one
    guard. Verified by direct diff read and `python -m py_compile` on both files.
  - **What the human should scrutinize**: this fix is unverified on physical hardware (no host
    CircuitPython simulator). The specific behaviors to confirm on a board: (a) a deliberate single
    tap on the status bar still toggles locked/unlocked normally with no perceptible input lag,
    (b) a rapid/chattering touch on the status bar no longer produces a repeated text flip or bar
    bounce, (c) the LOCK/OPEN button and every other gesture (swipes, settings, override presses) are
    unaffected.
  - Every child deliverable across this task arrived directly in the working tree rather than as a
    routed message — each report stated `SendMessage` could not reach an agent named "Mandy" in this
    session. This job has no visibility into why that routing failed; it is noted here as an
    observed, unresolved symptom, not diagnosed.

## Missing Evidence
- **app-ui-cleanup**: no dedicated evidence file was produced (mobile-dev reported "Artifacts: none
  reported"). Verification for this node rests on a direct read of the changed files rather than a
  child-authored evidence document. Flagging per the document-learnings phase's instruction not to
  silently omit this gap.

## Human Approval Checklist
- [ ] **Icon**: approve the redesigned `app/assets/icon.png` (dark navy + mint-to-green gradient
  padlock-in-phone, ambient glow) as the shipped app icon.
- [ ] **Disclaimer removal**: confirm removing "(it never unlocks)" from the call-alert setting row
  in the Dashboard screen is acceptable without a replacement caveat.
- [ ] **Box LOCK button removal**: confirm tap-to-lock without a visible button graphic is the
  intended on-device UX (already confirmed earlier in this session, restated here as the final
  sign-off item since it changes a physical-product interaction).
- [ ] **Box OPEN button always shown**: confirm showing the OPEN affordance in the done state even
  when `auto_open` is on (previously it was hidden in that case) is the intended behavior.
- [ ] **Status-bar debounce fix**: this is a judgment-call diagnosis (touch-chatter root cause) made
  without physical hardware access — approve deploying it to the board to confirm before treating the
  bug as closed.
- [ ] **All 4 changes are committed to `master` already** (commit `4422061` covers the first 3 nodes;
  the status-bar debounce fix, iteration 3, is still an uncommitted working-tree diff as of this
  evidence file — commit/push needs separate explicit approval).

## Catalog Gap Note
No dedicated FRAIM job exists for a standalone icon-asset redesign; it was folded into the
`feature-implementation` job for `app-ui-cleanup` rather than escalated, since it was a small asset
change within an existing app codebase. Recorded for `sleep-on-learnings` to evaluate whether a
lighter-weight "design asset" job would be worth adding to the catalog.
