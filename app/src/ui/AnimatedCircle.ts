// AnimatedCircle.ts -- react-native-svg's Circle, wrapped once for Animated.
//
// Animated.createAnimatedComponent() is not free to call repeatedly: each call
// builds a new component class, so three modules each making their own meant
// three distinct component types for the same element, and any future change
// to how this app animates an arc (a nativeDriver decision, a forwardRef, a
// prop shim) had three places to land in. screens/home/ProgressRing.tsx,
// screens/stats/GoalRing.tsx and screens/stats/InteractiveTopicDonut.tsx each
// declared it privately, identically, on one line -- small enough that a
// block-based clone scan steps right over it, which is exactly why it stayed
// triplicated while larger duplication got cleaned up around it.
//
// Only the wrapper is shared. The three rings draw genuinely different things
// -- a swept arc with a gap and topic segments, a notched over-target ring, an
// interactive donut -- so their dasharray/dashoffset/rotation math stays with
// each of them.
import { Animated } from 'react-native';
import { Circle } from 'react-native-svg';

export const AnimatedCircle = Animated.createAnimatedComponent(Circle);
