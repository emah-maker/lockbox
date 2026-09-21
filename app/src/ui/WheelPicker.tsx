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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
// Outlasts one animated scrollTo (UIScrollView's own ~300ms, Android's
// smoothScrollTo ~250ms). Only a backstop: correctingRef below is normally
// cleared by the trailing onMomentumScrollEnd that corrective scroll fires
// when it lands, and this just guarantees the flag can't stick if some
// platform/version declines to emit that event for a programmatic scroll.
const CORRECTION_SETTLE_MS = 400;
// (Needs no distance scaling: commit() derives its target index by ROUNDING
// the release position to the nearest item, so a correction never travels
// more than half an itemSize -- ~20px at the default -- however many items
// the wheel has. It is always a short animation.)

// isBusyRef's own backstops, the mirror of CORRECTION_SETTLE_MS above.
// isBusyRef is set the instant a drag begins and cleared ONLY inside
// commit(), which runs only from onScrollEndDrag/onMomentumScrollEnd. If
// neither ever arrives -- a flick whose trailing momentum event a platform
// declines to emit, or a drag whose native gesture recognizer is CANCELLED
// rather than ended (cancellation doesn't invoke the end-dragging delegate
// callback at all) -- isBusyRef stays true for the life of the component and
// the resync effect below silently no-ops on every future selectedIndex
// change. That is a permanently dead wheel: it stops tracking its own prop,
// which is the "wheel picker still freezes sometimes" report these two
// constants exist to make unreachable. correctingRef always had this
// safeguard; isBusyRef never did.
// After the finger is up (onScrollEndDrag deferring to momentum) the coast is
// this component's own bounded animation, so a short window suffices.
const BUSY_SETTLE_MS = 900;
// While a finger may still be down, only a long watchdog is safe -- a real
// scrub of a long wheel can legitimately last seconds, and clearing the flag
// under a live touch is what re-opens the scrollTo-vs-drag fight. Chosen long
// enough that a genuine drag effectively never trips it, but finite so a
// cancelled gesture can't wedge the wheel forever.
const BUSY_MAX_DRAG_MS = 4000;
// ...but "effectively never" was a probability argument, not a guarantee, and
// it loses: the Override-presses wheel is ~100 steps, and a deliberate slow
// scrub of the hour wheel passes 4s without trying. When it lost, the
// watchdog did the exact damage it exists to prevent -- fireDragEnd() handed
// the caller's scroll lock back under a live finger, and forceResync() let
// the resync effect fire a scrollTo into the touch still driving the view.
//
// So the deadline is no longer measured from the START of the gesture. It is
// measured from the last sign of LIFE: onScroll fires at scrollEventThrottle
// (16ms) for every frame the view actually moves, drag and momentum alike, so
// a gesture that is still happening keeps saying so. endBusy re-arms itself on
// this shorter window whenever the last frame is recent, and only speaks for a
// gesture that has genuinely gone quiet. That makes a mid-drag trip
// unreachable rather than unlikely, AND makes a real dropped release recover
// in ~this long instead of waiting out the full window above.
const BUSY_ACTIVITY_MS = 300;
// How often a live drag re-asserts the CALLER's lock (useWheelScrollLock's
// own BUSY_MAX_DRAG_MS window, armed once at onDragStart and never refreshed
// -- the same start-relative deadline, and so the same mid-drag expiry, as
// the watchdog above had). Re-claiming turns that window into a rolling one
// without touching any call site: every onDragStart handler in the app does
// nothing but `onWheelActiveChange(true, 'drag')`, which is idempotent --
// re-arming a deadline and setting an already-true boolean React then bails
// on. Comfortably inside the shortest window it has to keep alive, and rare
// enough (once a second, against a 16ms scroll event) to cost nothing.
const LOCK_RENEW_MS = 1000;

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
  // Captured once, at mount -- see the contentOffset prop below for why this
  // must not track `selectedIndex`. Held in a ref so even the object identity
  // is stable across renders.
  const initialOffset = useRef(
    horizontal ? { x: selectedIndex * itemSize, y: 0 } : { x: 0, y: selectedIndex * itemSize },
  ).current;
  const settledIndexRef = useRef(selectedIndex);
  // True from the moment a finger touches this wheel until its settle
  // (drag-release commit, or the momentum coast that follows a flick) has
  // fully resolved -- guards the external-resync effect just below from
  // calling scrollTo() while a live touch (or its own momentum) is still
  // driving the same ScrollView. That fight -- an imperative scrollTo
  // landing mid-gesture -- is exactly the "controlled value fighting a
  // drag" class of glitch this component exists to avoid (see WheelPicker's
  // own bounce-vs-manual-snap comment in commit() below for the sibling bug
  // of the same shape).
  const isBusyRef = useRef(false);
  // True while commit()'s *own* corrective scrollTo() is still animating.
  // isBusyRef alone can't cover that window: scrollTo() has no completion
  // callback, so commit() used to clear isBusyRef in the very same tick it
  // *started* the correction, calling that settle "fully resolved" while it
  // was still in flight. The resync effect below then saw an unguarded wheel,
  // and if commit()'s onChange landed on a different selectedIndex in the
  // next render -- routine here, via a paired wheel's clamp (GoalForm's
  // setDaysClamped, DashboardScreen's 0h00m guard) or a box-sync tick -- it
  // fired a second animated scrollTo into the middle of the first. Two
  // imperative scrolls fighting over one ScrollView is the same shape as the
  // bounce-vs-manual-snap fight commit() already guards against below:
  // visible jitter between the two targets, or a wedged gesture responder
  // that reads as the wheel freezing.
  const correctingRef = useRef(false);
  const correctingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The resync effect below is skipped while a correction runs, and the
  // render that would let it catch up afterwards may never arrive on its own
  // -- a correction's trailing onMomentumScrollEnd is deduped by committedRef
  // into a no-op, so it changes no state and schedules no render. Forcing one
  // here is what keeps a deferred resync from being a dropped one (which
  // would strand the wheel showing an index the caller had already rejected).
  const [, forceResync] = useReducer((n: number) => n + 1, 0);

  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the CURRENT gesture has already fired onDragEnd. Reset at
  // onScrollBeginDrag, set by every path that releases -- so endBusy below
  // can tell "the finger lifted and I already told the caller" from "no end
  // event ever arrived", and only speak up in the second case. Without it,
  // the ordinary dropped-momentum path (where onScrollEndDrag has already
  // released) fired a SECOND onDragEnd up to 900ms later, which on a paired
  // wheel row (hours + minutes share one lock) lands as a release of
  // whichever sibling drag is live by then.
  const dragEndFiredRef = useRef(false);

  // When the scroll view last actually moved -- the liveness signal endBusy
  // measures its deadline from. Written by the onScroll listener below.
  const lastScrollAtRef = useRef(0);
  // When this drag last re-claimed the caller's lock (see LOCK_RENEW_MS).
  const lockRenewedAtRef = useRef(0);
  // Read through a ref so noteScrollActivity below can stay dependency-free.
  const onDragStartRef = useRef(onDragStart);
  useEffect(() => {
    onDragStartRef.current = onDragStart;
  }, [onDragStart]);
  // Stable by construction: it touches nothing but refs, and the
  // Animated.event it is handed to MUST keep its identity across renders
  // (see the onScroll memo's own comment on AnimatedProps' identity keying).
  const noteScrollActivity = useCallback(() => {
    const now = Date.now();
    lastScrollAtRef.current = now;
    // Only while a finger is actually down: isBusyRef set with no onDragEnd
    // yet is exactly that window, and momentum frames after the release must
    // NOT keep extending a lock the caller was already told to drop.
    if (!isBusyRef.current || dragEndFiredRef.current) return;
    if (now - lockRenewedAtRef.current < LOCK_RENEW_MS) return;
    lockRenewedAtRef.current = now;
    onDragStartRef.current?.();
  }, []);

  const fireDragEnd = () => {
    if (dragEndFiredRef.current) return;
    dragEndFiredRef.current = true;
    onDragEnd?.();
  };

  const cancelCorrecting = () => {
    correctingRef.current = false;
    if (correctingTimerRef.current) {
      clearTimeout(correctingTimerRef.current);
      correctingTimerRef.current = null;
    }
  };

  const endCorrecting = () => {
    if (!correctingRef.current) return;
    cancelCorrecting();
    forceResync();
  };

  // Claim the ScrollView for an imperative animated scroll and arm the
  // backstop that guarantees the claim can't outlive it. EVERY animated
  // scrollTo in this component must go through here: an animated scroll owns
  // the view for its whole ~250-300ms duration, and a second one issued
  // before the first lands is the "two imperative scrolls fighting over one
  // ScrollView" wedge documented on correctingRef above. Normally cleared by
  // the trailing onMomentumScrollEnd the scroll fires when it lands, which
  // re-enters commit() with pos already on the snap point.
  const beginCorrecting = () => {
    correctingRef.current = true;
    if (correctingTimerRef.current) clearTimeout(correctingTimerRef.current);
    correctingTimerRef.current = setTimeout(endCorrecting, CORRECTION_SETTLE_MS);
  };

  // Marks the wheel busy and (re-)arms the backstop that guarantees the flag
  // can't outlive the gesture -- see BUSY_SETTLE_MS/BUSY_MAX_DRAG_MS.
  const beginBusy = (ms: number) => {
    isBusyRef.current = true;
    if (busyTimerRef.current) clearTimeout(busyTimerRef.current);
    busyTimerRef.current = setTimeout(endBusy, ms);
  };

  const clearBusy = () => {
    isBusyRef.current = false;
    if (busyTimerRef.current) {
      clearTimeout(busyTimerRef.current);
      busyTimerRef.current = null;
    }
  };

  // The settle that should have cleared isBusyRef never arrived. Drop the
  // guard and force the render the resync effect needs, so the wheel catches
  // up to whatever selectedIndex it was ignoring while wedged -- the same
  // deferred-not-dropped handoff endCorrecting() does for correctingRef.
  //
  // Releases the caller's lock too, because this is the only thing that runs
  // when a native gesture is CANCELLED rather than ended: cancellation
  // invokes neither onScrollEndDrag nor onMomentumScrollEnd, so onDragEnd
  // never fired and the lock would be left for the CALLER's backstop to
  // rescue -- and that backstop has to be long (see useWheelScrollLock's
  // BUSY_MAX_DRAG_MS window) precisely so a legitimate long scrub can't trip
  // it. Releasing here bounds the cancelled case to this component's own
  // watchdog, which is the thing that actually knows the gesture is over.
  //
  // Routed through fireDragEnd so it speaks ONLY for a gesture that never
  // ended: see dragEndFiredRef for why a second release is not harmless on a
  // paired wheel row.
  const endBusy = () => {
    if (!isBusyRef.current) return;
    // The view moved within the last BUSY_ACTIVITY_MS, so this gesture is
    // alive and this deadline is simply too early -- a long scrub, not a
    // dropped release. Re-arm on the short window and ask again; nothing
    // below may run while a finger can still be down (see BUSY_ACTIVITY_MS).
    if (Date.now() - lastScrollAtRef.current < BUSY_ACTIVITY_MS) {
      beginBusy(BUSY_ACTIVITY_MS);
      return;
    }
    clearBusy();
    fireDragEnd();
    forceResync();
  };

  // Belt-and-suspenders: neither safety timer must outlive the component.
  useEffect(
    () => () => {
      cancelCorrecting();
      clearBusy();
    },
    [],
  );

  // Dedupes a single physical release from committing twice. With
  // snapToInterval set, iOS keeps running its own momentum/settle pass to
  // glide to the snap point even after a release velocity near zero -- so
  // onScrollEndDrag's low-velocity branch below can call commit() directly,
  // and onMomentumScrollEnd (always wired to commit) still fires right
  // after for the very same settle. Without this, that shows up as a
  // doubled haptic tap and onChange firing twice per turn of the wheel.
  // Cleared at the start of every new drag so a genuinely separate gesture
  // still commits normally.
  const committedRef = useRef<number | null>(null);

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
  // Skipped entirely while isBusyRef is set: a re-render landing mid-drag
  // (e.g. the paired wheel's own onChange, or a box-sync tick arriving)
  // must not scrollTo() this wheel out from under the live touch. Once the
  // touch/momentum settles, onDragEnd's caller-side state update (see
  // DashboardScreen's lockOuterScroll/unlockOuterScroll) triggers the next
  // render this effect needs to actually catch up.
  // Skipped while correctingRef is set for the same reason: commit()'s own
  // corrective scroll is an imperative animation on this very ScrollView, so
  // scrolling again before it lands is the same fight as interrupting a drag.
  // endCorrecting() forces the render that re-runs this once it does land.
  // This effect's OWN scroll is claimed through beginCorrecting() for exactly
  // the same reason: it is an animated scrollTo, so it owns the view for the
  // couple hundred ms it runs, and until it was guarded this was the one
  // scrollTo in the component that could be re-entered while still in flight
  // -- a second external `selectedIndex` change arriving inside that window
  // fired a second overlapping scrollTo onto the same ScrollView, which is
  // the gesture-responder wedge (i.e. the frozen picker) that correctingRef
  // exists to prevent everywhere else.
  //
  // Reachable from an HOURS drag in particular: hours is the only wheel whose
  // onChange rewrites its SIBLING's value (DashboardScreen's 0h00m guard
  // bumps minutes to 5), so one hours commit forces a value change on an idle
  // wheel that has neither isBusyRef nor correctingRef set -- and the
  // box-sync tick is a second, drag-independent source that can land on the
  // same wheel a moment later. Dragging minutes never writes hours, so the
  // minutes-only path never stacked two forced scrolls this way.
  //
  // Deferred, not dropped: endCorrecting()'s forceResync() re-runs this once
  // the in-flight scroll lands (or once CORRECTION_SETTLE_MS rescues it), and
  // settledIndexRef still holds the older index, so the comparison below
  // catches up to whatever the latest selectedIndex turned out to be.
  useEffect(() => {
    if (isBusyRef.current || correctingRef.current) return;
    if (settledIndexRef.current === selectedIndex) return;
    settledIndexRef.current = selectedIndex;
    beginCorrecting();
    scrollToIndex(selectedIndex, true);
  });

  // Memoized so the native scroll subscription survives a re-render.
  //
  // With useNativeDriver an Animated.event is attached to the native scroll
  // view by node id, and RN's AnimatedProps memo keys non-style props by
  // IDENTITY -- so a fresh handler every render meant detaching and
  // re-attaching that subscription every render. The detach/attach pair is
  // queued into one NativeAnimatedHelper batch, so it drops no scroll frames
  // on its own; the cost it was actually paying is below, in itemStyles,
  // whose graphs were being torn down in the same swap.
  //
  // Memoizing this handler alone does NOT hold, which is why contentContainer
  // and children are memoized alongside it: they are keyed by identity too,
  // so one inline object literal or one inline labels.map() is enough to make
  // the whole composite key unequal and recreate AnimatedProps regardless of
  // how stable this handler is.
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: horizontal ? { x: scrollPos } : { y: scrollPos } } }], {
        useNativeDriver: true,
        // Still delivered in JS alongside the native attach: AnimatedEvent's
        // __getHandler() returns _callListeners as the JS handler when
        // __isNative, so the native driver keeps owning the animation while
        // this only stamps a timestamp. That is the whole cost -- no state,
        // no render -- and it is what lets endBusy tell a long scrub from a
        // gesture that died.
        listener: noteScrollActivity,
      }),
    [horizontal, scrollPos, noteScrollActivity],
  );

  const contentContainerStyle = useMemo(
    () => (horizontal ? { paddingHorizontal: PAD } : { paddingVertical: PAD }),
    [horizontal, PAD],
  );

  const maxOffset = (labels.length - 1) * itemSize;

  // One Animated style per item, built once per wheel GEOMETRY (how many
  // items, how tall) and never rebuilt for a mere re-render.
  //
  // Same mechanism as onScroll above, and the more visible half of the same
  // bug. Each of these is a native animated node graph -- subtract, then two
  // interpolations -- attached to one Animated.View. Building them inline in
  // the render body handed every item a brand-new graph on every render, and
  // Animated tears the old one down and attaches the new one, which for a
  // 24-item hour wheel is 72 node swaps. Mid-drag renders are not an edge
  // case here; they are how the call sites work:
  //   - the enclosing sheet's scroll-lock state flipping (ClockWheels.tsx and
  //     useWheelScrollLock below),
  //   - a paired wheel's onChange (dragging hours rewrites the minute value),
  //   - forceResync() from either backstop.
  // So the swap reliably happened WHILE a finger was moving, and the frames
  // spent detached are frames where the items don't move: a stall, then a
  // snap to wherever the scroll had got to. That is the freeze this wheel's
  // many earlier gesture-responder fixes never touched, because it was never
  // a gesture bug at all.
  //
  // Keyed on labels.LENGTH rather than `labels`: the label strings are drawn
  // by the Text below and have no bearing on the geometry, while the array
  // identity changes on every render at any call site that derives its labels
  // inline (NotificationsSection's minute labels used to be exactly that).
  const itemCount = labels.length;
  const itemStyles = useMemo(
    () =>
      Array.from({ length: itemCount }, (_, i) => {
        const distance = Animated.subtract(scrollPos, i * itemSize);
        const inputRange = [-itemSize * 2, -itemSize, 0, itemSize, itemSize * 2];
        return {
          opacity: distance.interpolate({
            inputRange,
            outputRange: [0.25, 0.55, 1, 0.55, 0.25],
            extrapolate: 'clamp',
          }),
          transform: [
            {
              scale: distance.interpolate({
                inputRange,
                outputRange: [0.82, 0.92, 1, 0.92, 0.82],
                extrapolate: 'clamp',
              }),
            },
          ],
        };
      }),
    [itemCount, itemSize, scrollPos],
  );

  const commit = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // A settle that arrives while a finger is still down is not this
    // gesture's settle -- it is the trailing onMomentumScrollEnd of an
    // ANIMATED scrollTo the new touch abandoned. cancelCorrecting() at
    // onScrollBeginDrag clears our flag, but it cannot cancel an animation
    // already running inside the native scroll view, so that animation lands
    // a few hundred ms later and calls in here mid-drag.
    //
    // Every other guard in this component is on ISSUING a scroll. This is
    // the one on ACTING ON a completion event for a scroll that no longer
    // has an owner, and it is the last way the wheel could still hurt
    // itself: such a call committed an index the finger was merely passing
    // through (firing onChange with it), issued its own corrective scrollTo
    // UNDER the live touch, and then -- via clearBusy() below -- disarmed
    // the BUSY_MAX_DRAG_MS watchdog, so this gesture's onDragEnd never fired
    // at all and the caller's scroll lock was left to the hook's own
    // backstop to rescue.
    //
    // On the Dashboard that phantom onChange is not merely cosmetic: it
    // writes pick -> pickSeconds -> setDuration() to the box over BLE, the
    // box echoes the wrong duration back, and DashboardScreen's box-sync
    // effect mirrors it in as a fresh external selectedIndex -- which is the
    // precondition for this very bug. Left open, it re-arms itself.
    //
    // isBusyRef is set the instant a drag begins and dragEndFiredRef is
    // cleared alongside it, so the pair reads exactly "a drag began and the
    // finger has not lifted". A real momentum settle cannot happen in that
    // window: onScrollEndDrag always runs first, and it always fires
    // fireDragEnd() before deferring to momentum.
    if (isBusyRef.current && !dragEndFiredRef.current) return;
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
    // Checked before this settle is marked committed below -- a corrective
    // scrollTo here is itself an animated scroll, so it can trigger its own
    // trailing onMomentumScrollEnd once it finishes. Marking `index` as
    // committed first turns that follow-up call into the ordinary
    // already-committed no-op below, instead of a second, spurious commit.
    const alreadyCommitted = committedRef.current === index;
    if (Math.abs(pos - snappedPos) > 0.5 && pos >= -0.5 && pos <= maxOffset + 0.5) {
      // Hold the resync effect off until this correction actually lands --
      // see correctingRef's own comment. Cleared by the trailing
      // onMomentumScrollEnd this scroll fires, which re-enters commit() with
      // pos already on the snap point and so takes the else branch below.
      beginCorrecting();
      scrollToIndex(index, true);
    } else {
      endCorrecting();
    }
    committedRef.current = index;
    settledIndexRef.current = index;
    // The touch and its momentum are done. A corrective scroll may still be
    // animating, but that's correctingRef's job to cover, not this flag's.
    // Disarms the backstop too: the settle arrived on its own, so there's
    // nothing left for it to rescue.
    clearBusy();
    if (alreadyCommitted) return; // see committedRef's own comment -- the other event already handled this exact settle
    if (index !== selectedIndex) {
      Haptics.selectionAsync();
      onChange(index);
    }
  };

  // The item views, memoized for the same identity reason as onScroll above:
  // an inline labels.map() is a new array every render, which alone is enough
  // to invalidate AnimatedProps' composite key and undo itemStyles' whole
  // point. Depends on everything actually rendered here and nothing else --
  // note itemStyles is itself memoized, so it does not re-trigger this.
  const items = useMemo(
    () =>
      labels.map((label, i) => (
        <Animated.View
          key={`${label}-${i}`}
          style={[
            styles.item,
            horizontal ? { width: itemSize, height: '100%' } : { height: itemSize },
            itemStyles[i],
          ]}
        >
          <Text style={[styles.itemText, itemTextStyle, { color: theme.text }]}>{label}</Text>
        </Animated.View>
      )),
    [labels, horizontal, itemSize, itemStyles, itemTextStyle, theme.text],
  );

  // VoiceOver/TalkBack's increment/decrement gestures on an "adjustable"
  // element -- the accessible equivalent of a one-step drag. Scrolls the
  // wheel to match, same as the external-value re-sync effect above, so a
  // screen-reader user sees the same visual state a sighted drag would leave.
  const changeBy = (delta: number) => {
    const next = Math.max(0, Math.min(labels.length - 1, selectedIndex + delta));
    if (next === selectedIndex) return;
    cancelCorrecting(); // this explicit scroll supersedes any in-flight correction
    settledIndexRef.current = next;
    // Marks `next` committed the same way a drag's own commit() does, before
    // this scrollTo(next, true) is even issued: an ANIMATED scrollTo fires
    // its own trailing onMomentumScrollEnd once it lands, which re-enters
    // commit() with pos already parked exactly on `next`'s snap point. If a
    // caller REJECTS this change (feeds back the same `selectedIndex` it
    // already had, e.g. GoalForm's clamp), that trailing event is the only
    // thing that still runs commit(), and without this it found
    // `index !== selectedIndex` still true (the reverted prop never caught
    // up to `next`) and fired a second, spurious onChange(next) plus a
    // second haptic tap for one single VoiceOver increment. Pre-marking
    // committedRef here turns that trailing call into the ordinary
    // already-committed no-op, same as commit()'s own dedupe for a drag.
    committedRef.current = next;
    // Claimed like every other animated scroll here (see beginCorrecting) --
    // onChange(next) below can land a new selectedIndex on this wheel in the
    // very next render, and without the claim the resync effect would fire a
    // second scrollTo into the middle of this one.
    beginCorrecting();
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
        contentContainerStyle={contentContainerStyle}
        // INITIAL parking position only -- deliberately frozen at its mount
        // value, never recomputed from the live `selectedIndex`. RN forwards
        // this straight through to the native scroll view as an ordinary prop
        // (only experimental_endDraggingSensitivityMultiplier is stripped), so
        // React re-sends it on any render where the value changed and the
        // native side repositions the content there. That made it a SECOND,
        // fully unguarded channel driving the same ScrollView the resync
        // effect above guards so carefully: `selectedIndex` changing mid-drag
        // is routine here (a paired wheel's clamp, a box-sync tick -- see that
        // effect's own comment), and while the effect correctly skipped its
        // scrollTo, this prop repositioned the view under the live touch
        // anyway. Beyond the visible jump, a native pan recognizer whose view
        // is moved out-of-band by something other than the gesture can end up
        // CANCELLED rather than ended -- and cancellation never fires
        // onScrollEndDrag/onMomentumScrollEnd, so commit() never ran, isBusyRef
        // stayed set, and the wheel silently ignored `selectedIndex` from then
        // on. That's the "still freezes sometimes" report: every earlier fix
        // hardened the imperative scrollTo path, which was never the whole
        // story. Position after mount is owned solely by scrollToIndex().
        contentOffset={initialOffset}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          beginBusy(BUSY_MAX_DRAG_MS);
          dragEndFiredRef.current = false; // a fresh gesture gets a fresh release
          // A new touch supersedes any correction still in flight from the
          // last one; cancel rather than end it, since this drag will drive
          // the next commit anyway and forcing a resync render mid-gesture
          // would be pure noise.
          cancelCorrecting();
          committedRef.current = null; // a fresh gesture -- the dedupe below must not carry over from the last one
          lockRenewedAtRef.current = Date.now(); // the claim below IS this gesture's first renewal
          onDragStart?.();
        }}
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
          fireDragEnd();
          const velocity = horizontal ? e.nativeEvent.velocity?.x : e.nativeEvent.velocity?.y;
          if (Math.abs(velocity ?? 0) > DRAG_SETTLE_VELOCITY) {
            // Handing this settle to onMomentumScrollEnd -- which is exactly
            // the event some platforms decline to emit for a flick. Re-arm the
            // backstop on the short post-release window now that the finger is
            // off the screen, so a dropped momentum event can no longer leave
            // isBusyRef set for the life of the component.
            beginBusy(BUSY_SETTLE_MS);
            return;
          }
          commit(e);
        }}
      >
        {items}
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

