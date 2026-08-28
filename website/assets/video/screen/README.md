# Phone Box screen recreation — asset notes

Pixel-accurate recreation of the box's physical display, generated from the
firmware source (`Box-code/lib/lock_ui.py`, `lock_config.py`), for compositing
into the Higgsfield product video during a push-in on the display. `Box-code/`
was treated as read-only; nothing there was modified.

## Native resolution

**172 x 320, portrait.** Confirmed two independent ways in the firmware source
(not the photo):
- `lock_config.py` line 64: `# ----- Touch -> screen mapping (panel is native 172x320) -----`
- `axs5106l.py`'s header comment identifies the board as the "Waveshare
  ESP32-S3 Touch LCD 1.47", and `lock_ui.py`'s override-ring comment
  independently derives the same width from the ring's own geometry: *"r=72,
  not the original 86: at r=86 the ring's outermost dots (4px radius) reached
  x = 86 +- 90 = -4 to 176 on this 172px-wide screen"*.

High confidence. `lock_ui.LockUI.__init__` reads `display.width`/`.height`
directly off `board.DISPLAY` at runtime rather than hardcoding them, but every
geometry constant throughout the file (button widths, ring radii, card
widths) is authored assuming exactly 172x320, so that's the value used here.

## The `fix()` color inversion

`lock_config.fix(c) = 0xFFFFFF ^ c`, and every color constant is `fix()`-wrapped
(`C_BG = fix(0x0D1117)`), with the comment: *"This panel's init has color
INVERSION on (red->cyan, white->black). fix() sends the inverse so colors
render correctly."*

Conclusion: **the literal pre-`fix()` argument is the color that actually
appears on screen.** The panel's own hardware inversion is already "on";
`fix()` pre-inverts the value being written so that after the panel's
inversion it lands back on the intended color. So `C_BG`'s `0x0D1117` (near
black) is genuinely what's displayed, `C_WHITE`'s `0xF0F3F6` is genuinely
near-white, etc. — not their bitwise complements.

This was checked empirically against `seeds/seed-closed.png`: the reference
photo shows a dark screen with light text and a white battery glyph, which
only matches the "literal argument is displayed" reading. The reverse
assignment would render a photo-negative (near-white background, dark text),
which is not what the photo shows.

Palette used (displayed RGB, i.e. the literal argument to `fix()`):

| name | hex | used for |
|---|---|---|
| `C_BG` | `#0D1117` | screen background |
| `C_SURFACE` | `#161B22` | card fills (clock card) |
| `C_SURFACE_HILITE` | `#2B3340` | card top-edge highlight (digital clock only, not used in these assets) |
| `C_WHITE` | `#F0F3F6` | primary text, battery outline/glyph |
| `C_BLACK` | `#000000` | text on the green status bar / LOCK button |
| `C_GREY` | `#7D8590` | secondary/dim text, unfilled ring dots |
| `C_GREEN` | `#35D07F` | UNLOCKED status bar, high battery fill, full timeout bar |
| `C_RED` | `#EF5350` | LOCKED status bar/countdown text, low timeout bar |
| `C_AMBER` | `#F2B84B` | CLOSED status bar, OVERRIDE title, mid battery/timeout bar |
| `ACCENT_COLORS_DARK[0]` (mint) | `#22C55E` | default accent — LOCK button fill, filled ring/gauge dots |
| `C_ON_ACCENT_DARK` | `#101010` | LOCK button label (near-black on light accent) |

## Font

`terminalio.FONT` — a small monospace **bitmap** font (not a vector/antialiased
face); `lock_ui.py`'s own arithmetic (`_clock_char_w = 6 * scale` in the clock
guide-column code) confirms a 6-px-wide monospace cell at scale 1, consistent
with the classic "6x8 cell / 5x7 glyph" bitmap font CircuitPython's
`terminalio` module embeds in firmware.

**The exact glyph bitmap table is not available in this offline repo** (it's
compiled into the CircuitPython firmware binary, not shipped as a font
asset). Substitute used: a custom-authored 5x7(-8)-in-6x8-cell blocky pixel
font (see `FONT_5X7` in the render script), rendered with hard pixel edges (no
anti-aliasing) and integer nearest-neighbor upscaling, matching the same cell
metrics the firmware code assumes.

