"""Host checks that every firmware module in Box-code/ still LOADS.

Not a behaviour test -- the other files in this directory cover behaviour for
the modules that have any testable logic. This one covers the failure those
cannot: a module that does not parse, or that references a name at import
time which no longer exists.

Why that is worth its own gate here. The box runs CircuitPython off a USB
mass-storage volume, and deployment is copying files onto it -- there is no
build step between an edit and a boot, so nothing except the device itself
ever discovers a syntax error. The device discovers it by failing to start,
and re-deploying to a box in that state is not free (the volume has to come
back read-write, and a bad unmount corrupts the FAT). Two of the modules here
are also the largest files in the repo by a wide margin -- lock_ui.py alone
is 2100 lines and has no other test at all -- which is exactly where a stray
edit goes unnoticed.

CircuitPython-only modules (board, displayio, pwmio, ...) are stubbed as
empty modules: none of their attributes are touched at import time, and the
point is to reach the module body, not to run it. The vendored Adafruit
display libraries ship as .mpy bytecode, which CPython cannot read at all, so
the handful of names lock_ui.py imports from them are stubbed as placeholder
classes -- they are only ever CALLED inside methods, never at import.

Run: python tests/test_firmware_loads.py
"""
import glob
import os
import sys
import types

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(REPO, "Box-code", "lib")
sys.path.insert(0, LIB)

_passed = 0
_failed = 0


def check(name, ok, detail=""):
    global _passed, _failed
    if ok:
        _passed += 1
        print("PASS " + name)
    else:
        _failed += 1
        print("FAIL " + name + ((" -- " + detail) if detail else ""))


# --- 1. Everything parses -------------------------------------------------
#
# The bricking case: a file that does not compile stops the box booting, and
# nothing upstream of the device would have said so.
sources = sorted(glob.glob(os.path.join(REPO, "Box-code", "lib", "*.py"))) + sorted(
    glob.glob(os.path.join(REPO, "Box-code", "*.py"))
)
check("found the firmware sources to check", len(sources) >= 15, "found {}".format(len(sources)))
for path in sources:
    rel = os.path.relpath(path, REPO).replace("\\", "/")
    try:
        compile(open(path, encoding="utf-8").read(), path, "exec")
        check("parses: " + rel, True)
    except SyntaxError as e:
        check("parses: " + rel, False, "{} (line {})".format(e.msg, e.lineno))


# --- 2. Every library module imports --------------------------------------
#
# Catches what parsing cannot: a name used at module level that no longer
# exists, a constant renamed in lock_config but still imported by its
# dependants, a circular import.
for name in (
    "alarm", "analogio", "bitmaptools", "board", "busio", "digitalio",
    "displayio", "dotclockframebuffer", "framebufferio", "i2cdisplaybus",
    "microcontroller", "neopixel", "pwmio", "storage", "supervisor",
    "terminalio", "usb_cdc", "vectorio", "watchdog",
):
    sys.modules.setdefault(name, types.ModuleType(name))

# The vendored Adafruit libs are .mpy bytecode; CPython cannot read them.
# Only the names imported at module level need to exist.
_text = types.ModuleType("adafruit_display_text")
_text.label = types.ModuleType("adafruit_display_text.label")
setattr(_text.label, "Label", type("Label", (), {}))
sys.modules.setdefault("adafruit_display_text", _text)
sys.modules.setdefault("adafruit_display_text.label", _text.label)

_shapes = types.ModuleType("adafruit_display_shapes")
sys.modules.setdefault("adafruit_display_shapes", _shapes)
for _mod, _cls in (
    ("roundrect", "RoundRect"), ("rect", "Rect"), ("circle", "Circle"),
    ("triangle", "Triangle"), ("line", "Line"), ("polygon", "Polygon"), ("arc", "Arc"),
):
    _m = types.ModuleType("adafruit_display_shapes." + _mod)
    setattr(_m, _cls, type(_cls, (), {}))
    sys.modules.setdefault("adafruit_display_shapes." + _mod, _m)
    setattr(_shapes, _mod, _m)

modules = [os.path.basename(p)[:-3] for p in sorted(glob.glob(os.path.join(LIB, "*.py")))]
check("found the library modules to import", len(modules) >= 14, "found {}".format(len(modules)))
for name in modules:
    try:
        __import__(name)
        check("imports: " + name, True)
    except Exception as e:  # noqa: BLE001 -- any import-time failure is the point
        check("imports: " + name, False, "{}: {}".format(type(e).__name__, e))


# --- 3. The one contract the app also depends on --------------------------
#
# tests/contracts/bleUuids.test.js compares these against the app's
# protocol.ts by reading both files as text. This asserts the other half of
# that: that they are really module-level constants here, so the text match
# is matching something real rather than a comment.
import lock_config  # noqa: E402 -- after the stubs above, deliberately

for const in (
    "BLE_SERVICE_UUID", "BLE_UUID_STATUS", "BLE_UUID_HISTORY", "BLE_UUID_COMMAND",
    "BLE_UUID_SETTINGS", "BLE_UUID_TIME", "BLE_UUID_ALERT", "BLE_UUID_LABELS",
    "BLE_UUID_PENDING_TOPIC",
):
    value = getattr(lock_config, const, None)
    check(
        "lock_config defines " + const,
        isinstance(value, str) and len(value) == 36,
        repr(value),
    )

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
