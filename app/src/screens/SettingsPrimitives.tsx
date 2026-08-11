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
  ActivityIndicator,
  PanResponder,
  LayoutChangeEvent,
  Animated,
} from 'react-native';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useReducedMotion } from '../ui/useReducedMotion';
import { typeScale, elevation } from '../theme/tokens';

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
        <Text style={[styles.buttonLabel, { color: filled ? color.accentText : color.text }]}>{label}</Text>
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
// Matches AnimatedPressable's press spring so every settle in the app shares
// one feel. useNativeDriver is off because the filled track animates `width`,
// and a single Animated.Value can't be shared across the two drivers.
const SPRING = { stiffness: 300, damping: 30, mass: 1, useNativeDriver: false } as const;

// A draggable slider giving continuous direct-set control (drag or tap
// anywhere on the track to jump straight to that value), built on RN core's
// PanResponder -- app/package.json has no gesture-handler/reanimated, and
// this doesn't need either. Values snap either to a uniform `step` on a
// `min` anchor, or -- when `options` is given instead of `min`/`max`/`step`
// -- to the nearest value in that (ascending) array. The latter covers
// non-uniform staircases like the firmware's OVR_OPTIONS
// (Box-code/lib/lock_config.py), where a flat step can't express steps that
// grow with the value. Only commits (calls `onChange`) on release, so a drag
// produces one BLE settings write via pushBoxSettings, not one per
// touch-move event.
type SliderRowRangeProps = {
  min: number;
  max: number;
  step: number;
  options?: undefined;
};
type SliderRowOptionsProps = {
  options: number[];
  min?: undefined;
  max?: undefined;
  step?: undefined;
};

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  options,
  format = (v: number) => String(v),
  caption,
  onChange,
  color,
}: {
  label: string;
  value: number;
  format?: (v: number) => string;
  caption?: (v: number) => string;
  onChange: (v: number) => void;
  color: ReturnType<typeof useTheme>;
} & (SliderRowRangeProps | SliderRowOptionsProps)) {
  const effMin = options ? options[0] : min;
  const effMax = options ? options[options.length - 1] : max;

  const [trackWidth, setTrackWidth] = React.useState(0);
  const trackWidthRef = React.useRef(0);
  const [dragValue, setDragValue] = React.useState<number | null>(null);
  // Handlers below are captured once by the PanResponder ref, so these refs
  // are how they always see the latest props rather than stale ones.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = React.useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  // Thumb/fill position in px along the track. While a finger is down this
  // follows the raw touch 1:1 (direct manipulation must not lag or stair-step
  // under the finger) even though the *value* it reports is snapped; on
  // release it springs the short distance to the snapped step.
  const thumbX = React.useRef(new Animated.Value(0)).current;
  const draggingRef = React.useRef(false);
  const settlingRef = React.useRef(false);
  const restingXRef = React.useRef(0);

  const snapValue = (v: number) => {
    if (options) {
      let nearest = options[0];
      let bestDist = Math.abs(v - nearest);
      for (const opt of options) {
        const dist = Math.abs(v - opt);
        if (dist < bestDist) {
          nearest = opt;
          bestDist = dist;
        }
      }
      return nearest;
    }
    const snapped = Math.round((v - min) / step) * step + min;
    return Math.min(max, Math.max(min, snapped));
  };

  const clampX = (x: number) => Math.min(trackWidthRef.current, Math.max(0, x));

  const xToValue = (x: number) => {
    const w = trackWidthRef.current;
    if (w <= 0) return effMin;
    const ratio = Math.min(1, Math.max(0, x / w));
    return snapValue(effMin + ratio * (effMax - effMin));
  };

  const valueToX = (v: number) => {
    if (effMax === effMin) return 0;
    return ((v - effMin) / (effMax - effMin)) * trackWidthRef.current;
  };

  const track = (x: number) => {
    thumbX.setValue(x);
    setDragValue(xToValue(x));
  };

  const settleTo = (x: number) => {
    if (reducedMotionRef.current) {
      thumbX.setValue(x);
      return;
    }
    settlingRef.current = true;
    Animated.spring(thumbX, { toValue: x, ...SPRING }).start(() => {
      settlingRef.current = false;
      // Re-sync in case `value` came back from the parent as something other
      // than what we committed while the spring was running.
      thumbX.setValue(restingXRef.current);
    });
  };

  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        draggingRef.current = true;
        track(clampX(evt.nativeEvent.locationX));
      },
      onPanResponderMove: (evt) => track(clampX(evt.nativeEvent.locationX)),
      onPanResponderRelease: () => {
        draggingRef.current = false;
        setDragValue((current) => {
          if (current != null) {
            onChangeRef.current(current);
            settleTo(valueToX(current));
          }
          return null;
        });
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        setDragValue(null);
        // Nothing was committed, so settle back onto the unchanged value.
        settleTo(restingXRef.current);
      },
    }),
  ).current;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWidthRef.current = w;
    setTrackWidth(w);
  };

  const displayValue = dragValue ?? value;
  const restingRatio = effMax === effMin ? 0 : (value - effMin) / (effMax - effMin);
  const restingX = trackWidth > 0 ? restingRatio * trackWidth : 0;
  restingXRef.current = restingX;

  // Keep the thumb parked on `value` whenever the drag/settle path isn't
  // driving it -- covers first layout and value changes from elsewhere
  // (another device syncing settings in, say).
  React.useEffect(() => {
    if (draggingRef.current || settlingRef.current) return;
    thumbX.setValue(restingX);
  }, [restingX, thumbX]);

  // A slightly-underdamped spring can overshoot past zero at the low end, and
  // a negative width is a layout error; the thumb itself can overhang freely.
  const fillWidth = React.useMemo(
    () => thumbX.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' }),
    [thumbX],
  );

  return (
    <View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: color.text }]}>{label}</Text>
        <Text style={[styles.sliderValue, { color: color.text }]}>{format(displayValue)}</Text>
      </View>
      <View style={styles.sliderTrackWrap} onLayout={onTrackLayout} {...panResponder.panHandlers}>
        <View style={[styles.sliderTrack, styles.sliderTrackBg, { backgroundColor: withAlpha(color.textDim, 0.3) }]} />
        <Animated.View
          style={[
            styles.sliderTrack,
            { backgroundColor: color.accent, width: fillWidth },
          ]}
        />
        <Animated.View
          style={[
            styles.sliderThumb,
            { backgroundColor: color.accent, transform: [{ translateX: thumbX }] },
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
  h2: { ...typeScale.sectionTitle },
  subtitle: { fontSize: 12, marginTop: 2, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  card: { borderRadius: 14, padding: 16, ...elevation.card },
  buttonLabel: { fontWeight: '600', letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
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
  label: { fontSize: 15, flexShrink: 1, paddingRight: 12, letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 20 },
  sliderValue: { fontSize: 15, fontWeight: '600', letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 20 },
  sliderTrackWrap: { height: THUMB_SIZE, justifyContent: 'center', marginTop: 10 },
  sliderTrack: { position: 'absolute', left: 0, height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2 },
  sliderTrackBg: { right: 0 },
  sliderThumb: {
    position: 'absolute',
    // Centers the thumb on its translateX, which is the raw track position.
    left: -THUMB_SIZE / 2,
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
