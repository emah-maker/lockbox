// AlertsSection.test.tsx -- guards the two things in this sheet that are
// about what a stranger sees, not about what the toggles do.
//
// The call diagnostics panel is developer instrumentation that deliberately
// ships in store builds (calls/callDiagnostics.ts explains why __DEV__ would
// be the wrong gate), so the only thing keeping it away from TestFlight
// testers and App Review is that it stays hidden until held for. That is one
// `useState` away from regressing silently: nothing looks broken when a debug
// panel is visible, so it gets a test.
//
// Same for the unavailable-call-detection caption, which in its developing
// form tells the reader to go run `npx expo prebuild`.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AlertsSection } from './AlertsSection';
import { resolveTheme } from '../../theme/theme';

// Same stand-in AboutSection.test.tsx/SettingsScreen.test.tsx use: jest-expo's
// expo-font mock trips over @expo/vector-icons' own font-loaded check outside
// a real native runtime.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Feather: 'Feather', MaterialIcons: 'MaterialIcons' }));

const theme = resolveTheme('dark', 'mint');

const mounted: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  while (mounted.length) act(() => mounted.pop()!.unmount());
});

function render(props: Partial<React.ComponentProps<typeof AlertsSection>> = {}) {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <AlertsSection
        color={theme}
        autoConnect
        setAutoConnect={() => {}}
        callAlertsEnabled
        setCallAlertsEnabled={() => {}}
        callDetectionAvailable
        lastAlert={null}
        {...props}
      />,
    );
  });
  mounted.push(tree!);
  return tree!;
}

/** Every string the sheet actually puts on screen, flattened. */
function renderedText(tree: TestRenderer.ReactTestRenderer): string {
  const walk = (node: unknown): string[] => {
    if (typeof node === 'string') return [node];
    if (Array.isArray(node)) return node.flatMap(walk);
    if (node && typeof node === 'object' && 'children' in node) {
      return walk((node as { children: unknown }).children);
    }
    return [];
  };
  return walk(tree.toJSON()).join(' ');
}

/**
 * The reveal gesture, found by shape rather than by component name: it is the
 * wrapper that takes a long press while staying out of the accessibility tree
 * (so VoiceOver lands on the Switch inside it instead). Outermost match owns
 * the handler, same as AboutSection.test.tsx's link lookup.
 */
function findRevealTarget(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    (n) => typeof n.props?.onLongPress === 'function' && n.props?.accessible === false,
  )[0];
}

describe('call diagnostics panel visibility', () => {
  it('stays hidden on a fresh mount, so testers and App Review never meet it', () => {
    expect(renderedText(render())).not.toContain('Call detection diagnostics');
  });

  it('appears once the call-alerts row is held', () => {
    const tree = render();
    act(() => findRevealTarget(tree).props.onLongPress());

    expect(renderedText(tree)).toContain('Call detection diagnostics');
  });

  it('holds long enough that a fumbled tap on the Switch cannot reach it', () => {
    expect(findRevealTarget(render()).props.delayLongPress).toBeGreaterThanOrEqual(1000);
  });
});

describe('unavailable call detection caption', () => {
  const unavailable = { callAlertsEnabled: true, callDetectionAvailable: false };

  it('keeps build instructions out of a release build', () => {
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      const text = renderedText(render(unavailable));

      expect(text).not.toContain('prebuild');
      expect(text).not.toContain('Expo Go');
      expect(text).toContain("Call detection isn't available on this device");
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
    }
  });

  it('still gives the developer the recipe while developing', () => {
    expect(renderedText(render(unavailable))).toContain('prebuild');
  });
});
