# Feature Implementation Evidence — Deepen Apple fluid-interface UI rework (on-device box)

## Work List

### Scope
Parent objective (Mandy, manager): deepen the Apple fluid-interface rework started in
commit `844cb93` across app, website, and box UI, going beyond that first pass rather
than auditing it. This workstream covers only the **on-device box UI**
(`Box-code/lib/lock_ui.py`, `lock_controller.py`, `lock_config.py`) — the companion app
and website are separate workstreams.

The first pass on the box (844cb93) added exactly one static change: a fixed
"catching light" highlight line on the digital-clock card, explicitly reasoned as
"the one change its displayio/no-alpha hardware can safely support." This workstream's
job is to find and ship genuine *motion*, not just audit that decision.

### Hardware constraints that shaped scope (read before assuming a technique works)
- CircuitPython/displayio: no alpha blending, no fractional `Group`/`TileGrid` scale
  (integer only) — ruled out any scale-based "pop" or true transparency fades.
- `adafruit_display_shapes` (`Rect`/`RoundRect`/`Circle`) shapes are `displayio.TileGrid`
  subclasses baked into a fixed-size `Bitmap` at construction — `.fill`/`.outline`
  (palette writes) and `.x`/`.y` (TileGrid position) are cheap and already proven safe
  in this exact codebase (`gauge_tip.x/y` reassigned every frame in `_set_gauge`).
  Resizing (`width`/`height`) is NOT cheap (would require rebuilding the bitmap) and
  was avoided everywhere.
- `adafruit_display_text.label.Label.anchored_position` is a plain settable property,
  already used at construction throughout; reassigning it every frame is the same
  class of operation, so used for label motion.
- The run loop (`Box-code/code.py`) calls `LockController.update(now)` unconditionally
  every iteration (~50 Hz while awake, `time.sleep(0.02)`), so a per-frame spring
  stepper has a real, adequate cadence without new plumbing in `code.py`.
- No host build/test — this is CircuitPython; all validation is code-review plus
  design-by-analogy to already-proven-safe operations in this file. **No physical
  board was available this session** (no `D:` drive), so nothing below has been
  observed running on the actual device.

### Concurrent contribution (discovered mid-session, not mine)
Partway through this workstream, `lock_ui.py`/`lock_config.py` started changing on
disk under a second, live writer I had no channel to identify or reach (`SendMessage`
to "Mandy" failed -- not a reachable teammate name in this runtime; the Ruflo claims
board had no registered claims either). I paused my own edits to those two files,
polled their mtimes until they went quiet, then read the settled result before
continuing, rather than blind-writing over an in-flight edit. That contribution
(already on disk, not something I wrote) added:
- A **color-transition engine** (`LockUI._start_color_transition` /
  `step_color_transitions`, `lock_config.STATUS_TRANSITION_S`): eases the status bar's
  fill and the active clock-view readout's color over 200ms (ease-out cubic) on state
  changes, instead of an instant color snap.
- Named corner-radius constants (`RADIUS_CARD`/`RADIUS_BTN_SM`/`RADIUS_BTN_LG`).
- It also explicitly considered and rejected a continuous "breathing" highlight on the
  digital-clock card (the idea my own `lerp_color()` docstring below was written to
  support) as failing the motion-and-animation skill's frequency/restraint gate for a
  screen stared at for a whole countdown session. That reasoning is sound, so I did
  **not** build the breathing highlight -- see "Deferred" below.

Because their engine only ever touches `.fill`/`.color` and mine below only ever
touches `.y`/`.anchored_position`, the two are additive, not overlapping -- confirmed
by reading their full diff before writing anything further, not assumed.

### Implementation decisions (this workstream)
1. **New `lock_motion.py`**: a small critically-damped spring (`Spring` class),
   stepped by `dt` each frame, mirroring the companion app's press spring semantics
   (`app/src/ui/AnimatedPressable.tsx`: stiffness 300 / damping 30 / mass 1) translated
   to pixel space instead of a scale factor. Chosen over fixed-duration timings for the
   same reason the app doc cites: interruptibility (a spring redirects smoothly from
   its current value+velocity; a timing restarts or snaps).
2. **`lerp_color()` added to `lock_config.py`** (already documented as the home for
   "small shared helpers"): a cheap integer channel lerp between two `0xRRGGBB` ints.
   Originally written to power a digital-clock "breathing" highlight; the concurrent
   contribution above reasoned that effect out of scope (see above), but the
   color-transition engine ended up importing and using this same helper for its own
   per-frame RGB easing, so it stayed as a shared dependency instead of dead code.
