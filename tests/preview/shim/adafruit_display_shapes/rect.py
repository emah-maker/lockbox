# rect.py -- host stand-in for adafruit_display_shapes.rect.Rect.
from _shapes_common import _ShapeBase, rgb


class Rect(_ShapeBase):
    def __init__(self, x, y, width, height, *, fill=None, outline=None, stroke=1):
        self.x = x
        self.y = y
        self.width = width
        self.height = height
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
        draw.rectangle(
            [x0, y0, x1, y1],
            fill=rgb(self.fill),
            outline=rgb(self.outline),
            width=self.stroke if self.outline is not None else 1,
        )