/** Which half of the gesture handoff is asking for the lock. A bare touch on
 * a wheel row may never become a drag, so it gets a short backstop; a drag
 * this wheel has actually captured gets a long one. See useWheelScrollLock. */
export type WheelLockPhase = 'touch' | 'drag';

// Backstop for the PRE-drag window. A touch that lands on a wheel row and
// never becomes a drag is released by the row's own onTouchEnd/-Cancel, so
// this only has to cover one of those being dropped -- it can stay short.
const LOCK_TAP_SETTLE_MS = 600;

/**
 * The outer-scroll lock every WheelPicker-in-a-scroller call site needs:
 * `wheelActive` drives the enclosing ScrollView's `scrollEnabled`, so an
 * ancestor sharing the wheel's scroll axis yields while a wheel is being
 * dragged (see this component's own onDragStart/onDragEnd comments for why
 * that handoff has to exist at all).
 *
 * Hoisted out of the three hand-rolled copies that had it -- SettingsScreen,
 * home/DurationSheet, calendar/SessionReminderForm -- because all three had
 * the SAME defect, and fixing it in one of them would only have left the
 * other two wrong: they armed a single 600ms backstop from whichever signal
 * arrived first, so any drag lasting longer than 600ms tripped it MID-DRAG.
 * Two things then went wrong at once, and both of them read as freezing:
 *
 *   1. The ancestor's scrollEnabled came back under a live finger, so the
 *      ancestor could steal the rest of the gesture -- the wheel stopped
 *      following the drag and the sheet moved instead.
 *   2. The state flip re-rendered the wheels mid-drag, which (before the
 *      memoization above) rebuilt their native animated graphs and stalled
 *      the item scale/opacity animation outright.
 *
 * The fix is to pick the backstop from the phase: LOCK_TAP_SETTLE_MS while a
 * touch might still be a tap, BUSY_MAX_DRAG_MS once a wheel reports a real
 * drag -- the same figure this component uses for its own drag watchdog, and
 * long enough that a genuine scrub can't reach it. Still finite, so a dropped
 * release (the app backgrounded mid-drag by an incoming call, where RN
 * promises no synthetic touch-end) cannot leave a sheet unscrollable for
 * good, which is what the backstop was for.
 */
