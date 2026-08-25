// WheelPicker.tsx -- Apple Clock-style scrolling-wheel picker, hand-rolled on
// RN core ScrollView + Animated (no reanimated/gesture-handler -- this app has
// neither, see AnimatedPressable.tsx). Defaults to a vertical column (one per
// wheel; a caller composing multiple, e.g. hours + minutes, renders one
// WheelPicker per unit and owns the combined value itself, the same way
// DashboardScreen used to pair two DurationStepper instances). `orientation`
// can rotate the same scroll/snap/highlight/accessibility logic onto the
// x-axis instead (e.g. Settings' Override-presses picker) -- one component,
// since the interaction (drag, momentum-snap, VoiceOver increment/decrement)
// is identical either way and only the scroll axis changes.
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import { useTheme } from '../theme/useTheme';
import { typeScale } from '../theme/tokens';

export const WHEEL_ITEM_SIZE = 40;
const VISIBLE_COUNT = 5; // odd, so exactly one row/column centers under the highlight
// A slow drag release (no throw) doesn't reliably fire onMomentumScrollEnd on
// every platform -- this is the velocity threshold below which onScrollEndDrag
// commits the snap itself instead of waiting for momentum that may not come.
const DRAG_SETTLE_VELOCITY = 0.05;

export function WheelPicker({
  labels,
  selectedIndex,
  onChange,
  orientation = 'vertical',
  itemSize = WHEEL_ITEM_SIZE,
  crossAxisSize = 90,
  onDragStart,
  onDragEnd,
  accessibilityLabel,
  itemTextStyle,
}: {
  labels: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  // 'vertical' (default) is the original Dashboard duration-wheel column;
  // 'horizontal' is the same wheel rotated onto the x-axis (e.g. Settings'
  // Override-presses picker, which has too many steps for a chip row).
  orientation?: 'vertical' | 'horizontal';
  // Size of one item along the scroll axis -- row height for vertical, column
  // width for horizontal.
  itemSize?: number;
  // Size of the picker across the scroll axis -- column width for vertical,
  // row height for horizontal. Named for the axis, not "width", since it maps
  // to height in horizontal orientation.
  crossAxisSize?: number;
  // The sole phone-side control for the Dashboard's lock duration, and had
  // zero accessibility affordances at all -- completely inoperable via
  // VoiceOver/TalkBack (production readiness review, High). Callers composing
  // multiple wheels (hours + minutes) should pass a distinct label for each.
  accessibilityLabel?: string;
  // Overrides the default Apple-Clock-scale item text style. The Dashboard's
  // duration wheels want the large `typeScale.title` digits this defaults to;
  // a picker embedded in a compact Settings row wants something smaller.
  itemTextStyle?: TextStyle;
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
  // the picker/screen intermittently going unresponsive. (Only relevant for
  // a wheel sharing its scroll axis with an ancestor ScrollView, e.g. the
  // Dashboard's vertical wheels inside a vertical screen scroll -- a
  // horizontal wheel inside a vertical screen scroll has no such conflict,
  // since RN's responder system already disambiguates orthogonal directions.)
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const horizontal = orientation === 'horizontal';
  const PAD = (itemSize * (VISIBLE_COUNT - 1)) / 2;
  const scrollPos = useRef(new Animated.Value(selectedIndex * itemSize)).current;
  const settledIndexRef = useRef(selectedIndex);

  const scrollToIndex = (index: number, animated: boolean) => {
    const offset = index * itemSize;
    scrollRef.current?.scrollTo(horizontal ? { x: offset, animated } : { y: offset, animated });
  };

  // Re-park the wheel when `selectedIndex` changes from outside a drag (e.g.
  // the hours wheel hitting the 9h cap forces minutes back to 0) -- mirrors
  // SliderRow's own external-value re-sync in SettingsPrimitives.tsx.
  // Deliberately has no dependency array: a caller can *reject* a drag by
  // feeding back the same `selectedIndex` value it already had (see
  // DashboardScreen's 0h00m guard), in which case this must still run to
  // correct the ref, because commit() below has already speculatively set
  // settledIndexRef.current to the rejected index before onChange/rejection
  // happens. Gating on `[selectedIndex]` would skip that render entirely
  // since the *value* never changed -- the ref comparison below is what
  // actually needs to run on every render; it already no-ops cheaply once
  // the two agree, so this isn't a behavior change for the normal case.
  useEffect(() => {
    if (settledIndexRef.current === selectedIndex) return;
    settledIndexRef.current = selectedIndex;
    scrollToIndex(selectedIndex, true);
  });

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: horizontal ? { x: scrollPos } : { y: scrollPos } } }],
    { useNativeDriver: true },
  );

  const maxOffset = (labels.length - 1) * itemSize;

  const commit = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pos = horizontal ? e.nativeEvent.contentOffset.x : e.nativeEvent.contentOffset.y;
    const index = Math.max(0, Math.min(labels.length - 1, Math.round(pos / itemSize)));
    const snappedPos = index * itemSize;
    // At the first/last item (0m/55m, 0h/9h -- exactly the boundary values
    // that were freezing) a fast release past the edge leaves the ScrollView
    // still elastically bouncing back on its own (iOS rubber-banding, the
    // "screen moves up and down" at the limit) when this fires. Correcting
    // with our own scrollTo while the position is still out of [0, maxOffset]
    // pits that imperative call against the native bounce-back animation
    // running on the same view; the two fighting each other is what left the
    // ScrollView's gesture responder wedged and the picker (and, since
    // onDragEnd never got a chance to run, the outer screen -- see
    // DashboardScreen's pickerActive) unresponsive afterward. In range, the
    // native bounce can't be involved (there's nothing to elastically
    // correct there), so this only skips the exact case that fights it --
    // the clamped index/onChange below still fire every time regardless.
    if (Math.abs(pos - snappedPos) > 0.5 && pos >= -0.5 && pos <= maxOffset + 0.5) {
      scrollToIndex(index, true);
    }
    settledIndexRef.current = index;
    if (index !== selectedIndex) {
      Haptics.selectionAsync();
      onChange(index);
    }
  };

  // VoiceOver/TalkBack's increment/decrement gestures on an "adjustable"
  // element -- the accessible equivalent of a one-step drag. Scrolls the
  // wheel to match, same as the external-value re-sync effect above, so a
  // screen-reader user sees the same visual state a sighted drag would leave.
  const changeBy = (delta: number) => {
    const next = Math.max(0, Math.min(labels.length - 1, selectedIndex + delta));
    if (next === selectedIndex) return;
    settledIndexRef.current = next;
    scrollToIndex(next, true);
    Haptics.selectionAsync();
    onChange(next);
  };

  return (
    <View
      style={{
        width: horizontal ? itemSize * VISIBLE_COUNT : crossAxisSize,
        height: horizontal ? crossAxisSize : itemSize * VISIBLE_COUNT,
        overflow: 'hidden',
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: labels[selectedIndex] }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') changeBy(1);
        else if (event.nativeEvent.actionName === 'decrement') changeBy(-1);
      }}
    >
      <Animated.ScrollView
        importantForAccessibility="no-hide-descendants"
        ref={scrollRef}
        horizontal={horizontal}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        snapToInterval={itemSize}
        decelerationRate="fast"
        // No elastic overscroll at the first/last item -- the commit() guard
        // above and DashboardScreen's pickerSafetyTimer both exist only to
        // react to the rubber-band-vs-manual-snap fight that overscroll
        // creates at 0m/55m and 0h/9h ("the screen moves up and down" at
        // those exact values, then sometimes never settles). A real
        // UIPickerView wheel doesn't bounce past its own ends either, so this
        // isn't a feel regression -- it removes the precondition for that
        // fight instead of only guarding around it after the fact.
        bounces={false}
        overScrollMode="never"
        contentContainerStyle={horizontal ? { paddingHorizontal: PAD } : { paddingVertical: PAD }}
        contentOffset={
          horizontal ? { x: selectedIndex * itemSize, y: 0 } : { x: 0, y: selectedIndex * itemSize }
        }
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
          const velocity = horizontal ? e.nativeEvent.velocity?.x : e.nativeEvent.velocity?.y;
          if (Math.abs(velocity ?? 0) > DRAG_SETTLE_VELOCITY) return; // momentum will settle the snap itself
          commit(e);
        }}
      >
        {labels.map((label, i) => {
          const distance = Animated.subtract(scrollPos, i * itemSize);
          const opacity = distance.interpolate({
            inputRange: [-itemSize * 2, -itemSize, 0, itemSize, itemSize * 2],
            outputRange: [0.25, 0.55, 1, 0.55, 0.25],
            extrapolate: 'clamp',
          });
          const scale = distance.interpolate({
            inputRange: [-itemSize * 2, -itemSize, 0, itemSize, itemSize * 2],
            outputRange: [0.82, 0.92, 1, 0.92, 0.82],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={`${label}-${i}`}
              style={[
                styles.item,
                horizontal ? { width: itemSize, height: '100%' } : { height: itemSize },
                { opacity, transform: [{ scale }] },
              ]}
            >
              <Text style={[styles.itemText, itemTextStyle, { color: theme.text }]}>{label}</Text>
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
      {/* Center highlight, Apple Clock-style -- a band across the wheel when
          vertical, a band down it when horizontal -- drawn once per wheel
          rather than shared across a multi-wheel row, so this component stays
          self-contained and usable on its own. */}
      <View
        pointerEvents="none"
        style={[
          horizontal ? styles.highlightColumn : styles.highlightRow,
          horizontal
            ? { left: PAD, width: itemSize, borderColor: theme.textDim }
            : { top: PAD, height: itemSize, borderColor: theme.textDim },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', justifyContent: 'center' },
  itemText: { ...typeScale.title, fontVariant: ['tabular-nums'] },
  highlightRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    opacity: 0.4,
  },
  highlightColumn: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    opacity: 0.4,
  },
});
