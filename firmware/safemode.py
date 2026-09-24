# safemode.py -- auto-recover from a brownout ("power dipped") safe mode.
# On battery the supply can sag during boot inrush and trip the ESP32-S3
# brownout detector, dropping CircuitPython into safe mode. If that's the
# reason, reset to retry running code.py -- the dip is usually transient. A
# small NVM counter caps retries so a truly dead battery doesn't reset-loop
# forever; code.py clears the counter on a successful normal boot.
import time
import microcontroller
import supervisor

reason = supervisor.runtime.safe_mode_reason

if reason == supervisor.SafeModeReason.BROWNOUT:
    try:
        n = microcontroller.nvm[0]
    except Exception:
        n = 0
    if n < 5:
        try:
            microcontroller.nvm[0] = n + 1
        except Exception:
            pass
        time.sleep(0.5)
        microcontroller.reset()
