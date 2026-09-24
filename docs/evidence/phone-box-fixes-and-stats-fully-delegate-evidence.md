# Evidence — Box Alert Bug, App Icon, Advanced Stats/Visuals, Call-Unlock Setting (fully-delegate)

**Issue:** phone-box-fixes-and-stats (local anchor — no issue-tracker API access this session)
**Job:** fully-delegate (manager)
**Date:** 2026-08-07
**Status:** DRAFT — Requires Human Approval

## Summary

Delivered the requested batch of fixes and features: the box's incoming-call alert now
actually wakes the screen instead of drawing onto a dark display; a new opt-in "unlock when
called" setting was added end-to-end (firmware + BLE contract + app); the app icon was
diagnosed as correctly configured (the real blocker is that the app has never been built as
an installed binary, not a code defect); and the Stats tab gained an Advanced Stats toggle
with a 7-day trend chart and a per-topic focus breakdown, plus light visual touches on
Dashboard, Calendar, and Settings. Confidence: **medium** — one node required a manager
takeover after two stalled delegated attempts, and nothing in this batch has been run on a
physical board or a real device/simulator.

## Work Completed

| Task | Persona | Job | Iterations | Verdict |
|------|---------|-----|-----------|---------|
| fix-call-alert-and-unlock-setting | swen | feature-implementation | 1 (reported "failed" on a later message due to a Claude safety-classifier false positive on a cybersecurity-topic flag; the artifact itself was correct on first pass) | pass |
| diagnose-and-fix-app-icon | swen | mobile-app-development | 1 | pass (no code change — correctly diagnosed as not a bug) |
| stats-advanced-and-visuals → advanced-stats-toggle-and-breakdown | swen, then MANdy | mobile-app-development | 3 (see Risk Areas) | pass |

All three tasks had no dependency on each other and ran in the same parallel layer.

### Deliverables
- `firmware/code.py`, `lib/lock_controller.py`, `lib/lock_config.py`, `lib/lock_settings.py`, `lib/lock_ui.py` — backlight-wake fix + `unlock_on_call` setting
- `app/src/ble/protocol.ts`, `PhoneBoxClient.ts`, `CallMonitor.ts`, `store/useSettingsStore.ts`, `screens/SettingsScreen.tsx`, `ble/protocol.test.ts` — app-side half of the same feature
- `app/src/stats/topics.ts`, `topics.test.ts`, `trend.ts`, `trend.test.ts` — new pure data helpers (topic breakdown, 7-day trend)
- `app/src/store/useStore.ts`, `sessionHistory.ts`, `theme.ts` — session topic-tagging plumbing + `withAlpha()` helper
- `app/src/screens/DashboardScreen.tsx`, `CalendarScreen.tsx`, `StatsScreen.tsx`, `SettingsScreen.tsx` — visuals (progress meter + topic chips, dominant-topic dot, Advanced Stats toggle + trend/breakdown charts, connection-status badge)
- `app/package.json`, `app/jest.setup.js` — fixed a pre-existing gap where the project's jest config never actually wired up AsyncStorage's jest mock
- `docs/evidence/call-alert-unlock-setting-feature-implementation-evidence.md`
- `docs/evidence/advanced-stats-toggle-and-breakdown-mobile-app-development-evidence.md`

### Missing Evidence
- **diagnose-and-fix-app-icon** produced no evidence file and no artifacts — this is expected
  and not a gap in the delivery, since the task's own conclusion was "no bug, no code change."
  Its findings are recorded only in this document and in the conversation transcript (no
  standalone evidence file exists for it, named here per the review-map requirement to not
  silently omit this).

## Key Findings

- **Root cause of the alert bug**: `firmware/code.py`'s run loop only woke the backlight on
  touch, button press, or countdown-finish. The incoming-call overlay could fire while the
  screen was already asleep and be completely invisible. Fixed with a `consume_call_event()`
  flag that covers both the alert-overlay path and the new unlock-on-call path.
- **App icon**: config is correct (1024×1024, no alpha, resolves clean through `expo config`
  and `expo-doctor`). The app has never been prebuilt/built as a real binary in this repo (no
  `ios`/`android` project, no `eas.json`), so Expo Go's own icon is all that's ever been seen.
  An Android dev build (`expo run:android`) was identified as the fastest way to visually
  confirm the real icon without needing macOS/Xcode/an Apple developer account.
- **Advanced Stats**: built on top of a new topic-tagging mechanism — since the box itself has
  no way to capture a topic (touchscreen swipe-timer only), a tag is applied app-side while a
  session is running and reconciled against the box's BLE history hand-off by timestamp.
