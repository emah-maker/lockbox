# lock_topic_confirm.py -- pre-session CONFIRM/CHANGE interaction state,
# sibling to lock_tag_picker.py (same extraction rationale: LockUI stays the
# pure renderer/hit-tester, LockController only reacts to a small, explicit
# result). Shown instead of the tag picker when the app has already pushed a
# topic the box recognises (see LockController.go_confirming) -- CONFIRM
# starts the session with that topic unchanged; CHANGE falls through to the
# existing tag picker to pick something else.
#
# Confirm/Change are tiny tagged results, same __slots__ style as
# lock_tag_picker.Select/Cancel/Page, so callers isinstance() instead of
# unpacking by position.
#
# No displayio/hardware imports -- pure and host-testable exactly like
# lock_tag_picker.py (see tests/test_lock_topic_confirm.py).


class Confirm:
    """Start the session with the topic this screen is already showing --
    the pending id the app pushed (LockController._pending_app_topic), not
    anything decided in this module. This module only knows the display
    name/color (via find_topic), never the id itself."""
    __slots__ = ()


class Change:
    """Back out to the existing tag picker to choose something else instead
    -- see LockController._apply_topic_confirm_result's Change branch for
    why self.state must be restored before go_picking runs."""
    __slots__ = ()


def find_topic(topics, topic_id):
    """Pure lookup over `topics` ([(id, name, color), ...], the exact shape
    LockController._all_topics() returns) for `topic_id` -- (name, color) if
    found, else None. None for a missing id AND for a falsy topic_id ("" or
    None) alike, matching the ''-is-nothing-pending convention
    lock_config.BLE_UUID_PENDING_TOPIC's payload and encode_status's "tp"
    field already use -- callers never need their own falsy guard before
    calling this.

    Used for two distinct purposes by LockController, both required by the
    no-regression brief: deciding what to actually display on this screen
    (go_confirming), and validating a pending id at both receipt
    (apply_ble_pending_topic) and again at LOCK-press time
    (_handle_release), since a custom label can be deleted/renamed on the
    app side between those two moments."""
    if not topic_id:
        return None
    for tid, name, color in topics:
        if tid == topic_id:
            return name, color
    return None


class TopicConfirm:
    """Pre-session CONFIRM/CHANGE screen: two large buttons, no hold
    required -- see on_touch for the per-touch-frame contract, which
    intentionally mirrors lock_tag_picker.TagPicker.on_touch's shape (same
    "call once per frame, infer touch-down from internal state" idiom) so
    LockController's dispatch code looks the same for both screens.

    CONFIRM/CHANGE commit on a plain tap-release inside their own hit box,
    NOT a press-and-hold like the tag picker's rows. That difference is
    deliberate, not an oversight: TAG_HOLD_S exists on the picker because a
    stray tap on one of up to six closely-packed list rows would otherwise
    start a session outright, with no way to back out once a finger landed.
    This screen is different on both counts -- the user was already
    deliberately navigated here (LOCK was pressed, and the app had already
    picked a topic), and it has exactly two large, well-separated buttons,
    not six thin rows -- so the accidental-tap risk a hold guards against
    barely exists here, and a confirm *button* is what was actually asked
    for.
    """

    def __init__(self, ui):
        self.ui = ui
        self._active = False
        # Which button (if any) the touch-down landed on -- 'confirm',
        # 'change', or None. Release only ever commits if the finger is
        # STILL over this same button at release time (see _release); a
        # press that starts on a button and drifts off before release does
        # not commit, same "touch-up-inside" convention buttons everywhere
        # else use, and the same reason this is captured once at touch-down
        # rather than re-derived from the release point alone.
        self._pressed = None
        # Currently-shown press highlight (mirrors self._pressed, but only
        # while the finger is actually still over that same button) -- kept
        # separate so ui.press_topic_confirm is only called when the
        # highlighted button actually changes, not on every frame.
        self._highlighted = None

    def show(self, name):
        """Resets all touch state and shows the confirm screen for `name`
        (the topic's display name, not its id -- see find_topic) -- call
        this instead of touching the ui directly (LockController.
        go_confirming)."""
        self._active = False
        self._pressed = None
        self._highlighted = None
        self.ui.show_topic_confirm(name)

    def on_touch(self, point, now, released):
        """Call once per touch-frame while this screen is showing: on every
        frame a finger is down (released=False), and once more on release
        (released=True, point should be the last known point). Infers
        "this is a fresh touch-down" from its own internal state, same as
        lock_tag_picker.TagPicker.on_touch, so the caller never has to track
        a separate "began" flag.

        Returns Confirm/Change/None. Unlike the tag picker's Select (which
        is only ever produced live, mid-hold), both real results here are
        only ever produced AT release -- there is no hold to complete
        mid-touch on this screen.
        """
        if not self._active:
            self._active = True
            self._pressed = self._hit(point)
        if released:
            self._active = False
            return self._release(point)
        self._update_highlight(self._hit(point))
        return None

    def _hit(self, point):
        x, y = point
        if self.ui.in_topic_confirm_confirm(x, y):
            return 'confirm'
        if self.ui.in_topic_confirm_change(x, y):
            return 'change'
        return None

    def _update_highlight(self, current):
        # Only highlight the ORIGINALLY pressed button, and only while the
        # finger is still over it -- drifting onto the OTHER button must not
        # highlight it, since release there still won't commit (see
        # _release): the highlight always reflects "release here now would
        # commit", never anything else.
        show = self._pressed if (self._pressed is not None and current == self._pressed) else None
        if show == self._highlighted:
            return
        self._highlighted = show
        self.ui.press_topic_confirm(show)

    def _release(self, point):
        pressed = self._pressed
        self._pressed = None
        self._update_highlight(None)
        if pressed is None:
            return None
        if self._hit(point) == pressed:
            return Confirm() if pressed == 'confirm' else Change()
        return None