Covers `A-Z a-z 0-9 space % . : - / < > = ( )`, **case-sensitive** — every
literal is rendered in the exact case `lock_ui.py` uses, not upper-cased.
This was a real bug in an earlier pass (caught by the manager on review):
`draw_text` looked glyphs up via `FONT_5X7.get(ch.upper())`, so the four
lowercase hint strings that actually appear in the source (`_build_control`'s
`"<- clock   battery ->"`, `_build_battery`'s `"<- timer    settings ->"`,
`_clock_hints`'s `"swipe right = timer"` / `"up/down = style"`, and
`_build_override`'s `"keep pressing to unlock"` / `"resets if you stop"`) were
rendering in caps regardless of what the firmware actually shows. Fixed by
authoring full lowercase glyphs and making the lookup case-sensitive
(`FONT_5X7.get(ch)`, falling back to the upper-case glyph only if a given
character truly has no distinct form). Two other case/content bugs were
caught in the same sweep: `_build_control`'s override-count hint is
`"x{}".format(...)` (lowercase `x`, was rendered `"X25"`), and
`_build_battery`'s watts line is `"~{:.1f} W (est)".format(r.watts)` (a space
before `W`, lowercase `(est)`, was rendered `"~0.3W (EST)"` with the space and
parens wrong — the parens then exposed a second bug, since `(`/`)` had no
glyph at all and were silently dropped by `draw_text`'s `if glyph is None:
continue`, until added.

Lowercase glyph design, per the manager's guidance: x-height letters
(a c e m n o r s u v w x z) sit rows 2-6 of the 8-row cell; ascenders
(b d f h k l t) use rows 0-6, the same height as uppercase; descenders
(g j p q y) keep x-height on rows 2-6 and drop their tail into row 7 — the row
that's always blank on uppercase/digits/punctuation — rather than shrinking
the x-height to fit. All of `_build_control`, `_build_clock_ring`,
`_build_clock_elapsed`, and `_build_battery` were re-grepped for every
`text=` literal (see next section) to confirm no other case mismatches
remain in the four rendered views.

## Views -> firmware source

| asset | firmware view | built from |
|---|---|---|
| `control-view-still.png` | primary/default view, `LockUI.show_idle()` | `_build_control` (`lock_ui.py` ~L311-521), default `DEFAULT_SECONDS=300` -> "5:00", `OVERRIDE_PRESSES=25` -> "x25" hint |
| `battery-view-still.png` / `battery-view-native.png` | `LockUI._build_battery` / `update_battery_view` | `lock_ui.py` ~L1036-1156; reading pinned to 88% / 4.01 V per the brief |
| `clock-ring-loop.webm` + `ring_frames/*.png` | clock view, "ring"/gauge style, running countdown | `_build_clock_ring` / `_set_gauge` / `update_clock_view` (`lock_ui.py` ~L789-1034) |
| `override-view-still.png` + `override-loop.webm` + `override_frames/*.png` | override overlay | `_build_override` / `show_override` / `_set_ovr_ring` / `update_override_timeout` (`lock_ui.py` ~L1159-1312) |

A physical rounded-corner alpha mask (radius 16px native, scaled with the
image) was added around all four assets' edges. This is **not** something
`lock_ui.py` renders — the firmware only ever draws a rectangular
framebuffer — it emulates the physical display module's own rounded bezel
visible in the reference photo, so the composited clip doesn't show a hard
rectangle sitting on top of the case texture.

### Battery view — the falsifiable check

Verified against `website/assets/video/seeds/seed-closed.png`: title
"BATTERY", battery glyph, "88%", "4.01 V" all present in matching position and
stacking order (title -> glyph -> big percent -> volts -> small watts line ->
bottom nav hint), which line up 1:1 with `_build_battery`'s actual y-offsets
(`bat_y+bat_h+44/+84/+150`, hint at `y=316`).

**One real discrepancy, called out rather than silently "fixed":** the
reference photo's battery glyph fill reads as washed-out near-white, not
green. The source code is unambiguous that a discharging battery at
`pct >= 50` fills with `C_GREEN` (`update_battery_view`, `lock_ui.py` ~L1133);
the photo almost certainly blooms/overexposes because it's a small, bright,
directly-lit screen shot at close range with a phone camera, not a color the
firmware would ever produce for 88%/not-charging. Per the brief's own rule
("where the photo and the code disagree, trust the code"), the fill here is
rendered green.

The `~0.3W (est)` line is illustrative, not derived: `lock_battery.py`'s
`watts` is a live discharge-rate *trend* (a smoothed `d(percent)/dt` sampled
over real elapsed seconds), with no closed-form value for a single static
frame — there is no "correct" wattage to compute for a still image.

## Override view — verified against source, not the paraphrase

Checked directly in `Box-code/lib/lock_config.py` and `lock_ui.py` before
building this (rather than trusting the summarized brief as-is):
- `OVERRIDE_PRESSES = 25` (default) — confirmed.
- `OVERRIDE_TIMEOUT = 3.0` seconds — confirmed.
- **Correction:** the brief described the press count as "user-adjustable
  10-100." The actual source (`lock_config.py`) defines
  `OVR_MIN = 5`, `OVR_MAX = 500`, `OVR_STEP = 5` — a 5-500 range in steps of 5,
  not 10-100. That range appears nowhere in `lock_config.py`. This asset uses
  the real default, 25.
- `update_override_timeout`'s bar thresholds are exactly `frac > 0.5` green,
  `frac > 0.2` amber, else red (`lock_ui.py` ~L1293-1302) — transcribed
  verbatim, not approximated.
- The press-pop is `lock_motion.Spring` displaced to `-OVR_POP_OFFSET_PX` (8px)
  with target 0 (`show_override`, ~L1278). This asset reproduces that as the
  closed-form solution of the same underdamped mass-spring-damper
  (`SPRING_STIFFNESS=300, SPRING_DAMPING=30, SPRING_MASS=1` from
  `lock_config.py`) rather than re-implementing `lock_motion.Spring`'s own
  numerical integrator, since only the response to a single isolated impulse
  per press was needed.

**Animation is an authored montage, not real-time**: per the manager's own
note, all 25 presses in real time wasn't required. The 6s/180-frame timeline:
four presses in quick succession (frames 5/20/35/50, count 0->4) with the
timeout bar staying green; then a deliberate ~2s pause with no presses,
long enough for the bar to drain into the amber band (`frac` bottoms out
around 0.33 at frame ~108 — see `override-view-still.png`, captured at frame
108 specifically to show this); a press right before the red zone/reset at
frame 110 (count -> 5, bar snaps back to full green) as the "you have to mean
it" near-miss beat; then a fast flurry of 20 presses 3 frames apart
(frames 113-170) landing on 25/25, held for the last 10 frames. No behavior
was invented beyond what the code defines — the reset-to-zero-on-timeout path
exists in the source but is never reached in this clip (the near-miss press
always lands before the bar hits zero), so it isn't shown.

## What couldn't be faithfully reproduced

- **Exact terminalio glyph shapes** — see Font section above; a custom pixel
  font (now with full, case-correct upper/lowercase coverage) was substituted,
  not the firmware's literal bitmap table.
- **The color-transition/easing engine** (`step_color_transitions`, 200ms
  ease-out-cubic on state-color changes) and the position springs' full
  numerical behavior (`lock_motion.Spring.step`) — approximated with a
  closed-form single-impulse response for the override pop; not reproduced at
  all for the ring view's white->red text transition (the ring clip opens
  already mid-"running", so no transition is on screen to reproduce).
- **`C_SURFACE_HILITE`** (the digital clock's static top-edge highlight) isn't
  exercised by any of the four requested views (control/battery/ring/override
  don't use `_build_clock_digital`), so it's defined in the palette table above
  but unused in these assets.

## How these were generated

Implementation lives in a Pillow (Python) script in the session scratchpad
(not committed to this repo, per file-ownership constraints) that draws each
view at native 172x320 using the exact geometry/color constants above, then
nearest-neighbor upscales. Battery and control views were additionally
opened in the Claude Browser pane (`file://.../battery-view-still.png`,
`override-view-still.png`) as the verification step against
`seeds/seed-closed.png`.

- Stills: native canvas -> `Image.resize(..., Image.NEAREST)` at **6x**
  (1032x1920).
- `ring_frames/` and `override_frames/`: native canvas -> NEAREST upscale at
  **4x** (688x1280), 30 fps, 180 frames (6.0s), rounded-corner alpha mask
  applied per frame.

ffmpeg commands actually run (absolute path, not on `PATH` in this
environment):

```sh
FFMPEG=/c/Users/emah/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe

# clock-ring-loop.webm
"$FFMPEG" -y -framerate 30 -i ring_frames/ring_%04d.png \
  -vf "format=yuva420p" -c:v libvpx-vp9 -pix_fmt yuva420p \
  -metadata:s:v:0 alpha_mode="1" -auto-alt-ref 0 -b:v 0 -crf 28 \
  clock-ring-loop.webm

# override-loop.webm
"$FFMPEG" -y -framerate 30 -i override_frames/override_%04d.png \
  -vf "format=yuva420p" -c:v libvpx-vp9 -pix_fmt yuva420p \
  -metadata:s:v:0 alpha_mode="1" -auto-alt-ref 0 -b:v 0 -crf 28 \
  override-loop.webm
```

**Playback/decode note:** this ffmpeg build's *default* `vp9` decoder silently
drops the alpha side-channel when re-reading these files (`ffprobe` reports
plain `yuv420p`even though the encode log confirms `yuva420p` + `alpha_mode=1`
were written). Verified the alpha data genuinely exists by forcing the
alpha-aware decoder on read:
`ffmpeg -c:v libvpx-vp9 -i clock-ring-loop.webm -pix_fmt rgba out.png`
(alpha channel extrema `(0, 255)`, confirming real per-pixel transparency).
Browsers' native VP9 decoders (Chrome, which is what the Higgsfield/compositing
pipeline is expected to use) handle WebM VP9 alpha correctly out of the box —
this is purely an `ffmpeg` CLI decode quirk on this machine, not a defect in
the exported files.
