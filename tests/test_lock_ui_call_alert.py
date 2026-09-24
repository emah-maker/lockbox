"""Host tests for who owns display.root_group while the incoming-call
overlay is up (firmware/lib/lock_ui*.py).

WHAT THIS PATH IS. A greenlisted call arrives over BLE while the box is
locked, and LockUI.show_call_alert takes over the whole screen with a
flashing full-screen banner for BLE_CALL_ALERT_S (20s) before
hide_call_alert puts the previous screen back. The box deliberately does
NOT open for it (see lock_ble.py's header: "alert-through ... never
auto-open"), so those 20 seconds sit on top of a live session with the
user still pressing things.

THE BUG THIS PINS. show_view() is careful about this -- its docstring
spells out that it must not "stomp the overlay out from under it" -- but
show_view is only one of the places that assigns display.root_group.
Every OVERLAY screen (the override counter, the tag picker, the
topic-confirm screen, both settings detail pages) wrote root_group
directly, with no guard at all, so any of them raised during a call alert
erased the alert mid-flash. And the restore had the mirror-image hole:
hide_call_alert() called show_view(self.view), which restores the last
top-level VIEW -- overlays are not views, so whatever overlay was up when
the alert arrived (or was raised during it) got wiped 20 seconds later
while the controller was still routing touches to it. From "closed" that
left state == "picking" with an invisible tag picker still swallowing
every touch, which reads on the box as a completely dead screen.

Both halves are one missing idea: a single _set_root(group) chokepoint
that records the INTENDED screen always and applies it only when the
alert does not own the display, with hide_call_alert restoring that
intent rather than re-deriving one from self.view.

HOW THIS RUNS ON A HOST. Unlike the other controller-side test files,
this one needs the real widget tree -- root_group identity is the whole
assertion, and a hand-written FakeUI would be asserting against itself.
tests/preview/shim already provides pure-Python stand-ins for displayio /
terminalio / adafruit_display_text / adafruit_display_shapes good enough
to construct the REAL LockUI (that is what tests/preview/render.py
rasterizes), so this builds one the same way render.py's build_ui() does
and reads display.root_group back out. No PIL involved -- nothing here
rasterizes anything.

Run: python tests/test_lock_ui_call_alert.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SHIM = os.path.join(HERE, "preview", "shim")
LIB = os.path.join(REPO, "firmware", "lib")

# Same ordering trick as render.py's _install_shim(): insert LIB first and
# SHIM second, so SHIM ends up ahead of it and wins any name collision.
for _path in (LIB, SHIM):
    if _path in sys.path:
        sys.path.remove(_path)
    sys.path.insert(0, _path)

import displayio        # noqa: E402 -- the shim's, after the path setup above
import lock_config      # noqa: E402
import lock_settings    # noqa: E402
import lock_ui          # noqa: E402

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS", name)
    else:
        _failed += 1
        print("FAIL", name, "--", detail)


def new_ui():
    """A freshly constructed LockUI over a fresh fake display -- same as
    render.py's build_ui(). Built per-section rather than shared, because
    these tests are about leftover state and a shared instance would let
    one section's overlay mask the next section's bug."""
    display = displayio.Display(172, 320, rotation=0)
    return lock_ui.LockUI(display)


# microcontroller.nvm is None in the shim, so this is the compiled-in
# defaults -- the two detail pages only need *a* settings object to format.
SETTINGS = lock_settings.Settings()

# Every overlay entry point that writes root_group, as
# (label, call it, the group it should end up showing).
# show_setting_detail2's row index is in page 2's flat 6..11 range (see
# lock_settings.Settings.adjust's comment on the shared index space).
OVERLAYS = (
    ("show_override", lambda ui: ui.show_override(3, 25),
     lambda ui: ui.override_group),
    ("show_tag_picker", lambda ui: ui.show_tag_picker(lock_config.BUILTIN_TOPICS),
     lambda ui: ui.tag_picker_group),
    ("show_topic_confirm", lambda ui: ui.show_topic_confirm("Work"),
     lambda ui: ui.topic_confirm_group),
    ("show_setting_detail", lambda ui: ui.show_setting_detail(0, SETTINGS),
     lambda ui: ui.setting_detail_group),
    ("show_setting_detail2", lambda ui: ui.show_setting_detail2(6, SETTINGS),
     lambda ui: ui.setting_detail_group),
)


# --- 1. Baseline: with no alert up, every screen still paints immediately --
# The guard must not become a reason nothing ever draws.
ui = new_ui()
check("(1) a fresh LockUI shows the control view",
      ui.display.root_group is ui.control_group)
check("(1) a fresh LockUI has no call alert up", ui._call_alert_active is False)

for _label, _call, _group in OVERLAYS:
    ui = new_ui()
    _call(ui)
    check("(1) " + _label + " paints immediately with no alert up",
          ui.display.root_group is _group(ui))

ui = new_ui()
ui.show_view("clock")
ui.cycle_clock_style(1)
check("(1) cycle_clock_style paints immediately with no alert up",
      ui.display.root_group is ui.clock_groups[ui.clock_style_idx])
check("(1) cycle_clock_style actually advanced the style", ui.clock_style_idx == 1)


# --- 2. An alert owns the display: no overlay may paint over it ------------
# BLE_CALL_ALERT_S is 20 seconds of a flashing full-screen banner that the
# box shows INSTEAD of opening. A screen change underneath it must be
# remembered, not drawn.
for _label, _call, _group in OVERLAYS:
    ui = new_ui()
    ui.show_call_alert("Sam")
    _call(ui)
    check("(2) " + _label + " does not stomp a live call alert",
          ui.display.root_group is ui.call_group,
          "root became {}".format(type(ui.display.root_group).__name__))

ui = new_ui()
ui.show_view("clock")
ui.show_call_alert("Sam")
ui.cycle_clock_style(1)
check("(2) cycle_clock_style does not stomp a live call alert",
      ui.display.root_group is ui.call_group)
check("(2) cycle_clock_style still advances the style behind the alert",
      ui.clock_style_idx == 1)

# show_view's own guard is the one that already worked -- pinned so the
# rewrite that generalises it cannot quietly drop it.
ui = new_ui()
ui.show_call_alert("Sam")
ui.show_view("battery")
check("(2) show_view does not stomp a live call alert",
      ui.display.root_group is ui.call_group)
check("(2) show_view still tracks the intended view behind the alert",
      ui.view == "battery")


# --- 3. hide_call_alert restores what was actually intended ----------------
# Not self.view. An overlay is not a view, and the controller is still
# routing touches to whatever it last put up.
for _label, _call, _group in OVERLAYS:
    ui = new_ui()
    ui.show_call_alert("Sam")
    _call(ui)
    ui.hide_call_alert()
    check("(3) hide_call_alert restores the overlay raised during it (" + _label + ")",
          ui.display.root_group is _group(ui),
          "root became {}".format(type(ui.display.root_group).__name__))

# The other order: the overlay was ALREADY up when the call arrived. This is
# the reported one -- override counter running, call comes in, 20s later the
# counter is gone while press_override is still counting into it.
ui = new_ui()
ui.show_override(3, 25)
ui.show_call_alert("Sam")
ui.hide_call_alert()
check("(3) an override overlay that predates the alert survives it",
      ui.display.root_group is ui.override_group)

# And the picker version, which is worse: LockController.state stays
# "picking", so an invisible tag picker keeps arbitrating every touch.
ui = new_ui()
ui.show_tag_picker(lock_config.BUILTIN_TOPICS)
ui.show_call_alert("Sam")
ui.hide_call_alert()
check("(3) a tag picker that predates the alert survives it",
      ui.display.root_group is ui.tag_picker_group)

# A plain view is still restored the way it always was.
ui = new_ui()
ui.show_view("battery")
ui.show_call_alert("Sam")
ui.hide_call_alert()
check("(3) hide_call_alert still restores a plain view",
      ui.display.root_group is ui.battery_group)

# A view change made DURING the alert wins over the one from before it --
# the deferred intent is the latest one, not the oldest.
ui = new_ui()
ui.show_view("battery")
ui.show_call_alert("Sam")
ui.show_view("settings")
ui.hide_call_alert()
check("(3) a view change made during the alert is the one restored",
      ui.display.root_group is ui.settings_group)

# An overlay DISMISSED during the alert must not be resurrected by the
# restore: hide_override/hide_tag_picker route through show_view, so the
# recorded intent has to fall back to the view they return to.
ui = new_ui()
ui.show_override(3, 25)
ui.show_call_alert("Sam")
ui.hide_override()
ui.hide_call_alert()
check("(3) an overlay hidden during the alert is not resurrected by the restore",
      ui.display.root_group is ui.control_group)

ui = new_ui()
ui.show_tag_picker(lock_config.BUILTIN_TOPICS)
ui.show_call_alert("Sam")
ui.hide_tag_picker()
ui.hide_call_alert()
check("(3) a tag picker hidden during the alert is not resurrected either",
      ui.display.root_group is ui.control_group)

# Back-to-back alerts: the second one must restore to the same underlying
# screen, not to whatever the first restore happened to leave behind.
ui = new_ui()
ui.show_override(3, 25)
for _i in range(3):
    ui.show_call_alert("Sam")
    ui.hide_call_alert()
check("(3) repeated alerts keep restoring the same underlying overlay",
      ui.display.root_group is ui.override_group)


# --- 4. Nothing assigns root_group outside the chokepoint ------------------
# The five overlay writers above were each individually correct-looking and
# collectively wrong, and a sixth is one new screen away. Reads the source
# text because the thing being asserted IS the source form -- a direct
# assignment behaves identically right up until an alert is on screen,
# which is exactly why nothing else would catch it.
import glob  # noqa: E402 -- only this section needs it
import re    # noqa: E402

_ASSIGN = re.compile(r"^\s*self\.display\.root_group\s*=", re.M)
_ALLOWED = {
    # The chokepoint itself, and the alert overlay -- which deliberately
    # does NOT go through it: the alert is what the deferral defers TO, so
    # recording it as the intended screen would make hide_call_alert
    # restore the alert it just dismissed.
    "_set_root", "show_call_alert",
}

_offenders = []
for _path in sorted(glob.glob(os.path.join(LIB, "lock_ui*.py"))):
    with open(_path, encoding="utf-8") as _fh:
        _src = _fh.read()
    for _m in _ASSIGN.finditer(_src):
        # Which def does this assignment sit inside?
        _defs = re.findall(r"^\s*def\s+(\w+)\(", _src[: _m.start()], re.M)
        _owner = _defs[-1] if _defs else "<module level>"
        if _owner not in _ALLOWED:
            _offenders.append("{}:{}".format(os.path.basename(_path), _owner))
check("(4) every screen change goes through the _set_root chokepoint",
      not _offenders, ", ".join(_offenders))

# LockUI.__init__'s first paint counts too -- it is what hide_call_alert
# has to restore to if an alert somehow lands before any other screen.
ui = new_ui()
ui.show_call_alert("Sam")
ui.hide_call_alert()
check("(4) the constructor's first paint is recorded as an intended screen",
      ui.display.root_group is ui.control_group)

print("")
print("{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
