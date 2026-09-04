// Sheet.tsx -- app-wide bottom-sheet primitive: a slide-up modal over a
// scrim, standing in for a screen that used to grow/shrink in place to show
// extra content (manager request: "screens shouldn't expand up and down,
// things should pop up more"). Built on RN core Modal + Animated +
// PanResponder, matching this app's existing hand-rolled house style
// (CalendarScreen's own LabelPickerModal sheet, WheelPicker's own
// drag/momentum handling) -- no react-native-gesture-handler/reanimated
// dependency, since this app deliberately has neither. This is the general
// version of LabelPickerModal's one-off sheet; new popups should use this
// instead of growing another bespoke Modal.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';
import { useReducedMotion } from './useReducedMotion';
import { overlay, radius, spacing, springs, typeScale } from '../theme/tokens';

// Same enter shape as CalendarScreen's LabelPickerModal sheet -- spring up
// from SHEET_TRAVEL px below rest -- so this app-wide primitive feels
// identical to the one-off it generalizes, not a second sheet feel living
// alongside it.
const SHEET_TRAVEL = 56;
const BACKDROP_OPACITY = 0.4;
const SHEET_SPRING = { ...springs.default, useNativeDriver: true };
// A swipe-down released past this many px, or fast enough, commits to a
// dismiss instead of springing back to rest -- mirrors a native sheet's own
// swipe-to-dismiss feel: a small accidental nudge snaps back, a real swipe
// goes all the way through.
const DISMISS_DISTANCE = 100;
const DISMISS_VELOCITY = 0.8;
// A committed dismiss rides the sheet the rest of the way OFF-screen rather
// than handing straight over to the `visible: false` effect below. That
// effect's exit target is SHEET_TRAVEL (56px), which is ABOVE where a real
// swipe has already dragged the sheet to -- so releasing a 200px drag used
// to yank the sheet ~150px back UP while it faded, reading as "it snapped
// back" rather than "it dismissed", i.e. as swipe-to-dismiss not working at
// all. The distance here is the sheet's own measured height, so the exit
// speed stays the same whether the sheet is short or tall.
const DISMISS_MS = 180;
// How far a drag must travel before the sheet BODY (as opposed to the
// grabber header, which claims any vertical drag) takes the gesture away
// from the content under the finger. Larger than the header's own 4px so an
// ordinary tap on a button in the body is never mistaken for a dismiss.
const BODY_DRAG_SLOP = 8;
// ...and how much more vertical than horizontal it has to be. The header only
// asks for `> 1x` because there is nothing in that strip to compete with; the
// body has to survive a drag that started on a horizontal control. Capture
// beats a descendant mid-gesture (that is the whole reason SliderRow in
// screens/SettingsPrimitives.tsx claims the capture phase itself -- see its
// comment about SettingsScreen's ScrollView stealing its drag), so at a bare
// 1x a slightly-diagonal slider drag inside the Box settings sheet would
// throw the sheet away in the middle of the adjustment. 2x still reads as
// "swipe down" for anyone actually meaning to.
const BODY_DRAG_VERTICAL_RATIO = 2;

