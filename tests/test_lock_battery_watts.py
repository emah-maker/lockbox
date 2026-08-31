"""Host tests for the discharge-power estimate in Box-code/lib/lock_battery.py.

WHY THIS EXISTS. The battery page's "Power / estimated draw" row read a flat
0.0W on hardware, permanently, in every state. Two bugs stacked:

  1. The delta was taken from the ROUNDED whole percent (`int(pct + 0.5)`),
     throwing away the 1/256% resolution the MAX17043's SOC register actually
     reports. So the input to a derivative only moved in 1% jumps -- one jump
     every ten-odd minutes at normal draw.
  2. The anchor it measured from was reset on EVERY read, and the controller
     reads once a second. So each window was ~1s wide, one second of discharge
     is far below the gauge's own LSB, every window saw zero change, and the
     `elif d_pct > 0` branch that assigns the estimate was never once entered.

Either bug alone pins the reading at its initial 0.0. Neither shows up as an
error: the page renders, the number formats, the voltage beside it is correct.

The battery module imports only `supervisor` (for usb_connected) and the pure
max17043 driver, and takes its I2C bus by injection, so the real production
class runs here against a fake gauge with a scripted discharge.

Run: python tests/test_lock_battery_watts.py
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "Box-code", "lib"))

_sup = types.ModuleType("supervisor")
_sup.runtime = types.SimpleNamespace(usb_connected=False)
sys.modules.setdefault("supervisor", _sup)
supervisor = sys.modules["supervisor"]

from lock_battery import Battery  # noqa: E402 -- after the stub
from lock_config import (BAT_CAPACITY_MAH, BAT_WATT_WINDOW_S,  # noqa: E402
                         BAT_WATT_CEILING_S)

_passed = 0
_failed = 0


def check(name, cond):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS", name)
    else:
        _failed += 1
        print("FAIL", name)


class FakeGauge:
    """Stands in for the MAX17043 driver: whatever charge/voltage we set."""

    def __init__(self, percent=80.0, volts=3.80):
        self.cell_percent = percent
        self.cell_volts = volts

    @property
    def cell_voltage(self):
        return self.cell_volts


def make_battery(gauge):
    """A Battery wired to `gauge`, skipping the I2C probe in __init__."""
    bat = Battery(None)
    bat._gauge = gauge
    bat.available = True
    return bat


def watts_for(pct_per_hour, volts=3.80):
    """The draw a given %/hour discharge rate corresponds to."""
    return (BAT_CAPACITY_MAH / 1000.0) * volts / 100.0 * pct_per_hour


def run_discharge(bat, gauge, pct_per_hour, seconds, step=1.0, t0=1000.0):
    """Read once per `step` seconds while draining at a steady rate."""
    start_pct = gauge.cell_percent
    t = t0
    end = t0 + seconds
    r = None
    while t <= end:
        gauge.cell_percent = start_pct - pct_per_hour * (t - t0) / 3600.0
        r = bat.read(t)
        t += step
    return r


def approx(a, b, rel=0.05):
    return abs(a - b) <= abs(b) * rel


# ---- the regression itself: a real draw must produce a non-zero estimate ----
# 2 W on a 5000 mAh / 3.8 V pack is ~10.5 %/h, a plausible awake-with-BLE load.
target_w = 2.0
rate = target_w / ((BAT_CAPACITY_MAH / 1000.0) * 3.80 / 100.0)

g = FakeGauge()
b = make_battery(g)
r = run_discharge(b, g, rate, 120.0)
check("steady 2W discharge reports non-zero draw", r.watts > 0.0)
check("steady 2W discharge reports ~2W", approx(r.watts, target_w))

# Read once a second, exactly as LockController._refresh_battery does -- the
# cadence the old code measured across and always saw zero change over.
g = FakeGauge()
b = make_battery(g)
r = run_discharge(b, g, rate, 120.0, step=1.0)
check("1 Hz read cadence still resolves the draw", approx(r.watts, target_w))

# Sub-1% total movement: the whole test above stays inside one displayed
# percent, which is what defeated the rounded-int delta.
check("estimate works below one whole percent of movement",
      80.0 - g.cell_percent < 1.0)

# ---- the estimate tracks the actual rate, it isn't a constant ----
g = FakeGauge()
b = make_battery(g)
r = run_discharge(b, g, rate / 2.0, 240.0)
check("half the draw reads about half the watts", approx(r.watts, target_w / 2.0, rel=0.15))

# ---- window: no figure is invented before there is enough charge movement ----
g = FakeGauge()
b = make_battery(g)
r = run_discharge(b, g, rate, BAT_WATT_WINDOW_S - 2.0)
check("no estimate before the measuring window closes", r.watts == 0.0)

# ---- charging: no current sensor, so no draw figure ----
g = FakeGauge()
b = make_battery(g)
run_discharge(b, g, rate, 120.0)
supervisor.runtime.usb_connected = True
r = b.read(2000.0)
check("charging zeroes the draw", r.watts == 0.0 and r.charging)
supervisor.runtime.usb_connected = False

# ---- a stale high reading decays once the load drops away ----
g = FakeGauge()
b = make_battery(g)
run_discharge(b, g, rate, 120.0)
hot = b._watts
idle = b.read(1120.0 + BAT_WATT_CEILING_S + 5.0)   # charge frozen, time passes
check("idle decays a stale estimate downward", idle.watts < hot)
check("idle estimate never goes negative", idle.watts >= 0.0)

# ---- gauge relaxation (charge ticks UP unplugged) must not read as draw ----
g = FakeGauge()
b = make_battery(g)
b.read(1000.0)
g.cell_percent = 80.5
r = b.read(1000.0 + BAT_WATT_WINDOW_S + 1.0)
check("a rising charge reading yields no draw", r.watts == 0.0)

# ---- the displayed whole percent is still an int, unchanged ----
g = FakeGauge(percent=79.6)
b = make_battery(g)
r = b.read(1000.0)
check("percent still rounds to a whole number for the UI", r.percent == 80)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
