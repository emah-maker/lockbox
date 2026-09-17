"""Host tests for the BLE transport itself -- Box-code/lib/lock_ble.py's
PhoneBoxBLE -- and for the run loop that calls it (Box-code/code.py).

WHY THIS FILE EXISTS. test_lock_protocol.py covers the wire CODEC, which is
pure and needs no stubs; it deliberately imports nothing hardware-shaped. But
PhoneBoxBLE is the half of the BLE path that decides WHEN the codec runs --
consume-or-dedup, rate limits, advertising, and what happens when the radio
misbehaves -- and none of that had a test anywhere. Those decisions are where
a write from the app gets silently dropped: the GATT write succeeds either
way, so the app has no way to know, and the only symptom is a button at the
box that "sometimes does nothing".

HOW THE FAKE RADIO WORKS. adafruit_ble ships as .mpy bytecode CPython cannot
read, so the six names lock_ble imports from it are stubbed below BEFORE it
is imported. They are not empty placeholders like test_firmware_loads.py's:
StringCharacteristic is a real descriptor with per-instance storage, so the
fake service behaves like a real GATT table -- the test writes a
characteristic the way the app would, and the box's own code reads and
clears it. FakeRadio.connected can be made to RAISE, which is the one
behaviour of the real radio a host cannot otherwise reproduce.

Run: python tests/test_lock_ble_service.py
"""
import ast
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "Box-code", "lib"))

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS " + name)
    else:
        _failed += 1
        print("FAIL " + name + ((" -- " + detail) if detail else ""))


def call(fn):
    """(ok, value-or-exception). Used wherever the behaviour under test is
    "does not raise" -- a bare call would abort this whole file instead of
    failing one check, and an aborted file reports nothing at all."""
    try:
        return True, fn()
    except Exception as e:  # noqa: BLE001 -- catching it IS the measurement
        return False, e


# --- The fake adafruit_ble, installed before lock_ble imports it -----------
class FakeBluetoothError(Exception):
    """Stands in for _bleio.BluetoothError -- lock_ble only ever catches
    `Exception`, so the exact class is not what is being measured."""


class FakeRadio:
    def __init__(self):
        self.name = ""
        self._connected = False
        self.raises = None          # set to an exception to make .connected fail
        self.adv_starts = 0
        self.adv_stops = 0

    @property
    def connected(self):
        if self.raises is not None:
            raise self.raises
        return self._connected

    def start_advertising(self, adv, interval=None):
        self.adv_starts += 1

    def stop_advertising(self):
        self.adv_stops += 1


class FakeStringCharacteristic:
    """A data descriptor with per-instance storage, so the generated
    PhoneBoxService behaves like a real GATT table: last write wins and the
    value persists until somebody overwrites it. That persistence is the
    whole subject of section 2 below."""
    _n = 0

    def __init__(self, uuid=None, properties=0, **kw):
        FakeStringCharacteristic._n += 1
        self._slot = "_chr{}".format(FakeStringCharacteristic._n)

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self._slot, "")

    def __set__(self, obj, value):
        setattr(obj, self._slot, value)


_ble_mod = types.ModuleType("adafruit_ble")
_ble_mod.BLERadio = FakeRadio
sys.modules.setdefault("adafruit_ble", _ble_mod)

_adv_pkg = types.ModuleType("adafruit_ble.advertising")
_adv_std = types.ModuleType("adafruit_ble.advertising.standard")
_adv_std.ProvideServicesAdvertisement = type(
    "ProvideServicesAdvertisement", (), {"__init__": lambda self, *a, **k: None})
_adv_pkg.standard = _adv_std
sys.modules.setdefault("adafruit_ble.advertising", _adv_pkg)
sys.modules.setdefault("adafruit_ble.advertising.standard", _adv_std)

_svcs = types.ModuleType("adafruit_ble.services")
_svcs.Service = type("Service", (), {})
sys.modules.setdefault("adafruit_ble.services", _svcs)

_chars = types.ModuleType("adafruit_ble.characteristics")
_chars.Characteristic = type("Characteristic", (), {
    "READ": 1, "WRITE": 2, "NOTIFY": 4, "WRITE_NO_RESPONSE": 8})
_chars_str = types.ModuleType("adafruit_ble.characteristics.string")
_chars_str.StringCharacteristic = FakeStringCharacteristic
_chars.string = _chars_str
sys.modules.setdefault("adafruit_ble.characteristics", _chars)
sys.modules.setdefault("adafruit_ble.characteristics.string", _chars_str)

