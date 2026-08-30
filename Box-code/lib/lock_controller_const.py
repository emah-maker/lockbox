# lock_controller_const.py -- the handful of module constants the controller
# and its mixins share.
#
# Their own module because lock_controller.py imports the mixins, so a mixin
# importing back from it would be a cycle. lock_controller.py re-exports them,
# so `from lock_controller import VIEWS` still reads the same as it always
# did -- which is how the tests in tests/ reach them.

COMPLETED = "completed"

OVERRIDDEN = "overridden"

# ordered top-level views; horizontal swipe moves between them
VIEWS = ("clock", "control", "battery", "settings")

# Reachable while state == "running" (see _handle_release's horizontal-swipe
# branch) -- control/settings are blocked while actually locked, but battery
# should still be checkable without waiting for the countdown to finish.
LOCKED_VIEWS = ("clock", "battery")
