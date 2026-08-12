// TopicDonut.tsx -- animated ring chart for the Stats screen's topic
// breakdown (an alternative to a linear bar per topic). Built on
// react-native-svg + core RN Animated (no reanimated/gesture-handler, same
// dependency-light convention as AnimatedPressable/AnimatedFill elsewhere in
// this app) -- react-native-svg is this screen's one new dependency, added
// specifically for this chart.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useReducedMotion } from './useReducedMotion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface DonutSegment {
  key: string;
  focusS: number;
  color: string;
}

/** Each arc's stroke length is fixed (the true final proportion) -- only
 * strokeDashoffset animates, from "pushed back by its own length" (so the
 * segment starts fully hidden, tucked into the gap just before its start
 * angle) to its true resting offset. That reveals the arc progressively
 * along its own angular range, which is the standard trick for "growing" an
 * SVG stroke with a single animated NUMBER prop -- no need to animate
 * strokeDasharray itself (a two-number string), which Animated doesn't
 * interpolate reliably. All segments share one progress value so the whole
 * ring reads as one coordinated sweep, not staggered arcs. */
export function TopicDonut({
  segments,
  size = 132,
  strokeWidth = 18,
}: {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const total = segments.reduce((sum, s) => sum + s.focusS, 0);

  // Re-sweep whenever the actual composition changes (a new topic appears,
  // or the proportions shift enough to matter) -- not on every render, and
  // not merely because the parent re-rendered with the same numbers.
  const compositionKey = segments.map((s) => `${s.key}:${s.focusS}`).join('|');
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastKeyRef.current === compositionKey) return;
    lastKeyRef.current = compositionKey;
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // strokeDashoffset isn't a transform/opacity prop
    }).start();
  }, [compositionKey, reducedMotion, progress]);

  if (total <= 0) return null;

  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  let cumBefore = 0;
  const arcs = segments.map((s) => {
    const segLen = (s.focusS / total) * circumference;
    const finalOffset = -cumBefore;
    const startOffset = finalOffset + segLen;
    cumBefore += segLen;
    return { key: s.key, color: s.color, segLen, finalOffset, startOffset };
  });

  return (
    <Svg width={size} height={size}>
      {/* rotate -90deg so the ring starts at 12 o'clock instead of SVG's
          default 3 o'clock, and grows clockwise like a clock face */}
      <G rotation={-90} originX={cx} originY={cy}>
        {arcs.map((a) => (
          <AnimatedCircle
            key={a.key}
            cx={cx}
            cy={cy}
            r={r}
            stroke={a.color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${a.segLen} ${circumference - a.segLen}`}
            strokeDashoffset={progress.interpolate({
              inputRange: [0, 1],
              outputRange: [a.startOffset, a.finalOffset],
            })}
          />
        ))}
      </G>
    </Svg>
  );
}
