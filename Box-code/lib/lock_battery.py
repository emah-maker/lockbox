# lock_battery.py -- reads the onboard LiPo via the Adafruit MAX17048 fuel gauge
# (I2C @ 0x36 on the shared touch bus). The MAX17048's ModelGauge reports a load-
# and temperature-compensated state of charge and cell voltage directly, so this
# replaces the old ADC voltage-divider + voltage-curve estimate. Because the gauge
# already compensates in hardware, we do NOT re-smooth or charge-correct the value.
# There is no charge-current sensor on the part, so charging is inferred from USB
# power (unchanged) and watts is a rough discharge-rate estimate from the trend.
import supervisor

from max17048 import MAX17048
from lock_config import BAT_GAUGE_ADDR, BAT_CAPACITY_MAH


class BatteryReading:
    __slots__ = ("available", "volts", "percent", "charging", "watts", "raw")

    def __init__(self, available, volts, percent, charging, watts, raw):
        self.available = available
        self.volts = volts
        self.percent = percent
        self.charging = charging
        self.watts = watts
        self.raw = raw


class Battery:
    def __init__(self, i2c):
        # The gauge shares the touch controller's I2C bus, so the bus object is
        # injected (two busio.I2C on the same pins would conflict). If it is
        # missing or does not ACK at 0x36, we degrade to "unavailable" -- the
        # same behavior the ADC path had when its pin was unreadable.
        self._gauge = None
        try:
            if i2c is not None:
                gauge = MAX17048(i2c, address=BAT_GAUGE_ADDR)
                if gauge.present():
                    self._gauge = gauge
        except Exception:
            self._gauge = None
        self.available = self._gauge is not None
        self._watts = 0.0
        self._last_t = None
        self._last_pct = None

    def read(self, now):
        if not self.available:
            return BatteryReading(False, 0.0, 0, False, 0.0, 0)
        try:
            volts = self._gauge.cell_voltage
            pct = max(0, min(100, int(self._gauge.cell_percent + 0.5)))
        except OSError:
            # Transient bus contention/error: skip this frame, retry next read.
            return BatteryReading(False, 0.0, 0, False, 0.0, 0)
        raw = self._gauge.vcell_raw
        charging = supervisor.runtime.usb_connected
        # watts: rough discharge-rate estimate from the (now accurate) % trend.
        if self._last_t is None or self._last_pct is None:
            self._last_t = now
            self._last_pct = pct
        else:
            dt = now - self._last_t
            if dt >= 1.0:
                d_pct = self._last_pct - pct
                if charging:
                    self._watts += (0.0 - self._watts) * 0.3
                elif d_pct > 0:
                    wh_per_pct = (BAT_CAPACITY_MAH / 1000.0) * volts / 100.0
                    watts = d_pct * wh_per_pct * (3600.0 / dt)
                    self._watts += (watts - self._watts) * 0.3
                self._last_t = now
                self._last_pct = pct
        return BatteryReading(True, volts, pct, charging, self._watts, raw)
