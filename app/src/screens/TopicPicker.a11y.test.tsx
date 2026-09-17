// TopicPicker.a11y.test.tsx -- the twelve colour swatches offered when
// saving a typed label as a real one all carried the same
// accessibilityLabel, "Save with this color".
//
// The swatches have no text and no shape of their own: the colour IS the
// content. Announcing all twelve identically leaves a VoiceOver user with a
// row of a dozen indistinguishable buttons and the only way to tell them
// apart -- looking -- removed. They also each commit the save, so the
// choice is not recoverable by tapping around to find out which was which.
// Settings > Custom labels' own swatch row (CustomLabelsSection.tsx's
// ColorSwatchRow) already announces `Color ${hex}`; this is the same
// palette, so it gets the same wording rather than a second convention.
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native-ble-plx', () => ({
  BleManager: class {
    onStateChange() {
      return { remove: jest.fn() };
    }
    startDeviceScan() {}
    stopDeviceScan() {}
    async state() {
      return 'PoweredOn';
    }
    async connectToDevice() {
      return {};
    }
    async cancelDeviceConnection() {}
  },
  State: {},
}));
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: null })),
  onAuthStateChanged: jest.fn(() => jest.fn()),
  signInWithCredential: jest.fn(),
  GoogleAuthProvider: { credential: jest.fn() },
  OAuthProvider: class {},
  signOut: jest.fn(),
  linkWithCredential: jest.fn(),
  unlink: jest.fn(),
  deleteUser: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
}));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

import { TopicPicker } from './TopicPicker';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { LABEL_SWATCHES } from '../stats/customLabels';

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <TopicPicker heading="Tag this session" currentTopic={null} customLabels={[]} themeMode="dark" onSelect={() => {}} />,
    );
  });
  mounted.push(tree!);
  return tree!;
}

function pressByLabel(tree: TestRenderer.ReactTestRenderer, accessibilityLabel: string) {
  const node = tree.root.find(
    (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === accessibilityLabel,
  );
  act(() => node.props.onPress());
}

/** Opens the save-as-label flow: type a name, then reveal the palette. */
function openSwatchRow(tree: TestRenderer.ReactTestRenderer) {
  const field = tree.root.find((n) => typeof n.props?.onChangeText === 'function');
  act(() => field.props.onChangeText('Deep work'));
  pressByLabel(tree, 'Save "Deep work" as a reusable label');
}

/** The palette buttons: the only pressables whose backgroundColor is one of
 * the swatch hexes. Matched by component type rather than by
 * "has an onPress": AnimatedPressable forwards every prop down to the
 * animated Pressable it wraps, so a props-based predicate finds each
 * button twice. */
function swatchLabels(tree: TestRenderer.ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(AnimatedPressable)
    .filter((n) => {
      const style = Array.isArray(n.props.style) ? Object.assign({}, ...n.props.style.filter(Boolean)) : n.props.style;
      return LABEL_SWATCHES.includes(style?.backgroundColor);
    })
    .map((n) => n.props.accessibilityLabel as string);
}

beforeEach(() => {
  useStore.setState({ sessions: [] } as never);
  useSettingsStore.setState({ hydrated: true, customLabels: [], excludedTopicKeys: [] } as never);
});

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
});

describe('the save-as-label colour palette', () => {
  it('offers one button per swatch', () => {
    const tree = mount();
    openSwatchRow(tree);

    expect(swatchLabels(tree)).toHaveLength(LABEL_SWATCHES.length);
  });

  it('announces each swatch distinctly', () => {
    const tree = mount();
    openSwatchRow(tree);

    const labels = swatchLabels(tree);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('names the colour, the way the Settings palette already does', () => {
    const tree = mount();
    openSwatchRow(tree);

    expect(swatchLabels(tree)).toEqual(LABEL_SWATCHES.map((hex) => `Color ${hex}`));
  });
});
