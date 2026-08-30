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

# Snapshot taken before anything is stubbed or imported -- see the unwind at
# the bottom of this file for why it has to be exact.
_MODULES_BEFORE = set(sys.modules)

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


# --- 4. LockUI is still one object -----------------------------------------
#
# LockUI is composed from per-screen mixins (see lock_ui.py's header). That
# split is safe only while three things hold, none of which the language
# enforces:
#
#   - no two mixins define the same name. Python would silently pick whichever
#     comes first in the MRO, and the other screen would quietly stop working.
#   - every mixin member is reachable on LockUI, i.e. no mixin was written and
#     then left out of the bases list.
#   - LockUI itself still defines __init__, which is where every attribute the
#     mixins reach for is created.
#
# Deliberately structural rather than a snapshot of the method list: a guard
# that has to be edited every time a method is added is one that gets edited
# without being read.
import lock_ui  # noqa: E402 -- after the stubs above, deliberately

MIXINS = [b for b in lock_ui.LockUI.__mro__ if b.__name__.endswith("Mixin")]
check("LockUI is composed from the view mixins", len(MIXINS) >= 7, "found {}".format(len(MIXINS)))

_seen = {}
_collisions = []
for base in MIXINS:
    for member in vars(base):
        if member.startswith("__"):
            continue
        if member in _seen:
            _collisions.append("{} in both {} and {}".format(member, _seen[member], base.__name__))
        _seen[member] = base.__name__
check("no two mixins define the same name", not _collisions, "; ".join(_collisions))

_unreachable = [n for n in _seen if not hasattr(lock_ui.LockUI, n)]
check("every mixin member is reachable on LockUI", not _unreachable, ", ".join(_unreachable))

_own = [n for n in vars(lock_ui.LockUI) if not n.startswith("__")]
check("LockUI itself holds only its constructor", not _own, ", ".join(_own))
check("LockUI defines __init__", "__init__" in vars(lock_ui.LockUI))

# One entry point per screen. A mixin dropped from the bases list would take
# its whole screen with it, and nothing else in this file would notice.
for _entry in ("show_view", "show_idle", "show_tag_picker", "show_override",
               "show_call_alert", "show_setting_detail", "update_clock_view",
               "update_battery_view", "set_theme", "on_touch_down"):
    check("LockUI still answers " + _entry, callable(getattr(lock_ui.LockUI, _entry, None)))

check(
    "is_flipped survived the move as a property, not a method",
    isinstance(
        next((vars(b)["is_flipped"] for b in lock_ui.LockUI.__mro__ if "is_flipped" in vars(b)), None),
        property,
    ),
)


# --- 5. Every name a function reads actually exists in its module -----------
#
# Importing a module proves its BODY runs. It proves nothing about the names
# its functions reach for, because those resolve when the function is CALLED
# -- which, for this firmware, means on the box. Splitting LockUI and
# LockController across mixin modules is exactly the edit that gets this
# wrong: move a method out and leave its import behind (or prune an import
# whose only remaining user was the method that moved) and every check above
# still passes, while the box raises NameError the first time that screen is
# drawn.
#
# So: for each module, collect what is bound at MODULE level -- including
# inside `try: import ... except ImportError:` blocks, which is how lock_ble
# and lock_servo make their optional dependencies optional -- and confirm
# every global a function reads is one of those, a local, or a builtin.
import ast  # noqa: E402
import builtins  # noqa: E402
import glob  # noqa: E402

_BUILTINS = set(dir(builtins)) | {"__name__", "__file__"}


def _module_bindings(tree):
    """Every name bound at module level, at any statement depth outside a
    function or class body (so a `try:`-wrapped import counts)."""
    bound = set()

    def walk(nodes):
        for n in nodes:
            if isinstance(n, ast.Import):
                for a in n.names:
                    bound.add(a.asname or a.name.split(".")[0])
            elif isinstance(n, ast.ImportFrom):
                for a in n.names:
                    bound.add(a.asname or a.name)
            elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bound.add(n.name)
                continue  # do not descend: their insides are not module level
            elif isinstance(n, ast.Assign):
                for t in n.targets:
                    if isinstance(t, ast.Name):
                        bound.add(t.id)
            elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
                bound.add(n.target.id)
            for field in ("body", "orelse", "finalbody", "handlers"):
                child = getattr(n, field, None)
                if isinstance(child, list):
                    walk(child)
    walk(tree.body)
    return bound


def _locals_of(fn):
    names = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.arg):
            names.add(n.arg)
        elif isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
            names.add(n.id)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(n.name)
        elif isinstance(n, ast.Import):
            for a in n.names:
                names.add(a.asname or a.name.split(".")[0])
        elif isinstance(n, ast.ImportFrom):
            for a in n.names:
                names.add(a.asname or a.name)
        elif isinstance(n, ast.ExceptHandler) and n.name:
            names.add(n.name)
    return names


_unresolved = []
for _path in sorted(glob.glob(os.path.join(LIB, "*.py"))):
    _tree = ast.parse(open(_path, encoding="utf-8").read())
    _bound = _module_bindings(_tree)
    for _fn in [x for x in ast.walk(_tree) if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        _local = _locals_of(_fn)
        for _n in ast.walk(_fn):
            if isinstance(_n, ast.Name) and isinstance(_n.ctx, ast.Load):
                if _n.id not in _local and _n.id not in _bound and _n.id not in _BUILTINS:
                    _unresolved.append("{}:{} {}() -> {}".format(
                        os.path.basename(_path), _n.lineno, _fn.name, _n.id))
check(
    "every global a firmware function reads is defined or imported in its module",
    not _unresolved,
    "; ".join(_unresolved[:6]) + (" (+{} more)".format(len(_unresolved) - 6) if len(_unresolved) > 6 else ""),
)


# --- Leave the interpreter as we found it ---------------------------------
#
# This file imports every firmware module against DELIBERATELY EMPTY stubs --
# the point is to reach each module body, not to make it work. The other test
# files in this directory install their own, functional stand-ins for the same
# CircuitPython names and then exercise real behaviour against them. Run
# individually that is fine, but `python -m unittest discover` runs them all
# in ONE interpreter, and whichever file imports a module first wins: every
# later `import lock_log` gets the copy already bound to the empty stubs, and
# its tests quietly measure the wrong thing.
#
# So this file unwinds itself: every module it added to sys.modules goes, and
# so does its sys.path entry. Ordering between test files then stops mattering,
# which is the only state in which it can be trusted.
for _name in list(sys.modules):
    if _name not in _MODULES_BEFORE:
        del sys.modules[_name]
if LIB in sys.path:
    sys.path.remove(LIB)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
