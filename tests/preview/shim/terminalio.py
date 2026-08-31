# terminalio.py -- host stand-in for CircuitPython's built-in terminalio
# module. The real module exposes exactly one public name, FONT: a fixed
# 6x8px bitmap font baked into the firmware binary.
#
# What is EXACT here: FONT.advance == 6 and FONT.line_height == 8 (per
# glyph, before any Label `scale` multiplies them) -- firmware layout math
# (label widths, row pitches, anchor centering) depends on these two
# numbers being right, so get_glyph_size() below reproduces them precisely.
#
# What is a STAND-IN: the glyph pixel data itself (see _font6x8.py's
# docstring) -- an original hand-drawn font, not the real terminalio
# bitmap, which isn't available outside the compiled firmware.
from _font6x8 import ADVANCE_W, ADVANCE_H, get_glyph


class _BuiltinFont:
    advance = ADVANCE_W       # exact: real terminalio.FONT glyph advance, px
    line_height = ADVANCE_H   # exact: real terminalio.FONT glyph height, px

    def get_glyph(self, codepoint):
        return get_glyph(codepoint)

    def get_bounding_box(self):
        # Matches BuiltinFont.get_bounding_box()'s real (width, height, ...)
        # shape closely enough for anything that only reads [0]/[1].
        return (ADVANCE_W, ADVANCE_H, 0, 0)


FONT = _BuiltinFont()
