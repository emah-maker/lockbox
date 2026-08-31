# lock_settings_nav.py -- settings LIST screen interaction state, extracted
# the same way lock_tag_picker.TagPicker extracted the tag picker's: LockUI
# stays the pure renderer/hit-tester, this module owns everything about WHEN
# a row press turns into a hold, WHEN a drag dominates a press, and WHEN
# either commits -- exposed through one method, on_touch(point, now,
# released), so LockController only has to react to a small, explicit
# result. Read lock_tag_picker.py first if you haven't; this is deliberately
# the same shape (same "one call per touch frame, infers a fresh touch-down
# from its own _active flag" contract, same tiny __slots__ result classes).
#
# See settings-ui-spec.md SS6/SS7 for the behaviour this implements, and
# lock_config.SETTINGS_HOLD_S's comment for why rows 4/5 are the only ones
# that ever hold, and only OFF->ON.
from lock_config import SWIPE_MIN_PX, SETTINGS_HOLD_S

# Row indices that are boolean AND security-weakening -- the box's only
# standing escape hatches from its own purpose (Settings.allow_remote_unlock,
# Settings.unlock_on_call; see lock_config.SETTINGS_HOLD_S's comment and
# BLE_ALLOW_REMOTE_UNLOCK/BLE_UNLOCK_ON_CALL for the anti-cheat reasoning).
# These are the ONLY rows that ever arm a hold, and only while OFF -- turning
# either OFF is the safe direction and stays a single instant tap, and row 1
# ("Auto") is a convenience setting, not a security one, so it is a plain tap
# both ways. Fixed index order (0..5) matches Settings.adjust's contract --
# do not renumber.
_HOLD_ROWS = (4, 5)


class Open:
    """Controller should open the detail page for this (numeric) row."""
    __slots__ = ("row",)

    def __init__(self, row):
        self.row = row


class Changed:
    """A boolean row's field was just mutated in-RAM -- controller should
    settings.save() and ui.update_settings(settings) to persist and repaint.
    Produced either at release (a plain tap on row 1, or turning an ON risky
    row OFF) or LIVE, mid-touch (a hold on an OFF risky row reaching
    SETTINGS_HOLD_S) -- the same Select-is-only-ever-live asymmetry
    lock_tag_picker.TagPicker documents; do not "fix" it."""
    __slots__ = ("row",)

    def __init__(self, row):
        self.row = row


