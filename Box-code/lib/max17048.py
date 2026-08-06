# max17048.py -- minimal CircuitPython driver for the Maxim MAX17048 single-cell
# LiPo/LiIon fuel gauge (Adafruit #5580 breakout), read over a shared busio I2C
# bus. ModelGauge state-of-charge needs no sense resistor, so we only read the
# two output registers:
#   VCELL (0x02) -- cell voltage,  LSB = 78.125 uV  -> volts   = raw * 78.125e-6
#   SOC   (0x04) -- state of charge, LSB = 1/256 %   -> percent = raw / 256.0
# VERSION (0x08) is read once to confirm the part ACKs before we trust it.
# Register map + decode per the MAX17048 datasheet and Adafruit's
# Adafruit_CircuitPython_MAX1704x library; we reproduce just those two reads so
# the firmware needs no external library (same rationale as axs5106l.py).
#
# Unlike the AXS5106L touch controller (which rejects repeated-start), the
# MAX17048 uses a standard SMBus register read: write the pointer, repeated
# start, read 2 bytes MSB-first. We share the touch bus with the same
# try_lock()/unlock() discipline so the two devices cooperate.

_ADDR = 0x36
_REG_VCELL = 0x02
_REG_SOC = 0x04
_REG_VERSION = 0x08


def decode_voltage(raw):
    """VCELL register (unsigned 16-bit) -> cell voltage in volts."""
    return raw * 78.125 / 1_000_000


def decode_percent(raw):
    """SOC register (unsigned 16-bit) -> state of charge in percent (float)."""
    return raw / 256.0


class MAX17048:
    def __init__(self, i2c, address=_ADDR):
        self._i2c = i2c
        self._addr = address
        self._reg = bytearray(1)
        self._buf = bytearray(2)
        self.vcell_raw = 0      # last raw VCELL register value (for diagnostics)

    def _read_u16(self, reg):
        self._reg[0] = reg
        while not self._i2c.try_lock():
            pass
        try:
            # repeated-start combined transaction (MAX17048 register read)
            self._i2c.writeto_then_readfrom(self._addr, self._reg, self._buf)
        finally:
            self._i2c.unlock()
        return (self._buf[0] << 8) | self._buf[1]

    def present(self):
        """True if the gauge ACKs on the bus (VERSION read succeeds)."""
        try:
            self._read_u16(_REG_VERSION)
            return True
        except OSError:
            return False

    @property
    def cell_voltage(self):
        self.vcell_raw = self._read_u16(_REG_VCELL)
        return decode_voltage(self.vcell_raw)

    @property
    def cell_percent(self):
        return decode_percent(self._read_u16(_REG_SOC))
