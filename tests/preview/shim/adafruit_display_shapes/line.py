# line.py -- host stand-in for adafruit_display_shapes.line.Line.
# Not used by the current firmware (grepped: no Line( call sites in
# firmware/lib/*.py) -- included for the shim's own completeness per the
# adafruit_display_shapes surface, but untested against any real call site.
from _shapes_common import _ShapeBase, rgb


class Line(_ShapeBase):
    def __init__(self, x0, y0, x1, y1, *, color=None):
        self.x0, self.y0 = x0, y0
        self.x1, self.y1 = x1, y1
        self.color = color
        self.hidden = False

    @property
    def x(self):
        return self.x0

    @x.setter
    def x(self, v):
        dx = v - self.x0
        self.x0 += dx
        self.x1 += dx

    @property
    def y(self):
        return self.y0

    @y.setter
    def y(self, v):
        dy = v - self.y0
        self.y0 += dy
        self.y1 += dy

    def _paint(self, img, draw, ox, oy):
        if self.hidden or self.color is None:
            return
        draw.line(
            [(ox + self.x0, oy + self.y0), (ox + self.x1, oy + self.y1)],
            fill=rgb(self.color),
            width=1,
        )
