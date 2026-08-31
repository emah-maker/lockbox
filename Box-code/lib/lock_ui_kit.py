# lock_ui_kit.py -- the box's shared design language, as constructors.
#
# The settings redesign established a visual language (see lock_ui_settings.py
# and lock_ui_widgets.py): a centred dim title at a FIXED y, cards at a fixed
# inset and radius, real chevron affordances instead of ASCII arrow captions,
# and one press-feedback treatment. Every other screen predated it and each
# had invented its own version of the same decisions -- titles at y=26 on the
# clock/battery/override screens but y=20 on settings, and three separately
# hand-rolled navigation captions ("<- clock   battery ->",
# "<- timer    settings ->", "swipe right = timer" + "up/down = style").
#
# This module is where those decisions live ONCE, so a screen cannot drift
# from the rest by being edited on its own.
#
# Module-level functions only -- deliberately NOT a mixin, for exactly the
# reason lock_ui_widgets.py's header gives: tests/test_firmware_loads.py
# asserts no two of LockUI's mixins define the same name, and a mixin is the
# one way to break that by accident. Nothing here touches `self`. Same
# precedent as lock_ui_common.py.
#
# CONSTRUCTORS, NOT REGISTRARS. Every function returns bare widgets and the
# CALLER appends them and registers them in the right theme registry
# (_surface_widgets / _fg_widgets / _dim_widgets / _accent_widgets). Colors
# passed at construction are placeholders, the same convention
# lock_ui_control.py's button/status_bar already use -- set_theme overwrites
# them before anything is visible. A widget the caller forgets to register
# silently ignores the user's theme, so each docstring below names the
# registry that widget belongs in.

import terminalio
from adafruit_display_text import label
from adafruit_display_shapes.circle import Circle
from adafruit_display_shapes.roundrect import RoundRect
from adafruit_display_shapes.triangle import Triangle
from lock_config import C_SURFACE, C_SURFACE_HILITE, C_GREY, RADIUS_CARD

# ----- vertical rhythm -----
# One title y for the whole box. Was 20 on settings and 26 on
# clock/battery/override, which is invisible on any one screen and obvious
# the moment you swipe between two of them.
TITLE_Y = 20
# The row the corner indicators (BLE dot / battery %) sit on, where a screen
# has them -- same line as the title so the header reads as one band. See
# ThemeMixin._add_corner_indicators, which takes this as its `y`.
HEADER_Y = TITLE_Y
# Footer navigation row. Moved up from 306 to make room for the view-dot row
# below it (VIEW_DOTS_Y) -- the dots are now the position indicator and want
# the very bottom edge, where a page indicator belongs.
NAV_Y = 294

# ----- position indicators (dots) -----
# ONE RULE, and it is the whole reason these are two separate functions: a
# dot row's ORIENTATION matches the SWIPE AXIS it reports on.
#
#   horizontal row along the bottom  <-> the horizontal swipe between the
#                                        top-level views (VIEWS in
#                                        lock_controller_const.py)
#   vertical column down the side    <-> the vertical swipe between the clock
#                                        face styles (LockUI.cycle_clock_style)
#
# So a user who has learned one has learned the other, and a screen with both
# says at a glance which axis does what -- which is the thing a box with no
# labels and two swipe axes otherwise has to be told in a caption. The clock
# screen's style dots used to sit along the BOTTOM, on the same axis as the
# view dots now do, which stated the opposite of the gesture that drives them.
DOT_R = 3
DOT_PITCH = 12          # centre-to-centre; 6px dot + 6px gap
VIEW_DOTS_Y = 312       # the very bottom, clear of NAV_Y's glyphs above it
# Right edge: a 3px dot at x=166 spans 163..169 inside the 172px panel, and
# clears the cards/clock faces, which all stop at CARD_X + CARD_W = 162.
STYLE_DOTS_X = 166


def _dot_span(count):
    """Total pixels a `count`-dot row occupies: each dot is 2*DOT_R wide and
    consecutive centres are DOT_PITCH apart."""
    return (count - 1) * DOT_PITCH + 2 * DOT_R


def build_dots_h(w, count, y=VIEW_DOTS_Y):
    """A horizontal, centred dot row -- the top-level VIEW indicator. Returns
    a list of `count` Circles, in view order left-to-right.

    Register in NO theme registry: which dot is active is STATE, so set_theme
    would fight it. The caller repaints all of them on every view change from
    the live self._accent_color / self._dim_color, exactly as the settings
    switch's track/knob are handled (see _apply_switch's comment).

    Width check: 5 views come to 54px, centred on a 172px screen -- x 59..113,
    nowhere near the edges, so this scales to a 6th view without rework."""
    first_cx = (w - _dot_span(count)) // 2 + DOT_R
    return [Circle(first_cx + i * DOT_PITCH, y, DOT_R, fill=C_GREY)
            for i in range(count)]


