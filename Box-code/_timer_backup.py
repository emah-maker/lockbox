import time
import board
import busio
import displayio
import terminalio
from adafruit_display_text import label
from adafruit_display_shapes.roundrect import RoundRect
from axs5106l import AXS5106L

# ===================== Tunables =====================
STEP_SECONDS = 30          # how much one swipe adds/removes
SWIPE_MIN_PX = 40          # min vertical travel to count as a swipe
MAX_SECONDS = 99 * 60 + 59  # cap (99:59)

DEBUG = True               # show live raw touch data at the bottom of the screen

# Touch->screen mapping. Panel is native 172x320.
SWAP_XY = False
INVERT_X = False
INVERT_Y = False
# ====================================================


# ---- This panel (JD9853) byte-swaps RGB565, which scrambles colors.
# rgb() pre-compensates so an intended 0xRRGGBB shows correctly. ----
def rgb(c):
    r = (c >> 16) & 0xFF
    g = (c >> 8) & 0xFF
    b = c & 0xFF
    v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)   # pack to RGB565
    v = ((v & 0xFF) << 8) | (v >> 8)                    # swap the two bytes
    r2 = ((v >> 11) & 0x1F) << 3
    g2 = ((v >> 5) & 0x3F) << 2
    b2 = (v & 0x1F) << 3
    return (r2 << 16) | (g2 << 8) | b2


C_BG = rgb(0x000000)
C_TITLE = rgb(0xFFAA00)
C_TIME = rgb(0xFFFFFF)
C_TIME_DONE = rgb(0xFF3030)
C_HINT = rgb(0x888888)
C_START = rgb(0x00AA44)
C_STOP = rgb(0xCC0000)
C_RESET = rgb(0xFFAA00)
C_BTN_TEXT = rgb(0xFFFFFF)
C_BTN_OUTLINE = rgb(0xFFFFFF)
C_DEBUG = rgb(0x00FF00)

# ----- Display -----
display = board.DISPLAY
W, H = display.width, display.height

group = displayio.Group()

bg_bitmap = displayio.Bitmap(W, H, 1)
bg_palette = displayio.Palette(1)
bg_palette[0] = C_BG
group.append(displayio.TileGrid(bg_bitmap, pixel_shader=bg_palette))

title = label.Label(terminalio.FONT, text="COUNTDOWN", color=C_TITLE, scale=2)
title.anchor_point = (0.5, 0.5)
title.anchored_position = (W // 2, 32)
group.append(title)

clock = label.Label(terminalio.FONT, text="01:00", color=C_TIME, scale=4)
clock.anchor_point = (0.5, 0.5)
clock.anchored_position = (W // 2, H // 2 - 20)
group.append(clock)

hint = label.Label(terminalio.FONT, text="swipe up/down to set", color=C_HINT)
hint.anchor_point = (0.5, 0.5)
hint.anchored_position = (W // 2, H // 2 + 30)
group.append(hint)

# ----- Start/Stop button (rounded rect) -----
BTN_W, BTN_H = 124, 56
BTN_X = (W - BTN_W) // 2
BTN_Y = H - BTN_H - 28
button = RoundRect(BTN_X, BTN_Y, BTN_W, BTN_H, 12,
                   fill=C_START, outline=C_BTN_OUTLINE, stroke=2)
group.append(button)

btn_label = label.Label(terminalio.FONT, text="START", color=C_BTN_TEXT, scale=2)
btn_label.anchor_point = (0.5, 0.5)
btn_label.anchored_position = (W // 2, BTN_Y + BTN_H // 2)
group.append(btn_label)

dbg = None
if DEBUG:
    dbg = label.Label(terminalio.FONT, text="touch: --", color=C_DEBUG)
    dbg.anchor_point = (0.5, 1.0)
    dbg.anchored_position = (W // 2, H - 4)
    group.append(dbg)

display.root_group = group

# ----- Touch -----
try:
    i2c = board.TOUCH_I2C()
except AttributeError:
    i2c = busio.I2C(board.SCL, board.SDA)
reset_pin = getattr(board, "TOUCH_RST", None)
touch = AXS5106L(i2c, reset_pin=reset_pin)


def map_touch(p):
    x, y = p
    if SWAP_XY:
        x, y = y, x
    if INVERT_X:
        x = W - x
    if INVERT_Y:
        y = H - y
    return x, y


def in_button(x, y):
    return BTN_X <= x <= BTN_X + BTN_W and BTN_Y <= y <= BTN_Y + BTN_H


def fmt(secs):
    secs = max(0, int(secs))
    return "{:02d}:{:02d}".format(secs // 60, secs % 60)


def set_button(mode):
    if mode == "stop":
        button.fill = C_STOP
        btn_label.text = "STOP"
    elif mode == "reset":
        button.fill = C_RESET
        btn_label.text = "RESET"
    else:
        button.fill = C_START
        btn_label.text = "START"


# ----- State -----
remaining = 60
running = False
done = False
deadline = 0.0

clock.text = fmt(remaining)

was_down = False
start_pt = None
last_pt = None

while True:
    now = time.monotonic()

    if running:
        left = deadline - now
        if left <= 0:
            remaining = 0
            running = False
            done = True
            set_button("reset")
            hint.text = "TIME'S UP"
            clock.color = C_TIME_DONE
            clock.text = "00:00"
        else:
            clock.text = fmt(left + 0.999)

    # ----- read touch -----
    if DEBUG:
        raw_count, points = touch.debug_read()
        if points:
            rx, ry = points[0]
            dbg.text = "n={} x={} y={}".format(raw_count, rx, ry)
        else:
            dbg.text = "n={} (no point)".format(raw_count)
    else:
        points = touch.touches

    is_down = len(points) > 0

    if is_down:
        pt = map_touch(points[0])
        if not was_down:
            start_pt = pt
        last_pt = pt

    if was_down and not is_down and start_pt and last_pt:
        dx = last_pt[0] - start_pt[0]
        dy = last_pt[1] - start_pt[1]

        if abs(dy) >= SWIPE_MIN_PX and abs(dy) >= abs(dx):
            if not running:
                if done:
                    done = False
                    clock.color = C_TIME
                if dy < 0:                     # swipe up = more time
                    remaining = min(MAX_SECONDS, remaining + STEP_SECONDS)
                else:                          # swipe down = less time
                    remaining = max(0, remaining - STEP_SECONDS)
                clock.text = fmt(remaining)
                hint.text = "swipe up/down to set"
                set_button("start")
        elif in_button(*last_pt) and in_button(*start_pt):
            if done:
                done = False
                remaining = 60
                clock.color = C_TIME
                clock.text = fmt(remaining)
                hint.text = "swipe up/down to set"
                set_button("start")
            elif running:
                running = False
                remaining = max(0, int(deadline - now))
                clock.text = fmt(remaining)
                hint.text = "paused"
                set_button("start")
            elif remaining > 0:
                running = True
                deadline = now + remaining
                hint.text = "running..."
                set_button("stop")

        start_pt = None
        last_pt = None

    was_down = is_down
    time.sleep(0.03)
