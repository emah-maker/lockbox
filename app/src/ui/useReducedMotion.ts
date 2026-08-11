// useReducedMotion.ts -- tracks the OS-level "reduce motion" accessibility
// setting so animated components can swap springs/timings for an instant
// equivalent instead of skipping feedback entirely (a toggle should still
// visibly flip, a press should still visibly react -- just without the
// moving parts). Nothing in this app read this setting before.
import { useEffect, useState } from 'react';
import { AccessibilityInfo, LayoutAnimation } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

// configureLayoutAnimation -- every implicit-layout transition in this app
// (tab switch, month nav, list show/hide) called
// `LayoutAnimation.configureNext` directly and unconditionally; unlike
// `Animated.timing`/`.spring`, LayoutAnimation has no built-in reduced-motion
// opt-out, so those transitions kept moving even with the OS setting on. This
// wraps the same call and no-ops under reduced motion -- the layout change
// still happens (React re-renders in the new state), it just snaps instead of
// animating, matching how `AnimatedPressable`/`useDisabledFade` already treat
// reduced motion elsewhere in this app.
export function configureLayoutAnimation(reducedMotion: boolean) {
  if (reducedMotion) return;
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}
