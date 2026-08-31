# lock_ui_widgets.py -- reusable, self-less primitives for the settings
# redesign: the switch (track + knob), the generic "fraction of a bar" width
# math shared by the hold-to-confirm sweep and the detail-page progress
# track, the row hit-test math, and the detail page's back chevron.
#
# Module-level functions ONLY -- deliberately NOT a mixin, unlike every other
# lock_ui_*.py file LockUI is composed from. tests/test_firmware_loads.py
# asserts no two of LockUI's mixins define the same name; a mixin is the one
# way to violate that by accident, and these primitives are shared building
# blocks, not a screen of their own, so there is no `self` for them to want
# in the first place. Same precedent as lock_ui_common.py (see its header):
# nothing below touches an instance.

import terminalio
from adafruit_display_text import label
from adafruit_display_shapes.roundrect import RoundRect
from adafruit_display_shapes.rect import Rect
from adafruit_display_shapes.circle import Circle
from adafruit_display_shapes.triangle import Triangle
from lock_config import (
    C_SURFACE, C_SURFACE_HILITE, C_WHITE, C_GREY, C_AMBER, RADIUS_CARD, RADIUS_BTN_LG,
    OVR_MIN, OVR_MAX, SLEEP_OPTIONS, BRIGHT_OPTIONS,
)


# ----- value formatting + range math for the three numeric settings -----
# Pure functions of (idx, settings), so they live here rather than as
# SettingsMixin methods: BOTH the six-row list and the detail page render
# these same strings, and the two sites drifting apart is exactly how one
# screen ends up claiming a feature is on while the other says it is off.
# idx is the settings-row index (0 Override, 2 Sleep, 3 Bright -- the
# booleans, 1/4/5, never reach any of these: they render as switches on the
# list and have no detail page at all).

def fmt_sleep(sleep_s):
    """0 is SLEEP_OPTIONS's "never sleep" choice, not a zero-second timeout
    (see lock_config.SLEEP_OPTIONS and code.py's sleep predicate), so it has
    to read as OFF rather than "0s" -- which would describe the opposite
    behaviour to the one the box is actually in."""
    return "OFF" if sleep_s <= 0 else "{}s".format(sleep_s)


def fmt_setting(idx, s):
    if idx == 0:
        return str(s.override_presses)
    if idx == 2:
        return fmt_sleep(s.sleep_s)
    return "{}%".format(s.bright_pct)


def setting_fraction(idx, s):
    """Where the current value sits in its own range, 0..1 -- drives the
    detail page's progress track so "30s" reads as visibly near the middle
    instead of forcing the user to remember SLEEP_OPTIONS's shape."""
    if idx == 0:
        return (s.override_presses - OVR_MIN) / float(OVR_MAX - OVR_MIN)
    if idx == 2:
        return SLEEP_OPTIONS.index(s.sleep_s) / float(len(SLEEP_OPTIONS) - 1)
    return BRIGHT_OPTIONS.index(s.bright_pct) / float(len(BRIGHT_OPTIONS) - 1)


def setting_bounds_text(idx):
    """The track's endpoint labels, formatted with the SAME functions the big
    value uses, so the ends read OFF/60s, 5/500, 10%/100% instead of a bare
    number that means something different from the value above it."""
    if idx == 0:
        return str(OVR_MIN), str(OVR_MAX)
    if idx == 2:
        return fmt_sleep(SLEEP_OPTIONS[0]), fmt_sleep(SLEEP_OPTIONS[-1])
    return "{}%".format(BRIGHT_OPTIONS[0]), "{}%".format(BRIGHT_OPTIONS[-1])

