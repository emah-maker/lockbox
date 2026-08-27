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
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { withAlpha } from '../theme/theme';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useReducedMotion } from '../ui/useReducedMotion';
import { typeScale, elevation, springs, opacity } from '../theme/tokens';

export function Button({
  label,
  onPress,
  disabled,
  loading,
  color,
  variant = 'filled',
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  // Distinct from `disabled`: a button can be disabled simply because its
  // inputs aren't valid yet (e.g. CustomLabelsSection's "Add label" with no
  // name/color picked) -- that's a static, resting state, not a spinner-
  // worthy one. `loading` is for the narrower case of an actual in-flight
  // async action (sign-in, sync, sign-out below), where a spinner is the
  // right signal. Every disabled button used to show a spinner regardless
  // of which of these was true, which read as "Add label" being perpetually
  // stuck loading before you'd typed anything.
  loading?: boolean;
  color: ReturnType<typeof useTheme>;
  variant?: 'filled' | 'outline';
  // Optional leading glyph (e.g. Ionicons "logo-google"/"logo-apple" for the
  // sign-in buttons, manager request) -- every other Button call site omits
  // this and renders exactly as before.
  icon?: React.ReactNode;
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
        disabled ? { opacity: opacity.disabled } : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={filled ? color.accentText : color.text} />
      ) : (
        <View style={styles.buttonContent}>
          {icon}
          <Text style={[styles.buttonLabel, { color: filled ? color.accentText : color.text }]}>{label}</Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

// Generic "label on the left, control on the right" row -- shared by
// SettingsScreen.tsx's own rows and (via AccountSection.tsx) the Account
// section, so both read as the same list style.
export function Row({
  label,
  color,
  children,
}: {
  label: string;
  color: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: color.text }]}>{label}</Text>
      {children}
    </View>
  );
}

