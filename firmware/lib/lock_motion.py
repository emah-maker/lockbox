# lock_motion.py -- a tiny critically-damped spring, stepped once per run-loop
# frame (code.py calls LockController.update() every iteration, ~50Hz while the
# screen is on -- see its `time.sleep(0.02 ...)` cadence). Mirrors the companion
# app's press-feedback spring (app/src/ui/AnimatedPressable.tsx: stiffness 300 /
# damping 30 / mass 1) translated into pixel space instead of a scale factor,
# since displayio has no fractional Group/TileGrid scale.
#
# A spring (unlike a fixed-duration timing) always continues from its current
# value and velocity, so a fast re-press or a repeated event mid-animation
# redirects smoothly instead of snapping or restarting -- the same
# interruptibility AnimatedPressable's own docstring gives as the reason to use
# a spring instead of Animated.timing.


_INF = float("inf")
_NEG_INF = float("-inf")

# Largest dt this semi-implicit Euler integration stays numerically stable at
# for SPRING_STIFFNESS=300/SPRING_DAMPING=30/SPRING_MASS=1 (lock_config.py).
# Verified by finding this update's fixed-point iteration matrix eigenvalues:
# at dt=0.02 (the run loop's normal ~50Hz cadence) they're ~0.74/0.54 --
# stable, error damps out, matching the smooth press-dip everyone has seen
# work. At dt=0.1 -- the ceiling LockController.update() clamps to after a GC
# pause, a BLE hiccup, or any delayed frame -- they're ~+-4.45: error
# AMPLIFIES by that factor every single step, so a widget's offset blows up
# exponentially within a handful of frames. It doesn't have to actually reach
# inf/nan (see step()'s guard below) to be a visible bug -- for the frames in
# between, the value is a huge but still-finite number of pixels, which is
# exactly what sent the status bar/button/override-counter text flying across
# the screen. Splitting any larger dt into several of these safe-sized steps
# keeps identical behavior for normal frame timing and removes the
# instability instead of only cleaning up after it.
_MAX_STABLE_DT_S = 0.02


class Spring:
    def __init__(self, stiffness, damping, mass=1.0):
        self.stiffness = stiffness
        self.damping = damping
        self.mass = mass
        self.value = 0.0
        self.target = 0.0
        self.velocity = 0.0

    def displace(self, value, target=0.0):
        """Jump to `value` with zero velocity, then animate toward `target`."""
        self.value = value
        self.velocity = 0.0
        self.target = target

    def to(self, target):
        self.target = target

    def step(self, dt):
        # Semi-implicit (symplectic) Euler integration of a damped harmonic
        # oscillator -- a handful of float ops, no allocation. Sub-stepped at
        # _MAX_STABLE_DT_S so a larger dt can't destabilize the integration
        # (see that constant's comment) -- ordinary frames (dt ~0.02s) take
        # exactly one iteration here, same cost as before.
        remaining = dt
        while remaining > 0.0:
            h = remaining if remaining <= _MAX_STABLE_DT_S else _MAX_STABLE_DT_S
            accel = (self.stiffness * (self.target - self.value)
                     - self.damping * self.velocity) / self.mass
            self.velocity += accel * h
            self.value += self.velocity * h
            remaining -= h
        # A value/velocity that has gone non-finite used to surface several
        # frames later at the call site instead of here -- LockUI.step_motion
        # does int(round(offset)), and int() can't convert nan/inf, so the
        # exception took down the whole run loop over a purely cosmetic
        # press-feedback animation (observed on device). This shouldn't
        # diverge given the small, clamped dt it's always fed, but a NaN/inf
        # check costs nothing on the every-other-frame path where nothing is
        # wrong, and makes this animation crash-proof regardless of the exact
        # trigger. `x != x` is the classic no-import NaN test (true only for
        # NaN); the `in` check catches +-inf, which does equal itself.
        if (self.value != self.value or self.velocity != self.velocity
                or self.value in (_INF, _NEG_INF) or self.velocity in (_INF, _NEG_INF)):
            self.value = self.target
            self.velocity = 0.0
        return self.value

    @property
    def settled(self):
        return abs(self.target - self.value) < 0.05 and abs(self.velocity) < 0.05
