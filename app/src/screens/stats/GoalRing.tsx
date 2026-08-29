// GoalRing.tsx -- single-goal progress ring for the Stats screen's Goals
// period view (GoalsProgressView.tsx). Built the same way the multi-segment
// topic ring is drawn (react-native-svg Circle + animated strokeDashoffset,
// no reanimated/gesture-handler) but deliberately its own file rather than a
// prop variant of that ring, since a single-goal ring has a different shape
// entirely (one fill arc + a track, over-target handling, no per-topic
// segment list).
//
// Over-target handling mirrors GoalsSection.tsx's own linear-bar
// barGeometry: ratio is deliberately unclamped upstream (goalProgress.ts's
// GoalProgressResult.ratio), so a >100% goal still has to read as "past the
// line", not silently cap at a full ring indistinguishable from exactly
// 100%. Here that's done by never drawing more than one full lap of fill --
// past 100% the ring is entirely filled and a small notch marks where the
// target line actually sat, exactly like the linear bar's target marker.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useReducedMotion } from '../../ui/useReducedMotion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function GoalRing({
  ratio,
  color,
  trackColor,
  size = 64,
  strokeWidth = 7,
  children,
}: {
  /** focusS / targetS, unclamped (see header comment) -- ratio > 1 still
   * renders a full ring with a notch, not an overflowed arc. */
  ratio: number;
  color: string;
  trackColor: string;
  size?: number;
  strokeWidth?: number;
  /** Centered content (percent label) -- laid out absolutely over the SVG. */
  children?: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const overTarget = Number.isFinite(ratio) && ratio > 1;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(clamped);
      return;
    }
    Animated.timing(progress, {
      toValue: clamped,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // strokeDashoffset isn't a transform/opacity prop
    }).start();
  }, [clamped, reducedMotion, progress]);

  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  // Target notch: a 2px gap punched at the 100% mark, same "gap in the fill,
  // not another colored segment" trick GoalsSection.tsx's targetMark uses --
  // only meaningful once the ring is fully filled (over target), so it's
  // otherwise omitted rather than drawn under a partial arc where it'd read
  // as a stray tick mark.
  const notchLen = overTarget ? Math.max(1, circumference * 0.01) : 0;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={cx}
          cy={cy}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          rotation={-90}
          originX={cx}
          originY={cy}
          strokeDasharray={overTarget ? `${circumference - notchLen} ${notchLen}` : `${circumference} ${circumference}`}
          strokeDashoffset={overTarget ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}
        />
      </Svg>
      {children}
    </View>
  );
}