- **Post-acceptance addition to the already-approved call-alert fix**: between the last manager
  re-verification pass and this submission, `firmware/code.py`, `lock_controller.py`,
  `lock_config.py`, and `lock_ui.py` grew further without an accompanying coaching message —
  the alert overlay now flashes (alternating red/amber, `CALL_ALERT_BLINK_HZ`) and the screen is
  held awake for the full alert duration via a new `call_alert_active` property, instead of
  potentially falling back asleep mid-alert if `sleep_s` is shorter than the alert timeout. This
  closes a real residual gap in the originally-approved fix (a short screen-sleep setting could
  have let the alert go dark before its 20s window ended). Re-verified independently before
  inclusion here: diffed line-by-line, confirmed `C_RED`/`C_WHITE` were already-imported
  constants (no missing import), and re-ran `py_compile` — clean.

## Validation

- `npx tsc --noEmit` — clean across the full working tree (checked repeatedly, most recently
  after the final Advanced Stats changes).
- `npx jest` — 5/5 suites, 28/28 tests passing (was 4/5 with a broken `trend.test.ts` before
  the jest AsyncStorage mock fix).
- `python -m py_compile` on all six touched CircuitPython modules — clean (syntax gate only;
  these modules cannot execute on host).
- BLE wire contract cross-checked by hand: all 7 UUIDs and the full `Settings` JSON field set
  (`ovr, auto, sleep, bright, unlk, ucal`) match exactly between `app/src/ble/protocol.ts` and
  `firmware/lib/lock_config.py`/`lock_controller.py`.
- **Not validated**: nothing in this batch has been flashed to the physical board or run in a
  real iOS/Android build. All verification above is host-side (types, unit tests, syntax,
  manual code reading) — stated plainly per project rules, not implied to be more than that.

## Risk Areas (nodes that needed more than one pass)

**stats-advanced-and-visuals** is the one workstream that did not go cleanly:
1. First delegated attempt hit an infrastructure failure (connection dropped mid-response). Not
   a quality failure — the partial work it left behind (topics.ts, trend.ts, tests, Dashboard/
   Calendar visuals) was independently verified as correct and kept.
2. A second delegated attempt, explicitly briefed to finish the remaining scope, made no
   progress on the actual deliverable (StatsScreen.tsx) and instead introduced an unrelated,
   unexplained change (a new `call-observer` package dependency + podspec/package.json
   scaffolding for the native module) that was not part of its brief.
3. After the human directed a takeover ("do it yourself"), MANdy implemented the remaining
   scope directly: the Advanced Stats toggle, the trend chart, the topic breakdown, and — while
   fixing the jest gap — discovered and corrected that the second attempt's own jest-mock fix
   was itself non-functional (it pointed `setupFiles` straight at the mock package's plain
   module export, which does nothing without an actual `jest.mock()` registration).

**What the human should scrutinize**: the leftover `call-observer` dependency addition in
`app/package.json` and the two new files under `app/modules/call-observer/` — these were never
explained by the sub-agent that introduced them and were left in place (typecheck passes, so
nothing is broken) but their purpose was not verified against this batch of work.

**fix-call-alert-and-unlock-setting** also kept growing after MANdy's own re-verification pass
accepted it (the flash/hold-awake addition described under Key Findings above), with no coaching
message ever announcing that additional work. It was caught only because this submission step
re-diffed the repository from scratch rather than trusting the earlier accepted state. The
content itself checks out (re-verified independently), but the human should be aware that
firmware/lock-logic files changed silently at least once during this run, which is worth
watching for on any future run given this file touches physical lock behavior.

## Human Approval Checklist
1. Approve merging/committing this batch of changes (nothing has been committed or pushed —
   no branch/PR exists; changes are live in the working tree on `master`).
2. Confirm the "unlock when called" setting's design decision — off by default, a separate
   opt-in from the existing "Allow open/close from this phone" remote-unlock setting — matches
   intent, since it's a new physical-security trade-off (any incoming call can now release the
   box if armed).
3. Decide whether to investigate/keep the unexplained `call-observer` package.json/podspec
   addition flagged above, or revert it.
4. No physical board and no iOS/Android device/simulator exist in this session — plan an
   on-device validation pass before treating any of this as ship-ready, especially the
   backlight-wake fix and the NVM magic-byte bump (which resets all box settings to defaults
   once on first boot after this update, same as a prior settings addition did).
5. Confirm the Advanced Stats scope (toggle + 7-day trend + topic breakdown) matches what was
   asked for, and whether "more visuals on all tabs" is sufficiently covered by the touches
   made here (Dashboard progress meter/topic chips, Calendar dominant-topic dot, Settings
   connection badge) or needs another pass.
