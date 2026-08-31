"""overflow_check.py -- automated regression gate for the overflow class of
UI bug (text running off a 172x320 panel, or one label drawn on top of
another).

Builds the real LockUI against tests/preview/shim (see render.py), feeds it
the same --populate sample data render.py uses, then walks every screen's
group tree collecting every visible Label's rendered bounding box (using
the exact same anchor-point math as the real adafruit_display_text.label.
Label -- see shim/adafruit_display_text/label.py). Fails (prints one line
per violation, non-zero exit) when a box:

  - crosses the screen's left/right edge (x < 0 or x + width > 172)
  - crosses the screen's top/bottom edge (y < 0 or y + height > 320)
  - overlaps another Label's box that shares the same immediate parent
    Group (i.e. the same screen, in every case this firmware's structure
    actually produces -- see discover_screens's docstring in render.py)

This is a real, current-firmware finding tool: it is expected to report
genuine violations if the firmware has any. That is the point -- see
tests/preview/README.md.

Run: python tests/preview/overflow_check.py
"""
import os
import sys

PREVIEW_DIR = os.path.dirname(os.path.abspath(__file__))
if PREVIEW_DIR not in sys.path:
    sys.path.insert(0, PREVIEW_DIR)

import render  # noqa: E402 -- installs the shim as an import-time side effect
import displayio  # noqa: E402 -- resolves to tests/preview/shim/displayio.py
from adafruit_display_text import label as label_mod  # noqa: E402

DISPLAY_W = render.DISPLAY_W
DISPLAY_H = render.DISPLAY_H


def collect_labels(group):
    """Every visible Label anywhere under `group`, as
    {label, parent_id, x, y, w, h} in absolute (screen) coordinates.
    `parent_id` is `id()` of the Label's immediate parent Group -- two
    Labels only count as "in the same group" (for the overlap check) if
    this matches."""
    items = []

    def walk(node, ox, oy, parent):
        if getattr(node, "hidden", False):
            return
        if isinstance(node, displayio.Group):
            gx, gy = ox + node.x, oy + node.y
            for child in node:
                walk(child, gx, gy, node)
        elif isinstance(node, label_mod.Label):
            if not node.text:
                return
            w, h = node.bounding_box_size()
            items.append({
                "label": node,
                "parent_id": id(parent),
                "x": ox + node.x,
                "y": oy + node.y,
                "w": w,
                "h": h,
            })

    walk(group, 0, 0, None)
    return items


def _boxes_overlap(a, b):
    ax0, ay0, ax1, ay1 = a["x"], a["y"], a["x"] + a["w"], a["y"] + a["h"]
    bx0, by0, bx1, by1 = b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]
    return ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1


def check_screen(name, group):
    violations = []
    items = collect_labels(group)

    for it in items:
        x, y, w, h = it["x"], it["y"], it["w"], it["h"]
        box = "box=(x={}, y={}, w={}, h={})".format(x, y, w, h)
        if x < 0 or x + w > DISPLAY_W:
            violations.append(
                "{}: label {!r} {} crosses the {}px screen width".format(
                    name, it["label"].text, box, DISPLAY_W))
        if y < 0 or y + h > DISPLAY_H:
            violations.append(
                "{}: label {!r} {} crosses the {}px screen height".format(
                    name, it["label"].text, box, DISPLAY_H))

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a, b = items[i], items[j]
            if a["parent_id"] != b["parent_id"]:
                continue
            if _boxes_overlap(a, b):
                violations.append(
                    "{}: label {!r} box=(x={}, y={}, w={}, h={}) overlaps "
                    "label {!r} box=(x={}, y={}, w={}, h={})".format(
                        name, a["label"].text, a["x"], a["y"], a["w"], a["h"],
                        b["label"].text, b["x"], b["y"], b["w"], b["h"]))

    return violations


def main():
    ui = render.build_ui()
    render.populate(ui)
    screens = render.discover_screens(ui)

    all_violations = []
    for name in sorted(screens):
        all_violations.extend(check_screen(name, screens[name]))

    if all_violations:
        for v in all_violations:
            print("FAIL " + v)
        print("\n{} violation(s) across {} screen(s).".format(
            len(all_violations), len(screens)))
        return 1

    print("PASS: no width/height overflow or label overlap found across "
          "{} screen(s).".format(len(screens)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
