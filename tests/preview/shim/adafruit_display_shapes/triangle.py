# triangle.py -- host stand-in for adafruit_display_shapes.triangle.Triangle.
# Constructor is (x0, y0, x1, y1, x2, y2, ...) -- three vertices.
from _shapes_common import _ShapeBase, rgb


class Triangle(_ShapeBase):
    def __init__(self, x0, y0, x1, y1, x2, y2, *, fill=None, outline=None, stroke=1):
        self.x0, self.y0 = x0, y0
        self.x1, self.y1 = x1, y1
        self.x2, self.y2 = x2, y2
        self.fill = fill
        self.outline = outline
        self.stroke = stroke
        self.hidden = False

    # Real Triangle exposes `.x`/`.y` as its TileGrid's top-left corner of
    # the bounding box, not vertex 0 -- this firmware never reads or sets
    # either on a Triangle (only fill, at construction time), so this alias
    # (vertex 0) is a guess made for the `.x`/`.y` contract's sake, not a
    # behaviour any call site here actually exercises.
    @property
    def x(self):
        return self.x0

    @x.setter
    def x(self, v):
        dx = v - self.x0
        self.x0 += dx
        self.x1 += dx
        self.x2 += dx

    @property
    def y(self):
        return self.y0

    @y.setter
    def y(self, v):
        dy = v - self.y0
        self.y0 += dy
        self.y1 += dy
        self.y2 += dy

    def _paint(self, img, draw, ox, oy):
        if self.hidden:
            return
        if self.fill is None and self.outline is None:
            return
        pts = [
            (ox + self.x0, oy + self.y0),
            (ox + self.x1, oy + self.y1),
            (ox + self.x2, oy + self.y2),
        ]
        # Pillow's polygon() outline is always 1px regardless of `width` --
        # not exercised by this firmware (every Triangle call site here
        # passes fill only, never outline+stroke), so that gap is harmless
        # in practice but real.
        draw.polygon(pts, fill=rgb(self.fill), outline=rgb(self.outline))