export function Sheet({
  visible,
  onClose,
  onOpened,
  title,
  size = 'auto',
  scrollEnabled = true,
  dragBodyToDismiss = true,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fires once this sheet's own entrance transition actually finishes (or
   * immediately, for a reduced-motion open) -- NOT the same moment `visible`
   * flips true, which is only when the transition *starts*. Exists so a
   * caller that wants to present a SECOND, nested Sheet as a direct
   * consequence of this one opening (GoalsSection's own form Sheet, auto-
   * opened by StatsScreen's "Start adding goals" empty-state CTA) can wait
   * for this one to actually settle first, instead of both sheets' own
   * slide-up + backdrop-fade springs starting on the very same tick -- see
   * StatsScreen's openManageToCreate for the bug that caused (the inner
   * form's chips/wheels/buttons visibly overlapping the still-mid-transition
   * outer sheet, and the empty state behind both of them). */
  onOpened?: () => void;
  title?: string;
  /** How much of the screen this sheet may use AT MOST. Either size hugs its
   * own content: a two-row sheet is two rows tall, and only a sheet whose
   * content genuinely overflows grows to the cap and scrolls internally.
   * 'large' just raises that cap for content known to run long (the goal
   * form, a busy day's session list). It is NOT a fixed height -- it used to
   * set one, which is why every sheet carrying the prop (Account, Labels,
   * Box, Notifications, the tag picker, a quiet day's detail) opened as a
   * near-full-screen panel of mostly empty space no matter how little was
   * actually in it. The sheet never grows the underlying screen either way. */
  size?: 'auto' | 'large';
  /** Gates the body ScrollView's own `scrollEnabled` -- lets content that
   * embeds its own vertical scroller (e.g. a WheelPicker, see
   * screens/home/DurationSheet.tsx) disable this outer scroll for the
   * duration of a drag via WheelPicker's onDragStart/onDragEnd, the same
   * "outer scroll must yield to an inner one mid-gesture" fix
   * DashboardScreen's lockOuterScroll/unlockOuterScroll already applies to
   * its own screen ScrollView -- two nested vertical scrollers fighting
   * over one drag is exactly the freeze WheelPicker's own onDragStart/
   * onDragEnd doc comment calls out. Defaults to true (ordinary content
   * with no competing scroller of its own). */
  scrollEnabled?: boolean;
  /** Whether a downward drag anywhere in the BODY dismisses the sheet, on top
   * of the grabber header (which always does). Defaults to true, which is
   * what makes the sheet feel native -- you flick the thing itself away
   * instead of having to find a 4px handle.
   *
   * Pass false when the body embeds its own vertical scroller that owns drags
   * of its own. Body dismissal has to claim the gesture in the CAPTURE phase
   * to beat the body ScrollView's rubber-band, and capture beats a nested
   * WheelPicker too -- so leaving it on for a wheel sheet means the wheel can
   * never be spun at all, every attempt just throws the sheet away.
   * `scrollEnabled` cannot stand in for this: it only goes false once the
   * wheel's own onDragStart has fired, and that never happens if this
   * responder took the gesture first. Every WheelPicker-bearing sheet in the
   * app passes false (SettingsScreen's goals + notifications, StatsScreen's
   * manage sheet, GoalsSection's form, DurationSheet, SessionReminderForm). */
  dragBodyToDismiss?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  // Read live rather than captured once at module load: a module-level
  // Dimensions.get('window') is evaluated at import time and never updates,
  // so on rotation (or an iPad split-view resize) every sheet went on sizing
  // itself against the launch orientation's height.
  const { height: windowHeight } = useWindowDimensions();
  // Stays mounted through the exit animation, then unmounts -- same
  // "presented" pattern as LabelPickerModal, so <Modal> itself doesn't cut
  // the slide-down short.
  const [presented, setPresented] = useState(visible);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(SHEET_TRAVEL)).current;
  // Mirrors sheetY's live value outside of Animated's own internals (which
  // have no public getter) -- the swipe-to-dismiss PanResponder below needs
  // to know where the sheet currently sits (it may be mid-spring on a fast
  // re-open/close) to drag relative to that instead of always assuming 0.
  const sheetYValue = useRef(SHEET_TRAVEL);
  // The PanResponders below are built once and kept (rebuilding one
  // mid-gesture drops the gesture), so they must not close over props or
  // state directly: they would keep answering with the values from the render
  // that created them. Everything they need goes through this ref instead.
  const latest = useRef({ onClose, reducedMotion, scrollEnabled, dragBodyToDismiss });
  const sheetHeight = useRef(0);
  const bodyAtTop = useRef(true);

  useEffect(() => {
    latest.current = { onClose, reducedMotion, scrollEnabled, dragBodyToDismiss };
  }, [onClose, reducedMotion, scrollEnabled, dragBodyToDismiss]);

  useEffect(() => {
    const id = sheetY.addListener(({ value }) => {
      sheetYValue.current = value;
    });
    return () => sheetY.removeListener(id);
  }, [sheetY]);

  useEffect(() => {
    if (visible) {
      setPresented(true);
      // RN's Modal renders null while hidden, so the body ScrollView is
      // genuinely unmounted between presentations and comes back at offset 0.
      // This ref lives on the Sheet itself, which never unmounts, and is only
      // ever written by onScroll -- so without this it stays at whatever the
      // LAST presentation scrolled to. Scroll a long sheet down, close it via
      // the grabber or the backdrop, reopen: the body is visibly at the top
      // but the capture gate still believes it isn't, and body swipe-to-
      // dismiss is dead. It self-corrects only once a scroll event fires
      // again, which for content too short to scroll never happens at all.
      bodyAtTop.current = true;
      if (reducedMotion) {
        backdropOpacity.setValue(BACKDROP_OPACITY);
        sheetY.setValue(0);
        onOpened?.();
        return;
      }
      Animated.parallel([
        Animated.spring(backdropOpacity, { toValue: BACKDROP_OPACITY, ...SHEET_SPRING }),
        Animated.spring(sheetY, { toValue: 0, ...SHEET_SPRING }),
      ]).start(({ finished }) => {
        if (finished) onOpened?.();
      });
      return;
    }
    if (reducedMotion) {
      backdropOpacity.setValue(0);
      sheetY.setValue(SHEET_TRAVEL);
      setPresented(false);
      return;
    }
    Animated.parallel([
      Animated.spring(sheetY, { toValue: SHEET_TRAVEL, ...SHEET_SPRING }),
      Animated.spring(backdropOpacity, { toValue: 0, ...SHEET_SPRING }),
    ]).start(({ finished }) => {
      if (finished) setPresented(false);
    });
  }, [visible, reducedMotion, backdropOpacity, sheetY]);

  // Rides a committed swipe the rest of the way down and only then tells the
  // caller to close, so the sheet leaves along the direction the finger was
  // already moving. The `visible: false` effect above still runs afterwards
  // (springing sheetY back to SHEET_TRAVEL, then unmounting), but by then the
  // backdrop -- and with it the sheet, which shares its opacity -- has
  // already faded to 0, so none of that is visible.
  const dismissWithMomentum = useCallback(() => {
    if (latest.current.reducedMotion) {
      latest.current.onClose();
      return;
    }
    Animated.parallel([
      Animated.timing(sheetY, {
        toValue: Math.max(sheetHeight.current, SHEET_TRAVEL),
        duration: DISMISS_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: DISMISS_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) latest.current.onClose();
    });
  }, [backdropOpacity, sheetY]);

  // Shared drag mechanics for both responders below -- the grabber header and
  // the body differ only in WHEN each decides to take the gesture.
  const dragHandlers = useMemo(() => {
    const dragStartY = { current: 0 };
    const springBack = () => {
      Animated.spring(sheetY, { toValue: 0, ...SHEET_SPRING }).start();
    };
    return {
      onPanResponderGrant: () => {
        dragStartY.current = sheetYValue.current;
      },
      onPanResponderMove: (_: unknown, g: { dy: number }) => {
        sheetY.setValue(Math.max(0, dragStartY.current + g.dy)); // can't drag up past rest
      },
      onPanResponderRelease: (_: unknown, g: { dy: number; vy: number }) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
          dismissWithMomentum();
          return;
        }
        springBack();
      },
      onPanResponderTerminate: springBack,
      // Once the sheet is following the finger, nothing underneath gets to
      // take the gesture back mid-drag.
      onPanResponderTerminationRequest: () => false,
    };
  }, [dismissWithMomentum, sheetY]);

  // The grabber/title header: any vertical drag here is a sheet drag, since
  // there is nothing else in that strip to interact with.
  const headerPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        ...dragHandlers,
      }),
    [dragHandlers],
  );

  // The body: a clear DOWNWARD drag dismisses, but only from a body already
  // scrolled to the top (otherwise the drag is the user scrolling back up
  // through the content) and only for content with no inner scroller of its
  // own -- see `dragBodyToDismiss`. Capture-phase, because the body
  // ScrollView would otherwise rubber-band the drag itself.
  const bodyPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) =>
          latest.current.dragBodyToDismiss &&
          latest.current.scrollEnabled &&
          bodyAtTop.current &&
          g.dy > BODY_DRAG_SLOP &&
          g.dy > Math.abs(g.dx) * BODY_DRAG_VERTICAL_RATIO,
        ...dragHandlers,
      }),
    [dragHandlers],
  );

  const onBodyScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    bodyAtTop.current = e.nativeEvent.contentOffset.y <= 0;
  }, []);

  const onSheetLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    // Measured so a committed swipe knows how far "all the way off the
    // bottom" actually is for THIS sheet.
    sheetHeight.current = e.nativeEvent.layout.height;
  }, []);

  const sheetOpacity = backdropOpacity.interpolate({
    inputRange: [0, BACKDROP_OPACITY],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const maxHeight = windowHeight * (size === 'large' ? 0.9 : 0.8);

  return (
    <Modal visible={presented} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.scrim, { opacity: backdropOpacity }]}>
        <Pressable
          style={styles.scrimTouch}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.sheetLayer, { opacity: sheetOpacity, transform: [{ translateY: sheetY }] }]}
      >
        <View
          onLayout={onSheetLayout}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              paddingBottom: insets.bottom + spacing.lg,
              maxHeight,
            },
          ]}
        >
          <View {...headerPan.panHandlers} style={styles.header}>
            <View style={[styles.grabber, { backgroundColor: theme.textDim }]} />
            {title ? <Text style={[styles.title, { color: theme.text }]}>{title}</Text> : null}
          </View>
          <View {...bodyPan.panHandlers} style={styles.bodyWrap}>
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              scrollEnabled={scrollEnabled}
              onScroll={onBodyScroll}
              scrollEventThrottle={16}
              // A sheet body that contains a TextInput (TopicPicker's one-time
              // tag field, CustomLabelsSection's name field) would otherwise
              // swallow the first tap on any button beside it -- the tap only
              // dismisses the keyboard. 'handled' lets the child's own press
              // win while a plain tap on empty body space still dismisses.
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: overlay.scrim },
  scrimTouch: { flex: 1 },
  sheetLayer: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  header: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm },
  grabber: { width: 36, height: 4, borderRadius: radius.pill, opacity: 0.4 },
  title: { ...typeScale.sectionTitle, marginTop: spacing.sm },
  // flexShrink:1 is load-bearing, not cosmetic, and has to be on BOTH the
  // ScrollView and the drag wrapper now standing between it and the sheet: a
  // wrapper left at RN's default flexShrink:0 would refuse to give back the
  // overflow no matter what the ScrollView inside it did. RN defaults both
  // flexGrow and flexShrink to 0, so with only `flexGrow: 0` this ScrollView
  // measured to its full CONTENT height and overflowed the sheet's own
  // `maxHeight`. The sheet's `overflow: 'hidden'` then clipped the bottom
  // off, and -- because the ScrollView's own frame was as tall as its content
  // -- it believed it had nothing to scroll, so the clipped part was simply
  // unreachable. That's what made a tall sheet (the goal form: chips + three
  // target wheels + session stepper + reminder wheels + Save/Cancel) look
  // like it "almost fits" while the last rows and the submit button could
  // never be scrolled to. flexShrink:1 lets it give back the overflow, at
  // which point it has real scrollable overflow and behaves. flexGrow stays 0
  // so a SHORT sheet still hugs its content instead of stretching to fill.
  bodyWrap: { flexGrow: 0, flexShrink: 1 },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
});
