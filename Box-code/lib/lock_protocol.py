# lock_protocol.py -- the BLE wire codec (app/src/ble/protocol.ts's mirror).
#
# Pure encode/decode: no hardware, no state-machine dispatch, no side
# effects. Plain-Python importable (no CircuitPython-only modules) so it can
# be unit-tested off-device -- see Box-code/tests/test_lock_protocol.py.
# LockController (lock_controller.py) owns everything this module is NOT:
# self.state checks, calling go_running/go_closed/go_done, and applying
# decoded settings/labels onto self.settings.
from lock_config import (
    MIN_SECONDS, MAX_SECONDS, OVR_MIN, OVR_MAX, SLEEP_OPTIONS, BRIGHT_OPTIONS,
    snap_to_option, SERVO_ANGLE_MIN, SERVO_ANGLE_MAX, ACCENT_COLORS, C_GREY,
    fix, BLE_LABEL_MAX_COUNT, BLE_LABEL_NAME_MAX_LEN, BUILTIN_TOPICS,
)

# Reserved ids a synced custom label must not be allowed to reuse -- see
# decode_labels. A plain tuple, not a set/frozenset -- frozenset is disabled
# on some smaller CircuitPython board builds for space reasons, and `in` on
# a 6-element tuple is plenty fast for this.
_BUILTIN_TOPIC_IDS = tuple(t[0] for t in BUILTIN_TOPICS)


def _parse_hex_color(s):
    """'#rrggbb' (app/src/stats/customLabels.ts's LABEL_SWATCHES format,
    leading '#' optional, case-insensitive) -> a fix()-applied int, the same
    encoding every other color in lock_config.py already uses as a displayio
    fill. Falls back to C_GREY on anything malformed, same "don't crash the
    run loop on garbage BLE input" philosophy as decode_labels's other
    fields."""
    try:
        h = str(s).lstrip("#")
        if len(h) != 6:
            return C_GREY
        return fix(int(h, 16))
    except (ValueError, TypeError):
        return C_GREY


def encode_status(state, rem, set_seconds, battery_pct, topic):
    return '{{"st":"{}","rem":{},"set":{},"bat":{},"tp":"{}","fw":"1.0"}}'.format(
        state, rem, set_seconds, battery_pct, topic)


def encode_settings(settings):
    st = settings
    return ('{{"ovr":{},"auto":{},"sleep":{},"bright":{},"unlk":{},"ucal":{},'
             '"thm":{},"acc":{},"flip":{},"langle":{},"uangle":{}}}').format(
        st.override_presses, 1 if st.auto_open else 0, st.sleep_s,
        st.bright_pct, 1 if st.allow_remote_unlock else 0,
        1 if st.unlock_on_call else 0, st.theme_mode, st.accent_idx,
        1 if st.screen_flipped else 0, st.lock_angle, st.unlock_angle)


class Command:
    """Decoded result of decode_command -- `name` is the opcode
    ("start"/"dur"/"lock"/"unlock"/"historyAck"); `seconds`/`seq` are only
    set for the opcodes that carry them."""
    __slots__ = ("name", "seconds", "seq")

    def __init__(self, name, seconds=None, seq=None):
        self.name = name
        self.seconds = seconds
        self.seq = seq


def decode_command(cmd):
    """Parse a BLE `command` write (see LockController.apply_ble_command's
    opcode list) into a Command, or None if the opcode is unrecognized or
    its argument is malformed in a way the original code treated as "ignore
    this write entirely" (e.g. "start:notanumber", "historyAck:notanumber").
    Pure parsing -- does not know about self.state; the caller decides what
    a given decoded Command means for the current state."""
    op = cmd.split(":", 1)
    name = op[0]
    if name == "start":
        if len(op) != 2:
            return Command("start", seconds=None)
        try:
            secs = int(op[1])
        except ValueError:
            return None
        return Command("start", seconds=max(MIN_SECONDS, min(MAX_SECONDS, secs)))
    if name == "dur":
        if len(op) != 2:
            return None
        try:
            secs = int(op[1])
        except ValueError:
            return None
        return Command("dur", seconds=max(MIN_SECONDS, min(MAX_SECONDS, secs)))
    if name == "lock":
        return Command("lock")
    if name == "unlock":
        return Command("unlock")
    if name == "historyAck":
        if len(op) != 2:
            return None
        try:
            seq = int(op[1])
        except ValueError:
            return None
        return Command("historyAck", seq=seq)
    return None