_uuid = types.ModuleType("adafruit_ble.uuid")
_uuid.VendorUUID = type("VendorUUID", (), {"__init__": lambda self, s: None})
sys.modules.setdefault("adafruit_ble.uuid", _uuid)

import lock_ble  # noqa: E402 -- after the stubs above, deliberately

check("the fake adafruit_ble was good enough for lock_ble to enable BLE",
      lock_ble._BLE_IMPORTED, "BLE imports were still treated as missing")


def new_ble():
    b = lock_ble.PhoneBoxBLE()
    assert b.enabled, "PhoneBoxBLE disabled itself against the fakes"
    return b


# --- 1. One radio exception must not end the run loop ----------------------
#
# lock_ble.service() wraps every radio touch in `except Exception: pass`,
# and says why: "never let a radio hiccup break the run loop". code.py then
# reads ble.connected on the very next line, OUTSIDE that guard, and the
# loop has no guard of its own -- so the one thing service() is written to
# survive kills the box anyway. Not just the radio: the box stops sampling
# touch, stops counting down and stops driving the servo, so a phone locked
# inside stays locked until somebody power-cycles it.
#
# The module's own guard is the evidence this is reachable rather than
# theoretical -- the firmware already treats a raising radio as a thing that
# happens. This first check pins that guard so the asymmetry below is a
# measurement and not an assumption.
ble = new_ble()
ble._radio.raises = FakeBluetoothError("radio busy")


class _NullCtrl:
    """service() reaches ctrl only after the radio read that fails here."""
    state = "idle"


_ok, _err = call(lambda: ble.service(_NullCtrl(), 1.0, True))
check("service() survives a radio that raises (the invariant this pins)",
      _ok, "raised {}".format(type(_err).__name__))

_ok, _val = call(lambda: ble.connected)
check("`connected` returns False for a raising radio instead of propagating",
      _ok and _val is False,
      "raised {}: {}".format(type(_val).__name__, _val) if not _ok else repr(_val))

# ...without turning the flag into a constant False. It drives the on-screen
# corner dot (LockUI.update_corner_ble), so a fix that always answers False
# would trade a crash for a dot that never lights.
_up = new_ble()
_up._radio._connected = True
check("`connected` is still True when the radio is actually connected",
      _up.connected is True)
_up._radio._connected = False
check("`connected` is False when the radio is idle", _up.connected is False)

_off = lock_ble.PhoneBoxBLE.__new__(lock_ble.PhoneBoxBLE)
_off.enabled = False
_off._radio = None
check("`connected` is False when BLE never came up at all", _off.connected is False)


# --- 1b. ...and the loop that calls it is guarded too -----------------------
#
# Fixing `connected` alone would only close the one hole that was noticed.
# Every other call in that loop -- touch.touches, ctrl.process, ctrl.update,
# the displayio writes underneath all three -- has the same property: one
# exception, on one frame, and the box is bricked until it is unplugged.
# Checked structurally against code.py's real AST rather than by re-stating
# the loop here, for the same reason test_screen_sleep.py lifts its
# predicate out of the file: a copy would not notice the file changing.
_CODE_PY = os.path.join(REPO, "Box-code", "code.py")
_code_tree = ast.parse(open(_CODE_PY, encoding="utf-8").read(), _CODE_PY)

_loops = [n for n in _code_tree.body if isinstance(n, ast.While)]
check("code.py has exactly one module-level run loop",
      len(_loops) == 1, "found {}".format(len(_loops)))

if len(_loops) == 1:
    _loop = _loops[0]
    _bare = ["line {}".format(s.lineno) for s in _loop.body if not isinstance(s, ast.Try)]
    check("every statement in the run loop body sits inside a try/except",
          not _bare, "unguarded at " + ", ".join(_bare))

    _handlers = [h for s in _loop.body if isinstance(s, ast.Try) for h in s.handlers]
    # `except:` (or `except BaseException:`) would also swallow the
    # KeyboardInterrupt a Ctrl-C at the serial console raises and the reload
    # exception auto-reload raises -- i.e. it would make the box impossible
    # to interrupt or re-deploy to, which is a worse failure than the one
    # being fixed.
    check("the loop's guard catches Exception by name, never a bare except",
          bool(_handlers) and all(isinstance(h.type, ast.Name) and h.type.id == "Exception"
                                  for h in _handlers),
          "handlers: " + ", ".join(ast.dump(h.type) if h.type else "bare" for h in _handlers))
    check("the guard neither re-raises nor breaks out of the loop",
          not any(isinstance(n, (ast.Raise, ast.Break))
                  for h in _handlers for n in ast.walk(h)))
    # A fault that repeats every frame would otherwise spin the loop flat
    # out -- burning battery and flooding the console -- which on a box that
    # now refuses to die is the failure mode that replaces the crash.
    _sleeps = [n for h in _handlers for n in ast.walk(h)
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == "sleep"]
    check("the guard paces itself, so a fault on every frame cannot spin the loop",
          bool(_sleeps))


