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
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';
import { useReducedMotion } from './useReducedMotion';
import { overlay, radius, spacing, springs, typeScale } from '../theme/tokens';

// Same enter/exit shape as CalendarScreen's LabelPickerModal sheet -- spring
// up from SHEET_TRAVEL px below rest, and back down the same path on
// dismiss -- so this app-wide primitive feels identical to the one-off it
// generalizes, not a second sheet feel living alongside it.
const SHEET_TRAVEL = 56;
const BACKDROP_OPACITY = 0.4;
const SHEET_SPRING = { ...springs.default, useNativeDriver: true };
// A swipe-down released past this many px, or fast enough, commits to a
// dismiss instead of springing back to rest -- mirrors a native sheet's own
// swipe-to-dismiss feel: a small accidental nudge snaps back, a real swipe
// goes all the way through.
const DISMISS_DISTANCE = 100;
const DISMISS_VELOCITY = 0.8;
const WINDOW_HEIGHT = Dimensions.get('window').height;

export function Sheet({
  visible,
  onClose,
  title,
  size = 'auto',
  scrollEnabled = true,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** 'auto' (default) hugs its content, capped so it can never exceed the
   * screen; 'large' takes a fixed ~85% of screen height. Either way the
   * sheet's own body scrolls internally -- the sheet never grows the
   * underlying screen. */
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
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
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

  useEffect(() => {
    const id = sheetY.addListener(({ value }) => {
      sheetYValue.current = value;
    });
    return () => sheetY.removeListener(id);
  }, [sheetY]);

  useEffect(() => {
    if (visible) {
      setPresented(true);
      if (reducedMotion) {
        backdropOpacity.setValue(BACKDROP_OPACITY);
        sheetY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.spring(backdropOpacity, { toValue: BACKDROP_OPACITY, ...SHEET_SPRING }),
        Animated.spring(sheetY, { toValue: 0, ...SHEET_SPRING }),
      ]).start();
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

  // Swipe-down-to-dismiss, scoped to the grabber/title header only (below),
  // not the whole sheet -- the body needs its own vertical ScrollView for
  // long content, and a single PanResponder spanning both would be exactly
  // the two-scrollers-fighting-over-one-gesture problem WheelPicker's own
  // comments describe for the Dashboard's picker-vs-screen scroll.
  const dragStartY = useRef(0);
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        dragStartY.current = sheetYValue.current;
      },
      onPanResponderMove: (_, g) => {
        sheetY.setValue(Math.max(0, dragStartY.current + g.dy)); // can't drag up past rest
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
          onClose();
          return;
        }
        Animated.spring(sheetY, { toValue: 0, ...SHEET_SPRING }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(sheetY, { toValue: 0, ...SHEET_SPRING }).start();
      },
    }),
  ).current;

  const sheetOpacity = backdropOpacity.interpolate({
    inputRange: [0, BACKDROP_OPACITY],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const maxHeight = WINDOW_HEIGHT * (size === 'large' ? 0.85 : 0.8);

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
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              paddingBottom: insets.bottom + spacing.lg,
              maxHeight,
              height: size === 'large' ? maxHeight : undefined,
            },
          ]}
        >
          <View {...panResponder.panHandlers} style={styles.header}>
            <View style={[styles.grabber, { backgroundColor: theme.textDim }]} />
            {title ? <Text style={[styles.title, { color: theme.text }]}>{title}</Text> : null}
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            scrollEnabled={scrollEnabled}
          >
            {children}
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: overlay.scrim },
  scrimTouch: { flex: 1 },
  sheetLayer: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  header: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm },
  grabber: { width: 36, height: 4, borderRadius: radius.pill, opacity: 0.4 },
  title: { ...typeScale.sectionTitle, marginTop: spacing.sm },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
});
