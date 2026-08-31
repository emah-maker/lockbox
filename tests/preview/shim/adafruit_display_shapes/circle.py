# circle.py -- host stand-in for adafruit_display_shapes.circle.Circle.
# Constructor is (x0, y0, r, ...) -- center + radius, matching the real API
# and how lock_ui_clock.py / lock_ui_panels.py / lock_ui_theme.py call it.
from _shapes_common import _ShapeBase, rgb


class Circle(_ShapeBase):
    def __init__(self, x0, y0, r, *, fill=None, outline=None, stroke=1):
        self.x0 = x0
        self.y0 = y0
        self.r = r
        self.fill = fill
        self.outline = outline
        self.stroke = stroke
        self.hidden = False

    # Real adafruit_display_shapes.circle.Circle exposes `.x`/`.y` as the
    # TileGrid's top-left (x0 - r, y0 - r), not the center -- but nothing in
    # this firmware moves a Circle after construction (unlike RoundRect/Rect,
    # which get `.y =` reassigned for press-dip motion), so that distinction
    # is untested territory here. `.x`/`.y` are exposed as aliases of the
    # center for read-back consistency with the other shapes' `.x`/`.y`
    # contract, not because a firmware call site depends on it.
    @property
    def x(self):
        return self.x0

    @x.setter
    def x(self, v):
        self.x0 = v

    @property
    def y(self):
        return self.y0

    @y.setter
    def y(self, v):
        self.y0 = v

    def _paint(self, img, draw, ox, oy):
        if self.hidden or self.r <= 0:
            return
        if self.fill is None and self.outline is None:
            return
        cx, cy = ox + self.x0, oy + self.y0
        draw.ellipse(
            [cx - self.r, cy - self.r, cx + self.r, cy + self.r],
            fill=rgb(self.fill),
            outline=rgb(self.outline),
            width=self.stroke if self.outline is not None else 1,
        )
