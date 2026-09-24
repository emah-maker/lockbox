# lock_battery.py -- reads the onboard LiPo via the MAX17043 fuel gauge
# (I2C @ 0x36 on the shared touch bus). The MAX17043's ModelGauge reports a load-
# and temperature-compensated state of charge and cell voltage directly, so this
# replaces the old ADC voltage-divider + voltage-curve estimate. Because the gauge
# already compensates in hardware, we do NOT re-smooth or charge-correct the value.
# There is no charge-current sensor on the part, so charging is inferred from USB
# power (unchanged) and watts is a rough discharge-rate estimate from the trend.
import supervisor

from max17043 import MAX17043
from lock_config import (BAT_GAUGE_ADDR, BAT_CAPACITY_MAH, BAT_WATT_WINDOW_S,
                         BAT_WATT_CEILING_S, clamp)


class BatteryReading:
    __slots__ = ("available", "volts", "percent", "charging", "watts")

    def __init__(self, available, volts, percent, charging, watts):
        self.available = available
        self.volts = volts
        self.percent = percent
        self.charging = charging
        self.watts = watts


class Battery:
    def __init__(self, i2c):
        # The gauge shares the touch controller's I2C bus, so the bus object is
        # injected (two busio.I2C on the same pins would conflict). If it is
        # missing or does not ACK at 0x36, we degrade to "unavailable" -- the
        # same behavior the ADC path had when its pin was unreadable.
        self._gauge = None
        try:
            if i2c is not None:
                gauge = MAX17043(i2c, address=BAT_GAUGE_ADDR)
                if gauge.present():
                    self._gauge = gauge
        except Exception:
            self._gauge = None
        self.available = self._gauge is not None
        self._watts = 0.0
        # Anchor for the draw estimate: the time and (fractional) state of
        # charge the current measuring window started from. It is NOT the
        # previous frame -- see _update_watts.
        self._anchor_t = None
        self._anchor_pct = None

    def read(self, now):
        if not self.available:
            return BatteryReading(False, 0.0, 0, False, 0.0)
        try:
            volts = self._gauge.cell_voltage
            pct_f = self._gauge.cell_percent
        except OSError:
            # Transient bus contention/error: skip this frame, retry next read.
            return BatteryReading(False, 0.0, 0, False, 0.0)
        charging = supervisor.runtime.usb_connected
        self._update_watts(now, pct_f, volts, charging)
        pct = clamp(int(pct_f + 0.5), 0, 100)
        return BatteryReading(True, volts, pct, charging, self._watts)

    def _update_watts(self, now, pct_f, volts, charging):
        """Estimate discharge power from how far state of charge has fallen.

        Two things this deliberately does not do, both of which pinned the
        reading at a flat 0.0 W before:

        1. It measures the FRACTIONAL state of charge, not the whole percent
           shown on screen. The gauge reports 1/256% steps; rounding to an int
           first means the input only ever moves in 1% jumps, which at normal
           draw is one step every ten-odd minutes.
        2. It keeps the anchor put until the charge actually moves. Re-anchoring
           every frame measures a ~1 s window, and a second of discharge is
           smaller than the gauge's own LSB -- so every window read exactly zero
           change and the estimate never left its initial value.
        """
        if charging or self._anchor_t is None:
            # No charge-current sensor, so there is no draw to report on USB.
            # Re-anchor so the first window after unplugging doesn't measure
            # across the charge (which would come out negative anyway).
            if charging:
                self._watts = 0.0
            self._anchor_t = now
            self._anchor_pct = pct_f
            return

        dt = now - self._anchor_t
        d_pct = self._anchor_pct - pct_f
        if d_pct < 0.0:
            # Charge rose while unplugged -- the gauge relaxing after a load
            # drop, not a real gain. No rate to derive; just re-anchor.
            self._anchor_t = now
            self._anchor_pct = pct_f
            return
        if dt < BAT_WATT_WINDOW_S:
            return

        wh_per_pct = (BAT_CAPACITY_MAH / 1000.0) * volts / 100.0
        if d_pct > 0.0:
            watts = d_pct * wh_per_pct * (3600.0 / dt)
            # Seed on the first real measurement rather than easing up from
            # zero, so the page shows a true figure as soon as it has one.
            if self._watts <= 0.0:
                self._watts = watts
            else:
                self._watts += (watts - self._watts) * 0.3
            self._anchor_t = now
            self._anchor_pct = pct_f
        elif dt >= BAT_WATT_CEILING_S:
            # Held the same charge this long: draw is under what one more LSB
            # (1/256%) over this span would imply. Pull a stale high number
            # down to that bound -- never up, since absence of change is not
            # evidence of draw. The anchor deliberately stays put: the longer
            # the wait, the tighter this bound gets, and the wider (so more
            # accurate) the window is when the charge finally does move.
            ceiling = (wh_per_pct / 256.0) * (3600.0 / dt)
            if ceiling < self._watts:
                self._watts = ceiling