# ----- switch: track + knob -----
# Apple's UISwitch is 51x31 pt (ratio 1.645), 27pt knob, 2pt inset. Ported at
# the closest whole-pixel aspect ratio this 172px-wide screen can hold --
# 36x22 (ratio 1.636) -- rather than scaled to a non-integer size that would
# need sub-pixel drawing this display stack doesn't have. Fixed x=120 (not a
# parameter): every switch row on the settings list uses the same column
# (see lock_ui_settings.py SS2.2/SS3), so there is exactly one switch column
# on the one screen that has any, and giving it a name here beats repeating
# the literal at every call site.
SWITCH_X = 120
SWITCH_TRACK_W = 36
SWITCH_TRACK_H = 22
SWITCH_TRACK_R = 11
SWITCH_KNOB_R = 9
SWITCH_KNOB_INSET = 2   # Apple's 2pt inset, ported 1:1 in px
# OFF/ON resting centre-x for the knob -- travel is the gap left once both
# ends have their inset+radius subtracted: 36 - 2*(2+9) = 14px.
SWITCH_KNOB_OFF_CX = SWITCH_X + SWITCH_KNOB_INSET + SWITCH_KNOB_R           # 131
SWITCH_KNOB_ON_CX = SWITCH_X + SWITCH_TRACK_W - SWITCH_KNOB_INSET - SWITCH_KNOB_R  # 145
SWITCH_KNOB_TRAVEL_PX = SWITCH_KNOB_ON_CX - SWITCH_KNOB_OFF_CX              # 14


def build_switch_track(track_y):
    """The track RoundRect for one switch row, at the fixed SWITCH_X column
    and the row-specific `track_y` (= band_top + 12, see lock_ui_settings.py).
    No `fill` at construction -- track/knob colors are STATE-dependent (see
    this function's caller), so they are never a theme-registry color; the
    caller's first update_settings() call (made immediately after LockUI is
    built, before the settings screen can ever actually be shown) paints the
    real fill before anything is visible.

    The 1px OUTLINE is load-bearing, not decoration. An OFF track's fill is
    C_SURFACE_HILITE -- the exact same color press_settings_row washes the
    row's CARD with. So the moment a finger lands on an OFF switch row (the
    single most common interaction on this screen), a fill-only track became
    invisible against its own highlighted card: the switch appeared to lose
    its track and leave a bare grey knob floating on the row. Caught on the
    first render of the pressed state; arithmetic would not have found it,
    since both colors are individually correct.
    _apply_switch drives the outline per state -- dim while OFF (so the pill
    always has a silhouette no matter what is painted behind it), and equal
    to the accent fill while ON (so it vanishes into it and the ON state
    stays a solid accent pill, the way a real UISwitch looks)."""
    return RoundRect(SWITCH_X, track_y, SWITCH_TRACK_W, SWITCH_TRACK_H, SWITCH_TRACK_R,
                     stroke=1)


def build_switch_knob(knob_cy):
    """The knob Circle for one switch row, resting at the OFF position
    (`switch_knob_cx(False)`) -- the caller's first update_settings() call
    moves/repaints it to the real initial state, same reasoning as
    build_switch_track's placeholder-fill comment above."""
    return Circle(SWITCH_KNOB_OFF_CX, knob_cy, SWITCH_KNOB_R)


def switch_knob_cx(is_on):
    """The knob's resting centre-x for a given on/off state -- the single
    place that OFF/ON maps to a pixel column, so the build helper above and
    lock_ui_settings.py's apply-state path can never disagree about it.

    Callers must animate this via the knob's `.x0` property, NOT `.x`:
    adafruit_display_shapes.circle.Circle's `.x`/`.y` are the underlying
    TileGrid's top-left corner (bitmap origin), while `.x0`/`.y0` are the
    true centre -- a property pair that recomputes `.x` from `.x0 - r`
    under the hood. Tweening `.x` directly would move the knob by the same
    delta but treat that delta as a TOP-LEFT offset instead of a centre
    one, which happens to still look right only because the knob never
    changes radius -- fragile and not what the name means. `.x0` is correct
    on both this repo's host shim (tests/preview/shim/adafruit_display_shapes
    /circle.py, where it's a plain attribute) and the real vendored library
    (a property), so it is the one attribute name safe to write from either
    side.
    """
    return SWITCH_KNOB_ON_CX if is_on else SWITCH_KNOB_OFF_CX


