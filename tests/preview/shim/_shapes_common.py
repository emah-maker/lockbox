# _shapes_common.py -- shared plumbing for the adafruit_display_shapes
# stand-ins (rect/roundrect/circle/triangle/line): the x/y/fill/outline/
# stroke/hidden attribute contract every real adafruit_display_shapes class
# exposes, plus the int24-color helper.
#
# Rasterization itself is hard-edged (no anti-aliasing) via Pillow's
# ImageDraw, matching the real library's look on an actual panel -- there
# is no sub-pixel blending in either.


def rgb(color):
    """int24 -> (r, g, b), undoing lock_util.fix()'s XOR pre-compensation.

    Every color constant in lock_config.py is wrapped in `fix(c) = 0xFFFFFF
    ^ c` (see lock_util.fix's comment: "This panel's init has color
    INVERSION on... fix() sends the inverse so colors render correctly").
    That XOR is compensating for the REAL PANEL's own hardware inversion
    register -- on real hardware, the stored (fixed) value passes through
    that inversion and comes out as the intended color. This host renderer
    has no such hardware stage, so painting the stored value directly would
    show the pre-compensation (backwards) colors -- e.g. a cream background
    and magenta accent instead of the intended dark slate + mint. XOR-ing
    again here cancels fix()'s own XOR, landing back on the color the
    firmware actually intends a human to see, which is what this preview
    tool exists to show. Not a guess: this exactly mirrors fix()'s own
    documented transform, applied a second time."""
    if color is None:
        return None
    color = 0xFFFFFF ^ color
    return ((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF)


class _ShapeBase:
    """Not a real adafruit_display_shapes base class (the real ones don't
    share one) -- just where this shim's common `.x`/`.y`/`.hidden` state
    and `_paint` dispatch live, since every shape here works the same way:
    a small pure-Python object with mutable geometry/color, rasterized by
    `_paint` in absolute (offset-applied) coordinates."""

    hidden = False
    _parent = None

    def _paint(self, img, draw, ox, oy):
        raise NotImplementedError
