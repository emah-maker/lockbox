// GoalRow.midnight.test.tsx -- GoalRow calls `goalWindow(goal.period,
// Date.now())` during render rather than reading ui/useNowMs.ts, which
// exists precisely to close that hole (see its header) and which
// screens/stats/GoalsProgressView.tsx and screens/home/useHomeGoalRing.ts
// both use. The caption that window feeds is the goal row's own date line
// -- the weekday for a daily goal, "Week of ..." for a weekly, the month
// name for a monthly -- so a clock read once and never again would leave
// Settings > Goals, left open across local midnight, still naming
// yesterday.
//
// Which is the question this file answers, at the level the claim is
// actually about: GoalRow does not render alone. GoalsSection renders it,
// and GoalsSection DOES call useNowMs (for computeGoalProgress), so the
// whole list re-renders on that hook's tick and GoalRow's own Date.now()
// is re-read with it. A test of GoalRow in isolation would "fail" only by
// constructing a mounting that the app never performs.
//
// The zone is pinned in-process (same reasoning as
// CalendarScreen.deeplink.test.tsx): a midnight test has to know where
// midnight is. The clock is then parked a few seconds before it.
process.env.TZ = 'America/Los_Angeles';

import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', DATE: 'date' },
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

import { GoalsSection } from './GoalsSection';
import { useStore } from '../store/useStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveTheme } from '../theme/theme';
import { DEFAULT_NOW_MS_INTERVAL } from '../ui/useNowMs';

const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 47, left: 0, right: 0, bottom: 34 };
const theme = resolveTheme('dark', 'mint');

/** 2026-03-10 is a Tuesday in the pinned zone. Ten seconds before its
 * local midnight, so one useNowMs tick lands on the Wednesday. */
const BEFORE_MIDNIGHT = new Date(2026, 2, 10, 23, 59, 50).getTime();

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <GoalsSection color={theme} onWheelActiveChange={() => {}} />
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree!);
  return tree!;
}

/** The goal row's date caption -- the only weekday name on screen. */
function weekdayCaption(tree: TestRenderer.ReactTestRenderer): string | undefined {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return tree.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => n.props.children)
    .find((child): child is string => typeof child === 'string' && days.includes(child));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(BEFORE_MIDNIGHT);
  // react-native/jest/setup.js leaves AppState.currentState as an
  // unconfigured jest.fn(), and useNowMs only starts its interval while
  // 'active' -- set it the same way useNowMs.test.tsx does.
  (AppState as unknown as { currentState: string }).currentState = 'active';
  useStore.setState({ sessions: [] } as never);
  useSettingsStore.setState({ hydrated: true, customLabels: [], excludedTopicKeys: [] } as never);
  useGoalsStore.setState({
    hydrated: true,
    goals: [
      {
        id: 'g1',
        topic: null,
        period: 'daily',
        targetS: 3600,
        createdAt: BEFORE_MIDNIGHT - 86_400_000,
        updatedAt: BEFORE_MIDNIGHT - 86_400_000,
        archived: false,
      },
    ],
  } as never);
});

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('Settings > Goals left open across local midnight', () => {
  it('renames a daily goal\'s window without being touched', () => {
    const tree = mount();
    expect(weekdayCaption(tree)).toBe('Tuesday');

    // One useNowMs interval, which is the only thing in this app that ever
    // ticks. GoalsSection re-renders off it, which is what re-reads
    // GoalRow's own Date.now() -- the row's clock read is impure, but it is
    // never the last word on when the row re-renders.
    act(() => {
      jest.advanceTimersByTime(DEFAULT_NOW_MS_INTERVAL + 1000);
    });

    expect(weekdayCaption(tree)).toBe('Wednesday');
  });
});
