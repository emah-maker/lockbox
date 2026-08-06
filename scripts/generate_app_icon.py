"""generate_app_icon.py -- renders app/assets/icon.png (1024x1024) for the Expo
app. Colors match the box's own on-device palette (Box-code/lib/lock_config.py:
C_BG/C_GREEN) so the app icon and the box screen read as one product. Simple,
bold shapes on purpose -- iOS shrinks this down to ~40px on a home screen.

Run: python scripts/generate_app_icon.py
"""
from PIL import Image, ImageDraw

SIZE = 1024
BG = (13, 17, 23)  # #0D1117 -- Box-code C_BG
MINT = (53, 208, 127)  # #35D07F -- Box-code C_GREEN
WHITE = (240, 243, 246)  # #F0F3F6 -- Box-code C_WHITE

img = Image.new('RGB', (SIZE, SIZE), BG)
draw = ImageDraw.Draw(img)

# Full-bleed square, no transparency and no pre-rounded corners: iOS applies
# its own corner mask over the raw square at build time, so baking in our own
# rounding here would just create a mismatched double edge.

# Phone silhouette: a simple rounded rect with a notch-free screen and a home
# indicator bar, centered and slightly above middle so the padlock has room
# to sit on its bottom edge.
phone_w, phone_h = 380, 620
phone_x0 = (SIZE - phone_w) // 2
phone_y0 = 190
phone_x1 = phone_x0 + phone_w
phone_y1 = phone_y0 + phone_h
draw.rounded_rectangle(
    [phone_x0, phone_y0, phone_x1, phone_y1], radius=64, outline=WHITE, width=26
)
# home indicator
bar_w, bar_h = 120, 14
draw.rounded_rectangle(
    [
        (SIZE - bar_w) // 2,
        phone_y1 - 56,
        (SIZE + bar_w) // 2,
        phone_y1 - 56 + bar_h,
    ],
    radius=bar_h // 2,
    fill=WHITE,
)

# Padlock: shackle (arc) + body (rounded rect), overlapping the phone's lower
# third -- the box's whole point, rendered as the dominant accent shape.
lock_w, lock_h = 340, 260
lock_cx = SIZE // 2
lock_body_y0 = 620
lock_body_y1 = lock_body_y0 + lock_h
lock_x0 = lock_cx - lock_w // 2
lock_x1 = lock_cx + lock_w // 2

shackle_w = 40
shackle_r = 110
draw.arc(
    [lock_cx - shackle_r, lock_body_y0 - shackle_r * 2 + 40, lock_cx + shackle_r, lock_body_y0 + 40],
    start=180,
    end=360,
    fill=MINT,
    width=shackle_w,
)

draw.rounded_rectangle(
    [lock_x0, lock_body_y0, lock_x1, lock_body_y1], radius=40, fill=MINT
)

# Keyhole notch in the lock body for a touch of detail at large sizes.
kh_cx, kh_cy = lock_cx, lock_body_y0 + lock_h // 2 - 10
draw.ellipse([kh_cx - 22, kh_cy - 22, kh_cx + 22, kh_cy + 22], fill=BG)
draw.polygon(
    [
        (kh_cx - 14, kh_cy + 10),
        (kh_cx + 14, kh_cy + 10),
        (kh_cx + 8, kh_cy + 58),
        (kh_cx - 8, kh_cy + 58),
    ],
    fill=BG,
)

out_path = 'app/assets/icon.png'
img.save(out_path)
print('wrote', out_path, img.size)
