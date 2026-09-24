# lock_util.py -- the small pure helpers the firmware shares.
#
# These lived in lock_config.py, which is otherwise 100-odd tuning CONSTANTS.
# They are behaviour, not configuration: clamping a range, formatting a
# duration, blending two colours. Keeping them here draws the line where it
# belongs -- lock_config answers "what value", this answers "how" -- and it is
# what brought that file back under the 500-line guide without inventing
# arbitrary seams through a list of constants that reads perfectly well as one.
#
# lock_config re-exports every name below, so the 86 `from lock_config import
# ...` sites across the firmware are unchanged and either import path works.
# Nothing here reads a constant; each helper takes what it needs as arguments.


# This panel's init has color INVERSION on (red->cyan, white->black).
# fix() sends the inverse so colors render correctly.
def fix(c):
    return 0xFFFFFF ^ c


def clamp(value, lo, hi):
    """Clamp value into [lo, hi]. Works for int or float alike; cast first
    (e.g. int(x)) if the call site needs a specific type -- this only orders
    the comparisons. Not for per-frame/hot-path call sites (see lock_ui.py's
    _set_gauge/update_override_timeout/step_tag_picker_* and
    LockController.update, which inline this instead)."""
    return max(lo, min(hi, value))


def fmt_hms(secs):
    secs = max(0, int(secs))
    return "{:d}:{:02d}:{:02d}".format(secs // 3600, (secs % 3600) // 60, secs % 60)


def fmt_hm(secs):
    """H:MM, no seconds -- the control ("home") screen's clock label only
    (LockUI.set_clock/set_clock_text). The clock view's analog/digital/ring/
    elapsed styles still show full H:MM:SS via fmt_hms above; this is a
    separate, coarser display, not a change to fmt_hms itself. Rounds UP to
    the next whole minute (except on an exact minute) so the displayed
    minute never ticks down a full minute early -- the same "never show less
    time than is actually left" rule fmt_hms's callers apply via a `+0.999`
    ceiling, just baked in here since there's no seconds digit left to
    absorb the fractional remainder."""
    secs = max(0, int(secs))
    mins = (secs + 59) // 60 if secs % 60 else secs // 60
    return "{:d}:{:02d}".format(mins // 60, mins % 60)


def lerp_color(c0, c1, t):
    """Linear-blend two already-`fix()`ed 0xRRGGBB colors by t in [0, 1].
    fix() is a per-channel bitwise complement (an affine map), so lerping the
    fixed ints gives the exact same result as fixing a lerp of the originals --
    no need to un-invert first. Cheap integer channel math, no allocation, safe
    to call every frame (see LockUI's digital-clock "breathing" highlight)."""
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    r0, g0, b0 = (c0 >> 16) & 0xFF, (c0 >> 8) & 0xFF, c0 & 0xFF
    r1, g1, b1 = (c1 >> 16) & 0xFF, (c1 >> 8) & 0xFF, c1 & 0xFF
    r = int(r0 + (r1 - r0) * t)
    g = int(g0 + (g1 - g0) * t)
    b = int(b0 + (b1 - b0) * t)
    return (r << 16) | (g << 8) | b


def snap_to_option(options, value):
    """Nearest member of a discrete option tuple (SLEEP_OPTIONS/
    BRIGHT_OPTIONS) to an arbitrary value -- used wherever a value can arrive
    from outside the on-box stepper (a BLE write carries whatever the app's
    slider sent, not a value pre-guaranteed to already be one of these
    options). Without this, a stored value that isn't an exact option member
    makes lock_settings._step_in's `options.index(value)` raise, silently
    resetting the on-box stepper to the first option on the very next swipe
    instead of stepping from where the phone left it. Ties round toward the
    lower option (min()'s first-match-wins on equal key)."""
    return min(options, key=lambda o: abs(o - value))