def build_dots_v(count, cy, x=STYLE_DOTS_X):
    """A vertical dot column at the right edge, centred on `cy` -- the clock
    STYLE indicator. Returns a list of `count` Circles, top-to-bottom in
    style order. Same no-registry / repaint-on-change contract as
    build_dots_h.

    Vertical extent for the 4 clock styles: 42px, so centring on the clock
    face's own centre keeps it inside the face's vertical band rather than
    floating against the screen edge on its own."""
    first_cy = cy - _dot_span(count) // 2 + DOT_R
    return [Circle(x, first_cy + i * DOT_PITCH, DOT_R, fill=C_GREY)
            for i in range(count)]


def paint_dots(dots, active_idx, active_color, idle_color):
    """Repaint a dot row so `active_idx` reads as current. Pure and shared by
    both orientations, so the two indicators can never drift on what "active"
    looks like. Cheap enough to call on every view/style change: one palette
    write per dot, no reallocation (see the colour-transition engine's
    docstring in lock_ui.py on why a .fill write is not a redraw).

    Deliberately NOT animated. These change only when the user has just
    completed a deliberate swipe, and they are the feedback CONFIRMING that
    swipe landed -- easing them would report the new position later than the
    screen behind them already has."""
    for i, dot in enumerate(dots):
        dot.fill = active_color if i == active_idx else idle_color

# ----- card geometry -----
# The settings list's card, promoted to the shared language: x=4/w=158 on a
# 172px screen is a 4px outer margin with an 8px inner text pad landing text
# on x=12. Any screen wanting a raised surface should use these rather than
# a fresh inset, so cards line up vertically when swiping between screens.
CARD_X = 4
CARD_W = 158
CARD_TEXT_X = 12          # CARD_X + 8px pad -- where a card's text starts
CARD_VALUE_RIGHT_X = 156  # CARD_X + CARD_W - 6px pad -- where a value ends


