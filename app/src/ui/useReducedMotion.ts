// useReducedMotion.ts -- tracks the OS-level "reduce motion" accessibility
// setting so animated components can swap springs/timings for an instant
// equivalent instead of skipping feedback entirely (a toggle should still
// visibly flip, a press should still visibly react -- just without the
// moving parts). Nothing in this app read this setting before.
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

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
