// a11y.ts -- small accessibility prop helpers, so the two-platform props that
// must always move together stop being written out (and inverted) by hand.
import type { AccessibilityProps } from 'react-native';

/** Hides a subtree from VoiceOver/TalkBack without touching layout.
 *
 * Exists because "invisible" and "not announced" are separate things: a view
 * hidden with `opacity: 0` -- the trick this app uses wherever a card must
 * reserve its height regardless of content -- is still read out in full by
 * both screen readers. Muting it takes two props, one per platform, and they
 * are expressed in opposite shapes (a boolean on iOS, a string enum on
 * Android), which is exactly how a hand-written pair ends up disagreeing.
 * One argument, both platforms, no way to invert only half of it. */
export function a11yHidden(hidden: boolean): AccessibilityProps {
  return {
    accessibilityElementsHidden: hidden,
    importantForAccessibility: hidden ? 'no-hide-descendants' : 'auto',
  };
}
