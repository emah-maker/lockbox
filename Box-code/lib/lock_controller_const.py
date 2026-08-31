# lock_controller_const.py -- the handful of module constants the controller
# and its mixins share.
#
# Their own module because lock_controller.py imports the mixins, so a mixin
# importing back from it would be a cycle. lock_controller.py re-exports them,
# so `from lock_controller import VIEWS` still reads the same as it always
# did -- which is how the tests in tests/ reach them.

COMPLETED = "completed"

OVERRIDDEN = "overridden"

# ordered top-level views; horizontal swipe moves between them. "settings2"
# added after "settings" (phase 2's second on-box settings page) -- so the
# existing swipe reaches it with no new gesture, and it also becomes the
# view-position dot row's 5th/last dot (lock_ui_kit.build_dots_h sizes
# itself from len(VIEWS), nothing else to update there).
VIEWS = ("clock", "control", "battery", "settings", "settings2")

# Reachable while state == "running" (see _handle_release's horizontal-swipe
# branch) -- control/settings are blocked while actually locked, but battery
# should still be checkable without waiting for the countdown to finish.
LOCKED_VIEWS = ("clock", "battery")
