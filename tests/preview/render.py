"""render.py -- host-side rasterizer for the Box-code displayio UI.

Builds a fake 172x320 display, imports the REAL Box-code/lib/lock_ui.LockUI
against tests/preview/shim's pure-Python stand-ins for displayio/
terminalio/adafruit_display_text/adafruit_display_shapes, and rasterizes
any of its screen groups to a PNG -- so a screen can be looked at without
deploying to the actual hardware.

See tests/preview/README.md for exactly what is and is not faithful here.

Usage:
    python tests/preview/render.py --list
    python tests/preview/render.py --screen settings --out out.png
    python tests/preview/render.py --all --outdir tests/preview/out
    python tests/preview/render.py --screen control --out out.png --scale 4 --grid
"""
import argparse
import os
import sys
from types import SimpleNamespace

from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PREVIEW_DIR = os.path.dirname(os.path.abspath(__file__))
SHIM_DIR = os.path.join(PREVIEW_DIR, "shim")
LIB = os.path.join(REPO, "Box-code", "lib")

DISPLAY_W = 172
DISPLAY_H = 320


def _install_shim():
    """Puts the shim's stand-in modules ahead of Box-code/lib on sys.path,
    so the real firmware's `import displayio` (etc.) resolves to
    tests/preview/shim/displayio.py instead of failing outright. Order
    matters: SHIM_DIR must come before LIB since neither directory's
    module names collide, but SHIM_DIR needs to win if they ever did."""
    # Insert LIB first, then SHIM_DIR, so SHIM_DIR ends up FIRST in
    # sys.path -- each insert(0, ...) pushes the previous one back, so
    # inserting in this order is what makes the shim win.
    for path in (LIB, SHIM_DIR):
        if path in sys.path:
            sys.path.remove(path)
        sys.path.insert(0, path)


_install_shim()

import displayio  # noqa: E402 -- must follow _install_shim()
import lock_config  # noqa: E402
import lock_settings  # noqa: E402
import lock_ui  # noqa: E402


def build_ui():
    display = displayio.Display(DISPLAY_W, DISPLAY_H, rotation=0)
    ui = lock_ui.LockUI(display)
    return ui


def discover_screens(ui):
    """Every renderable top-level screen group, keyed by a short name.

    A "screen" is any Group LockUI built that is never itself appended
    into another Group -- i.e. `foo_group` attributes with no parent (see
    displayio.Group._parent). That excludes redrawable sub-groups like
    bat_fill_group or tp_hold_fill_group, which ARE appended into their
    screen's own group and so do have a parent. clock_groups is handled
    separately since it's a list of 4 screens, not a single `*_group`
    attribute.
    """
    screens = {}
    for name, val in vars(ui).items():
        if not isinstance(val, displayio.Group):
            continue
        if not name.endswith("_group"):
            continue
        if val._parent is not None:
            continue
        key = name[: -len("_group")]
        if key == "call":
            key = "call_alert"
        screens[key] = val
    for style, group in zip(ui.clock_styles, ui.clock_groups):
        screens["clock_" + style] = group
    return screens


# ----- sample data for --populate --------------------------------------
def _sample_settings():
    # microcontroller.nvm is None in this shim, so Settings() already falls
    # back to its compiled-in defaults (see lock_settings.Settings._load) --
    # this is "realistic sample data" in the sense of being the same
    # defaults a freshly-flashed box would show, not invented numbers.
    return lock_settings.Settings()


def _sample_battery(charging=False):
    return SimpleNamespace(available=True, volts=3.87, percent=62,
                            charging=charging, watts=0.4)


