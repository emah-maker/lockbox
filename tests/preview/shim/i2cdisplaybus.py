# i2cdisplaybus.py -- empty host stub for CircuitPython's i2cdisplaybus module.
#
# Not exercised by tests/preview/render.py's import path (LockUI and its
# lock_settings/lock_config/lock_motion dependencies never touch this
# module's attributes at import time) -- present only so any firmware
# module that imports it at module scope (e.g. lock_controller.py,
# lock_servo.py) can still be imported on the host too, same rationale as
# tests/test_firmware_loads.py's stub list.
