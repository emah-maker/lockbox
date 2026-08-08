# Feature: Fix call-alert screen-wake bug + add opt-in "unlock when called" setting
Issue: #local (delegated workstream from the "box call-alert / app-icon / Advanced Stats" roadmap)
Tech Spec: `docs/rfcs/companion-app-development-approach-technical-design.md` (§4.2/§4.3 BLE `alert` characteristic; §8 risk "BLE `unlock` is a new bypass of the focus contract")
PR: N/A — conversational mode (no repo configured in `fraim/config.json`); changes presented in place, no branch/commit created.

## Work List
Created at scoping; updated throughout the job.

### Scope
Bug: `Box-code/code.py`'s run loop never wakes the backlight when `lock_controller.notify_call()`
fires the incoming-call overlay (`ui.show_call_alert`). If the screen was already asleep
(`backlight.is_on == False`) when a call rings, the alert is drawn to a dark screen and the user
never sees it — the alert-through feature is silently useless exactly when it matters most (screen
asleep = box has been locked and untouched for a while).

Feature: a new opt-in **"unlock when called"** setting, distinct from the existing
`allow_remote_unlock` ("R Unlock" — gates the app's explicit Open/Close command). When on, an
incoming call releases the lock instead of just alert-through. Off by default, matching the
project's "alert-through, never auto-open by default" convention (RFC §4.2, §8).

- [x] `Box-code/lib/lock_controller.py` — `_call_event` flag set in `notify_call()`, consumed via
  `consume_call_event()`; `notify_call()` branches on `self.settings.unlock_on_call` to either
  release the lock (`go_done(now, OVERRIDDEN)`) or alert-through (existing overlay path); BLE
  settings JSON round-trip gets a new `ucal` field — ✅ done
- [x] `Box-code/code.py` — wake the backlight + reset `last_activity` when `consume_call_event()`
  is true, after `ble.service(...)` — ✅ done
- [x] `Box-code/lib/lock_config.py` — `BLE_UNLOCK_ON_CALL = False` default constant — ✅ done
- [x] `Box-code/lib/lock_settings.py` — `unlock_on_call` field, NVM persistence (bumped `_MAGIC`),
  `adjust()` index 5, `toggle_unlock_on_call()` — ✅ done
- [x] `Box-code/lib/lock_ui.py` — 6th settings row "C Unlock" (tight 172px-wide-panel label,
  matching the precedent set by "R Unlock"); `update_settings`/`_fmt_setting`/`_SET_NAMES` — ✅ done
- [x] `app/src/ble/protocol.ts` — `ucal: 0 | 1` on `Settings`, `parseSettings`/`encodeSettings` — ✅ done
- [x] `app/src/store/useSettingsStore.ts` — `DEFAULT_BOX_SETTINGS.ucal` — ✅ done
- [x] `app/src/screens/SettingsScreen.tsx` — "Unlock box when called" toggle row — ✅ done
- [x] `app/src/ble/protocol.test.ts` (NEW) — round-trip test for `ucal` — ✅ done

### Validation Requirements
- `uiValidationRequired`: Yes — one new row on the box's on-device Settings screen, one new
  Switch row on the app's Settings screen. No web/browser surface (React Native app; box is an
  on-device CircuitPython UI). Journey: box Settings → swipe to "C Unlock" row → toggle; app
  Settings → Box behaviors → "Unlock box when called" → toggle → confirm it round-trips.
- `mobileValidationRequired`: Yes, in principle (React Native) — but **no board and no
  iOS/Android device/simulator available in this session**, so this is untested live; see
  Validation Results below for what *was* checked on host (types/tests).
- Required suites/modes:
  - **Host (PC):** `python -m py_compile` on every touched firmware module (syntax gate only —
    cannot exercise hardware/adafruit_ble imports).
  - **Host (PC):** `npx tsc --noEmit` (app TypeScript) and `npx jest` (app unit tests, including
    the new `protocol.test.ts`).
  - **On-device (deferred, no board this session):** confirm the call overlay now wakes the
    screen; confirm toggling "C Unlock" on the box and "Unlock box when called" in the app both
    persist across reboot/relaunch and actually change behavior (alert-through vs. release) on a
    real incoming-call BLE write.

### Decisions
- **Separate setting from `allow_remote_unlock`, not a reuse.** `allow_remote_unlock` gates the
  app's explicit `unlock` command (a companion phone deliberately opening the box). "Unlock when
  called" is a different trust decision — auto-releasing on an *external event* (any call, since
  iOS `CXCallObserver` gives no caller identity per the RFC §5.3) — so conflating the two would
  let one opt-in silently enable the other. Kept as two independent NVM bytes/settings-row/BLE
  fields, following the existing per-concern-one-field convention.
- **Off by default.** Matches the RFC's explicit default posture ("default new remote paths to
  alert-through, not auto-unlock", §4.2) and the same rationale already documented at
  `Settings.toggle_remote_unlock` — an auto-unlock-on-call is a bigger one-tap-equivalent escape
  hatch than a manual remote unlock, since it fires without any phone-side action at all once
  armed.