# ----- generic "fraction of a bar" width math -----
# Shared by two different-looking bars: the settings-list hold-to-confirm
# amber sweep (SS6, min_w=0 -- 0 progress must draw nothing) and the
# detail-page progress track fill (SS4, min_w=4 -- a non-zero value must
# never look perfectly empty). One function instead of two near-duplicates
# because a bug in the clamp/round behavior would otherwise have to be found
# and fixed twice.
def bar_fill_width(total_w, fraction, min_w=0):
    if fraction < 0.0:
        fraction = 0.0
    elif fraction > 1.0:
        fraction = 1.0
    w = int(total_w * fraction)
    if fraction > 0.0 and w < min_w:
        w = min_w
    return w


# ----- row hit-test math -----
# The settings list's whole reason for existing as a redesign (SS1b): every
# pixel from `rows_top` to the last row's bottom edge belongs to SOME row,
# with no dead gap between visible cards. A plain integer-divide-by-pitch
# after subtracting the top, rather than settings_row_at's old per-row
# center+/-19px tolerance check, which is exactly what left 2px gaps between
# adjacent rows' hit zones.
def row_at(y, rows_top, pitch, row_count):
    if y < rows_top:
        return -1
    idx = int((y - rows_top) // pitch)
    if idx < 0 or idx >= row_count:
        return -1
    return idx


# ----- settings list: row layout + construction (SS2.1/SS2.2) -----
# Moved here (rather than staying in lock_ui_settings.py alongside the
# interaction code that uses these numbers) purely to fit that file under
# the repo's 500-line cap once the switch/hold/detail-track work landed --
# see settings-ui-spec.md SS9's explicit allowance to move MORE geometry
# helpers here rather than trim comments. lock_ui_settings.py imports these
# constants back wherever hit-testing/hold-fill math needs them.
SET_ROWS_TOP = 40
SET_ROW_PITCH = 46
SET_CARD_X = 4
SET_CARD_W = 158
SET_CARD_H = 42
SET_TEXT_X = 12
# Hold-to-confirm sweep (SS6): x=6/w=154 leaves a 2px margin inside the
# card's own x=4..162 span on both sides, so the amber fill never paints
# outside the card it belongs to.
#
# A BAR ALONG THE CARD'S BOTTOM EDGE, not a full-height wash over the whole
# row. The wash was built first (and is still what lock_ui_tags.py's tag
# picker does) but failed on the very first render review: C_WHITE #F0F3F6
# name text on C_AMBER #F2B84B is near-zero contrast, so the row label went
# unreadable at exactly the moment the user is being asked to make a
# security decision about that row. Flipping the text to a dark ink is not
# a fix either -- the sweep's whole point is that it is PARTIAL, so any
# single text colour is unreadable on one side of the wipe boundary or the
# other while it crosses the label.
#
# A determinate bar under the desc line sidesteps the contrast problem
# entirely (amber on the card's own surface fill is high contrast), still
# reads unambiguously as "filling toward something", and leaves the row's
# name/desc/switch fully legible throughout. The card's press highlight
# (C_SURFACE_HILITE) and the "hold to enable" desc swap carry the rest of
# the feedback -- see SettingsMixin.set_settings_row_hint.
#
# y: the desc line's glyphs end at band+36 (cy band+33, 8px tall at
# scale 1) and the card's bottom edge is band+44, so band+38..band+42
# clears the text by 1px and the card edge by 2px.
#
# x=8/w=150 (a 4px inset inside the card's x=4..162 span), not the 2px the
# full-height wash used: now that the bar sits only 2-6px above the card's
# BOTTOM edge, it runs through the RADIUS_CARD=8 rounded corners rather than
# the card's straight sides. At the bar's lowest row (band+42, 2px above the
# card edge) the corner's arc has already pulled the card's own left
# boundary in to x~6.7, so a bar starting at x=6 would spill a pixel of
# amber outside the card it belongs to. 8 clears the arc at every row the
# bar occupies.
SET_HOLD_FILL_X = 8
SET_HOLD_FILL_W = SET_CARD_W - 8
SET_HOLD_FILL_H = 5
SET_HOLD_FILL_Y_OFFSET = 38


def build_settings_card(band_top):
    """Just the card for one settings-list row (SS2.2), split out from the
    name/desc text below (build_settings_row_text) so the caller can build
    ALL SIX cards in one pass before appending the shared hold-to-confirm
    fill group (SS6) -- that fill has to paint ON TOP of a row's card
    (otherwise the card's own opaque fill hides it, leaving only a sliver
    poking out past the card's square Rect corners past the card's rounded
    ones) but BEHIND that row's name/desc/switch, and a Group's paint order
    is fixed by append order among its PARENT's children at build time, not
    something a later child added into an already-positioned sub-group can
    retroactively change. `fill` is a construction-time placeholder, same
    convention as every other themed shape (see lock_ui_control.py's
    button/status_bar) -- the caller registers it in `_surface_widgets`."""
    return RoundRect(SET_CARD_X, band_top + 2, SET_CARD_W, SET_CARD_H,
                     RADIUS_CARD, fill=C_SURFACE)


def build_settings_row_text(band_top, name_text, desc_text):
    """Name + desc for one settings-list row (SS2.2), offsets measured from
    the row's own BAND top (SET_ROWS_TOP + i*SET_ROW_PITCH): name sits at
    band+15, desc at band+33. See build_settings_card's docstring for why
    this is a separate builder rather than building the card alongside
    these in one call. `color` is a construction-time placeholder like the
    card's `fill` above. Returns (name_label, desc_label)."""
    name_lbl = label.Label(terminalio.FONT, text=name_text, color=C_WHITE, scale=2)
    name_lbl.anchor_point = (0.0, 0.5)
    name_lbl.anchored_position = (SET_TEXT_X, band_top + 15)
    desc_lbl = label.Label(terminalio.FONT, text=desc_text, color=C_GREY)
    desc_lbl.anchor_point = (0.0, 0.5)
    desc_lbl.anchored_position = (SET_TEXT_X, band_top + 33)
    return name_lbl, desc_lbl


def build_settings_value_label(band_top):
    """The right-aligned value Label for a non-switch row (SS2.2) -- amber
    (accent) placeholder; the caller registers it in `_accent_widgets`."""
    lbl = label.Label(terminalio.FONT, text="", color=C_AMBER, scale=2)
    lbl.anchor_point = (1.0, 0.5)
    lbl.anchored_position = (SET_CARD_X + SET_CARD_W - 6, band_top + 15)
    return lbl


def build_settings_hold_fill(row, w):
    """The amber sweep Rect for one hold-in-progress row (SS6), at the
    width the caller has already computed via bar_fill_width -- returns
    None for w<=0 so the caller can skip appending it (an empty fill group
    IS the "not holding" state, same idiom as lock_ui_tags.py's
    tp_hold_fill_group)."""
    if w <= 0:
        return None
    band_top = SET_ROWS_TOP + row * SET_ROW_PITCH
    return Rect(SET_HOLD_FILL_X, band_top + SET_HOLD_FILL_Y_OFFSET,
               w, SET_HOLD_FILL_H, fill=C_AMBER)


# ----- setting detail page: layout + construction (SS4) -----
SD_TRACK_X = 16
SD_TRACK_Y = 176
SD_TRACK_W = 140
SD_TRACK_H = 10
SD_TRACK_R = 5
# Minimum drawn width whenever fraction > 0, so e.g. Override's lowest
# non-floor value never renders as a visually empty track.
SD_TRACK_MIN_FILL = 4
SD_BTN_W = 68
SD_BTN_H = 64
SD_BTN_Y = 214
SD_MINUS_X = 10
SD_PLUS_X = 94


def build_stepper_button(x, glyph):
    """One of the detail page's two identical-shape stepper buttons (SS4)
    -- this redesign drops the old fixed red/green fill pair for a
    neutral, IDENTICAL pair (see lock_ui_settings.py's _build_setting_detail
    for the full reasoning and the old note it references), so the only
    thing left to distinguish minus from plus is the glyph -- making one
    shared builder correct instead of two near-duplicate blocks. Returns
    (button, label)."""
    btn = RoundRect(x, SD_BTN_Y, SD_BTN_W, SD_BTN_H, RADIUS_BTN_LG,
                    fill=C_SURFACE, outline=C_WHITE, stroke=2)
    lbl = label.Label(terminalio.FONT, text=glyph, color=C_WHITE, scale=4)
    lbl.anchor_point = (0.5, 0.5)
    lbl.anchored_position = (x + SD_BTN_W // 2, SD_BTN_Y + SD_BTN_H // 2)
    return btn, lbl


def build_detail_track_bg():
    """The progress-track background (SS4) -- a lighter step of surface,
    same role C_SURFACE_HILITE already plays for the digital clock's hilite
    line (lock_ui_clock.py). Intentionally theme-fixed, same as that line --
    the caller does not register this in any theme bucket."""
    return RoundRect(SD_TRACK_X, SD_TRACK_Y, SD_TRACK_W, SD_TRACK_H, SD_TRACK_R,
                     fill=C_SURFACE_HILITE)


def build_detail_track_fill(w, color):
    """The progress-track's live fill Rect (SS4) -- `color` is read by the
    caller at rebuild time off the current accent, never baked in here."""
    return Rect(SD_TRACK_X, SD_TRACK_Y, w, SD_TRACK_H, fill=color)


def build_detail_labels(W):
    """The detail page's static text labels (SS4): the back-control label,
    name, big value, description, and the two progress-track endpoints.
    Bundled into one builder purely to keep lock_ui_settings.py's
    _build_setting_detail under the repo's line-count cap (SS9) -- each
    label's scale/anchor/position is fixed by the spec and none of the six
    are reused anywhere else, so there is no OTHER reason to share one
    function for six otherwise-unrelated labels. All start color=C_GREY,
    a construction-time placeholder like every themed shape elsewhere (see
    build_settings_row's docstring) -- the caller sorts each into its real
    theme bucket (sd_value alone belongs in `_accent_widgets`, not `_dim_
    widgets` like the rest) right after this call.
    Returns (back_lbl, name_lbl, value_lbl, desc_lbl, min_lbl, max_lbl)."""
    back_lbl = label.Label(terminalio.FONT, text="SETTINGS", color=C_GREY)
    back_lbl.anchor_point = (0.0, 0.5)
    back_lbl.anchored_position = (24, 16)

    name_lbl = label.Label(terminalio.FONT, text="", color=C_GREY, scale=2)
    name_lbl.anchor_point = (0.5, 0.5)
    name_lbl.anchored_position = (W // 2, 52)

    value_lbl = label.Label(terminalio.FONT, text="", color=C_GREY, scale=4)
    value_lbl.anchor_point = (0.5, 0.5)
    value_lbl.anchored_position = (W // 2, 112)

    desc_lbl = label.Label(terminalio.FONT, text="", color=C_GREY)
    desc_lbl.anchor_point = (0.5, 0.5)
    desc_lbl.anchored_position = (W // 2, 150)

    min_lbl = label.Label(terminalio.FONT, text="", color=C_GREY)
    min_lbl.anchor_point = (0.0, 0.5)
    min_lbl.anchored_position = (SD_TRACK_X, 198)

    max_lbl = label.Label(terminalio.FONT, text="", color=C_GREY)
    max_lbl.anchor_point = (1.0, 0.5)
    max_lbl.anchored_position = (SD_TRACK_X + SD_TRACK_W, 198)

    return back_lbl, name_lbl, value_lbl, desc_lbl, min_lbl, max_lbl


# ----- detail page: back chevron -----
def build_back_chevron(color):
    """Left chevron for the detail page's back control (SS4) -- vertices
    fixed by the spec: tip at (8,16), the two trailing corners at (16,10)
    and (16,22). `color` is a build-time placeholder like every other
    themed shape's construction-time fill/outline elsewhere in this
    codebase (e.g. lock_ui_control.py's button/status_bar) -- the caller
    registers the returned Triangle in `_dim_widgets`, and set_theme
    overwrites this the moment every widget has finished building."""
    return Triangle(16, 10, 16, 22, 8, 16, fill=color)


def in_back_region(x, y):
    """Hit region for the back chevron + "SETTINGS" label (SS4) -- generous
    on purpose, per the tag_picker_nav_at precedent (lock_ui_tags.py):
    the target is a small glyph pair, but the tappable area is the whole
    top-left corner of the screen, not just the glyphs themselves."""
    return 0 <= x <= 96 and 0 <= y <= 34
