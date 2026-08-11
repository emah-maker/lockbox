// AnimatedFill.tsx -- animates a bar-chart fill toward a new value instead of
// snapping. `height` (a fixed-height track, absolute px) and `width` (a
// percentage of track width) both need JS-driven Animated (neither supports
// the native driver), which is the normal, cheap way to animate a single
// bar's layout in RN -- unlike animating layout across a whole web page,
// there's no larger reflow chain here to worry about. Shared by
// StatsScreen's trend/topic bars and DashboardScreen's Focus-card sparkline.
import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useReducedMotion } from './useReducedMotion';

export function AnimatedFill({
  axis,
  toValue,
  style,
  color,
}: {
  axis: 'height' | 'width';
  toValue: number;
  style: any;
  color: string;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) {
      anim.setValue(toValue);
      return;
    }
    Animated.timing(anim, { toValue, duration: 500, useNativeDriver: false }).start();
  }, [toValue, reducedMotion]);
  const sizeStyle =
    axis === 'width'
      ? { width: anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }
      : { height: anim };
  return <Animated.View style={[style, sizeStyle, { backgroundColor: color }]} />;
}