# --- 2. Picking the same topic twice ---------------------------------------
#
# `pending_topic` is the app's forward suggestion: pick a tag on the phone,
# walk to the box, press LOCK, and get the CONFIRM screen for that tag
# instead of the plain picker. The box consumes the pick when the session
# starts (go_running clears _pending_app_topic) but nothing clears the
# CHARACTERISTIC, and _drain_inbound deduped on "did the string change".
# So the second time the user picks the same tag, the app writes the value
# that is already sitting there, the box reads no change, and LOCK falls
# through to the picker as if nothing had been picked at all.
#
# Picking a DIFFERENT tag works, which is what makes this so hard to report:
# the feature looks like it fails at random rather than on a rule.
from lock_controller_ble import BleMixin  # noqa: E402 -- pure, no hardware


class FakeCtrl:
    """Only the surface _drain_inbound touches. _all_topics and the real
    apply_ble_pending_topic are bound off BleMixin so the id validation
    exercised here is the firmware's own, not a restatement of it."""

    _all_topics = BleMixin._all_topics

    class _Log:
        has_pending = False

    def __init__(self):
        self._synced_labels = []
        self._pending_app_topic = None
        self.applied = []       # every value lock_ble handed to the controller
        self.commands = []      # ...and every command it let through
        self.calls = []         # ...and every incoming-call alert it raised
        self.log = FakeCtrl._Log()

    def apply_ble_pending_topic(self, text):
        self.applied.append(text)
        BleMixin.apply_ble_pending_topic(self, text)

    def apply_ble_command(self, cmd, now):
        self.commands.append(cmd)

    # --- the rest is only what service() needs to complete a full pass ---
    state = "idle"

    def notify_call(self, label, now):
        self.calls.append(label)

    def ble_status_json(self, now):
        return '{"st":"idle"}'

    def ble_settings_json(self):
        return '{"ovr":25}'

    def go_running(self):
        """The one line of lock_controller_states.go_running that matters
        here. Pinned against the real source immediately below, so this
        stand-in cannot drift into testing a consumption rule the firmware
        stopped following."""
        self._pending_app_topic = None


_states = os.path.join(REPO, "Box-code", "lib", "lock_controller_states.py")
_go_running = next(
    n for n in ast.walk(ast.parse(open(_states, encoding="utf-8").read()))
    if isinstance(n, ast.FunctionDef) and n.name == "go_running")
_clears = [n for n in ast.walk(_go_running)
           if isinstance(n, ast.Assign)
           and any(isinstance(t, ast.Attribute) and t.attr == "_pending_app_topic"
                   for t in n.targets)
           and isinstance(n.value, ast.Constant) and n.value.value is None]
check("go_running still clears the pending pick (the premise for all of part 2)",
      len(_clears) == 1, "found {} such assignments".format(len(_clears)))


class Link:
    """A connected box plus the phone on the other end of it. `now` advances
    on every drain because _drain_inbound rate-limits the slow group to
    5Hz, and a test that forgot to move time would measure that instead."""

    def __init__(self):
        self.ble = new_ble()
        self.ble._radio._connected = True
        self.ctrl = FakeCtrl()
        self.now = 100.0

    def app_writes(self, char, value):
        setattr(self.ble._svc, char, value)

    def drain(self, step=0.5):
        self.now += step
        self.ble._drain_inbound(self.ctrl, self.now)

    def serve(self, step=0.5):
        """A full service() pass, so the connect/disconnect bookkeeping
        (_on_connected) runs the way it does on the box."""
        self.now += step
        self.ble.service(self.ctrl, self.now, True)

    def reconnect(self):
        self.ble._radio._connected = False
        self.serve()
        self.ble._radio._connected = True
        self.serve()


link = Link()
link.drain()
check("(2) a box nobody has written to hands the controller nothing",
      link.ctrl.applied == [], repr(link.ctrl.applied))

link.app_writes("pending_topic", "work")
link.drain()
check("(2) the first pick reaches the controller",
      link.ctrl.applied == ["work"] and link.ctrl._pending_app_topic == "work",
      "applied {} pending {}".format(link.ctrl.applied, link.ctrl._pending_app_topic))

