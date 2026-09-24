# shim -- pure-Python stand-ins for the CircuitPython display stack
# (displayio, terminalio, adafruit_display_text, adafruit_display_shapes)
# plus empty stubs for everything else firmware/lib imports at module
# scope, so the REAL firmware UI code (firmware/lib/lock_ui*.py and its
# dependencies) imports and runs unmodified on a host Python.
#
# This package is not imported as `shim.xxx` by anything -- render.py and
# overflow_check.py add THIS DIRECTORY to sys.path (ahead of firmware/lib),
# so the firmware's own `import displayio` / `import terminalio` etc. find
# the modules living directly in this folder. See render.py's
# `_install_shim()` for the exact sys.path setup and ordering.
#
# See README.md in this same tests/preview/ directory for what is exact
# here (terminalio glyph metrics, RoundRect corner geometry, Label anchor
# math) versus what is a stand-in (glyph pixel shapes, no real panel
# gamma/color, no touch/hit-testing simulation).