3. **Press-depth feedback**: the two existing press rings (`button_press_ring`,
   `status_press_ring`, added for touch-down/up acknowledgement) upgraded from binary
   `.hidden` show/hide to a spring-eased sink-and-release: the ring plus the button/
   status-bar widget plus its label move down `PRESS_DEPTH_PX` together on touch-down
   and spring back on release, hiding the ring only once fully settled. A guard
   (`_finish_press`) snaps any in-flight press back to rest before starting a new one,
   so a fast re-tap on a different control can't leave a widget stuck off-position.
4. **Success "pop"**: the `UNLOCKED` `big_msg` label now springs up from an offset
   (`DONE_POP_OFFSET_PX`) into place when `show_done()` fires, instead of appearing
   instantly — the existing blink continues on top of this for sustained emphasis.
5. **Override-press pop**: the override counter label (`ov_count`) now bumps up and
   springs back on every registered press — tactile confirmation for the single most
   repetitive physical interaction on the device (default 25 presses), which
   previously had zero motion.

### Deferred (explicitly out of scope this pass, with reasoning)
- **Digital-clock "breathing" highlight** (continuous color pulse while running):
  originally planned by this workstream, then dropped after reading the concurrent
  contribution's reasoning (see above) that a perpetual ambient motion on a screen
  the user stares at for the whole countdown fails the motion-and-animation skill's
  frequency/restraint gate -- motion should mark occasional, meaningful events, not
  run continuously as decoration. Agreed and not built.
- **Cross-view slide transition** (swiping control ↔ clock ↔ battery ↔ settings
  currently swaps `display.root_group` instantly). This is the highest-value
  remaining "fluid interface" gap, but implementing it safely needs
  `displayio.Group.x`/`.y` to reparent/offset whole view groups during the slide.
  That API's availability was **not verified against this board's actual
  CircuitPython build** this session (no device attached), and unlike everything
  shipped above, an `AttributeError` there would raise inside the main run loop in
  `code.py`, which also polls the physical override button — i.e. a bad guess here
  risks bricking the emergency-unlock path, not just a visual glitch. Needs a live
  a live-device spike (confirm `Group.x`/`.y` support on-device) before landing.
- **Settings-list-row / setting-detail `[-]`/`[+]` press feedback**: currently zero
  touch-down feedback on either screen. Same spring mechanism as #3 above would
  apply, but wiring it needs new persistent widget references (`nlbl`, `_sd_minus`,
  `_sd_plus`, their labels) that `lock_ui.py` currently discards as locals; deferred
  to keep this change's diff reviewable and `lock_ui.py` (already ~1050 lines, over
  the project's 500-line guidance pre-existing this change) from growing further in
  one pass.

### Validation
- `uiValidationRequired`: yes (on-device visual/behavioral check), but **no physical
  board was available this session** — stated plainly per project rules rather than
  fabricating a test result. Validation performed instead:
  - `ast.parse()` on all four changed/added files (`lock_ui.py`, `lock_config.py`,
    `lock_controller.py`, `lock_motion.py`) confirms valid Python syntax -- not a
    substitute for a device run, but catches typos/structural errors before deploy.
  - Caught and fixed one real bug this way only after a manual trace, not the parse
    check: `_begin_press` initially called a `Spring.set()` method that was never
    defined (only `displace()` exists) -- would have raised `AttributeError` on the
    very first button/status-bar tap. Fixed to call `displace(0.0, PRESS_DEPTH_PX)`.
  - Read-through against the four state transitions that touch these widgets
    (`show_idle/running/closed/done`, `show_override`/`_clear_override`,
    `set_view`/`_handle_release`), confirming no other code path writes to the same
    attributes (`.y` on `button`/`status_bar`/the two rings; `.anchored_position` on
    `big_msg`/`ov_count`) that the new motion code now owns.
  - Confirmed `LockController.update()` is called unconditionally every run-loop
    iteration (`code.py`) so `step_motion(dt)` always advances, and that its `dt` is
    clamped to 0.1s so a long pause (sleep wake, GC pause) can't feed a spring one
    huge step.
  - Confirmed the new position-spring motion (`.y`/`.anchored_position` writes) and
    the concurrently-added color-transition engine (`.fill`/`.color` writes) never
    touch the same attribute on the same object, so the two systems layer safely.
- `mobileValidationRequired`: no (box-only workstream).
- Follow-up owed to Mandy: get this deployed to the physical board (batch-write all
  changed files, then sync, no unplug/replug per project rules) and confirm the press
  feel, the success pop, the override bump, and the status/clock color eases all read
  as intended before calling this workstream fully done.