- **When `unlock_on_call` is on, `notify_call` skips the overlay and unlocks directly** rather than
  showing "box stays locked" for a moment and then unlocking. The overlay text is specifically
  "box stays locked", which would be actively wrong; the done/unlock screen (`go_done` →
  `ui.show_done`) already communicates the state change. No new UI state was invented — this
  reuses the existing done-screen render, consistent with the RFC's "no new lock mechanism"
  constraint (§4.2/8a).
- **Screen-wake fix is a general "call happened" event, not tied to which branch fired.** Initially
  considered diffing `_call_alert_until` before/after `ble.service()` to detect a new alert, but
  that signal goes unset when `unlock_on_call` is on (no overlay is shown in that branch), which
  would silently reintroduce the exact bug this fixes for the new setting. A single
  `_call_event`/`consume_call_event()` flag set unconditionally inside `notify_call()` (after its
  existing "only meaningful while locked" guard) covers both branches with one mechanism.
- **6th settings row fits without repeating the prior overlap bug.** The panel is 172px wide (per
  the two prior commits fixing "Remote unlock" → "Unlock" → "R Unlock" for exactly this reason).
  Reused the same short-label style: "C Unlock" (8 chars, same length as "R Unlock"). Row y
  positions were recomputed from `(70, 113, 156, 199, 242)` (43px pitch, 5 rows) to
  `(70, 110, 150, 190, 230, 270)` (40px pitch, 6 rows) to keep 30px clearance above the "tap a row
  to change" hint at y=300, instead of pushing the hint further down or shrinking margins to zero.
- **No app-side call-handling logic needed.** `CallMonitor.ts`'s existing flow (`alertCall(label)` →
  BLE `alert` characteristic → firmware `notify_call`) is unchanged; the new behavior lives
  entirely in what the firmware *does* with that same write, gated by the settings mirror the app
  already round-trips via `pushBoxSettings`. This keeps the "one seam, box decides" design intact
  and avoids duplicating the unlock-vs-alert decision on both sides of the radio.

## Validation Results
Latest run only.

| Validation Step | Result | Notes |
|---|---|---|
| `python -m py_compile` on `Box-code/code.py`, `lock_controller.py`, `lock_config.py`, `lock_settings.py`, `lock_ui.py`, `lock_ble.py` | ✅ Pass | Syntax gate only — these modules import `board`/`pwmio`/`busio` transitively and cannot be executed on host. |
| `npx tsc --noEmit` (app) | ✅ Pass | Clean, no errors — checked against the full current working tree, including a concurrent teammate's in-flight Stats/visuals changes (`useStore.ts`, `comparisons.ts`, `sessionHistory.ts`, `theme.ts`, `CalendarScreen.tsx`, `DashboardScreen.tsx`), confirming no type conflict with the new `ucal` field. |
| `npx jest src/ble/protocol.test.ts` | ✅ Pass | 4/4 — round-trip incl. `ucal`, default-to-0 on a pre-upgrade box's payload, truthy coercion, garbled-JSON → null. |
| `npx jest` (full app suite) | ⚠️ 4/5 suites pass, 24/24 tests pass | `src/stats/trend.test.ts` fails with `AsyncStorage native module is null` via `src/storage/storage.ts` → `src/stats/sessionHistory.ts` → `src/stats/trend.ts`. **Pre-existing/unrelated**: none of those three files were touched by this workstream; `trend.ts`/`trend.test.ts` are new files from a concurrent teammate's Stats workstream, not introduced here. |
| On-device (box) | ⏸️ Untested — no physical board this session | Stated plainly per project rules. Everything above is host-side (syntax/type/unit) verification only. |
| UI polish check | N/A — no web/browser UI; box UI and RN app UI have no host-renderable surface to screenshot in this session |  |

## Bug Bash Findings
- **Fixed during validation**: the new 6th settings row (40px pitch, 6 rows in the space previously fitting 5 at 43px pitch) narrowed the gap between adjacent rows' hit-test zones (`settings_row_at`'s `±22` tolerance vs. the new 40px pitch would have created a 4px zone where a tap could resolve to the wrong row). Tightened tolerance to `±19` (`Box-code/lib/lock_ui.py`) so all 6 rows have a clean 1px gap between hit zones — no ambiguity, and this also tightens (slightly improves) the original 5 rows' precision.
- Checked: call rings while box is `idle`/`done` → `notify_call` returns early (existing guard); no spurious wake, no unlock. Correct — matches "only meaningful while locked."
- Checked: call rings from `closed` (before LOCK was tapped) with `unlock_on_call` on → `go_done` runs from a non-`running` state, so no session is logged (same no-log behavior as the existing physical-override-from-closed path) — consistent, not a new gap.
- Checked: a second call arriving after `unlock_on_call` already released the box (state now `done`) → guard returns early, no double action.
- Checked: NVM magic-byte bump (`0x5E` → `0x5F`) resets *all* saved settings (not just the new field) to firmware defaults on first boot after this update, on boxes that had previously saved settings. This is expected and matches the precedent set by the prior `0x5D → 0x5E` bump when `allow_remote_unlock` was added — not a new risk introduced here, but worth flagging to the manager as a known one-time reset on upgrade.
- 0 Critical/High findings.

