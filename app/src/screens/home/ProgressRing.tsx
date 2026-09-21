// ProgressRing.tsx -- a single-arc circular progress indicator, split out
// for the Home screen's focus hero (DashboardScreen -> FocusHero) so the
// running-session countdown reads as one calm shape instead of the old
// screen's thin linear meter bar. Built on the exact same react-native-svg +
// core Animated technique the Stats screen's topic ring uses (AnimatedCircle
// + animated strokeDashoffset, -90deg rotation so the arc starts at 12
// o'clock) -- kept as its own small component rather than generalizing that
// ring, since a topic ring's whole reason to exist is *multiple* simultaneous
// segments (each with a fixed final length) and this needs the opposite: one
// segment whose length itself changes smoothly tick over tick as `progress`
// ticks upward, which is a different animation (continuously re-targeted,
// like AnimatedFill) rather than a single reveal-once sweep.
//
// Ring redesign (manager brief): no longer a full circle -- the bottom is
// cut off by an open `gapDegrees`-wide gap centered on 6 o'clock, both the
// track and the progress arc respect it, and `progress` maps 0..1 across the
// *drawn* sweep (360 - gapDegrees), never across the full 360. The math:
// rotate the whole arc group so local angle 0 (where a plain Circle's own
// stroke naturally starts, at 3 o'clock) lands at `startAngle` = 90 +
// gapDegrees/2 -- 90 is due south (6 o'clock) in this rotation prop's own
// convention (0 = east/3 o'clock, positive = clockwise, so 90 = south, 180 =
// west, 270 = north; this is the same convention -90 already relied on below
// to land the old full circle's start at 12 o'clock). Sweeping clockwise for
// `sweepDegrees` = 360 - gapDegrees from there lands exactly at 90 -
// gapDegrees/2, so the two arc ends straddle 90 symmetrically and the open
// gap sits centered at the bottom regardless of `gapDegrees`. The track is a
// FIXED reveal of the whole sweep (dashoffset = circumference - arcLength,
// constant); the progress arc reuses the exact same rotation/dasharray but
// reveals only `arcLength * progress` of it, so a partial `progress` can
// never bleed into the gap the way naively animating dashoffset across the
// full circumference (the pre-redesign technique) would.
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useReducedMotion } from '../../ui/useReducedMotion';
import type { RingSegment } from './idleRingState';

import { AnimatedCircle } from '../../ui/AnimatedCircle';

// ~90-100 degrees reads clearly as "an arc, not a circle" without eating so
// much of the ring that the remaining sweep looks thin or lopsided -- picked
// from that range per the manager brief's own suggestion, not load-bearing
// on any other math here (every angle below derives from this one constant).
const DEFAULT_GAP_DEGREES = 100;

// Roughly one pixel of swept arc at the default size (2*pi*122 * 260/360 is
// ~554px of drawn arc, so 1/554 ~= 0.0018). Below this a change in `progress`
// cannot be seen, so it is applied instantly instead of tweened -- see the
// effect in the component for why that matters on a screen driven by a 1Hz
// BLE tick.
const PROGRESS_EPSILON = 0.0018;