// Disclosure row for the Settings hub (SettingsScreen.tsx) -- label on the
// left, a one-line current-value summary and a chevron on the right, the
// whole row tappable to open that category's Sheet. Unlike Row above (which
// hosts an inline control, e.g. a Switch, and is still used inside each
// sheet's own content), this is the hub's own list-item shape: a summary
// string rather than a live control, since the control itself only exists
// once its sheet is open. min 44pt tall so the hub itself is comfortable to
// scan and tap even though its rows are denser than the old wall-of-controls
// screen this replaces.
export function DisclosureRow({
  label,
  value,
  onPress,
  color,
  icon,
  accessibilityLabel,
}: {
  label: string;
  /** One-line summary of the section's current state, e.g. "Dark · Mint" or
   * "3 labels" -- omitted (not empty-stringed) when there's nothing worth
   * summarizing yet, so the chevron doesn't sit next to an awkward blank. */
  value?: string;
  onPress: () => void;
  color: ReturnType<typeof useTheme>;
  /** Optional leading glyph (e.g. the account avatar icon) -- most hub rows
   * omit this and render as plain text + chevron. */
  icon?: React.ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
      style={styles.disclosureRow}
    >
      <View style={styles.disclosureLeft}>
        {icon}
        <Text style={[styles.label, { color: color.text }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.disclosureRight}>
        {value ? (
          <Text style={[styles.disclosureValue, { color: color.textDim }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={color.textDim} />
      </View>
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
// Shares AnimatedPressable's press spring (via the tokens.ts `springs` token)
// so every settle in the app comes from one feel. useNativeDriver is off
// because the filled track animates `width`, and a single Animated.Value
// can't be shared across the two drivers.
const SPRING = { ...springs.default, useNativeDriver: false } as const;

// Rubber-band resistance for drag past either track edge, instead of a hard
// stop -- the apple-design skill's exact formula (§9), constant 0.55 is its
// documented default. RUBBER_BAND_DIMENSION is the max extra px of give as
// overshoot approaches infinity (the formula asymptotes to this value), kept
// small since this is a compact settings control, not a full-screen gesture.
const RUBBER_BAND_DIMENSION = 24;
const RUBBER_BAND_CONSTANT = 0.55;
function rubberBand(overshoot: number): number {
  return (
    (overshoot * RUBBER_BAND_DIMENSION * RUBBER_BAND_CONSTANT) /
    (RUBBER_BAND_DIMENSION + RUBBER_BAND_CONSTANT * Math.abs(overshoot))
  );
}

// A draggable slider giving continuous direct-set control (drag or tap
// anywhere on the track to jump straight to that value), built on RN core's
// PanResponder -- app/package.json has no gesture-handler/reanimated, and
// this doesn't need either. Values snap to a uniform `step` on a `min`
// anchor. Only commits (calls `onChange`) on release, so a drag produces one
// BLE settings write via pushBoxSettings, not one per touch-move event.
//
// Used to also support a non-uniform `options` array (for the firmware's old
// OVR_OPTIONS staircase, Box-code/lib/lock_config.py) with equal-width
// per-option track slices instead of value-proportional ones -- removed once
// override presses became a flat linear step, since a non-uniform staircase
// is exactly what made that slider feel "inconsistent" (the same drag
// distance meant a tiny nudge near one end and a huge jump near the other).
// If a future control needs that again, it's in this file's git history.
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
  // Handlers below are captured once by the PanResponder ref, so these refs
  // are how they always see the latest props rather than stale ones.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = React.useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  // Same reasoning as onChangeRef/reducedMotionRef above, extended to
  // min/max/step: snapValue/xToValue/valueToX below are plain functions
  // re-created every render, but the PanResponder that calls them is built
  // once via useRef(...).current (below), so it only ever closes over
  // whichever snapValue/xToValue/valueToX existed at that first render --
  // and those, in turn, closed over that render's min/max/step. Without these
  // refs, a caller passing a dynamic range (this file's own doc comment flags
  // this as latent, since today's single call site uses a constant range)
  // would have every drag permanently snap/clamp against the *first-render*
  // range forever (production readiness review, Medium: "SliderRow stale
  // closure on min/max/step").
  const minRef = React.useRef(min);
  minRef.current = min;
  const maxRef = React.useRef(max);
  maxRef.current = max;
  const stepRef = React.useRef(step);
  stepRef.current = step;

  // Thumb/fill position in px along the track. While a finger is down this
  // follows the raw touch 1:1 (direct manipulation must not lag or stair-step
  // under the finger) even though the *value* it reports is snapped; on
  // release it springs the short distance to the snapped step.
  const thumbX = React.useRef(new Animated.Value(0)).current;
  const draggingRef = React.useRef(false);
  const settlingRef = React.useRef(false);
  const restingXRef = React.useRef(0);

  const snapValue = (v: number) => {
    const mn = minRef.current;
    const mx = maxRef.current;
    const st = stepRef.current;
    const snapped = Math.round((v - mn) / st) * st + mn;
    return Math.min(mx, Math.max(mn, snapped));
  };

  // Soft edges while dragging: past either end, the thumb still follows the
  // finger but with progressive resistance (rubberBand above) instead of
  // stopping dead. The *value*/snap math below is untouched -- xToValue
  // already clamps its ratio to [0, 1], so an overshot x here can never
  // produce an out-of-range committed value, only a visual overhang.
  const clampX = (x: number) => {
    const w = trackWidthRef.current;
    if (x < 0) return -rubberBand(-x);
    if (x > w) return w + rubberBand(x - w);
    return x;
  };

  const xToValue = (x: number) => {
    const w = trackWidthRef.current;
    const mn = minRef.current;
    const mx = maxRef.current;
    if (w <= 0) return mn;
    const ratio = Math.min(1, Math.max(0, x / w));
    return snapValue(mn + ratio * (mx - mn));
  };

  const valueToX = (v: number) => {
    const mn = minRef.current;
    const mx = maxRef.current;
    if (mx === mn) return 0;
    return ((v - mn) / (mx - mn)) * trackWidthRef.current;
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
      // Capture variants too: without these, SettingsScreen's ScrollView
      // ancestor can steal the gesture mid-drag on any touch with vertical
      // motion, firing onPanResponderTerminate (snap to null) then re-grant
      // -- a cycle that reads as the thumb glitching/flashing while dragging.
      // Claiming at the capture phase keeps the whole drag with this
      // responder once it starts.
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
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
  const restingRatio = max === min ? 0 : (value - min) / (max - min);
  const restingX = trackWidth > 0 ? restingRatio * trackWidth : 0;
  restingXRef.current = restingX;

  // Keep the thumb parked on `value` whenever the drag/settle path isn't
  // driving it -- covers first layout and value changes from elsewhere
  // (another device syncing settings in, say).
  React.useEffect(() => {
    if (draggingRef.current || settlingRef.current) return;
    thumbX.setValue(restingX);
  }, [restingX, thumbX]);

  // A slightly-underdamped spring can overshoot past either end during
  // settle, and rubber-banding now lets the raw drag overshoot too -- a
  // fill narrower/wider than the track is a layout error, so this clamps the
  // *fill* to real track bounds on both sides; the thumb itself (styled via
  // `transform: translateX`, not this) is left free to overhang, which is
  // the whole point of the rubber-band/overshoot feel.
  const fillWidth = React.useMemo(() => {
    const w = Math.max(trackWidth, 1);
    return thumbX.interpolate({
      inputRange: [0, w],
      outputRange: [0, w],
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }, [thumbX, trackWidth]);

  return (
    <View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: color.text }]}>{label}</Text>
        <Text style={[styles.sliderValue, { color: color.text }]}>{format(displayValue)}</Text>
      </View>
      <View
        style={styles.sliderTrackWrap}
        onLayout={onTrackLayout}
        // The drag surface is THUMB_SIZE (28px) tall -- under the ~44pt
        // minimum touch target (production readiness review, Low). hitSlop
        // extends the *touch* target without changing the visual track
        // height/layout.
        hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
        {...panResponder.panHandlers}
      >
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

// Row-label / small-caption text styles -- exported since SettingsScreen.tsx
// (and, via OverridePressSection.tsx, the Override-presses picker) need the
// exact same look for their own rows/captions. Previously defined a second
// time, byte-for-byte, in SettingsScreen.tsx's own StyleSheet; consolidated
// to this one source once a third consumer needed it, rather than adding a
// third copy.
export const rowLabelStyle = {
  fontSize: 15,
  flexShrink: 1 as const,
  paddingRight: 12,
  letterSpacing: typeScale.sectionTitle.letterSpacing,
  lineHeight: 20,
};
export const captionStyle = {
  fontSize: 12,
  marginTop: 2,
  letterSpacing: typeScale.caption.letterSpacing,
  lineHeight: typeScale.caption.lineHeight,
};

const styles = StyleSheet.create({
  h2: { ...typeScale.sectionTitle },
  subtitle: captionStyle,
  card: { borderRadius: 14, padding: 16, ...elevation.card },
  buttonLabel: { fontWeight: '600', letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    // paddingVertical 12 (was 10) so a filled/outline Button's tap target
    // clears the ~44pt minimum together with its text line-height, not just
    // its visual box (production readiness review-style pass, same
    // reasoning as SliderRow's hitSlop just below).
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  // minHeight 44 so every Row -- both a sheet's own Switch/value rows and
  // (via the shared object below) SliderRow's label/value line -- clears the
  // minimum comfortable touch target, now that the hub above it is denser.
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  label: rowLabelStyle,
  disclosureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 10,
  },
  disclosureLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  disclosureRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, marginLeft: 12 },
  disclosureValue: { fontSize: 14, flexShrink: 1, letterSpacing: typeScale.body.letterSpacing, lineHeight: 18 },
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
    ...elevation.thumb,
  },
});
