// SettingsPrimitives.tsx -- small presentational building blocks shared
// between SettingsScreen.tsx and CustomLabelsSection.tsx. Split out here
// (rather than exported from SettingsScreen.tsx) so neither file has to
// import the other -- a two-file settings screen importing each other would
// be a circular dependency for no benefit.
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  PanResponder,
  LayoutChangeEvent,
} from 'react-native';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { AnimatedPressable } from '../ui/AnimatedPressable';

export function Button({
  label,
  onPress,
  disabled,
  color,
  variant = 'filled',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color: ReturnType<typeof useTheme>;
  variant?: 'filled' | 'outline';
}) {
  const filled = variant === 'filled';
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        filled
          ? { backgroundColor: color.accent, borderColor: color.accent }
          : { backgroundColor: 'transparent', borderColor: color.textDim },
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {disabled ? (
        <ActivityIndicator size="small" color={filled ? color.accentText : color.text} />
      ) : (
        <Text style={{ color: filled ? color.accentText : color.text, fontWeight: '600' }}>{label}</Text>
      )}
    </AnimatedPressable>
  );
}

export function Section({
  title,
  subtitle,
  color,
  children,
}: {
  title: string;
  subtitle?: string;
  color: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: color.surface }]}>
      <Text style={[styles.h2, { color: color.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: color.textDim }]}>{subtitle}</Text> : null}
      <View style={{ gap: 12, marginTop: 8 }}>{children}</View>
    </View>
  );
}

const THUMB_SIZE = 28;
const TRACK_HEIGHT = 6;

// A draggable slider giving continuous direct-set control (drag or tap
// anywhere on the track to jump straight to that value), built on RN core's
// PanResponder -- app/package.json has no gesture-handler/reanimated, and
// this doesn't need either. Values snap to `step` on a `min` anchor, matching
// the firmware's own OVR_STEP-style option lists (Box-code/lib/lock_config.py).
// Only commits (calls `onChange`) on release, so a drag produces one BLE
// settings write via pushBoxSettings, not one per touch-move event.
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format = (v: number) => String(v),
  caption,
  onChange,
  color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  caption?: (v: number) => string;
  onChange: (v: number) => void;
  color: ReturnType<typeof useTheme>;
}) {
  const [trackWidth, setTrackWidth] = React.useState(0);
  const trackWidthRef = React.useRef(0);
  const [dragValue, setDragValue] = React.useState<number | null>(null);
  // Handlers below are captured once by the PanResponder ref, so this ref
  // is how they always see the latest `onChange` prop rather than a stale one.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const snapValue = (v: number) => {
    const snapped = Math.round((v - min) / step) * step + min;
    return Math.min(max, Math.max(min, snapped));
  };

  const xToValue = (x: number) => {
    const w = trackWidthRef.current;
    if (w <= 0) return min;
    const ratio = Math.min(1, Math.max(0, x / w));
    return snapValue(min + ratio * (max - min));
  };

  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => setDragValue(xToValue(evt.nativeEvent.locationX)),
      onPanResponderMove: (evt) => setDragValue(xToValue(evt.nativeEvent.locationX)),
      onPanResponderRelease: () => {
        setDragValue((current) => {
          if (current != null) onChangeRef.current(current);
          return null;
        });
      },
      onPanResponderTerminate: () => setDragValue(null),
    }),
  ).current;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWidthRef.current = w;
    setTrackWidth(w);
  };

  const displayValue = dragValue ?? value;
  const ratio = max === min ? 0 : (displayValue - min) / (max - min);
  const thumbX = trackWidth > 0 ? ratio * trackWidth : 0;

  return (
    <View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: color.text }]}>{label}</Text>
        <Text style={[styles.sliderValue, { color: color.text }]}>{format(displayValue)}</Text>
      </View>
      <View style={styles.sliderTrackWrap} onLayout={onTrackLayout} {...panResponder.panHandlers}>
        <View style={[styles.sliderTrack, styles.sliderTrackBg, { backgroundColor: withAlpha(color.textDim, 0.3) }]} />
        <View
          style={[
            styles.sliderTrack,
            { backgroundColor: color.accent, width: thumbX },
          ]}
        />
        <View
          style={[
            styles.sliderThumb,
            { backgroundColor: color.accent, transform: [{ translateX: thumbX - THUMB_SIZE / 2 }] },
          ]}
        />
      </View>
      {caption ? (
        <Text style={[styles.subtitle, { color: color.textDim, marginTop: 4 }]}>
          {caption(displayValue)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 16, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2 },
  card: { borderRadius: 14, padding: 16 },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 15, flexShrink: 1, paddingRight: 12 },
  sliderValue: { fontSize: 15, fontWeight: '600' },
  sliderTrackWrap: { height: THUMB_SIZE, justifyContent: 'center', marginTop: 10 },
  sliderTrack: { position: 'absolute', left: 0, height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2 },
  sliderTrackBg: { right: 0 },
  sliderThumb: {
    position: 'absolute',
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
});
