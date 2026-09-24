# axs5106l.py
# Minimal CircuitPython driver for the AXS5106L capacitive touch controller
# (Waveshare ESP32-S3 Touch LCD 1.47). Uses raw busio I2C so it needs no
# external dependencies. Protocol: addr 0x63, write reg 0x01, read 14 bytes;
# byte[1] = touch count, each point is 6 bytes starting at offset 2, with
# 12-bit X/Y packed as ((hi & 0x0F) << 8) | lo.
import time
import digitalio

_ADDR = 0x63
_TOUCH_DATA_REG = 0x01
_MAX_POINTS = 2


class AXS5106L:
    def __init__(self, i2c, reset_pin=None, address=_ADDR):
        self._i2c = i2c
        self._addr = address
        self._buf = bytearray(14)
        self._reg = bytes([_TOUCH_DATA_REG])
        self._rst = None
        if reset_pin is not None:
            rst = digitalio.DigitalInOut(reset_pin)
            rst.switch_to_output(value=True)
            rst.value = False
            time.sleep(0.2)
            rst.value = True
            time.sleep(0.3)
            self._rst = rst

    def _read(self):
        # The AXS5106L does NOT accept a repeated-start combined transaction
        # (that returns errno 5 / EIO). Write the register, STOP, then read.
        while not self._i2c.try_lock():
            pass
        try:
            self._i2c.writeto(self._addr, self._reg)
            self._i2c.readfrom_into(self._addr, self._buf)
        finally:
            self._i2c.unlock()

    @property
    def touches(self):
        """Return a list of (x, y) tuples for the active touch points."""
        try:
            self._read()
        except OSError:
            return []
        count = self._buf[1]
        # Only 1 or 2 are valid. 0 = no touch; anything else is a stale/garbage
        # frame and must NOT be treated as a phantom touch.
        if count < 1 or count > _MAX_POINTS:
            return []
        points = []
        for i in range(count):
            b = 2 + i * 6
            x = ((self._buf[b] & 0x0F) << 8) | self._buf[b + 1]
            y = ((self._buf[b + 2] & 0x0F) << 8) | self._buf[b + 3]
            points.append((x, y))
        return points

    def debug_read(self):
        """Return (raw_count_byte, points) for diagnostics. raw_count is the
        byte the chip reported before validation, so 0xFF/garbage is visible."""
        try:
            self._read()
        except OSError as exc:
            return (-1, [])
        count = self._buf[1]
        points = []
        if 1 <= count <= _MAX_POINTS:
            for i in range(count):
                b = 2 + i * 6
                x = ((self._buf[b] & 0x0F) << 8) | self._buf[b + 1]
                y = ((self._buf[b + 2] & 0x0F) << 8) | self._buf[b + 3]
                points.append((x, y))
        return (count, points)
