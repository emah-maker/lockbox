// CalendarScreen.deeplink.test.tsx -- the inbound `navigate('calendar',
// { calendarDate })` deep link (Stats -> a trend bar -> a session row's
// "view in Calendar") has to land on the day it was handed, not the one
// before it.
//
// A NavIntent.calendarDate is a dayKey: a LOCAL calendar day rendered as
// 'YYYY-MM-DD' (stats/sessionHistory.ts's dayKey, which builds it out of
// getFullYear/getMonth/getDate). `new Date('2026-03-01')` is the one Date
// constructor that reads a bare date-only string as UTC midnight, so west of
// UTC that instant is still the previous local evening -- the screen selected
// the day before the one Stats pointed at, and on the 1st of a month it also
// paged the grid back a whole month. dayKeyToDate exists for exactly this
// round trip and this screen already uses it elsewhere.
//
// The zone is pinned in-process rather than inherited from whatever machine
// runs this: in UTC the two parses agree and this test would pass against the
// bug it exists to catch. In-process because a `TZ=...` command prefix is
// silently dropped by the shell this repo's tests are usually launched from
// (Git Bash on Windows), so the env var has to be set from inside Node.
process.env.TZ = 'America/Los_Angeles';

import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Same "native modules this environment doesn't have" set screens.smoke.test.tsx
// installs, and for the same reason: none of them is what this test is about,
// they just let the tree exist.
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
import { DaySheet } from './calendar/DaySheet';
import { useNav } from '../nav/useNav';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useScheduleStore } from '../store/useScheduleStore';

const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 47, left: 0, right: 0, bottom: 34 };

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <CalendarScreen />
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree!);
  return tree!;
}

/** The month the grid is paged to, read the way the header renders it, so
 * this comparison stays locale-independent (only the MONTH is under test). */
function monthHeaderOf(tree: TestRenderer.ReactTestRenderer) {
  return tree.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => n.props.children)
    .filter((child): child is string => typeof child === 'string' && /\d{4}$/.test(child))[0];
}

function monthLabelFor(y: number, monthIndex: number) {
  return new Date(y, monthIndex, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

beforeEach(() => {
  jest.useFakeTimers();
  useStore.setState({ sessions: [], status: null, conn: 'idle', currentTopic: null, pendingBoxTopic: null } as never);
  useGoalsStore.setState({ hydrated: true, goals: [] } as never);
  useSettingsStore.setState({ hydrated: true, customLabels: [], excludedTopicKeys: [] } as never);
  useScheduleStore.setState({ hydrated: true, scheduled: [], deletedIds: {} } as never);
  useNav.setState({ tab: 'dashboard', intent: null });
});

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
  jest.useRealTimers();
});

test('the pinned zone actually took, or nothing below proves anything', () => {
  // Both parses agree in UTC, so a run that silently stayed there would pass
  // every assertion below while the bug was still present. Fail loudly here
  // instead of vacuously passing there.
  expect(new Date(2026, 2, 1).getTimezoneOffset()).toBeGreaterThan(0);
});

describe('navigate("calendar", { calendarDate })', () => {
  it('selects the day it was handed, not the previous one', () => {
    useNav.getState().navigate('calendar', { calendarDate: '2026-03-14' });
    const tree = mount();

    const sheet = tree.root.findByType(DaySheet);
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.dateKey).toBe('2026-03-14');
  });

  it('pages the grid to the linked day\'s own month, even on the 1st', () => {
    // The 1st is where the off-by-one day also becomes an off-by-one MONTH:
    // UTC midnight on the 1st is the last evening of the month before, so the
    // grid opened on February with a March day sheet's worth of nothing.
    useNav.getState().navigate('calendar', { calendarDate: '2026-03-01' });
    const tree = mount();

    expect(tree.root.findByType(DaySheet).props.dateKey).toBe('2026-03-01');
    expect(monthHeaderOf(tree)).toBe(monthLabelFor(2026, 2));
    expect(monthHeaderOf(tree)).not.toBe(monthLabelFor(2026, 1));
  });
});
