# lock_ui_common.py -- the module-level helpers the view mixins share.
#
# Here rather than in lock_ui.py because lock_ui.py imports the mixins, so a
# mixin importing back from it would be a cycle. Nothing in this file touches
# `self`; it is arithmetic and one bitmap factory.

import displayio


def _bg_tile(w, h, color):
    bmp = displayio.Bitmap(w, h, 1)
    pal = displayio.Palette(1)
    pal[0] = color
    return displayio.TileGrid(bmp, pixel_shader=pal)

# Hard ceiling on any spring-driven position offset actually applied to a
# widget, in _step_motion below -- independent of whatever is or isn't wrong
# further upstream in lock_motion.Spring's math. The largest INTENDED
# amplitude among the three springs that use this (press-depth 3px, override
# pop 8px, done-message pop 16px -- lock_config.py) is 16px; this leaves
# room for a legitimate slight spring overshoot past its target without ever
# letting a widget visibly fly across the screen, regardless of the cause.
_MAX_MOTION_OFFSET_PX = 40

def _clamp_offset(v):
    if v > _MAX_MOTION_OFFSET_PX:
        return _MAX_MOTION_OFFSET_PX
    if v < -_MAX_MOTION_OFFSET_PX:
        return -_MAX_MOTION_OFFSET_PX
    return v
