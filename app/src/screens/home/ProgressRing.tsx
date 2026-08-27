// ProgressRing.tsx -- a single-arc circular progress indicator, split out
// for the Home screen's focus hero (DashboardScreen -> FocusHero) so the
// running-session countdown reads as one calm shape instead of the old
// screen's thin linear meter bar. Built on the exact same react-native-svg +
// core Animated technique src/ui/TopicDonut.tsx already uses for the Stats
// screen's topic ring (AnimatedCircle + animated strokeDashoffset, -90deg
// rotation so the arc starts at 12 o'clock) -- kept as its own small
// component here rather than generalizing TopicDonut itself, since
// TopicDonut's whole reason to exist is *multiple* simultaneous segments
// (each with a fixed final length) and this needs the opposite: one segment
// whose length itself changes smoothly tick over tick as `progress` ticks
// upward, which is a different animation (continuously re-targeted, like
// AnimatedFill) rather than TopicDonut's single reveal-once sweep.
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useReducedMotion } from '../../ui/useReducedMotion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ProgressRing({
  size = 208,
  strokeWidth = 14,
  progress,
  color,
  trackColor,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  /** 0..1. Values outside that range are clamped -- callers derive this from
   * live BLE ticks (elapsedFraction in FocusHero.tsx), which can very briefly
   * disagree with the box by a hair around a tick boundary. */
  progress: number;
  color: string;
  trackColor: string;
  /** Centered content (the countdown/duration text) -- laid out with
   * absolute positioning over the SVG rather than passed as SVG children,
   * so it can be ordinary RN Text/View. */
  children?: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, progress));
  const anim = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    if (reducedMotion) {
      anim.setValue(clamped);
      return;
    }
    // Same 400ms timing DashboardScreen's old linear meter used for the
    // identical purpose (tracking a BLE status tick smoothly rather than
    // snapping) -- carried over unchanged now that it drives a ring instead
    // of a bar.
    Animated.timing(anim, { toValue: clamped, duration: 400, useNativeDriver: false }).start();
  }, [clamped, reducedMotion]);

  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <G rotation={-90} originX={cx} originY={cy}>
          <AnimatedCircle
            cx={cx}
            cy={cy}
            r={r}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={anim.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}
          />
        </G>
      </Svg>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={styles.center}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