link.ctrl.go_running()
link.drain()
check("(2) once consumed, the box does not resurrect the pick by itself",
      link.ctrl.applied == ["work"] and link.ctrl._pending_app_topic is None,
      "applied {} pending {}".format(link.ctrl.applied, link.ctrl._pending_app_topic))

# The reported bug: session over, user picks "Work" again in the app.
link.app_writes("pending_topic", "work")
link.drain()
check("(2) picking the SAME topic again after a session reaches the box",
      link.ctrl.applied == ["work", "work"] and link.ctrl._pending_app_topic == "work",
      "applied {} pending {}".format(link.ctrl.applied, link.ctrl._pending_app_topic))

# ...and the case that always worked, which is why this looked intermittent.
link2 = Link()
link2.app_writes("pending_topic", "work")
link2.drain()
link2.ctrl.go_running()
link2.app_writes("pending_topic", "reading")
link2.drain()
check("(2) picking a DIFFERENT topic after a session still reaches the box",
      link2.ctrl._pending_app_topic == "reading", repr(link2.ctrl.applied))

# The contract the DEDUP GOTCHA comment in _drain_inbound exists to protect:
# '' is a REAL payload on this characteristic (the app withdrawing a pick it
# has not yet had consumed), not "nothing new to read". Whatever the box
# does to mark a value consumed must not eat that.
link3 = Link()
link3.app_writes("pending_topic", "work")
link3.drain()
link3.app_writes("pending_topic", "")
link3.drain()
check("(2) an app-side clear of a LIVE pick still reaches the controller",
      link3.ctrl.applied == ["work", ""] and link3.ctrl._pending_app_topic is None,
      "applied {} pending {}".format(link3.ctrl.applied, link3.ctrl._pending_app_topic))

# An id the box has never heard of validates to None (see
# apply_ble_pending_topic) -- and re-sending it must still be observable, or
# the same dedup hole reopens for a custom label whose sync arrived late.
link4 = Link()
link4.app_writes("pending_topic", "custom-not-yet-synced")
link4.drain()
check("(2) an unknown id is received but resolves to nothing pending",
      link4.ctrl.applied == ["custom-not-yet-synced"]
      and link4.ctrl._pending_app_topic is None, repr(link4.ctrl.applied))
link4.ctrl._synced_labels = [("custom-not-yet-synced", "Later", 0x112233)]
link4.app_writes("pending_topic", "custom-not-yet-synced")
link4.drain()
check("(2) re-sending that id once its label has synced now resolves",
      link4.ctrl._pending_app_topic == "custom-not-yet-synced",
      "applied {} pending {}".format(link4.ctrl.applied, link4.ctrl._pending_app_topic))


# --- 3. A command dropped inside the rate-limit window ---------------------
#
# BLE_CMD_MIN_INTERVAL exists for one stated reason (see its comment in
# lock_config.py): "rate-limit inbound BLE commands that CHANGE THE LATCH",
# because remote unlock from a companion phone is the anti-cheat case. But
# _drain_inbound applied it to the characteristic, not to the opcode, so
# every opcode paid it -- and a command that loses the race is not queued,
# not retried and not reported. The GATT write succeeded, so the app has
# every reason to believe it landed.
#
# The trigger is ordinary use, not an edge case: the Home screen's duration
# wheels write "dur:<n>" on every value change with no app-side throttle
# (DashboardScreen's setDuration effect), so a drag leaves the window full.
# Tap Close in the second after it and the "lock" is swallowed -- the box
# just sits there until the user taps again.
link = Link()
link.app_writes("command", "lock")
link.drain(0.1)
check("(3) a lock command on a quiet link is applied",
      link.ctrl.commands == ["lock"], repr(link.ctrl.commands))

# Two latch commands back to back: the rate limit MUST still bite. This is
# the property the fix has to leave intact, so it is checked first.
link.app_writes("command", "unlock")
link.drain(0.1)
check("(3) a second latch command inside the window is still rate-limited",
      link.ctrl.commands == ["lock"], repr(link.ctrl.commands))
link.app_writes("command", "unlock")
link.drain(1.5)
check("(3) ...and is accepted again once the window has passed",
      link.ctrl.commands == ["lock", "unlock"], repr(link.ctrl.commands))

# The reported case. "dur" moves no servo -- it previews a duration on the
# box's clock digits -- so it has no business spending the latch budget.
link = Link()
for _secs in (600, 660, 720, 780):
    link.app_writes("command", "dur:{}".format(_secs))
    link.drain(0.1)