### Deferrals
- **On-device validation** — Deferred, no physical board in this session. Documented plainly per
  project rules ("state plainly when a change is untested because no board run was performed").
  Not tracked as a separate issue (no issue tracker configured); flagged to the manager instead.
- **Live iOS/Android app validation** — Deferred, no device/simulator in this session. Type-check
  + unit test only.
- **Advanced Stats / app icon / broader visuals** — out of scope for this workstream; delegated
  separately per the parent objective.

## Follow-up: manager coaching — "more insistent, harder to miss" alert (this session)
Manager reported the call-alert overlay was still a static banner and asked for it to be more
insistent. Addressed:
- [x] `Box-code/lib/lock_config.py` — `CALL_ALERT_BLINK_HZ = 3` — ✅ done
- [x] `Box-code/lib/lock_controller.py` — `_call_alert_started`/`_call_anim_on` state; `notify_call`
  seeds the flash phase on each new alert (including re-triggers via the nonce); `update()` toggles
  the flash on `CALL_ALERT_BLINK_HZ` and only redraws on the flip (same pattern as `animate_done`);
  new `call_alert_active` property — ✅ done
- [x] `Box-code/lib/lock_ui.py` — `_build_call_alert` keeps live refs to the background tile and
  border (`call_bg`, `call_border`); new `animate_call_alert(on)` alternates red/amber full-screen
  background + border each flash tick, white text throughout so it reads on either color — ✅ done
- [x] `Box-code/code.py` — screen-sleep guarded with `not ctrl.call_alert_active`, so the backlight
  can no longer go dark mid-alert if `sleep_s` (as low as 10s) is shorter than `BLE_CALL_ALERT_S`
  (20s) — this was a real gap in the original backlight-wake fix (it woke the screen once on
  arrival but didn't hold it awake for the full alert) — ✅ done

**Validation**: `python -m py_compile` on all four touched files — pass (syntax gate only, same
hardware-import limitation as above). `.outline =` / `.fill =` and `pixel_shader[0] =` mutation
follow existing precedent already used elsewhere in `lock_ui.py` (settings dots, status bar,
button fill) rather than a new API assumption.
**Deferred**: on-device visual confirmation of the flash — no board this session, same as above.

## Follow-up: manager coaching — "alert on box does not detect any of the calls on the phone"
Separate, deeper root cause found after the above was delivered: the app was never detecting
calls **at all** (not a visibility issue on the box — the phone-side native module never fires).

- **Root cause**: `app/modules/call-observer/` (the Swift `CXCallObserver` Expo module) had no
  `package.json` and no `.podspec`, and the app's `package.json` never listed it as a dependency
  (no `"call-observer": "file:./modules/call-observer"` entry). Without those, `npm install` never
  creates the `node_modules/call-observer` symlink, so Expo's autolinking can never discover the
  module's `expo-module.config.json` on `expo prebuild` — the Swift file would never be compiled
  into the app on *any* build, dev-client or not. `requireNativeModule('CallObserver')` in
  `modules/call-observer/index.ts` always threw and was silently caught, so
  `isCallObserverAvailable()` was always `false` and `CallMonitor` never received a single call
  event. This is a total-failure bug (matches "does not detect any of the calls"), distinct from
  and upstream of the earlier screen-wake bug.
- **Fix**:
  - [x] `app/modules/call-observer/package.json` (NEW) — makes the module a resolvable local npm package
  - [x] `app/modules/call-observer/CallObserver.podspec` (NEW) — lets CocoaPods find/compile the Swift source on `pod install` (part of `expo prebuild`/`expo run:ios`)
  - [x] `app/package.json` — added `"call-observer": "file:./modules/call-observer"` dependency
  - [x] `app/package-lock.json` — regenerated (`npm install`); confirmed `node_modules/call-observer` now symlinks to `modules/call-observer`
  - [x] `app/src/store/useStore.ts` / `app/src/screens/DashboardScreen.tsx` — surfaced `callDetectionAvailable` (from `CallMonitor.available`) so if the module is ever unlinked again (e.g. someone runs it in Expo Go), the Dashboard says so explicitly instead of the toggle silently no-op'ing
- **Still can't fully verify**: linking only takes effect through `expo prebuild` + a native
  rebuild, which needs a Mac/Xcode — unavailable this session. Verified everything checkable
  without one: the symlink exists, `npx tsc --noEmit` is clean, and `npx jest` passes the same as
  before (`src/stats/trend.test.ts`'s pre-existing `AsyncStorage native module is null` failure is
  unrelated, from the concurrent Stats/visuals workstream).
- **Ask for the manager**: next time this is tested on the actual iPhone, run
  `cd app && npm install && npx expo prebuild --clean && npx expo run:ios --device` (not
  `expo start` in Expo Go) so the now-wired module actually gets compiled in. If detection still
  fails after that specific rebuild, that would point to something new (e.g. iOS permissions) worth
  a fresh report.
