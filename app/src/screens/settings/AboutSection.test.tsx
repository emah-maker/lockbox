// AboutSection.test.tsx -- guards the one thing in this app that is an App
// Store requirement rather than a product decision.
//
// App Store Review Guideline 5.1.1(i): an app that creates accounts and
// stores user data must link its privacy policy from inside the app, in an
// easily accessible place -- not only in App Store Connect metadata. Losing
// that link is not a visible regression: nothing looks broken, no test that
// exists for another reason fails, and the app keeps working perfectly until
// Beta App Review rejects the build. So it gets a test of its own.
//
// Both mount points are covered, because "easily accessible" is what makes
// two of them necessary in the first place: signing in is optional in this
// app, so the Account page's "Data & privacy" section (which only exists once
// you are signed in) cannot be the only place the link lives. The Settings
// hub's About sheet is the one reachable either way.
import React from 'react';
import { Linking } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { AboutSection } from './AboutSection';
import { DataPrivacySection } from '../account/DataPrivacySection';
import { PRIVACY_POLICY_URL } from '../../legal/legalLinks';
import { resolveTheme } from '../../theme/theme';

// Same stand-in GoalReminderControl.test.tsx/SettingsScreen.test.tsx use:
// jest-expo's expo-font mock trips over @expo/vector-icons' own font-loaded
// check outside a real native runtime.
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const theme = resolveTheme('dark', 'mint');

const mounted: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  // Same reasoning GoalForm.test.tsx's own `mounted` gives: AnimatedPressable
  // leaves pending Animated timings that fire after Jest tears the
  // environment down.
  while (mounted.length) act(() => mounted.pop()!.unmount());
  jest.restoreAllMocks();
});

function render(node: React.ReactElement) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(node);
  });
  mounted.push(tree!);
  return tree!;
}

/**
 * The link is found by its accessibility ROLE and label rather than its
 * rendered text: those two are what a reviewer using VoiceOver -- and the
 * guideline's "easily accessible" -- actually depend on.
 *
 * Returns the outermost match. AnimatedPressable forwards these props down
 * through its Animated.View to the host view, so one link is several matching
 * nodes in the test tree; `[0]` is the component that owns the onPress.
 */
function findPrivacyLink(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    (n) => n.props?.accessibilityRole === 'link' && n.props?.accessibilityLabel === 'Privacy Policy',
  );
}

describe('privacy policy link (App Store Review Guideline 5.1.1(i))', () => {
  it('is reachable from the Settings hub About sheet, signed in or not', () => {
    const tree = render(<AboutSection color={theme} />);
    expect(findPrivacyLink(tree).length).toBeGreaterThan(0);
  });

  it('is reachable from the Account page Data & privacy section', () => {
    const tree = render(<DataPrivacySection color={theme} />);
    expect(findPrivacyLink(tree).length).toBeGreaterThan(0);
  });

  it('opens the deployed policy URL, not a placeholder', async () => {
    // A link to a 404 is itself a rejection (Guideline 2.1, broken links), so
    // what matters is the exact URL -- website/privacy.html is the page that
    // has to be deployed for it to resolve.
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const tree = render(<AboutSection color={theme} />);

    await act(async () => {
      findPrivacyLink(tree)[0].props.onPress();
    });

    expect(openURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
    expect(PRIVACY_POLICY_URL).toMatch(/^https:\/\//);
  });

  it('does not crash the screen when the system browser refuses to open', async () => {
    // openExternalUrl swallows this deliberately -- a leaf action no caller
    // can do anything better about. What this asserts is that the rejection
    // stays swallowed: onPress is fire-and-forget (it returns undefined, not
    // a promise), so an unhandled rejection here would surface as a crash in
    // the app rather than as a failed await.
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tree = render(<AboutSection color={theme} />);

    await act(async () => {
      expect(() => findPrivacyLink(tree)[0].props.onPress()).not.toThrow();
    });

    expect(warn).toHaveBeenCalled(); // the failure is reported, not silent
  });
});
