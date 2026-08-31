# bitmaptools.py -- host stand-in for CircuitPython's bitmaptools module.
#
# Everything except draw_line is genuinely unused at runtime by the code
# path this preview renderer exercises (grepped: lock_ui_clock.py is the
# only importer, and only calls draw_line, from _draw_hand -- which
# _build_clock_analog calls at CONSTRUCTION time, via `self._set_hands(0)`,
# to draw the initial clock hands). Unlike the other CircuitPython-only
# modules in this shim (board, microcontroller's sibling stubs, etc.),
# leaving this one an empty stub would make LockUI() itself raise
# AttributeError on the very first screen it builds -- so draw_line is a
# real, working Bresenham implementation, not a stub, and that is a
# deliberate departure from tests/test_firmware_loads.py's "stub-only,
# nothing touched at import time" list (that file only imports modules; it
# never calls their functions, so an empty stub is sufficient there. This
# renderer calls into LockUI's constructor, which does).
def draw_line(dest_bitmap, x0, y0, x1, y1, value):
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    sx = 1 if x1 >= x0 else -1
    sy = 1 if y1 >= y0 else -1
    x, y = x0, y0
    w, h = dest_bitmap.width, dest_bitmap.height
    if dx >= dy:
        err = dx // 2 if dx else 0
        for _ in range(dx + 1):
            if 0 <= x < w and 0 <= y < h:
                dest_bitmap[x, y] = value
            err -= dy
            if err < 0:
                y += sy
                err += dx
            x += sx
    else:
        err = dy // 2 if dy else 0
        for _ in range(dy + 1):
            if 0 <= x < w and 0 <= y < h:
                dest_bitmap[x, y] = value
            err -= dx
            if err < 0:
                x += sx
                err += dy
            y += sy