def populate(ui):
    """Feeds every screen realistic sample data before rendering, since
    several groups only show real content after a setter is called (see
    module docstring / this file's --populate flag).

    Several fields are pushed to their real, app-adjustable MAXIMUM rather
    than a comfortable middle value -- override_presses to OVR_MAX (500),
    sleep_s/bright_pct to their top SLEEP_OPTIONS/BRIGHT_OPTIONS entries --
    because those are exactly the boundary lock_ui_panels.py's own comments
    reason about ("255/255... OVR_MAX's ceiling", now 500/500) as the
    widest text a row/detail page ever has to fit. A preview that only ever
    shows comfortable values would never exercise the layouts most likely
    to actually overflow.
    """
    settings = _sample_settings()
    settings.override_presses = lock_config.OVR_MAX
    settings.sleep_s = max(lock_config.SLEEP_OPTIONS)
    settings.bright_pct = max(lock_config.BRIGHT_OPTIONS)
    battery = _sample_battery()

    ui.update_corner_battery(battery)
    ui.update_corner_ble(True)

    ui.show_idle(3725)  # home screen, H:MM
    # update_clock_view only paints the CURRENTLY active clock style (see
    # its `style = self.clock_styles[self.clock_style_idx]` branch in
    # lock_ui_clock.py) -- cycle through all 4 so every clock face gets
    # real sample text instead of just whichever one happened to be active.
    for i in range(len(ui.clock_styles)):
        ui.clock_style_idx = i
        ui.update_clock_view(1834, 3600, "running")
    ui.clock_style_idx = 0
    ui.update_battery_view(battery)
    ui.update_settings(settings)
    ui.show_setting_detail(0, settings)
    ui.show_tag_picker(lock_config.BUILTIN_TOPICS)
    # 12 chars = BLE_LABEL_NAME_MAX_LEN, the widest a synced custom label's
    # name can be (see lock_ui_tags.py's tc_name comment) -- not truncated
    # by show_topic_confirm itself, unlike the tag-picker's own rows.
    ui.show_topic_confirm("Client Calls")
    ui.show_override(487, lock_config.OVR_MAX)
    ui.update_override_timeout(6.0, 10.0)
    # 15 chars: a realistic long contact name, under show_call_alert's own
    # [:16] cap (see lock_ui_panels.py) but wide enough to stress this
    # label's scale=3 width the way a short "Mom" sample never would.
    ui.show_call_alert("Alexandria Ruiz")


# ----- rendering ---------------------------------------------------------
def render_group(group, grid=False):
    img = Image.new("RGB", (DISPLAY_W, DISPLAY_H), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    group._paint(img, draw, 0, 0)
    if grid:
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        for x in range(0, DISPLAY_W, 10):
            odraw.line([(x, 0), (x, DISPLAY_H - 1)], fill=(255, 255, 255, 50))
        for y in range(0, DISPLAY_H, 10):
            odraw.line([(0, y), (DISPLAY_W - 1, y)], fill=(255, 255, 255, 50))
        odraw.rectangle([0, 0, DISPLAY_W - 1, DISPLAY_H - 1], outline=(255, 32, 32, 200))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return img


def save_png(img, path, scale):
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    out_dir = os.path.dirname(path)
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir, exist_ok=True)
    img.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="print every renderable screen name")
    ap.add_argument("--screen", help="render this one screen (see --list for names)")
    ap.add_argument("--out", help="output PNG path for --screen")
    ap.add_argument("--all", action="store_true", help="render every screen")
    ap.add_argument("--outdir", default=os.path.join(PREVIEW_DIR, "out"),
                     help="output directory for --all (default: tests/preview/out)")
    ap.add_argument("--scale", type=int, default=3,
                     help="NEAREST-neighbour upscale factor (default: 3)")
    ap.add_argument("--grid", action="store_true",
                     help="overlay a faint 10px grid + 1px screen border")
    ap.add_argument("--populate", dest="populate", action="store_true", default=True,
                     help="feed sample data to every screen before rendering (default: on)")
    ap.add_argument("--no-populate", dest="populate", action="store_false",
                     help="skip sample-data population; screens show their build-time defaults")
    args = ap.parse_args()

    ui = build_ui()
    if args.populate:
        populate(ui)
    screens = discover_screens(ui)

    if args.list:
        for name in sorted(screens):
            print(name)
        return 0

    if args.all:
        for name, group in sorted(screens.items()):
            img = render_group(group, grid=args.grid)
            path = os.path.join(args.outdir, name + ".png")
            save_png(img, path, args.scale)
            print("wrote " + path)
        return 0

    if args.screen:
        if args.screen not in screens:
            print("unknown screen: {!r}. Known screens: {}".format(
                args.screen, ", ".join(sorted(screens))), file=sys.stderr)
            return 1
        out = args.out or (args.screen + ".png")
        img = render_group(screens[args.screen], grid=args.grid)
        save_png(img, out, args.scale)
        print("wrote " + out)
        return 0

    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