class SettingsNav:
    """Settings list screen: tap a numeric row to open its detail page, tap
    row 1 (Auto) to toggle it in place, tap an ON risky row (4/5) to turn it
    off, or hold an OFF risky row past SETTINGS_HOLD_S to turn it on. See
    on_touch for the per-touch-frame contract.

    `settings_fn` is a callable returning the live Settings object (mirrors
    TagPicker's `topics_fn`), so this nav can never hold a stale reference
    across a BLE-pushed settings change.
    """

    def __init__(self, ui, settings_fn):
        self.ui = ui
        self._settings_fn = settings_fn
        self._active = False
        self._start = None
        self._last = None
        # The row armed at touch-down (press highlight owner), or None if
        # the touch-down missed every row band.
        self._armed_row = None
        # True only while _armed_row is also mid hold-to-enable (an OFF
        # risky row) -- see _arm.
        self._holding = False
        self._hold_start = 0.0

    def show(self):
        """Resets all touch/press/hold state -- call this instead of
        touching the ui directly whenever the settings view is (re)entered
        (LockController.set_view), so a view switch mid-press or mid-hold
        can never leave a stale row highlight or a stale amber fill armed
        against a touch that no longer exists."""
        self._active = False
        self._start = None
        self._last = None
        if self._armed_row is not None:
            self.ui.press_settings_row(None)
        if self._holding:
            self.ui.cancel_settings_hold()
            self.ui.set_settings_row_hint(self._armed_row, None)
        self._armed_row = None
        self._holding = False

    def on_touch(self, point, now, released):
        """Call once per touch-frame while the settings list is showing: on
        every frame a finger is down (released=False), and once more on
        release (released=True, point should be the last known point).
        Infers "this is a fresh touch-down" from its own _active flag, same
        as lock_tag_picker.TagPicker.on_touch -- see its docstring for why a
        touch that begins and ends in the SAME call both arms AND ticks,
        rather than skipping the tick.

        Returns one of Open/Changed/None.
        """
        if not self._active:
            self._active = True
            self._start = point
            self._last = point
            self._arm(point, now)
        else:
            self._last = point
        if released:
            self._active = False
            return self._release()
        return self._tick(now)

    # ----- touch-down: arm a press, and a hold if this is an OFF risky row -----
    def _arm(self, point, now):
        x, y = point
        row = self.ui.settings_row_at(y)
        if row < 0:
            return
        self._armed_row = row
        self.ui.press_settings_row(row)   # instant highlight -- see spec SS2.4
        if row in _HOLD_ROWS and not self._row_is_on(row):
            self._holding = True
            self._hold_start = now
            self.ui.start_settings_hold(row)
            # Live swap to the requirement text -- the discoverability
            # mechanism: it appears exactly when the finger is already
            # down, so it can never be missed, and costs no permanent
            # screen space the rest of the time (spec SS6.1).
            self.ui.set_settings_row_hint(row, "hold to enable")

    def _row_is_on(self, row):
        s = self._settings_fn()
        if row == 1:
            return s.auto_open
        if row == 4:
            return s.allow_remote_unlock
        if row == 5:
            return s.unlock_on_call
        return False

    # ----- per-frame tick while held -----
    def _tick(self, now):
        if self._armed_row is None:
            return None
        x, y = self._last
        dx = x - self._start[0]
        dy = y - self._start[1]
        # Horizontal drag: the controller's own view-switch swipe
        # (_handle_release, checked ahead of the settings-list tap handling)
        # owns this gesture -- never eat it, just drop whatever was armed
        # and hand back None so the controller sees a clean slate.
        if abs(dx) >= SWIPE_MIN_PX and abs(dx) > abs(dy):
            self._cancel_armed()
            return None
        # Vertical drag: there is no scrolling on this screen (frozen spec
        # SS1, item 1) -- a stray vertical drag must do NOTHING rather than
        # commit something the user didn't mean, so this cancels exactly
        # like the horizontal case rather than, say, paging or adjusting.
        if abs(dy) >= SWIPE_MIN_PX and abs(dy) > abs(dx):
            self._cancel_armed()
            return None
        # Drifted onto a different row (or off the list entirely, row -1)
        # than the one armed -- mirrors TagPicker._hold_tick's identical
        # guard. Applies to every armed row, not just the holding ones: a
        # press highlight that stays lit under a finger that has wandered
        # onto a different row is exactly the kind of "target you see isn't
        # the target you get" bug SS1b called out.
        if self.ui.settings_row_at(y) != self._armed_row:
            self._cancel_armed()
            return None
        if self._holding:
            progress = (now - self._hold_start) / SETTINGS_HOLD_S
            if progress >= 1.0:
                row = self._armed_row
                return self._commit_hold(row)
            self.ui.step_settings_hold(self._armed_row, progress)
        return None

    def _cancel_armed(self):
        if self._armed_row is not None:
            self.ui.press_settings_row(None)
        if self._holding:
            self.ui.cancel_settings_hold()
            self.ui.set_settings_row_hint(self._armed_row, None)
        self._armed_row = None
        self._holding = False

    def _commit_hold(self, row):
        # Reaching SETTINGS_HOLD_S commits LIVE, mid-touch -- this is the one
        # gesture in the whole nav that does not wait for release (see
        # Changed's docstring and lock_tag_picker.Select's identical
        # asymmetry). The field flips here; the controller's
        # _apply_settings_nav_result does the save()+repaint.
        s = self._settings_fn()
        if row == 4:
            s.allow_remote_unlock = True
        else:
            s.unlock_on_call = True
        self.ui.cancel_settings_hold()
        self.ui.set_settings_row_hint(row, None)
        self.ui.press_settings_row(None)
        self._armed_row = None
        self._holding = False
        return Changed(row)

    # ----- release -----
    def _release(self):
        dx = self._last[0] - self._start[0]
        dy = self._last[1] - self._start[1]
        row = self._armed_row
        holding_row = self._armed_row if self._holding else None
        # Always clear the press highlight and any fill/hint here, whatever
        # the outcome below turns out to be -- a finger that has already
        # lifted must never leave a row looking armed.
        self.ui.press_settings_row(None)
        if holding_row is not None:
            self.ui.cancel_settings_hold()
            self.ui.set_settings_row_hint(holding_row, None)
        self._armed_row = None
        self._holding = False
        if row is None:
            return None
        if abs(dx) >= SWIPE_MIN_PX and abs(dx) > abs(dy):
            return None   # view-switch swipe -- not ours to resolve
        if abs(dy) >= SWIPE_MIN_PX and abs(dy) > abs(dx):
            return None   # no scrolling; a stray vertical drag does nothing
        return self._resolve_tap(row)

    def _resolve_tap(self, row):
        if row == 0 or row == 2 or row == 3:
            return Open(row)
        if row == 1:
            # Auto-open toggles in place, same as before this redesign --
            # but NOT via Settings.toggle_auto(), which saves internally.
            # This nav never saves (mirrors TagPicker/_update_hold's
            # division of labour: the controller's single save() call in
            # _apply_settings_nav_result is the only debounce point), so
            # the field is flipped directly here instead.
            s = self._settings_fn()
            s.auto_open = not s.auto_open
            return Changed(1)
        if row in _HOLD_ROWS:
            if self._row_is_on(row):
                # Turning a risky row OFF is the safe direction -- a single
                # instant tap, no hold required (SETTINGS_HOLD_S's comment).
                s = self._settings_fn()
                if row == 4:
                    s.allow_remote_unlock = False
                else:
                    s.unlock_on_call = False
                return Changed(row)
            # OFF and just tapped (not held): deliberately does nothing.
            # Only a completed hold (see _tick/_commit_hold) may turn a
            # risky row on -- an accidental tap must never silently defeat
            # the box. Do not "fix" this into a toggle.
            return None
        return None
