# max17043.py -- minimal CircuitPython driver for the Maxim MAX17043 single-cell
# LiPo/LiIon fuel gauge (HiLetgo-style breakout), read over a shared busio I2C
# bus. ModelGauge state-of-charge needs no sense resistor, so we only read the
# two output registers:
#   VCELL (0x02) -- cell voltage,  LSB = 78.125 uV  -> volts   = raw * 78.125e-6
#   SOC   (0x04) -- state of charge, LSB = 1/256 %   -> percent = raw / 256.0
# VERSION (0x08) is read once to confirm the part ACKs before we trust it.
# Register map + decode per the MAX17043 datasheet: VCELL is a 12-bit ADC value
# left-justified into the top 12 bits of the 16-bit register (bottom 4 bits
# read 0), at 1.25 mV/step -- mathematically identical to reading the full
# 16-bit register at 78.125 uV/LSB (1.25 mV / 16), so the decode below is the
# same formula the sibling MAX17048 driver used; SOC and VERSION share the
# same register addresses and formats across the whole MAX1704x family. We
# reproduce just those two reads so the firmware needs no external library
# (same rationale as axs5106l.py).
#
# Unlike the AXS5106L touch controller (which rejects repeated-start), the
# MAX17043 uses a standard SMBus register read: write the pointer, repeated
# start, read 2 bytes MSB-first. We share the touch bus with the same
# try_lock()/unlock() discipline so the two devices cooperate.
#
# Hardware note (not firmware-relevant, but easy to get wrong when wiring):
# leave QST floating -- grounding it holds the gauge in reset -- and leave
# ALRT unconnected unless interrupt-driven low-battery handling is added.

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


class MAX17043:
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
            # repeated-start combined transaction (MAX17043 register read)
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
