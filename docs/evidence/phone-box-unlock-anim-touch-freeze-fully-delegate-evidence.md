DRAFT - Requires Human Approval

# Fully-Delegate: Phone Box unlock animation rework + touch-freeze fix

## Executive Summary
Goal: redo the Phone Box unlock ("done") success animation on the physical device's touchscreen, and fix a user-confirmed bug where the touchscreen stops responding while the screen is flashing.

What was built: the on/off blink that used to flash a full-screen green border + "UNLOCKED" message every ~125ms was replaced with a one-shot reveal ring (32 dots, same dots-around-a-circle idiom as the existing force/override-unlock ring) that sweeps from empty to full green once over 0.5s, then holds static with no further redraws. This follows the device's existing progress-indicator design language rather than reusing the override screen's actual ring/bar objects, per manager correction mid-run. The suspected root cause of the touch freeze (the old blink's full-region `.hidden` toggling on the two largest-area elements on screen, competing with touch reads in the single-threaded main loop) is addressed by construction: the new ring only ever mutates one small dot's fill color per changed step, and stops entirely once the reveal completes.

Confidence: **High** for code-level correctness (idiom reuse, state wiring, scope boundaries all verified against the actual diff, not just the child's summary). The one first-iteration correction was a manager-brief revision issued before the child began implementing (don't literally reuse the override ring/bar objects; follow their design language instead), not a post-submission failure, so this run completed in a single execution pass.

**What is NOT yet known**: whether the fix actually resolves the touch freeze on the physical board, and whether the new ring's geometry (center y=130, radius 55) looks right, since this firmware has no host-runnable renderer or test bed. Both are explicitly flagged below for on-device confirmation.

## Delegation Ledger
Single-node graph (one cohesive change; both asks landed in the same files with a shared root-cause theory, no parallelizable independent subparts).

| Task ID | Persona | Job | Depends On |
|---|---|---|---|
| box-unlock-animation-rework | firmware-dev | feature-implementation | none |

## Sub-Agent Review Surface
| Task | Evidence File | PR | Manager Verdict | Iterations | Corrections |
|---|---|---|---|---|---|
| box-unlock-animation-rework | [`docs/evidence/unlock-reveal-animation-feature-implementation-evidence.md`](unlock-reveal-animation-feature-implementation-evidence.md) | None — project is conversational-mode (`fraim/config.json`), no repository/PR workflow configured for this task; changes sit in the working tree | **Accepted** | 1 | Pre-execution brief correction only: "follow the override ring/bar's design language, do not reuse the actual animation objects." Verified in the final diff: the new ring is a genuinely separate, newly-built widget, not the override ring reused in place. |

## Manager Verification Performed
Verified against the actual `git diff` of all three changed files (`firmware/lib/lock_config.py`, `lock_ui.py`, `lock_controller.py`), not the child's summary alone:
- Grepped for leftover `self.border` / `ANIM_HZ` / `_anim_on` references after the border-to-ring swap — none found; all three hide-sites (`show_idle`/`show_running`/`show_closed`) correctly updated to `_hide_done_ring()`.
- Confirmed `_set_done_ring` uses the same key-gated single-dot `.fill` idiom as the existing `_set_ovr_ring` (only redraws when a segment index changes), replacing the old full-region `.hidden` toggle — this is the concrete mechanism behind the touch-freeze theory.
- Confirmed the reveal is a true one-shot: the controller stops calling `animate_done` once `frac == 1.0`, no ongoing per-frame cost after the sweep.
- Confirmed auto-dismiss (`DONE_ANIM_S`), tap-to-dismiss (`OPEN` button), and the `_done_pop` spring pop-up are untouched by the diff.
- Confirmed the incoming-call alert flash (`animate_call_alert`/`CALL_ALERT_BLINK_HZ`/`_call_anim_on`) is byte-identical — correctly left out of scope (unconfirmed as broken, per the user).
- Reviewed and accepted the ring-only (vs. ring+bar) judgment call: the user's own reference was specifically the override screen's ring/bar; ring-only correctly matches the override ring's technique, and the control view's existing layout has no clean room for a second progress element.
- Noted the `BAT_CAPACITY_MAH` change present in the `lock_config.py` diff is a pre-existing, unrelated uncommitted edit from before this task started, not introduced by this child, and correctly left untouched by it.

## Risk Areas
1. **Root cause unconfirmed on hardware.** The theory (full-region `.hidden` toggle blocking touch reads) is well-grounded in this codebase's own documented precedent (the override ring/bar's key-gated redraw fix for a prior heap-exhaustion bug), but there is no host test bed for this firmware, so the theory has not been measured. Needs an on-device tap test during/after the reveal.
2. **Ring geometry unverified visually.** `DONE_RING_CY=130`, `DONE_RING_R=55`, `DONE_RING_N=32` in `lock_config.py` were reasoned from other widgets' documented y-coordinates, not from an actual render. Most likely thing to need a tweak after looking at it on the device.

