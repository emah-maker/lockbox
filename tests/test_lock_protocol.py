"""Host tests for the pure BLE wire codec in Box-code/lib/lock_protocol.py.

encode_status/encode_settings/decode_command/decode_settings/decode_labels
have no hardware imports, so they run as-is under plain CPython -- no
reimplementation, no stubs.

Run: python tests/test_lock_protocol.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib"))

import lock_protocol
from lock_config import (
    MIN_SECONDS, MAX_SECONDS, OVR_MIN, OVR_MAX, SLEEP_OPTIONS, BRIGHT_OPTIONS,
    SERVO_ANGLE_MIN, SERVO_ANGLE_MAX, ACCENT_COLORS, BUILTIN_TOPICS,
    BLE_LABEL_MAX_COUNT, OVR_TIMEOUT_MIN_TENTHS, OVR_TIMEOUT_MAX_TENTHS,
)

_passed = 0
_failed = 0


def check(name, cond):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS", name)
    else:
        _failed += 1
        print("FAIL", name)


class FakeSettings:
    """Duck-typed stand-in for lock_settings.Settings -- encode_settings only
    reads attributes, so no real Settings (NVM I/O) is needed here."""
    def __init__(self):
        self.override_presses = 25
        self.auto_open = True
        self.sleep_s = 30
        self.bright_pct = 70
        self.allow_remote_unlock = False
        self.unlock_on_call = False
        self.theme_mode = 0
        self.accent_idx = 2
        self.screen_flipped = False
        self.lock_angle = 45
        self.unlock_angle = 0
        # Seconds here; encode_settings puts it on the wire in tenths.
        self.override_timeout = 1.5


# ----- encode_status -----
s = lock_protocol.encode_status("running", 42, 300, 87, "work")
check("encode_status shape", s == '{"st":"running","rem":42,"set":300,"bat":87,"tp":"work","fw":"1.0"}')
s_idle = lock_protocol.encode_status("idle", 0, 300, -1, "")
check("encode_status idle/no-topic/no-battery", s_idle == '{"st":"idle","rem":0,"set":300,"bat":-1,"tp":"","fw":"1.0"}')

# ----- encode_settings -----
enc = lock_protocol.encode_settings(FakeSettings())
check("encode_settings shape", enc == (
    '{"ovr":25,"auto":1,"sleep":30,"bright":70,"unlk":0,"ucal":0,'
    '"thm":0,"acc":2,"flip":0,"langle":45,"uangle":0,"ovrt":15}'))
# The one field whose wire unit differs from its Settings attribute, so it is
# the one a future edit is most likely to get wrong in only one direction.
check("encode_settings puts override_timeout on the wire in tenths",
      '"ovrt":15' in enc and '"ovrt":1.5' not in enc)

# ----- decode_command: start -----
c = lock_protocol.decode_command("start:120")
check("start:120 clamps up to MIN_SECONDS", c.name == "start" and c.seconds == MIN_SECONDS)
c = lock_protocol.decode_command("start:99999999")
check("start clamps down to MAX_SECONDS", c.seconds == MAX_SECONDS)
c = lock_protocol.decode_command("start")
check("start with no arg -> seconds None", c.name == "start" and c.seconds is None)
check("start with malformed int -> None (ignore entirely)",
      lock_protocol.decode_command("start:abc") is None)

# ----- decode_command: dur -----
c = lock_protocol.decode_command("dur:600")
check("dur:600 decodes with clamp", c.name == "dur" and c.seconds == 600)
check("dur with no arg -> None", lock_protocol.decode_command("dur") is None)
check("dur with malformed int -> None", lock_protocol.decode_command("dur:xyz") is None)

# ----- decode_command: lock/unlock -----
check("lock decodes", lock_protocol.decode_command("lock").name == "lock")
check("unlock decodes", lock_protocol.decode_command("unlock").name == "unlock")

# ----- decode_command: historyAck -----
c = lock_protocol.decode_command("historyAck:7")
check("historyAck:7 decodes seq", c.name == "historyAck" and c.seq == 7)
check("historyAck with no arg -> None", lock_protocol.decode_command("historyAck") is None)
check("historyAck malformed int -> None", lock_protocol.decode_command("historyAck:x") is None)

# ----- decode_command: unrecognized opcode -----
check("unknown opcode -> None", lock_protocol.decode_command("frobnicate") is None)

# ----- decode_settings -----
full = ('{"ovr":50,"auto":1,"sleep":25,"bright":42,"unlk":1,"ucal":1,'
        '"thm":1,"acc":3,"flip":1,"langle":10,"uangle":-10,"ovrt":20}')
d = lock_protocol.decode_settings(full)
check("decode_settings ovr", d["ovr"] == 50)
check("decode_settings auto bool", d["auto"] is True)
check("decode_settings sleep snaps to nearest option", d["sleep"] == min(SLEEP_OPTIONS, key=lambda o: abs(o - 25)))
check("decode_settings bright snaps to nearest option", d["bright"] == min(BRIGHT_OPTIONS, key=lambda o: abs(o - 42)))
check("decode_settings unlk bool", d["unlk"] is True)
check("decode_settings ucal bool", d["ucal"] is True)
check("decode_settings thm", d["thm"] == 1)
check("decode_settings acc", d["acc"] == 3)
check("decode_settings flip bool", d["flip"] is True)
check("decode_settings langle", d["langle"] == 10)
check("decode_settings uangle", d["uangle"] == -10)
check("decode_settings ovrt", d["ovrt"] == 20)

check("decode_settings missing key omitted",
      "ovr" not in lock_protocol.decode_settings('{"auto":1}'))
check("decode_settings wrong type silently omitted, doesn't crash rest",
      lock_protocol.decode_settings('{"ovr":"nope","auto":1}') == {"auto": True})
check("decode_settings ovr clamps above OVR_MAX",
      lock_protocol.decode_settings('{{"ovr":{}}}'.format(OVR_MAX + 1000))["ovr"] == OVR_MAX)
check("decode_settings ovr clamps below OVR_MIN",
      lock_protocol.decode_settings('{{"ovr":{}}}'.format(OVR_MIN - 1000))["ovr"] == OVR_MIN)
check("decode_settings thm clamps to [0,1]",
      lock_protocol.decode_settings('{"thm":99}')["thm"] == 1)
check("decode_settings acc clamps to len(ACCENT_COLORS)-1",
      lock_protocol.decode_settings('{{"acc":{}}}'.format(len(ACCENT_COLORS) + 5))["acc"] == len(ACCENT_COLORS) - 1)
check("decode_settings langle clamps to SERVO_ANGLE_MAX",
      lock_protocol.decode_settings('{{"langle":{}}}'.format(SERVO_ANGLE_MAX + 50))["langle"] == SERVO_ANGLE_MAX)
check("decode_settings uangle clamps to SERVO_ANGLE_MIN",
      lock_protocol.decode_settings('{{"uangle":{}}}'.format(SERVO_ANGLE_MIN - 50))["uangle"] == SERVO_ANGLE_MIN)
check("decode_settings ovrt stays in tenths (no unit conversion here)",
      lock_protocol.decode_settings('{"ovrt":25}')["ovrt"] == 25)
check("decode_settings ovrt clamps to OVR_TIMEOUT_MAX_TENTHS",
      lock_protocol.decode_settings('{{"ovrt":{}}}'.format(OVR_TIMEOUT_MAX_TENTHS + 500))["ovrt"] == OVR_TIMEOUT_MAX_TENTHS)
# The floor matters more than the ceiling: a timeout under a human press
# interval makes the counter unable to build, and override is the emergency
# path. 0 must not be honoured as "no window at all".
check("decode_settings ovrt clamps to OVR_TIMEOUT_MIN_TENTHS",
      lock_protocol.decode_settings('{"ovrt":0}')["ovrt"] == OVR_TIMEOUT_MIN_TENTHS)
check("decode_settings ovrt wrong type omitted, not defaulted",
      "ovrt" not in lock_protocol.decode_settings('{"ovrt":"soon"}'))

check("decode_settings malformed JSON -> None (not {})",
      lock_protocol.decode_settings("not json") is None)
check("decode_settings empty object -> {} (valid, zero fields)",
      lock_protocol.decode_settings("{}") == {})

# ----- decode_labels -----
labels_json = '[{"i":"a1","n":"Deep Work","c":"#22c55e"},{"i":"a2","n":"Reading","c":"3388ff"}]'
labels = lock_protocol.decode_labels(labels_json)
check("decode_labels parses both entries", labels is not None and len(labels) == 2)
check("decode_labels id/name preserved", labels[0][0] == "a1" and labels[0][1] == "Deep Work")
check("decode_labels leading-# hex parsed same as bare hex",
      lock_protocol.decode_labels('[{"i":"x","n":"y","c":"#3388ff"}]')[0][2]
      == lock_protocol.decode_labels('[{"i":"x","n":"y","c":"3388ff"}]')[0][2])

builtin_id = BUILTIN_TOPICS[0][0]
collide_json = '[{{"i":"{}","n":"Collide","c":"#ffffff"}}]'.format(builtin_id)
check("decode_labels drops id colliding with a BUILTIN_TOPICS id",
      lock_protocol.decode_labels(collide_json) == [])

check("decode_labels drops id containing a double-quote",
      lock_protocol.decode_labels('[{"i":"a\\"b","n":"y","c":"#ffffff"}]') == [])
check("decode_labels drops id containing a backslash",
      lock_protocol.decode_labels('[{"i":"a\\\\b","n":"y","c":"#ffffff"}]') == [])

check("decode_labels drops entries missing id or name",
      lock_protocol.decode_labels('[{"i":"","n":"y","c":"#fff"},{"i":"z","n":"","c":"#fff"}]') == [])

many = [{"i": "id{}".format(i), "n": "n{}".format(i), "c": "#ffffff"} for i in range(BLE_LABEL_MAX_COUNT + 5)]
import json as _json
check("decode_labels truncates to BLE_LABEL_MAX_COUNT",
      len(lock_protocol.decode_labels(_json.dumps(many))) == BLE_LABEL_MAX_COUNT)

check("decode_labels malformed JSON -> None (leaves previous state)",
      lock_protocol.decode_labels("not json") is None)
check("decode_labels non-list JSON -> None",
      lock_protocol.decode_labels('{"i":"a","n":"b"}') is None)
check("decode_labels valid empty list -> [] (distinct from None)",
      lock_protocol.decode_labels("[]") == [])

# ----- decode_pending_topic -----
check("decode_pending_topic real id passes through unchanged",
      lock_protocol.decode_pending_topic("work") == "work")
check("decode_pending_topic empty string -> None",
      lock_protocol.decode_pending_topic("") is None)
check("decode_pending_topic None -> None",
      lock_protocol.decode_pending_topic(None) is None)
check("decode_pending_topic over-length truncates to 40",
      len(lock_protocol.decode_pending_topic("x" * 60)) == 40)
check("decode_pending_topic truncation keeps the leading characters",
      lock_protocol.decode_pending_topic("a" * 40 + "b" * 20) == "a" * 40)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