export function ProgressRing({
  // Bigger than the pre-redesign default (208) so the ring reads as the
  // screen's anchor (manager brief) -- FocusHero mounts this with no size
  // override, so this default IS the Home hero's actual on-screen size.
  size = 260,
  strokeWidth = 16,
  gapDegrees = DEFAULT_GAP_DEGREES,
  progress,
  color,
  trackColor,
  children,
  bottomSlot,
  segments,
}: {
  size?: number;
  strokeWidth?: number;
  /** Degrees of open gap centered at 6 o'clock -- see this file's header for
   * the angle math. Exposed (rather than hardcoded) so a future caller could
   * tune it, but every current caller uses the default. */
  gapDegrees?: number;
  /** 0..1 across the *drawn* sweep (360 - gapDegrees), not across a full
   * circle -- callers derive this from live BLE ticks (elapsedFraction in
   * FocusHero.tsx) or from idleRingState.ts, which can very briefly disagree
   * by a hair around a tick boundary; clamped below regardless. */
  progress: number;
  color: string;
  trackColor: string;
  /** Centered content (the countdown/duration text) -- laid out with
   * absolute positioning over the SVG rather than passed as SVG children,
   * so it can be ordinary RN Text/View. */
  children?: React.ReactNode;
  /** Content docked in the bottom gap itself (FocusHero's BatteryBadge) --
   * positioned to visually fill the cut-out the arc leaves open, distinct
   * from `children`'s vertically-centered slot. Optional: a caller with no
   * gap content (there is none today, but a future bare progress ring might
   * have none) simply omits it. */
  bottomSlot?: React.ReactNode;
  /** A second, INNER concentric arc showing today's topic mix -- each
   * segment a contiguous slice of the same swept range the main arc uses,
   * drawn in that topic's own color. Deliberately a separate ring rather
   * than a recolouring of the main one: the outer arc answers "how far
   * toward the target" and this answers "spent on what", and overloading
   * one arc with both makes neither readable.
   *
   * Never animated. Its lengths are fixed for a given day's data (unlike
   * `progress`, which re-targets continuously as a session ticks), so it's
   * a static reveal exactly like the track -- and animating a dozen slices
   * on every BLE status tick would be a lot of work to show nothing new. */
  segments?: RingSegment[];
}) {
  const reducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, progress));
  const anim = useRef(new Animated.Value(clamped)).current;

  const animatedTo = useRef(clamped);

  useEffect(() => {
    if (reducedMotion) {
      anim.setValue(clamped);
      animatedTo.current = clamped;
      return;
    }
    // A running countdown re-targets this on every BLE status tick (~1Hz),
    // and each of those steps is invisible: the swept arc is ~554px at the
    // default size, so a 25-minute session advances it by 0.37px per tick
    // and an hour-long one by 0.15px. Tweening that costs ~24 JS frames a
    // second -- strokeDashoffset cannot use the native driver (react-native-svg
    // #684), so every frame is an interpolate plus a prop write on the same
    // JS thread that handles touch -- for the entire length of the session,
    // to animate less than a pixel.
    //
    // So only animate a step big enough to see. PROGRESS_EPSILON is ~1px of
    // arc; a countdown tick lands under it and simply snaps, while the jumps
    // that actually read as motion (switching idle-ring source, a session
    // starting or ending) still get the 400ms timing DashboardScreen's old
    // linear meter used. Compared against the last TARGET rather than the
    // value's current position, so a run of sub-pixel ticks can't accumulate
    // into a visible lag.
    if (Math.abs(clamped - animatedTo.current) < PROGRESS_EPSILON) {
      anim.setValue(clamped);
      animatedTo.current = clamped;
      return;
    }
    animatedTo.current = clamped;
    Animated.timing(anim, { toValue: clamped, duration: 400, useNativeDriver: false }).start();
  }, [clamped, reducedMotion]);

  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  // See this file's header comment for the full derivation.
  const sweepDegrees = 360 - gapDegrees;
  const startAngle = 90 + gapDegrees / 2;
  const arcLength = circumference * (sweepDegrees / 360);

  // The topic-mix ring sits inside the main one with a small gap between
  // them, and is drawn thinner so it reads as secondary rather than as a
  // second equal ring competing for attention.
  const segmentStroke = Math.max(4, strokeWidth * 0.4);
  const segmentR = r - strokeWidth / 2 - segmentStroke / 2 - 4;
  const segmentCircumference = 2 * Math.PI * segmentR;
  const segmentArcLength = segmentCircumference * (sweepDegrees / 360);
  // Each slice is drawn as its own full-circumference dash pattern offset to
  // start where the previous one ended -- the same technique the Stats topic
  // ring uses, and the reason the running offset is accumulated here rather
  // than derived per index.
  let segmentOffset = 0;
  const segmentArcs =
    segments && segmentR > 0
      ? segments.map((seg) => {
          const length = segmentArcLength * Math.max(0, Math.min(1, seg.fraction));
          const dashOffset = segmentCircumference - segmentOffset - length;
          segmentOffset += length;
          return { key: seg.key, color: seg.color, length, dashOffset };
        })
      : [];

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={startAngle} originX={cx} originY={cy}>
          {/* Track -- a fixed reveal of the whole sweep (never animated):
              dasharray's "on" length is the full circumference so the same
              formula the progress arc uses below still applies, and a
              constant dashoffset of (circumference - arcLength) reveals
              exactly `arcLength` starting at this <G>'s rotated zero point,
              i.e. the whole sweep, gap included by omission. */}
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={trackColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference - arcLength}
          />
          {/* Progress -- identical dasharray/rotation as the track above, so
              its drawn arc always starts at the exact same point; only the
              revealed LENGTH changes with `progress`, animated between 0 (at
              progress 0) and `arcLength` (the full sweep, at progress 1).
              Interpolating the offset down to `circumference - arcLength`
              (never all the way to 0, unlike the pre-redesign full-circle
              version) is what keeps a filling ring from ever drawing past
              the sweep and into the gap. */}
          <AnimatedCircle
            cx={cx}
            cy={cy}
            r={r}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={anim.interpolate({
              inputRange: [0, 1],
              outputRange: [circumference, circumference - arcLength],
            })}
          />
          {/* Drawn after the progress arc so a segment can never be hidden
              under it -- they occupy different radii, but stacking order
              still decides which wins any antialiasing overlap at the
              boundary. */}
          {segmentArcs.map((seg) =>
            seg.length > 0 ? (
              <Circle
                key={seg.key}
                cx={cx}
                cy={cy}
                r={segmentR}
                stroke={seg.color}
                strokeWidth={segmentStroke}
                fill="none"
                // Butt, not round: adjacent slices with rounded caps overlap
                // each other by half a stroke width, which visibly eats the
                // smaller of any two neighbours.
                strokeLinecap="butt"
                strokeDasharray={`${segmentCircumference} ${segmentCircumference}`}
                strokeDashoffset={seg.dashOffset}
              />
            ) : null,
          )}
        </G>
      </Svg>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={styles.center}>{children}</View>
      </View>
      {bottomSlot ? (
        <View
          // Centered horizontally, anchored so its own vertical center lands
          // roughly on the ring's true bottom point (cx, cy + r) -- the
          // geometric center of the gap regardless of gapDegrees, since the
          // gap is always symmetric about 6 o'clock (see header comment).
          // The `-14` is a fixed visual nudge (half of BatteryBadge's own
          // ~28px row height), not a computed exact center -- "visually
          // filling the gap" doesn't need pixel-perfect centering, and
          // hardcoding half of one specific child's height would be more
          // fragile than a judgment-call constant.
          style={[styles.bottomSlot, { top: cy + r - 14 }]}
          pointerEvents="box-none"
        >
          {bottomSlot}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottomSlot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
