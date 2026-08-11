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
        # oscillator -- a handful of float ops, no allocation, stable for the
        # small, clamped dt values LockController.update() feeds it.
        accel = (self.stiffness * (self.target - self.value)
                 - self.damping * self.velocity) / self.mass
        self.velocity += accel * dt
        self.value += self.velocity * dt
        return self.value

    @property
    def settled(self):
        return abs(self.target - self.value) < 0.05 and abs(self.velocity) < 0.05
