// AnimatedPressable.tsx -- a Pressable that scales down slightly on press.
// RN's Pressable gives zero visual feedback by default unless you style off
// the `pressed` render-prop callback, and nothing in this app did -- every
// button, chip, and calendar cell registered a tap with no tactile
// confirmation at all. This is the one shared fix for that, built on RN
// core's Animated only (no gesture-handler/reanimated dependency, matching
// SettingsPrimitives.tsx's SliderRow -- this app deliberately has neither).
//
// Wraps Pressable itself via Animated.createAnimatedComponent rather than
// nesting an extra View around it: a wrapper View would need to duplicate
// every layout-relevant style (flexDirection, alignItems, gap) to keep
// multi-child rows (e.g. a dot + label) arranged the same way, which is
// exactly the kind of thing that silently breaks and is hard to catch
// without a simulator. This way `style`/`children`/every other prop behaves
// identically to a plain Pressable -- only the press-scale is new.
import React, { useRef } from 'react';
import { Animated, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';

const PRESS_SCALE = 0.96;
const DURATION = 90;

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

// `style` is narrowed to the plain (non-function) form: Pressable normally
// also accepts `style={(state) => ...}` for the `pressed` render-prop, but
// every call site here passes a plain array/object, and Animated's wrapper
// can only merge a plain style, not a callback.
export function AnimatedPressable({
  onPressIn,
  onPressOut,
  style,
  disabled,
  scaleTo = PRESS_SCALE,
  ...rest
}: Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  scaleTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) => {
    Animated.timing(scale, { toValue, duration: DURATION, useNativeDriver: true }).start();
  };

  return (
    <AnimatedPressableBase
      disabled={disabled}
      onPressIn={(e: any) => {
        if (!disabled) animateTo(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e: any) => {
        animateTo(1);
        onPressOut?.(e);
      }}
      style={[style, { transform: [{ scale }] }]}
      {...rest}
    />
  );
}
