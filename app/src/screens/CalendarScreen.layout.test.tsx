// CalendarScreen.layout.test.tsx -- the month grid has to fit the width it
// is given. The whole point of this screen's onLayout-driven sizing (see
// CalendarScreen.tsx's header) is "fits on one page"; a grid wider than the
// page it sits on is the one outcome that sizing must never produce.
//
// There is no iOS runtime on this machine, so this argues the layout from
// the numbers rather than a screenshot -- which is all the arithmetic needs:
// the grid is `width: cellSize * 7` centered inside a container with a known
// paddingHorizontal, and both of those are readable off the rendered tree.
// The device widths below are every iPhone this portrait-only, phone-only
// app (app.json: orientation "portrait", supportsTablet false) actually runs
// on, narrowest first.
import TestRenderer, { act } from 'react-test-renderer';
import { Dimensions, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Same "native modules this environment doesn't have" set
// screens.smoke.test.tsx installs, for the same reason.
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
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

import CalendarScreen from './CalendarScreen';
import { DAY_CELL_CONTENT_HEIGHT } from '../ui/calendar/DayCell';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useScheduleStore } from '../store/useScheduleStore';
import { useNav } from '../nav/useNav';

/** Every iPhone width this app can be launched at, in points, portrait.
 * 375 is the narrowest still-supported one (SE 2nd/3rd gen, 13 mini); 440
 * is the widest (16 Pro Max). */
const IPHONE_WIDTHS = [375, 390, 393, 402, 414, 428, 430, 440];

/** A roomy, entirely ordinary vertical budget: a ~844pt-tall phone leaves
 * this screen's root about 660pt after StatusStrip/tab bar/safe areas, and
 * this screen's own chrome above and below the grid takes the rest. Chosen
 * generous ON PURPOSE -- with height in plentiful supply, the width term is
 * the only thing that can be deciding cellSize, which is exactly the term
 * under test. */
const ROOMY_LAYOUT = { root: 660, above: 110, below: 90 };

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount(width: number) {
  // The screen reads its width from useWindowDimensions, which is backed by
  // Dimensions -- NOT by the SafeAreaProvider frame below (that only feeds
  // useSafeAreaInsets). React Native's own jest setup leaves Dimensions on a
  // 750x1334 placeholder, wide enough that every clamp under test here is
  // trivially satisfied, so the device width has to be pushed in here.
  Dimensions.set({
    window: { width, height: 844, scale: 3, fontScale: 1 },
    screen: { width, height: 844, scale: 3, fontScale: 1 },
  });
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width, height: 844 },
          // Portrait-locked, so left/right insets are 0 on every iPhone --
          // the notch/Dynamic Island only ever costs vertical space here.
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <CalendarScreen />
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree!);
  return tree!;
}

/** Feeds the three heights this screen measures for itself (its own root,
 * the chrome above the grid, the chrome below it) -- until these arrive the
 * screen deliberately runs a width-only fallback, so nothing about the real
 * clamp is observable before this. In tree order: container, aboveGrid,
 * belowGrid (the only other onLayout in reach belongs to Sheet, and both
 * sheets are closed here, so their Modals render null). */
function reportLayout(tree: TestRenderer.ReactTestRenderer, { root, above, below }: typeof ROOMY_LAYOUT) {
  const nodes = tree.root.findAll((n) => typeof n.type === 'string' && typeof n.props?.onLayout === 'function');
  const send = (i: number, height: number) =>
    nodes[i].props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 0, height } } });
  act(() => {
    send(0, root);
    send(1, above);
    send(2, below);
  });
}

/** The grid container's own rendered width, and the content width its
 * parent actually has for it -- both read off the tree rather than
 * recomputed from copies of the screen's private constants, so this test
 * keeps meaning the same thing if those constants are retuned. */
function widths(tree: TestRenderer.ReactTestRenderer, deviceWidth: number) {
  const hosts = tree.root.findAll((n) => typeof n.type === 'string');
  const grid = hosts
    .map((n) => StyleSheet.flatten(n.props.style) as Record<string, unknown>)
    .find((s) => s && s.flexWrap === 'wrap' && s.flexDirection === 'row' && typeof s.width === 'number');
  const container = hosts
    .map((n) => StyleSheet.flatten(n.props.style) as Record<string, unknown>)
    .find((s) => s && typeof s.paddingHorizontal === 'number' && s.flex === 1);
  return {
    grid: grid!.width as number,
    content: deviceWidth - 2 * (container!.paddingHorizontal as number),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  useStore.setState({ sessions: [], status: null, conn: 'idle', currentTopic: null, pendingBoxTopic: null } as never);
  useGoalsStore.setState({ hydrated: true, goals: [] } as never);
  useSettingsStore.setState({ hydrated: true, customLabels: [], excludedTopicKeys: [] } as never);
  useScheduleStore.setState({ hydrated: true, scheduled: [], deletedIds: {} } as never);
  useNav.setState({ tab: 'calendar', intent: null });
});

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
  jest.useRealTimers();
});

describe('the month grid never outgrows the screen', () => {
  it.each(IPHONE_WIDTHS)('fits inside its own padded container at %ipt', (deviceWidth) => {
    const tree = mount(deviceWidth);
    reportLayout(tree, ROOMY_LAYOUT);

    const { grid, content } = widths(tree, deviceWidth);
    // A cell floor above everything (deviceWidth - padding)/7 can offer
    // always wins its own Math.max, so the grid rendered at a constant
    // 7 * floor regardless of the phone -- wider than the content box on
    // every single one of these, spilling past the screen edge on the
    // narrow ones and clipping the Sunday/Saturday columns.
    expect(grid).toBeLessThanOrEqual(content);
  });

  it('lines the weekday header up with the columns it labels', () => {
    // The header is a full-content-width row of seven flex:1 labels, so the
    // two only agree when the grid is exactly the content width. With
    // height in plentiful supply nothing else should be shrinking it, and a
    // grid that is merely "not too wide" would still leave S and S pointing
    // at empty space.
    const deviceWidth = 390;
    const tree = mount(deviceWidth);
    reportLayout(tree, ROOMY_LAYOUT);

    const { grid, content } = widths(tree, deviceWidth);
    expect(grid).toBeCloseTo(content, 5);
  });

  it.each(IPHONE_WIDTHS)('still leaves room for DayCell\'s fixed glyphs at %ipt', (deviceWidth) => {
    // The other half of the same constraint, and the reason the fix above
    // could not be "just cap the width": cells are square (DayCell's
    // aspectRatio 1), and DayCell's ring + topic stack + streak dots are
    // fixed pixel sizes that do not scale down with the cell. Capping the
    // width without making that stack fit would have traded a grid off the
    // side of the screen for cells whose contents spill into the rows above
    // and below. This is the check that says both can be true at once on
    // every phone -- and, unlike the old hand-copied "54px" in a comment,
    // it reads the footprint from DayCell itself, so it stays true.
    const tree = mount(deviceWidth);
    reportLayout(tree, ROOMY_LAYOUT);

    expect(widths(tree, deviceWidth).grid / 7).toBeGreaterThanOrEqual(DAY_CELL_CONTENT_HEIGHT);
  });

  it('still fits before the first onLayout has reported anything', () => {
    // The pre-measurement fallback is a different branch (width-only, no
    // height budget to clamp against yet) and has to respect the same
    // ceiling -- a one-frame flash of an over-wide grid is still an
    // over-wide grid.
    const deviceWidth = 375;
    const tree = mount(deviceWidth);

    const { grid, content } = widths(tree, deviceWidth);
    expect(grid).toBeLessThanOrEqual(content);
  });
});