def build_screen_title(w, text, y=TITLE_Y):
    """A screen's title: scale 2, centred, dim. Register in `_dim_widgets`.

    Dim rather than fg on purpose -- the title names the screen you are
    already looking at, so it is the least important text on it. Everything
    the user came to read (a value, a countdown, a state) is fg or accent,
    and letting the title compete with that is how a small screen stops
    having a hierarchy at all. Budget: 14 glyphs at scale 2 (168px) before
    it touches the 172px edge; 8-10 is the comfortable range."""
    lbl = label.Label(terminalio.FONT, text=text, color=C_GREY, scale=2)
    lbl.anchor_point = (0.5, 0.5)
    lbl.anchored_position = (w // 2, y)
    return lbl


def build_card(y, h, x=CARD_X, w=CARD_W):
    """A raised surface at the shared inset/radius. Register in
    `_surface_widgets`.

    `fill` is a construction-time placeholder (see this module's header)."""
    return RoundRect(x, y, w, h, RADIUS_CARD, fill=C_SURFACE)


def build_track_bg(x, y, w, h):
    """The unfilled part of a progress/value track -- a pill of
    C_SURFACE_HILITE, with the filled part drawn over it by the caller as a
    rebuilt Rect (see lock_ui_widgets.bar_fill_width for the width math, and
    copy the `_tp_hold_last_key` rebuild-only-on-change idiom).

    INTENTIONALLY THEME-FIXED -- do NOT register this. C_SURFACE_HILITE is
    defined as a lighter step of the surface color and that is exactly the
    role it plays here: a groove that has to stay distinguishable from both
    the card behind it and the accent filling it. Routing it through
    `_surface_widgets` would collapse it into the card; through
    `_accent_widgets` it would become invisible against its own fill."""
    return RoundRect(x, y, w, h, h // 2, fill=C_SURFACE_HILITE)


# ----- navigation affordance -----
# Replaces the ASCII arrow captions. A real Triangle chevron plus a scale-1
# label reads as a direction rather than as punctuation, and it is the same
# glyph the settings detail page's back control already uses -- so "there is
# a screen that way" looks the same everywhere on the box.
#
# These are AFFORDANCES, NOT BUTTONS: nothing here is hit-tested, exactly as
# the captions they replace were not. The gesture is still the horizontal
# swipe that every screen already shares (LockController._handle_release).
# Making them tappable is a real further improvement, but it means new hit
# regions on six screens that must not collide with the control view's
# status bar / LOCK button / H-M swipe zones, so it is deliberately not
# bundled in with a visual change.
_CHEV_W = 6      # chevron width in px
_CHEV_H = 10     # chevron height in px
_CHEV_INSET = 8  # from the screen edge to the chevron's outer point
_CHEV_GAP = 6    # chevron to its label


def build_nav_left(text, y=NAV_Y):
    """A "previous screen is this way" chevron + label, left-aligned.
    Returns (chevron, label); register BOTH in `_dim_widgets` (the chevron
    tracks 'fill', the label 'color').

    Width: the label starts at x=20, so `text` has (w - 20 - half the
    screen) to play with -- keep it to 8 glyphs (48px) so it cannot meet the
    right-hand label coming the other way."""
    tip_x = _CHEV_INSET
    back_x = _CHEV_INSET + _CHEV_W
    chev = Triangle(back_x, y - _CHEV_H // 2, back_x, y + _CHEV_H // 2,
                    tip_x, y, fill=C_GREY)
    lbl = label.Label(terminalio.FONT, text=text, color=C_GREY)
    lbl.anchor_point = (0.0, 0.5)
    lbl.anchored_position = (back_x + _CHEV_GAP, y)
    return chev, lbl


def build_nav_right(w, text, y=NAV_Y):
    """A "next screen is this way" label + chevron, right-aligned -- the
    mirror of build_nav_left. Returns (label, chevron); register BOTH in
    `_dim_widgets`.

    Keep `text` to 8 glyphs for the same reason build_nav_left's docstring
    gives: at scale 1 two 8-glyph labels plus both chevrons come to 124px on
    a 172px screen, which still leaves a readable gap in the middle."""
    tip_x = w - _CHEV_INSET
    back_x = w - _CHEV_INSET - _CHEV_W
    chev = Triangle(back_x, y - _CHEV_H // 2, back_x, y + _CHEV_H // 2,
                    tip_x, y, fill=C_GREY)
    lbl = label.Label(terminalio.FONT, text=text, color=C_GREY)
    lbl.anchor_point = (1.0, 0.5)
    lbl.anchored_position = (back_x - _CHEV_GAP, y)
    return lbl, chev


def build_hint(w, text, y):
    """A centred scale-1 dim caption, for the handful of hints that are a
    real instruction rather than a direction (e.g. the tag picker's "swipe
    up = cancel", which has no screen on the other side of it to name).
    Register in `_dim_widgets`.

    Budget: 28 glyphs (168px). Prefer a chevron pair above, or an on-screen
    control, over adding one of these -- a caption explaining a gesture is
    what the settings redesign removed, not something to spread."""
    lbl = label.Label(terminalio.FONT, text=text, color=C_GREY)
    lbl.anchor_point = (0.5, 0.5)
    lbl.anchored_position = (w // 2, y)
    return lbl


# ----- row text inside a card -----
def build_card_row_text(band_top, name, desc, name_dy=15, desc_dy=33):
    """The two-line "name over description" pair the settings list rows use,
    generalised so any card can carry it. Returns (name_label, desc_label);
    register the name in `_fg_widgets` and the desc in `_dim_widgets`.

    Budgets on a CARD_W card, measured: the name is scale 2 from
    CARD_TEXT_X, so 12 glyphs (144px) with nothing to its right, or 8 (100px)
    when a switch occupies the x=120..156 column. The desc is scale 1 from
    the same x: 24 glyphs (144px), or 17 (102px) alongside a switch."""
    nlbl = label.Label(terminalio.FONT, text=name, color=C_GREY, scale=2)
    nlbl.anchor_point = (0.0, 0.5)
    nlbl.anchored_position = (CARD_TEXT_X, band_top + name_dy)
    dlbl = label.Label(terminalio.FONT, text=desc, color=C_GREY)
    dlbl.anchor_point = (0.0, 0.5)
    dlbl.anchored_position = (CARD_TEXT_X, band_top + desc_dy)
    return nlbl, dlbl


def build_card_value(band_top, dy=15):
    """The right-aligned accent value a card row shows (empty at build time,
    set via `.text` later -- the build-once-then-mutate idiom every screen
    here uses). Register in `_accent_widgets`.

    Budget: 4 glyphs at scale 2 (48px, x 108..156) before it can meet an
    8-glyph name coming the other way."""
    lbl = label.Label(terminalio.FONT, text="", color=C_GREY, scale=2)
    lbl.anchor_point = (1.0, 0.5)
    lbl.anchored_position = (CARD_VALUE_RIGHT_X, band_top + dy)
    return lbl