def decode_settings(text):
    """Parse+validate a BLE `settings` JSON write (app/src/ble/protocol.ts's
    encodeSettings) into a dict of {wire_key: validated_value}, containing
    only the keys that were present in `text` AND passed their own
    validation -- one malformed field must not drop the rest of an otherwise
    valid payload. Returns None if `text` isn't parseable JSON at all, which
    the caller must treat as "ignore this write entirely" (no field applied,
    no save, no refresh) -- distinct from a validly-parsed payload that
    happens to apply zero fields."""
    try:
        import json
        d = json.loads(text)
    except (ValueError, ImportError):
        return None
    updates = {}
    if "ovr" in d:
        # Clamp to [OVR_MIN, OVR_MAX] -- a BLE write now carries whatever
        # the app's slider or its custom-number entry sent, not a value
        # pre-snapped to a fixed option list, so this is the only thing
        # standing between a malformed/out-of-range payload and a stored
        # value the box's single NVM byte can't actually hold.
        try:
            updates["ovr"] = max(OVR_MIN, min(OVR_MAX, int(d["ovr"])))
        except (ValueError, TypeError):
            pass
    if "auto" in d:
        updates["auto"] = bool(d["auto"])
    if "sleep" in d:
        # Snap to the nearest SLEEP_OPTIONS member, not just clamp into its
        # min/max range -- lock_settings._step_in (the on-box stepper) does
        # `options.index(value)`, which raises for any value that isn't an
        # exact option member and silently resets the stepper to the first
        # option on the next swipe instead of stepping from wherever the
        # phone left it.
        try:
            updates["sleep"] = snap_to_option(SLEEP_OPTIONS, int(d["sleep"]))
        except (ValueError, TypeError):
            pass
    if "bright" in d:
        # Same snap-to-option reasoning as "sleep" above.
        try:
            updates["bright"] = snap_to_option(BRIGHT_OPTIONS, int(d["bright"]))
        except (ValueError, TypeError):
            pass
    if "unlk" in d:
        updates["unlk"] = bool(d["unlk"])
    if "ucal" in d:
        updates["ucal"] = bool(d["ucal"])
    if "thm" in d:
        try:
            updates["thm"] = max(0, min(1, int(d["thm"])))
        except (ValueError, TypeError):
            pass
    if "acc" in d:
        # len(ACCENT_COLORS) tracks whatever the current accent count
        # actually is instead of a second number that has to be remembered
        # and kept in sync.
        try:
            updates["acc"] = max(0, min(len(ACCENT_COLORS) - 1, int(d["acc"])))
        except (ValueError, TypeError):
            pass
    if "flip" in d:
        updates["flip"] = bool(d["flip"])
    if "langle" in d:
        # Clamp to [SERVO_ANGLE_MIN, SERVO_ANGLE_MAX] -- the servo's real
        # range (lock_servo.Servo._write_angle already clamps here too, but
        # this keeps the persisted/reported value honest rather than
        # relying on that as the only backstop).
        try:
            updates["langle"] = max(SERVO_ANGLE_MIN, min(SERVO_ANGLE_MAX, int(d["langle"])))
        except (ValueError, TypeError):
            pass
    if "uangle" in d:
        try:
            updates["uangle"] = max(SERVO_ANGLE_MIN, min(SERVO_ANGLE_MAX, int(d["uangle"])))
        except (ValueError, TypeError):
            pass
    return updates


def decode_labels(text):
    """Parse+validate a BLE `labels` JSON write (app/src/ble/protocol.ts's
    cmdSetLabels) into [(id, name, color), ...], or None if the payload was
    malformed (unparsable JSON, or not a JSON array) -- None signals the
    caller to leave its previous label list untouched rather than clearing
    it on a garbled write. Compact keys ("i"/"n"/"c") to save BLE payload
    bytes."""
    try:
        import json
        d = json.loads(text)
    except (ValueError, ImportError):
        return None
    if not isinstance(d, list):
        return None
    labels = []
    for item in d[:BLE_LABEL_MAX_COUNT]:
        if not isinstance(item, dict):
            continue
        lid = str(item.get("i", ""))[:40]
        name = str(item.get("n", ""))[:BLE_LABEL_NAME_MAX_LEN]
        color = _parse_hex_color(item.get("c", ""))
        # lid (never name) gets echoed back verbatim, unescaped, into
        # encode_status's "tp" field -- a '"' or '\' in it would break that
        # JSON's structure, freezing the app's live status parsing for the
        # whole session (parseStatus returns null on a parse error). Not
        # reachable via the shipped app today (customLabels.ts only ever
        # generates base36 ids), but a malformed/adversarial id from
        # anywhere else that can write BLE_UUID_LABELS shouldn't be able to
        # do this -- same "don't crash/wedge on bad input" standard already
        # applied to every other BLE-sourced field here.
        if '"' in lid or "\\" in lid:
            continue
        # A synced id colliding with a BUILTIN_TOPICS id would put two
        # tag-picker rows under the same id -- encode_status's "tp" field
        # can then only echo back the shared id, not which row was actually
        # tapped, so the app can't tell them apart when it re-resolves
        # display/color from its own customLabels catalog.
        if lid and name and lid not in _BUILTIN_TOPIC_IDS:
            labels.append((lid, name, color))
    return labels