## Human Approval Checklist
- [ ] Deploy all three changed files to the physical board (batch-write `lock_config.py` + `lock_ui.py` + `lock_controller.py`, then sync — no unplug/replug between files) and trigger an unlock.
- [ ] Confirm the ring sweeps once to full green and holds static, with no residual blink.
- [ ] Confirm touch (tap OPEN, or any touch) stays responsive during and immediately after the reveal — this is the actual bug being fixed; if it is not, the root-cause theory needs revisiting.
- [ ] Confirm the ring's on-screen position/size looks right relative to the "UNLOCKED" message and surrounding widgets (corner status icons, nav hint); adjust `DONE_RING_CY`/`DONE_RING_R` in `lock_config.py` if not.
- [ ] Confirm auto-dismiss after 2s (when auto-open is on), tap-to-dismiss via OPEN, and the message's spring pop-up all still behave as before.
- [ ] Decide whether to commit these changes (nothing has been committed; they are sitting in the working tree pending this approval).

## Deploy Notes
Deployed `lock_config.py`, `lock_ui.py`, `lock_controller.py` to the board's `D:` drive; on first boot the device raised an import error for `OVR_OPTIONS` from `lock_settings.py`. Investigation found this was **not caused by this task's changes**: the board's `D:\lib\lock_settings.py` was a stale copy (last deployed 2026-08-10) predating an unrelated, already-committed repo change that renamed the override-presses config from a discrete `OVR_OPTIONS` tuple to a `OVR_MIN`/`OVR_MAX`/`OVR_STEP` range (repo file dated 2026-08-12). Deploying this task's current `lock_config.py` (which only has the new names) exposed that latent drift. Swept all of `firmware/lib/*.py` and `code.py` for other repo-vs-device drift — `lock_settings.py` was the only mismatch. Deployed the current `lock_settings.py` to `D:\lib\` and verified it now matches the repo byte-for-byte. No code changes were needed, only a missed deploy step from an earlier, unrelated session.

## Missing Evidence
None. The child's evidence file exists and is non-empty; verified directly.

## Catalog Job Usage
Used the existing `feature-implementation` catalog job for the one delegated node — no gap in available jobs surfaced during this run.

## Round 2: Ring rejected, button-to-center redesign, executed by the manager directly

**What happened:** after round 1 was deployed and the OVR_OPTIONS drift fixed, the human rejected the ring reveal outright: "make a new animation, not a ring animation, I would like you to move the unlock button to the middle though during the open animation." This was routed back to the delegated child (`box-unlock-animation-rework`) as a round-2 correction, per standard process. The human then reported no visible progress from that child ("I am not seeing anything happen right now") and explicitly authorized the manager to implement it directly or bring in another employee: "can you do it youself or call in another employee."

**Manager decision:** implemented directly rather than spawning a duplicate Agent-tool worker, since a real child task was already logged against this exact work and the explicit instruction was to act, not to re-delegate further. Building an additional agent on top of an already-stalled delegated task risked exactly the duplicate-editor collision this project's `fully-delegate` learnings already warn about (see `fraim/personalized-employee/learnings/raw/2026-08-11T20-00-00-avoid-duplicate-subagent-spawn-in-fully-delegate.md`) — direct action was the safer and faster path given explicit human authorization.

**What changed:** the ring (all of `done_ring_dots`/`_set_done_ring`/`_hide_done_ring`/`animate_done`/`DONE_RING_CY`/`DONE_RING_R`/`DONE_RING_N`/`DONE_REVEAL_S`) is deleted entirely. The unlock animation is now the OPEN button itself springing from its normal bottom position to the screen's center (`firmware/lib/lock_config.py`'s new `DONE_MSG_Y`/`DONE_BTN_CENTER_Y`, `lock_ui.py`'s new `_btn_move` Spring + `_reset_button_position`, `lock_controller.py`'s simplified `done` branch). Full technical detail, including two structural issues this uncovered (hit-testing a moving button, and a press-vs-move conflict) and how each was resolved, is in the child's evidence file's new "Round 2" section: [`docs/evidence/unlock-reveal-animation-feature-implementation-evidence.md`](unlock-reveal-animation-feature-implementation-evidence.md#round-2-button-to-center-spring-redesign-replaces-the-ring-entirely).

**Verification performed:** re-read every changed line in the actual diff (not written blind) — confirmed zero leftover references to any deleted ring symbol; confirmed `in_button`'s hit-test now reads the button's live position; confirmed the press-dip and move-spring can't both write `self.button.y` on the same frame; confirmed `python -m py_compile` passes on all three files. Deployed to the board (single batch `cp` of all three files + `sync`, verified byte-identical to the repo).

**Still unverified (unchanged constraint from round 1):** no host-runnable renderer or test bed exists for this firmware. The button's on-screen position, the spring's feel, and — the actual point of this whole task — whether touch stays responsive during the move, all still need an on-device look. The Human Approval Checklist below is superseded by this round; re-check against the button-move behavior, not the old ring.

## Superseded Approval Checklist (round 1, ring-based -- see Round 2 above)
The checklist in the "Human Approval Checklist" section above described the ring reveal, which no longer exists. Re-verify on-device against the current build instead:
- [ ] Deploy all three files (already done this round, batch-write + sync, verified byte-identical).
- [ ] Trigger an unlock; confirm the OPEN button visibly springs from the bottom to the screen's center and holds there.
- [ ] Confirm touch stays responsive during and immediately after the move — the actual bug this whole task exists to fix.
- [ ] Confirm the button's centered position/size looks right relative to the "UNLOCKED" message (now at the top, `DONE_MSG_Y=85`) and the nav hint below; adjust `DONE_BTN_CENTER_Y`/`DONE_MSG_Y` in `lock_config.py` if not.
- [ ] Confirm tapping the button while it's centered actually dismisses (tap-to-dismiss now hit-tests the button's live position).
- [ ] Confirm auto-dismiss after 2s (when auto-open is on) still works, and the button snaps back to the bottom afterward (idle/running/closed).
- [ ] Decide whether to commit these changes (still nothing committed; conversational mode, working tree only).

## Round 3: Scope expansion (manager coaching) -- tag-picker cancel, dashboard stat, layout stability, theme audit

The human expanded scope mid-run with four new, mostly independent asks spanning both `firmware/` and `app/`. Handled directly by the manager (same authorization basis as Round 2 -- "do it yourself"), not re-delegated, since each item was small/well-scoped once investigated and an Explore sub-agent was used first for the app-side survey to avoid duplicating research.

1. **Cancel swipe-up on the box's tag picker** (`lock_controller.py`): the pre-session tag picker previously had no true cancel path -- every exit (tap a topic, SKIP, swipe-left) started some session, tagged or not. Added: swipe up now backs out to whichever of idle/closed was active before LOCK was tapped (tracked via new `self._picking_from`), with no session started. Deployed to D:.
2. **Dashboard "today's" focus time** (`app/src/screens/DashboardScreen.tsx`): the headline focus-time number was a lifetime total; now scoped to today via the existing `filterByWindow(sessions, 'day')` helper (already used by StatsScreen). Session count/completion/streak/longest stay lifetime, matching StatsScreen's own precedent of never windowing streak.
3. **Fixed-size UI boxes**: fixed the clearest reflow sources -- the Box status card's running-session meter and "remote unlock is off" warning now stay mounted with reserved height instead of appearing/disappearing (previously the biggest source of the reported "text moving because of status changes"); the Dashboard Focus card and three Stats cards (Total focus time, Fun facts, By topic) got a reasoned `minHeight` so the empty-history placeholder doesn't leave them shorter than the populated state. Deliberately left the Box card's duration-picker/topic-picker block variable-size -- forcing it fixed would reserve a lot of dead space when not showing, judged worse than the reflow it would prevent. Verified with `tsc --noEmit` (clean) and the full Jest suite (81/81 passing) after every edit in this round.
4. **Theme/color audit, then both proposed fixes on manager approval**: ran actual WCAG contrast math (not eyeballed) on the app's 6 existing accents against both theme modes. Finding: all 6 pass comfortably as text in dark mode (5.6-11:1) but **every one fails minimum text contrast in light mode** (measured ~1.7-3.2:1 against light bg/surface, need >=3:1 large text / ideally >=4.5:1) -- they were tuned for dark mode only. Given "do both approaches":
   - Computed a separately darkened/more-saturated light-mode variant of each of the 6 existing hues (script-generated via HSL lightness reduction until >=4.5:1 against both light.bg and light.surface, then verified), rather than eyeballed values.
   - Added 2 new accent options -- `teal` (green-leaning cyan, fills the gap between mint and sky) and `indigo` (deep blue-violet, fills the gap between sky and violet) -- computed with the same per-mode contrast method from the start.
   - Restructured `app/src/theme/theme.ts`'s `ACCENTS` from a flat per-accent map to per-mode (`ACCENTS[mode][key]`); `resolveTheme`, `accentSwatch` (replaces mode-independent `ACCENT_SWATCHES`), `ACCENT_KEYS`, and `ACCENT_LABELS` all updated; `SettingsScreen.tsx`'s accent-swatch call updated to pass the current mode.
   - Found and fixed a second-order contrast problem the restructure surfaced: light mode's new darker/more-saturated fills fail contrast against the old near-black `accentText` (~3.3-3.8:1) -- light mode's `accentText` is now white (>=4.9:1 against every light-mode fill) while dark mode keeps its original near-black per-accent text.
   - **Mirrored the entire change to `firmware/lib/lock_config.py`/`lock_ui.py`**, since the box's own contrast bug is real too (confirmed: `_accent_widgets` includes settings-screen value text and the elapsed-clock time text, both drawn on the themed bg/surface) and this system is explicitly documented as mirroring the app's. `ACCENT_COLORS` split into `ACCENT_COLORS_DARK`/`ACCENT_COLORS_LIGHT` (8 entries each, `ACCENT_COLORS` kept as a dark-mode alias for `BUILTIN_TOPICS`' fixed tag-picker dot colors and existing bounds-checks); `C_ON_ACCENT` split into `C_ON_ACCENT_DARK`/`C_ON_ACCENT_LIGHT`; `set_theme` now selects per mode and additionally drives `btn_label.color` (previously a fixed build-time constant that theme changes never touched).
   - **Caught a real bug while mirroring**: both `firmware/lib/lock_controller.py`'s BLE settings handler and `app/src/ble/protocol.ts`'s `parseSettings` had the accent index hardcoded to clamp at `5` (the old 6-accent set's last index) -- left as-is, this would have silently clamped teal/indigo back down to rose the moment they were selected. Fixed both (box: `len(ACCENT_COLORS) - 1`, dynamic; app: bumped the manually-synced literal to `7` with a comment, kept independent of the theme module by design, same as this file's UUID-sync convention). Updated the one test that asserted the old clamp value (`protocol.test.ts`).
   - Verified: `tsc --noEmit` clean, full Jest suite 81/81 passing, `py_compile` clean on all four touched firmware files, deployed to D: and confirmed byte-identical, full repo-vs-device sweep confirms zero drift across every firmware file.

**Still unverified (on-device/in-app, same constraint as every prior round):** the new light-mode accent contrast and the two new accent swatches need an actual visual look, on both the phone screen and the box's LCD -- computed contrast ratios are correct math but were never rendered.

## Round 4: Bug fix -- LOCK/OPEN button getting stuck at an animation position

**Report:** "the lock lock unlock button still get stuck in the animation positions" (on-device, after Round 2's button-to-center rework).

**Root cause found:** `LockUI._reset_button_position()` (called by `show_idle`/`show_running`/`show_closed` to snap the button back to its bottom rest position `BTN_Y` on every exit from "done") didn't account for an in-flight press-depth dip on that same button. The ordinary, everyday path into this method -- tapping OPEN to dismiss "done" -- IS a press on this exact button, and `LockController._handle_release` acts on the release (calling `go_idle()`) before the cosmetic press-depth spring has finished easing back to 0. At the moment `_reset_button_position()` ran, the press system's `_press_targets` still held a stale base captured from the button's CENTERED (done-animation) position. The very next `_step_motion` frame's still-active press-dip block used that stale base to overwrite the button's `.y` right back to it, and once the dip settled, `_finish_press()` left the button sitting at that stale centered position instead of the bottom -- exactly the reported symptom, and reproducible on essentially every ordinary tap-to-dismiss.

**Fix:** `_reset_button_position()` now cancels any in-flight press on the button outright (clears `_press_targets`/`_press_ring`, hides the press ring, zeroes the press spring) before snapping to `BTN_Y`, instead of letting the stale press finish naturally and fight the reset. This is the single chokepoint every done-state exit (and the less-likely tag-picker-cancel path, which shares the same underlying hazard) already funnels through, so one fix covers both.

**Verification:** `py_compile` clean, deployed to D:, verified byte-identical, full repo-vs-device sweep confirms zero drift elsewhere. Still needs an actual on-device tap-to-dismiss test to confirm the fix, per this round's report -- the previous "looks right in the diff" confidence on this exact code was insufficient once, so this one specifically should be checked by hand before considering it closed.

Human confirmed this round fixed (round 5 opens with "ok it is fixed now").

## Round 5: General button lag, cross-screen (settings + lock screen)

**Report:** buttons "a bit laggy," confirmed present on both the settings screen and the lock/control screen -- ruled out a screen-specific animation cause since the settings screen has no press-dip feedback at all (`LockUI.on_touch_down` returns early for any view other than "control"), yet the lag is still felt there.

**Root cause found:** `PhoneBoxBLE._drain_inbound` (`lock_ble.py`) read all 5 BLE characteristics (`command`, `alert`, `time_sync`, `settings`, `labels`) every single main-loop iteration (~50Hz) whenever a phone is connected, unconditionally, regardless of which screen is showing (`code.py` calls `ble.service()` every loop pass after touch/update). Four of those five change rarely (an incoming call, an occasional settings/label push, one clock sync) but were being polled at the same 50Hz rate as `command`, which genuinely needs it for a snappy remote Open/Close. Each characteristic read is a real `_bleio` round-trip, not free -- this is the one thing that runs at full frequency regardless of screen, matching the reported cross-screen scope exactly (the settings screen has nothing else in common with the lock screen that could explain a shared slowdown).

**Fix:** rate-limited the four rarely-changing characteristic reads to 5x/sec (`_last_drain_slow` gate, same pattern as the existing `_push_outbound` 1x/sec gate); `command` stays polled every iteration, unchanged.

**Deliberately not touched:** `RELEASE_FRAMES` (the touch-release debounce) and the main loop's `time.sleep()` cadence -- both are documented, tuned values addressing a specific known AXS5106L touch-controller quirk (dropped frames mid-touch); reducing either without on-device drop-rate data risks reintroducing chopped-up taps/swipes, a worse regression than mild perceived lag. If the BLE fix doesn't fully resolve it, these are the next lever, but they need real evidence first, not a guess.

**Verification:** `py_compile` clean, deployed to D:, verified byte-identical, full sweep confirms zero drift elsewhere. This fix only has an effect while a phone is BLE-connected -- if the lag is also present with no phone connected, this specific fix won't explain it and the debounce/loop-cadence path above would need real investigation instead.

## Round 6: Tag-picker cancel discoverability, override limit raised to 500, BLE discovery reliability

1. **Tag-picker cancel was undiscoverable, not broken.** Report: "when choosing a focus topic on the box, there is no choice to cancel it... if you accidentally press the lock button you cannot do anything to close out." Re-verified the swipe-up-cancel logic added earlier (`lock_controller.py`'s "picking" branch) and it's correct as written -- the real gap was that this screen had zero on-screen indication the gesture existed. Added a visible "swipe up = cancel" hint at the top of `_build_tag_picker` (`lock_ui.py`), same fix class as the existing SKIP/MORE arrow+label controls on that same screen.

2. **Override-press limit raised to 500.** Not a simple constant change: `OVR_MAX` was hard-capped at 255 because `Settings.save()` persisted `override_presses` in a single NVM byte (documented ceiling). Widened storage to 2 bytes (low byte kept at its original offset, high byte appended at a new one so no other field's layout shifted), bumped the NVM magic byte so an already-flashed box doesn't reconstruct a garbage override count from a stray erased high byte. Mirrored `OVR_MAX` in `app/src/screens/SettingsScreen.tsx`. Confirmed the on-screen "N/N" counter's digit budget is unaffected ("500/500" is the same 7 characters as the old "255/255" ceiling).

3. **BLE discovery bug found and fixed.** User confirmed (after being asked to distinguish discovery vs. GATT-negotiation failure) that the intermittent connection trouble is a **discovery** failure, and confirmed it happens even with the screen awake -- ruling out the sleep/power-budget tradeoff from Round 5's other finding. Root cause: `PhoneBoxBLE._set_advertising` only calls the radio's actual `start_advertising()` when its own cached on/off flag changes value; it never reconciles that cache against the real hardware state. If advertising ever silently stops for any reason outside this code's visibility (a radio hiccup, an aborted connection attempt from a phone that gives up mid-handshake, or any underlying `_bleio`/adapter quirk), the cached flag stays stuck at "on" and nothing would ever call `start_advertising()` again -- the box sits genuinely undiscoverable while every observable signal (screen awake, not connected) says it should be found. Fix: `_set_advertising` now periodically forces a fresh `start_advertising()` call every `BLE_ADV_REASSERT_S` (15s, new `lock_config.py` tunable) regardless of the cached flag, as a belt-and-suspenders self-heal -- harmless if advertising was already genuinely active, recovers it if it had silently dropped.

**Verification (all three):** `py_compile` clean on every touched file, `tsc --noEmit` clean, full Jest suite passing, deployed to D: and verified byte-identical, full repo-vs-device sweep confirms zero drift. None of the three have been confirmed on-device yet.

## Round 7: Gauge clock style recolored to follow the theme accent

Request: "make the gauge color match the theme colors." The gauge clock style (`_build_clock_ring`/`_set_gauge`) previously used a fixed amber (elapsed) / green (remaining) pairing, deliberately documented as exempt from theming ("a local progress indicator, not the app-lock/closed/unlocked status language"). This is an explicit reversal of that earlier decision, not a bug fix. Changed the elapsed/remaining dots to accent (elapsed) / grey (remaining), matching the exact convention the override ring (`_set_ovr_ring`) already uses, rather than inventing a separate theming rule for this one view. Same known, accepted limitation as the override ring: switching accent while already sitting on this view won't recolor already-drawn dots until the next segment-boundary crossing (dots aren't in `_accent_widgets`) -- consistent with existing behavior elsewhere, not a new gap. `py_compile` clean, deployed to D:, verified byte-identical, zero drift elsewhere. Not yet confirmed on-device.