export function useWheelScrollLock(): {
  /** Feed straight to the enclosing ScrollView's `scrollEnabled` as `!wheelActive`. */
  wheelActive: boolean;
  /** The `onWheelActiveChange(active, phase)` callback to hand to wheel rows. */
  setWheelActive: (active: boolean, phase?: WheelLockPhase) => void;
} {
  const [wheelActive, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which window the armed backstop belongs to. Needed because a 'touch' can
  // arrive while a 'drag' is already live -- a second finger landing on the
  // wheel row -- and re-arming the short window there would resurrect exactly
  // the mid-drag unlock this hook exists to remove. A phase only ever
  // escalates; it is cleared on release.
  const phaseRef = useRef<WheelLockPhase | null>(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  // Must not outlive the component: a backstop firing after unmount sets
  // state on a dead tree.
  useEffect(() => clear, []);

  const setWheelActive = (active: boolean, phase: WheelLockPhase = 'touch') => {
    if (!active) {
      clear();
      phaseRef.current = null;
      setActive(false);
      return;
    }
    // Already holding the long window -- leave it alone. Re-arming it from a
    // second touch would restart a 4s watchdog that is already running, and
    // re-arming the SHORT one would cut the live drag's guard to 600ms.
    if (phaseRef.current === 'drag' && phase === 'touch') {
      setActive(true);
      return;
    }
    clear();
    phaseRef.current = phase;
    setActive(true);
    timer.current = setTimeout(() => {
      phaseRef.current = null;
      setActive(false);
    }, phase === 'drag' ? BUSY_MAX_DRAG_MS : LOCK_TAP_SETTLE_MS);
  };

  return { wheelActive, setWheelActive };
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
