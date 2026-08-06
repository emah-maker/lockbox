# lock_power.py -- screen backlight control for inactivity sleep.

from lock_config import BL_LEVEL


class Backlight:
    """Turns the LCD backlight on/off via display.brightness. Falls back to a
    no-op if the board's display does not support brightness control."""

    def __init__(self, display):
        self._display = display
        self._on = True
        try:
            display.brightness          # probe brightness support
            self._supported = True
        except (AttributeError, NotImplementedError):
            self._supported = False
        self._level = BL_LEVEL
        self._set(self._level)          # apply the dimmed level at startup

    def set_level(self, level):
        # change the active brightness (e.g. battery vs USB); applies now if on
        if level != self._level:
            self._level = level
            if self._supported and self._on:
                self._set(level)

    def _set(self, val):
        if not self._supported:
            return
        try:
            self._display.brightness = val
        except (AttributeError, NotImplementedError):
            self._supported = False

    @property
    def is_on(self):
        return self._on

    @property
    def supported(self):
        return self._supported

    def on(self):
        if self._supported and not self._on:
            self._set(self._level)
            self._on = True

    def off(self):
        # Only treat the screen as "off" if we can actually dim it; otherwise
        # leave is_on True so touch handling is never silently swallowed.
        if self._supported and self._on:
            self._set(0.0)
            self._on = False
