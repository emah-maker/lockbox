# label.py -- host stand-in for adafruit_display_text.label.Label.
#
# Reproduces the real anchoring math: `anchor_point` is a (0..1, 0..1)
# fraction of the label's OWN bounding box, `anchored_position` is where
# that anchor point lands in parent coordinates. Whenever the text, scale,
# or either of those two change, the label's top-left (`.x`/`.y`) is
# recomputed from them -- exactly like the real Label re-laying itself out
# whenever `.text` is reassigned. Single-line only: nothing in this
# firmware ever puts "\n" in a Label (grepped), so multi-line layout /
# line_spacing is not implemented.
from _shapes_common import rgb


class Label:
    def __init__(self, font, text="", color=0xFFFFFF, scale=1,
                 anchor_point=(0.0, 0.0), anchored_position=None,
                 max_glyphs=None, background_color=None, **_ignored):
        # max_glyphs: accepted and ignored -- see lock_ui_panels.py's
        # _build_override comment for why the real firmware never passes
        # this (the board's installed Label rejects it outright).
        self.font = font
        self.hidden = False
        self._text = text
        self._scale = scale
        self.color = color
        self.background_color = background_color
        self._anchor_point = anchor_point
        self._anchored_position = anchored_position
        self.x = 0
        self.y = 0
        if anchored_position is not None:
            self._relayout()

    # ----- text -----
    @property
    def text(self):
        return self._text

    @text.setter
    def text(self, value):
        self._text = value
        self._relayout()

    # ----- scale -----
    @property
    def scale(self):
        return self._scale

    @scale.setter
    def scale(self, value):
        self._scale = value
        self._relayout()

    # ----- anchor_point / anchored_position -----
    @property
    def anchor_point(self):
        return self._anchor_point

    @anchor_point.setter
    def anchor_point(self, value):
        self._anchor_point = value
        self._relayout()

    @property
    def anchored_position(self):
        return self._anchored_position

    @anchored_position.setter
    def anchored_position(self, value):
        self._anchored_position = value
        self._relayout()

    # ----- layout -----
    def bounding_box_size(self):
        """(width, height) in pixels of this label's own bounding box, at
        its current text/scale -- terminalio.FONT's exact 6x8 advance box
        per glyph (see terminalio.py), times scale."""
        w = len(self._text) * self.font.advance * self._scale
        h = self.font.line_height * self._scale
        return w, h

    def _relayout(self):
        if self._anchored_position is None:
            return
        w, h = self.bounding_box_size()
        ax, ay = self._anchor_point
        px, py = self._anchored_position
        self.x = int(round(px - ax * w))
        self.y = int(round(py - ay * h))

    # ----- rendering (not part of the real API; see displayio.py's header) -----
    def _paint(self, img, draw, ox, oy):
        if self.hidden or not self._text or self.color is None:
            return
        color = rgb(self.color)
        advance = self.font.advance * self._scale
        line_h = self.font.line_height * self._scale
        left = ox + self.x
        top = oy + self.y
        if self.background_color is not None:
            w, h = self.bounding_box_size()
            draw.rectangle(
                [left, top, left + w - 1, top + h - 1],
                fill=rgb(self.background_color),
            )
        gx = left
        for ch in self._text:
            rows = self.font.get_glyph(ord(ch))
            for row_i, row in enumerate(rows):
                for col_i, on in enumerate(row):
                    if not on:
                        continue
                    px0 = gx + col_i * self._scale
                    py0 = top + row_i * self._scale
                    if self._scale == 1:
                        if 0 <= px0 < img.width and 0 <= py0 < img.height:
                            img.putpixel((px0, py0), color)
                    else:
                        draw.rectangle(
                            [px0, py0, px0 + self._scale - 1, py0 + self._scale - 1],
                            fill=color,
                        )
            gx += advance
