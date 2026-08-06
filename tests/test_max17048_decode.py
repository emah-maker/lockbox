"""Host tests for the pure logic in Box-code/lib/max17048.py.

The register-decode math (VCELL/SOC raw -> volts/percent), the MSB-first byte
assembly, the register-pointer selection, and the try_lock()/unlock() discipline
are all hardware-independent, so they run off-device against a fake I2C bus that
returns programmed register bytes. The actual bus transaction is on-device-only.

max17048.py imports no hardware modules (the bus is injected), so importing it
under CPython exercises the real production driver -- no reimplementation.

Run: python tests/test_max17048_decode.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Box-code", "lib"))

from max17048 import MAX17048, decode_voltage, decode_percent, _REG_VCELL, _REG_SOC

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


def approx(a, b, tol=1e-3):
    return abs(a - b) <= tol


class FakeI2C:
    """Minimal stand-in for busio.I2C: serves programmed 2-byte registers and
    tracks the lock/unlock calls so the sharing discipline can be asserted."""

    def __init__(self, regs=None, fail=False):
        self.regs = regs or {}
        self.fail = fail
        self.locked = False
        self.lock_calls = 0
        self.unlock_calls = 0
        self.last_reg = None

    def try_lock(self):
        self.lock_calls += 1
        self.locked = True
        return True

    def unlock(self):
        self.unlock_calls += 1
        self.locked = False

    def writeto_then_readfrom(self, addr, out, buf):
        if self.fail:
            raise OSError(5)
        self.last_reg = out[0]
        hi, lo = self.regs[out[0]]
        buf[0] = hi
        buf[1] = lo


# --- decode math against datasheet anchors ---
check("voltage: 0 raw -> 0 V", decode_voltage(0) == 0.0)
# 4.20 V full cell -> 0xD200 (53760); LSB = 78.125 uV
check("voltage: 0xD200 -> 4.20 V", approx(decode_voltage(0xD200), 4.20))
# full-scale 0xFFFF -> ~5.12 V (0-5 V range)
check("voltage: 0xFFFF -> ~5.12 V", approx(decode_voltage(0xFFFF), 5.11992, 1e-2))
check("percent: 0 raw -> 0 %", decode_percent(0) == 0.0)
# SOC LSB = 1/256 %: 100% -> 0x6400 (25600), 50% -> 12800
check("percent: 0x6400 -> 100 %", decode_percent(0x6400) == 100.0)
check("percent: 12800 -> 50 %", decode_percent(12800) == 50.0)

# --- driver reads the right register and assembles MSB-first ---
gauge = MAX17048(FakeI2C({_REG_VCELL: (0xD2, 0x00), _REG_SOC: (0x64, 0x00)}))
check("cell_voltage reads VCELL (0x02) -> 4.20 V", approx(gauge.cell_voltage, 4.20))
check("cell_percent reads SOC (0x04) -> 100 %", gauge.cell_percent == 100.0)

# byte order: 0x1234 must decode as 4660, not 0x3412
bus = FakeI2C({_REG_VCELL: (0x12, 0x34)})
g2 = MAX17048(bus)
check("MSB-first assembly (0x1234 -> 4660)", approx(g2.cell_voltage, decode_voltage(0x1234)))
check("selected the VCELL register pointer", bus.last_reg == _REG_VCELL)

# --- bus-sharing discipline: every read locks then unlocks, leaving bus free ---
check("read locks and unlocks symmetrically",
      bus.lock_calls == bus.unlock_calls and bus.lock_calls >= 1)
check("bus left unlocked after read", bus.locked is False)

# --- present(): ACK -> True, bus error -> False, and still unlocks on failure ---
ok_bus = FakeI2C({0x08: (0x00, 0x12)})
check("present() True when gauge ACKs", MAX17048(ok_bus).present() is True)
bad_bus = FakeI2C(fail=True)
check("present() False when bus errors", MAX17048(bad_bus).present() is False)
check("bus unlocked even after a failed read",
      bad_bus.locked is False and bad_bus.unlock_calls == bad_bus.lock_calls)

print("\n{} passed, {} failed".format(_passed, _failed))
sys.exit(1 if _failed else 0)
