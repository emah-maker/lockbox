# Host-side displayio preview renderer

## What this is

Box-code/lib/lock_ui.py builds its screens with `displayio` -- a
CircuitPython-only display stack that does not exist on a laptop. Until
now, checking whether a screen actually fit on the box's 172x320 panel
meant deploying to real hardware; several geometry constants in
Box-code/lib carry a comment saying exactly that ("needs an on-device
visual check, no host-runnable renderer exists for this display stack").

This directory closes that gap:

- `shim/` -- pure-Python stand-ins for `displayio`, `terminalio`,
  `adafruit_display_text.label`, `adafruit_display_shapes`, and empty
  stubs for the rest of the CircuitPython-only modules -- faithful enough
  that the REAL, unmodified `Box-code/lib/lock_ui*.py` imports and runs
  against them.
- `render.py` -- imports the real `LockUI`, feeds it sample data, and
  rasterizes any screen to a PNG with Pillow.
- `overflow_check.py` -- an automated regression gate: walks every
  screen's group tree and fails if any Label's box crosses the 172x320
  panel or overlaps another Label.

## Commands

```
python tests/preview/render.py --list
python tests/preview/render.py --screen settings --out out.png
python tests/preview/render.py --all --outdir tests/preview/out
python tests/preview/render.py --screen control --out out.png --scale 4 --grid
python tests/preview/render.py --screen control --out out.png --no-populate
python tests/preview/overflow_check.py
python tests/test_firmware_loads.py   # unaffected -- run to confirm this addition broke nothing
```

`--scale` (default 3) upscales the 172x320 PNG with NEAREST-neighbour so
it's actually legible; `--grid` overlays a faint 10px grid and a 1px
screen-edge border for measuring things by eye. `--populate` (on by
default) feeds every screen realistic sample data first -- several
screens (settings, tag picker, override, ...) show nothing meaningful
until a setter is called; `--no-populate` renders build-time defaults
instead (mostly blank/placeholder text, e.g. "--", "0:00").

## Fidelity limits -- read before trusting a pixel

This is a stand-in, not an emulator. Specifically:

- **Glyph shapes are not the real font.** `terminalio.FONT` is a fixed
  6x8px bitmap font compiled into CircuitPython's firmware binary -- there
  is no file to read on a host, so `shim/_font6x8.py` is an
  ORIGINAL, hand-drawn 5x7 font (padded to the real 6x8 advance box), not
  a reproduction of the real glyph bitmaps. What IS exact: the metrics --
  6px advance / 8px line height per glyph, before `scale` -- since that's
  what firmware layout math (label widths, row pitches, centering) actually
  depends on. Lowercase descenders (g, j, p, q, y) sit on the baseline
  instead of hanging below it (there's no 8th row to spare). Every
  printable ASCII character (32-126) renders as *something* legible, but
  don't compare exact letterforms against a real photo of the panel.
- **No panel gamma, backlight, or color reproduction.** Colors are plain
  sRGB int24 values straight into a PNG. There's also one deliberate,
  documented un-inversion: every color constant in `lock_config.py` is
  wrapped in `lock_util.fix()`, which XORs it to compensate for this
  specific panel's hardware color-inversion setting (see `fix()`'s own
  comment). This shim's color conversion (`shim/_shapes_common.py`'s
  `rgb()`) XORs a second time to undo that compensation -- otherwise every
  screen would render in backwards (inverted) colors, since there's no
  hardware inversion stage on a host. That is an exact mirror of `fix()`'s
  own transform, not a guess, but it does mean colors here are the
  *intended* design colors, not a literal simulation of raw framebuffer
  bytes.
- **RoundRect corners are real quarter-circles** (Pillow's
  `rounded_rectangle`), matching the real adafruit RoundRect's geometry --
  not a guess.
- **No touch / hit-testing simulation.** `on_touch_down`, the various
  `in_button`/`*_row_at`/`*_nav_at` methods, press-spring motion, and color
  transitions are none of them exercised here -- this renders a single
  static frame per screen, at whatever state `render.populate()` (or the
  real widget defaults) leaves it in.
- **bitmaptools is a real implementation, not a stub, for one function.**
  Every other CircuitPython-only module here (`board`, `busio`,
  `microcontroller`'s siblings, etc.) is an intentionally empty stub, same
  as `tests/test_firmware_loads.py` uses -- nothing calls into them. But
  `LockUI.__init__` draws the analog clock's hands at construction time
  (`_build_clock_analog` calls `_set_hands(0)`), which calls
  `bitmaptools.draw_line` -- so that one function is a real Bresenham
  line-drawer (`shim/bitmaptools.py`), not an empty stub, or building
  *any* screen would raise `AttributeError` immediately.
- **`Circle`/`Triangle`/`Line`'s `.x`/`.y` are a guess.** The real
  adafruit shape classes expose `.x`/`.y` as their backing TileGrid's
  top-left corner, not a vertex/center -- but nothing in the current
  firmware ever reads or moves a Circle/Triangle/Line after construction
  (only Rect and RoundRect get `.y =` reassigned, for press-dip motion),
  so this shim aliases `.x`/`.y` to the center (Circle) or vertex 0
  (Triangle/Line) for attribute-contract completeness, not because any
  real call site depends on the choice.
- **Label anchor/layout math is exact** (anchor_point as a fraction of the
  label's own bounding box, anchored_position as where that lands in
  parent coordinates, re-laid-out on every text/scale/anchor change) --
  this is the one piece of geometry the task cared most about getting
  right, since it's what most of Box-code/lib's layout constants are
  reasoned from.

## Known current-firmware findings

Run `python tests/preview/overflow_check.py`. As of this writing it
reports exactly one violation: the incoming-call alert's caller-name label
(`call_who`, scale=3) overflows the 172px screen width for any realistic
contact name longer than a handful of characters -- `show_call_alert`
truncates by *character count* (`who[:16]`), not by rendered pixel width.
At scale=3 each glyph is 18px wide, so its 16-character cap allows up to
288px of text on a 172px-wide screen -- a 15-char sample name
("Alexandria Ruiz") already overflows both edges. See the tool's own
output for the exact box.