check("(3) every duration-wheel write is applied",
      link.ctrl.commands == ["dur:600", "dur:660", "dur:720", "dur:780"],
      repr(link.ctrl.commands))
link.app_writes("command", "lock")
link.drain(0.1)
check("(3) Close right after dragging the duration wheels still locks",
      link.ctrl.commands[-1] == "lock", repr(link.ctrl.commands))

# Same for the history acknowledgement -- it is bookkeeping for a queue the
# box is trying to hand off (lock_log.SessionLog.ack), and losing it means
# the box re-sends that batch forever.
link = Link()
link.app_writes("command", "historyAck:7")
link.drain(0.1)
link.app_writes("command", "lock")
link.drain(0.1)
check("(3) a history ack does not spend the latch budget either",
      link.ctrl.commands == ["historyAck:7", "lock"], repr(link.ctrl.commands))

# And an opcode the box does not recognize must not either: it decodes to
# None and does nothing (see lock_protocol.decode_command), so letting it
# arm the window would let any garbage write starve a real Close.
link = Link()
link.app_writes("command", "frobnicate")
link.drain(0.1)
link.app_writes("command", "lock")
link.drain(0.1)
check("(3) an unrecognized opcode cannot starve a real latch command",
      link.ctrl.commands == ["frobnicate", "lock"], repr(link.ctrl.commands))

# The classification lives next to the opcode table it has to track, and
# every opcode decode_command answers to is on exactly one side of it --
# an opcode added to one and not the other is the drift this catches.
import lock_protocol  # noqa: E402

_OPCODES = ("start", "dur", "lock", "unlock", "historyAck")
_ARGS = {"start": "start:600", "dur": "dur:600", "lock": "lock",
         "unlock": "unlock", "historyAck": "historyAck:7"}
check("every opcode decode_command accepts is still in the table above",
      all(lock_protocol.decode_command(_ARGS[o]) is not None for o in _OPCODES))
check("the latch opcodes are exactly the ones that can move the servo",
      tuple(lock_protocol.LATCH_OPCODES) == ("start", "lock", "unlock"),
      repr(lock_protocol.LATCH_OPCODES))
for _op in _OPCODES:
    check("is_latch_command agrees with LATCH_OPCODES for " + _op,
          lock_protocol.is_latch_command(_ARGS[_op]) is (_op in lock_protocol.LATCH_OPCODES))


# --- 4. The same call alert, on a new connection ---------------------------
#
# `alert` carries "<nonce>|<label>" precisely so a repeat call re-fires
# through an equality dedup. But _last_alert is seeded in __init__ and
# never reset, while the characteristic keeps its last written value across
# a disconnect -- so the dedup spans connections even though nothing else
# about that conversation does. _on_connected already resets _last_history
# for the mirror-image reason (a notify the previous connection may never
# have delivered); an alert is even less forgiving, because it is an EVENT
# and there is no retry anywhere: the app's write succeeds, CallMonitor
# marks the call alerted, and the box simply never lights up.
#
# That made the worst case the normal one. iOS terminates the app and
# restores it through CoreBluetooth, so "first call after a restore" is the
# common path, and an app whose nonce restarted at the same number each
# process produced a byte-identical payload every launch.
#
# The app now seeds its nonce from the wall clock, which fixes it from that
# side; this is the half that also holds when a phone's clock moves
# BACKWARDS, which no app-side seed can cover.
link = Link()
link.serve()                              # first connection
link.app_writes("alert", "1|Call")
link.drain()
check("(4) an incoming call raises the alert", link.ctrl.calls == ["Call"],
      repr(link.ctrl.calls))

link.drain()
check("(4) the same alert is not re-raised on the SAME connection",
      link.ctrl.calls == ["Call"], repr(link.ctrl.calls))

link.reconnect()
link.drain()
check("(4) the identical alert payload raises again after a reconnect",
      link.ctrl.calls == ["Call", "Call"], repr(link.ctrl.calls))

# ...and the label is still taken from after the nonce separator, not the
# whole payload -- the reset must not turn the alert into a raw echo.
link.app_writes("alert", "2|Mom")
link.drain()
check("(4) a fresh alert still reports only the label half",
      link.ctrl.calls[-1] == "Mom", repr(link.ctrl.calls))

# The history resend on connect is a separate, deliberate reset and stays.
link2 = Link()
link2.serve()
link2.ble._last_history = "something already sent"
link2.reconnect()
check("(4) _on_connected still forces a history resend",
      link2.ble._last_history is None, repr(link2.ble._last_history))


print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
