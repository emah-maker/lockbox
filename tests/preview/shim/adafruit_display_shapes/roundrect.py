# roundrect.py -- host stand-in for adafruit_display_shapes.roundrect.RoundRect.
#
# Uses Pillow's ImageDraw.rounded_rectangle, which draws a REAL quarter-
# circle corner of the given radius (not a chamfer/approximation) -- the
# same corner geometry the real adafruit RoundRect produces.
from _shapes_common import _ShapeBase, rgb


class RoundRect(_ShapeBase):
    def __init__(self, x, y, width, height, r, *, fill=None, outline=None, stroke=1):
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.r = r
        self.fill = fill
        self.outline = outline
        self.stroke = stroke
        self.hidden = False

    def _paint(self, img, draw, ox, oy):
        if self.hidden or self.width <= 0 or self.height <= 0:
            return
        if self.fill is None and self.outline is None:
            return
        x0, y0 = ox + self.x, oy + self.y
        x1, y1 = x0 + self.width - 1, y0 + self.height - 1
        radius = max(0, min(self.r, (x1 - x0) // 2, (y1 - y0) // 2))
        draw.rounded_rectangle(
            [x0, y0, x1, y1],
            radius=radius,
            fill=rgb(self.fill),
            outline=rgb(self.outline),
            width=self.stroke if self.outline is not None else 1,
        )
