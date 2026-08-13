// WheelPicker.tsx -- Apple Clock-style scrolling-wheel picker column, hand-rolled
// on RN core ScrollView + Animated (no reanimated/gesture-handler -- this app
// has neither, see AnimatedPressable.tsx). One column per wheel; a caller
// composing multiple (e.g. hours + minutes) renders one WheelPicker per unit
// and owns the combined value itself, the same way DashboardScreen used to
// pair two DurationStepper instances.
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../theme/useTheme';
import { typeScale } from '../theme/tokens';

export const WHEEL_ITEM_HEIGHT = 40;
const VISIBLE_COUNT = 5; // odd, so exactly one row centers under the highlight
const PAD = (WHEEL_ITEM_HEIGHT * (VISIBLE_COUNT - 1)) / 2;
// A slow drag release (no throw) doesn't reliably fire onMomentumScrollEnd on
// every platform -- this is the velocity threshold below which onScrollEndDrag
// commits the snap itself instead of waiting for momentum that may not come.
const DRAG_SETTLE_VELOCITY = 0.05;

export function WheelPicker({
  labels,
  selectedIndex,
  onChange,
  width = 90,
  onDragStart,
  onDragEnd,
}: {
  labels: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  width?: number;
  // Fire on the ScrollView's own drag lifecycle, not a wrapping View's raw
  // touch events -- once this wheel actually captures the gesture (which it
  // does the moment a real drag starts), the caller's wrapping View stops
  // receiving touch-end/-cancel at all, since only the responder does. A
  // caller using onTouchEnd alone to, say, re-enable a sibling ScrollView's
  // scrolling would then never see that re-enable fire, leaving it stuck
  // disabled -- exactly the bug DashboardScreen's picker-row hit ("swipe
  // freezes the screen"). onDragStart/onDragEnd give a caller a signal this
  // component can guarantee actually fires. onDragEnd fires the instant the
  // finger lifts (onScrollEndDrag), not once a fast flick's momentum coast
  // fully settles (onMomentumScrollEnd, which can trail the actual release
  // by several hundred ms) -- momentum coasting is this wheel's own internal
  // animation, not a live touch a sibling could ever steal, so there's
  // nothing left for a caller to keep guarding against once the finger is
  // off the screen. Firing late here is what made a fast flick leave a
  // caller's disabled sibling scroll stuck for the whole coast, reading as
  // the picker/screen intermittently going unresponsive.
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(selectedIndex * WHEEL_ITEM_HEIGHT)).current;
  const settledIndexRef = useRef(selectedIndex);

  // Re-park the wheel when `selectedIndex` changes from outside a drag (e.g.
  // the hours wheel hitting the 9h cap forces minutes back to 0) -- mirrors
  // SliderRow's own external-value re-sync in SettingsPrimitives.tsx.
  useEffect(() => {
    if (settledIndexRef.current === selectedIndex) return;
    settledIndexRef.current = selectedIndex;
    scrollRef.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_HEIGHT, animated: true });
  }, [selectedIndex]);

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
    useNativeDriver: true,
  });

  const commit = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const index = Math.max(0, Math.min(labels.length - 1, Math.round(y / WHEEL_ITEM_HEIGHT)));
    const snappedY = index * WHEEL_ITEM_HEIGHT;
    if (Math.abs(y - snappedY) > 0.5) {
      scrollRef.current?.scrollTo({ y: snappedY, animated: true });
    }
    settledIndexRef.current = index;
    if (index !== selectedIndex) onChange(index);
  };

  return (
    <View style={{ width, height: WHEEL_ITEM_HEIGHT * VISIBLE_COUNT, overflow: 'hidden' }}>
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: PAD }}
        contentOffset={{ x: 0, y: selectedIndex * WHEEL_ITEM_HEIGHT }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={onDragStart}
        onMomentumScrollEnd={commit}
        onScrollEndDrag={(e) => {
          // The finger has left the screen the instant this fires, whether
          // or not the wheel itself keeps coasting under momentum -- that
          // coasting is purely internal animation, not a live touch the
          // outer ScrollView could ever steal, so there's nothing left to
          // guard against. Firing onDragEnd here (not only from commit(),
          // which a fast flick defers to onMomentumScrollEnd until the
          // coast fully settles) is what onDragEnd is actually for: without
          // it, the outer scroll stayed disabled for the whole coast --
          // often several hundred ms -- and any gesture landing on the rest
          // of the screen during that window did nothing, reading as the
          // picker/screen intermittently "glitching" or going unresponsive.
          onDragEnd?.();
          const vy = e.nativeEvent.velocity?.y ?? 0;
          if (Math.abs(vy) > DRAG_SETTLE_VELOCITY) return; // momentum will settle the snap itself
          commit(e);
        }}
      >
        {labels.map((label, i) => {
          const distance = Animated.subtract(scrollY, i * WHEEL_ITEM_HEIGHT);
          const opacity = distance.interpolate({
            inputRange: [-WHEEL_ITEM_HEIGHT * 2, -WHEEL_ITEM_HEIGHT, 0, WHEEL_ITEM_HEIGHT, WHEEL_ITEM_HEIGHT * 2],
            outputRange: [0.25, 0.55, 1, 0.55, 0.25],
            extrapolate: 'clamp',
          });
          const scale = distance.interpolate({
            inputRange: [-WHEEL_ITEM_HEIGHT * 2, -WHEEL_ITEM_HEIGHT, 0, WHEEL_ITEM_HEIGHT, WHEEL_ITEM_HEIGHT * 2],
            outputRange: [0.82, 0.92, 1, 0.92, 0.82],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={`${label}-${i}`}
              style={[styles.item, { height: WHEEL_ITEM_HEIGHT, opacity, transform: [{ scale }] }]}
            >
              <Text style={[styles.itemText, { color: theme.text }]}>{label}</Text>
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
      {/* Center highlight band, Apple Clock-style -- drawn once per wheel
          rather than shared across a multi-wheel row, so this component stays
          self-contained and usable on its own. */}
      <View
        pointerEvents="none"
        style={[
          styles.highlight,
          { top: PAD, height: WHEEL_ITEM_HEIGHT, borderColor: theme.textDim },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', justifyContent: 'center' },
  itemText: { ...typeScale.title, fontVariant: ['tabular-nums'] },
  highlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    opacity: 0.4,
  },
});
