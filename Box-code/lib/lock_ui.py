# lock_ui.py -- builds the displayio scenes and exposes display helpers.
# Two views: "control" (set/start/stop) and "clock" (countdown dial).

from lock_config import (
    C_WHITE, C_GREY, C_GREEN, DEFAULT_MODE_IDX, DEFAULT_ACCENT_IDX, SPRING_STIFFNESS,
    SPRING_DAMPING, SPRING_MASS, NATIVE_ROTATION,
)
from lock_motion import Spring
from lock_ui_theme import ThemeMixin
from lock_ui_control import ControlMixin
from lock_ui_states import StateViewMixin
from lock_ui_clock import ClockMixin
from lock_ui_panels import PanelsMixin
from lock_ui_settings import SettingsMixin
from lock_ui_tags import TagPickerMixin

# COMPOSED FROM MIXINS. LockUI is one object with one set of attributes -- the
# ones __init__ below creates -- and every method still runs against that same
# `self`. The split is a filing decision, not a design change: at 2100 lines
# this class had eight unrelated screens interleaved in one file, and finding
# the tag picker meant scrolling past the clock faces. Each mixin is one
# screen's worth of methods, in the order they were already in.
#
# What it deliberately does NOT do is give the mixins state of their own.
# There is no __init__ in any of them and no super() call anywhere; they are
# namespaces for methods, resolved through the MRO at call time. That keeps
# them within the subset of multiple inheritance MicroPython implements, and
# it keeps the answer to "where does self._foo come from" a single place
# (__init__ below) rather than seven.
#
# tests/test_firmware_loads.py asserts the composed class still exposes
# exactly the members it did before the split, so a method lost in the move
# fails on the host rather than on the box.


class LockUI(ThemeMixin, ControlMixin, StateViewMixin, ClockMixin, PanelsMixin, SettingsMixin, TagPickerMixin):
    def __init__(self, display):
        self.display = display
        self.W = W = display.width
        self.H = H = display.height
        # Whether the call-alert overlay currently owns the display -- see
        # show_call_alert/hide_call_alert/show_view.
        self._call_alert_active = False
        # The display's native orientation -- NATIVE_ROTATION (lock_config.py)
        # is a hardcoded constant verified against this board's own
        # CircuitPython board.c, not a value read off display.rotation.
        # board.DISPLAY can be a supervisor-owned singleton that outlives a
        # soft reload, and -- per the 2026-08-25 manager report -- touch
        # mapping was still wrong even after a genuine full power-cycle test,
        # which means display.rotation at construction time is not a
        # trustworthy "was this actually native" signal even with a
        # run_reason-based fresh-boot check (a prior attempt at exactly that
        # heuristic is what this replaces). Trusting the known-correct
        # constant instead of trying to detect/recover it eliminates that
        # whole class of bug outright.
        self._base_rotation = NATIVE_ROTATION

        # ----- theme-tracking registries, populated by the _build_* calls
        # below (see set_theme). Bucketed by role, not by widget type, so
        # set_theme can walk them uniformly; the call_alert overlay is
        # deliberately never registered here -- an incoming-call alarm stays
        # full-intensity red/amber regardless of the chosen theme.
        self._bg_tiles = []            # TileGrid backgrounds (.pixel_shader[0])
        self._surface_widgets = []     # (obj, attr) tracking the "surface" color
        self._fg_widgets = []          # (obj, attr) tracking the "fg" (readable-on-bg) color
        self._dim_widgets = []         # (obj, attr) tracking the "dim" (secondary) color
        self._accent_widgets = []      # (obj, attr) tracking the chosen accent color --
        # settings values and the elapsed-clock time text, same accent the
        # LOCK/OPEN button and analog second hand already use, so a chosen
        # accent is actually visible there instead of every accent looking
        # identical on those two screens.
        # corner status glyphs (one pair per view that has them -- control +
        # the 3 clock styles) so battery/BLE state is glanceable without
        # swiping to the dedicated battery view. See update_corner_battery /
        # update_corner_ble.
        self._corner_ble_dots = []
        self._corner_bat_labels = []
        self._mode_idx = DEFAULT_MODE_IDX
        self._accent_idx = DEFAULT_ACCENT_IDX
        self._fg_color = C_WHITE
        self._dim_color = C_GREY
        self._accent_color = C_GREEN

        # ----- color-transition engine (see _start_color_transition /
        # step_color_transitions below) -- displayio has no alpha blending,
        # but a shape's .fill/.color setter is a cheap single-palette-entry
        # write with no bitmap reallocation (verified against
        # adafruit_display_shapes' RoundRect source), so lerping a widget's
        # RGB value across a handful of frames is a real, hardware-safe
        # motion technique distinct from an alpha cross-fade. Reserved for
        # "state indication" transitions (status bar, clock-view active
        # color) -- never for the override-timeout or battery bars, whose
        # width IS the literal remaining value; easing those would show a
        # number of seconds/percent that isn't the true one.
        self._color_transitions = []   # [obj, attr, from_color, to_color, start_time]
        self._an_active_target = None
        self._dig_active_target = None
        self._rg_active_target = None
        self._el_active_target = None

        # ----- position-spring motion (see lock_motion.Spring / step_motion
        # below) -- a complement to the color-transition engine above, not an
        # overlap: these move .y / .anchored_position, never .fill/.color, so
        # the two systems can never race on the same attribute.
        self._press_spring = Spring(SPRING_STIFFNESS, SPRING_DAMPING, SPRING_MASS)
        self._press_targets = ()   # ((obj, 'y'|'label', base), ...) currently offset
        self._press_ring = None
        self._done_pop = Spring(SPRING_STIFFNESS, SPRING_DAMPING, SPRING_MASS)
        self._ovr_pop = Spring(SPRING_STIFFNESS, SPRING_DAMPING, SPRING_MASS)

        self._build_control(W, H)

        # clock view has several swappable appearances (swipe up/down)
        self.clock_styles = ["analog", "digital", "ring", "elapsed"]
        self.clock_style_idx = 0
        self.clock_groups = []
        self._build_clock_analog(W, H)
        self._build_clock_digital(W, H)
        self._build_clock_ring(W, H)
        self._build_clock_elapsed(W, H)
        self._build_battery(W, H)
        self._build_call_alert(W, H)
        self._build_override(W, H)
        self._build_settings(W, H)
        self._build_setting_detail(W, H)
        self._build_tag_picker(W, H)
        self._build_topic_confirm(W, H)

        self.view = "control"
        display.root_group = self.control_group

        # apply the compiled-in default theme now that every widget above has
        # registered itself; LockController re-applies the persisted theme
        # (if different) right after this once Settings() has loaded.
        self.set_theme(DEFAULT_MODE_IDX, DEFAULT_ACCENT_IDX)
