# displayio.py -- host stand-in for CircuitPython's displayio module.
#
# Faithful to the real API surface the firmware actually touches (Bitmap
# indexed-pixel storage, Palette with transparency, TileGrid positioning,
# Group as a list-like scene node, a Display-ish root object) so
# firmware/lib/lock_ui*.py imports and runs against this unmodified.
#
# Each concrete widget additionally carries a private `_paint(...)` hook --
# NOT part of the real displayio API -- that tests/preview/render.py's
# compositor calls to rasterize it into a Pillow image. That hook is this
# shim's own rendering engine, bolted on rather than pretending to be a
# real display driver; see tests/preview/README.md's fidelity-limits
# section.

from PIL import ImageDraw


def _rgb(color):
    """int24 0xRRGGBB -> (r, g, b), undoing lock_util.fix()'s XOR
    pre-compensation for this panel's hardware color inversion -- see
    tests/preview/shim/_shapes_common.py's `rgb()` docstring for the full
    explanation; this is the same transform, duplicated here rather than
    imported so displayio.py has no dependency on the shapes shim."""
    color = 0xFFFFFF ^ color
    return ((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF)


class Bitmap:
    """Indexed-pixel buffer. Real displayio.Bitmap supports `bmp[x, y]` and
    the flat `bmp[y * width + x]` form for both get and set; both are
    reproduced here since lock_ui_clock.py's hand-drawing path is the one
    piece of firmware logic that reads pixels back out of a Bitmap it just
    drew into (via bitmaptools.draw_line, not indexing directly today, but
    kept general since nothing here should assume otherwise)."""

    def __init__(self, width, height, color_count):
        self.width = width
        self.height = height
        self.color_count = color_count
        self._data = [0] * (width * height)

    def _index(self, key):
        if isinstance(key, tuple):
            x, y = key
            return y * self.width + x
        return key

    def __getitem__(self, key):
        return self._data[self._index(key)]

    def __setitem__(self, key, value):
        self._data[self._index(key)] = value

    def fill(self, value):
        self._data = [value] * (self.width * self.height)


class Palette:
    """Indexed color table. Real displayio.Palette supports `pal[i] = color`
    and `.make_transparent(i)` -- both reproduced. Colors are stored as the
    plain int24 the firmware sets them to (e.g. `pal[0] = 0x0D1117`), not
    pre-converted, so a widget's own color-equality checks (see LockUI.
    _start_color_transition's `frm == to_color`) compare like with like."""

    def __init__(self, count):
        self._colors = [0] * count
        self._transparent = set()

    def __len__(self):
        return len(self._colors)

    def __getitem__(self, index):
        return self._colors[index]

    def __setitem__(self, index, color):
        self._colors[index] = color

    def make_transparent(self, index):
        self._transparent.add(index)

    def make_opaque(self, index):
        self._transparent.discard(index)

    def is_transparent(self, index):
        return index in self._transparent


class TileGrid:
    """A single Bitmap+Palette pair positioned at (x, y). The firmware only
    ever uses this with a single tile (no tilemap paging), so this shim
    does not model tile_width/tile_height/multiple tiles at all -- always
    one tile, the whole bitmap."""

    def __init__(self, bitmap, pixel_shader=None, x=0, y=0, **_ignored):
        self.bitmap = bitmap
        self.pixel_shader = pixel_shader
        self.x = x
        self.y = y
        self.hidden = False
        self._parent = None

    def _paint(self, img, draw, ox, oy):
        if self.hidden:
            return
        bmp = self.bitmap
        pal = self.pixel_shader
        left = ox + self.x
        top = oy + self.y
        # Fast path: a single-color, fully-opaque bitmap (every _bg_tile in
        # this firmware) is just a filled rectangle -- avoids a per-pixel
        # putpixel loop over a full 172x320 background on every render.
        if bmp.color_count == 1 and not pal.is_transparent(0):
            draw.rectangle(
                [left, top, left + bmp.width - 1, top + bmp.height - 1],
                fill=_rgb(pal[0]),
            )
            return
        for py in range(bmp.height):
            for px in range(bmp.width):
                v = bmp[px, py]
                if pal.is_transparent(v):
                    continue
                ix, iy = left + px, top + py
                if 0 <= ix < img.width and 0 <= iy < img.height:
                    img.putpixel((ix, iy), _rgb(pal[v]))


class Group:
    """List-like scene node. Real displayio.Group supports append/pop/
    insert/len/iter plus `.hidden`, `.x`, `.y`, `.scale` -- all reproduced.

    `_parent` is NOT part of the real API -- tests/preview/render.py's
    screen discovery uses it to tell a top-level screen Group (LockUI
    builds one per screen and never appends it into anything else) apart
    from a nested sub-group used as a redrawable fill (e.g. bat_fill_group,
    appended straight into battery_group)."""

    def __init__(self):
        self._items = []
        self.hidden = False
        self.x = 0
        self.y = 0
        self.scale = 1
        self._parent = None

    def append(self, item):
        self._adopt(item)
        self._items.append(item)

    def insert(self, index, item):
        self._adopt(item)
        self._items.insert(index, item)

    def pop(self, index=-1):
        item = self._items.pop(index)
        if getattr(item, "_parent", None) is self:
            item._parent = None
        return item

    def _adopt(self, item):
        try:
            item._parent = self
        except AttributeError:
            pass

    def __len__(self):
        return len(self._items)

    def __iter__(self):
        return iter(self._items)

    def __getitem__(self, index):
        return self._items[index]

    def _paint(self, img, draw, ox, oy):
        if self.hidden:
            return
        gx, gy = ox + self.x, oy + self.y
        for item in self._items:
            paint = getattr(item, "_paint", None)
            if paint is not None:
                paint(img, draw, gx, gy)


class Display:
    """Stand-in for the board.DISPLAY object LockUI is built against --
    real firmware gets this from board/framebufferio/i2cdisplaybus, none of
    which have a host equivalent, so tests/preview/render.py constructs
    this directly instead."""

    def __init__(self, width, height, rotation=0):
        self.width = width
        self.height = height
        self.rotation = rotation
        self.root_group = None
