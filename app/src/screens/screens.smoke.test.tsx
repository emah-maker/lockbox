// screens.smoke.test.tsx -- mounts the three top-level screens that had no
// test of their own (Dashboard, Stats, Calendar; SettingsScreen has its own
// file) against realistic store state, and against the awkward states that
// only ever show up on a real device: an empty install, a session log with
// nothing tagged, a tag pointing at a deleted custom label, and a box
// reporting an unavailable battery.
//
// A render crash on any of these is not hypothetical -- these screens are
// where every one of this app's derived-data modules (stats, goals, topics,
// heat levels, ring state) is finally composed together, and none of that
// composition was exercised anywhere before. Each screen is also its tab's
// entire content (App.tsx renders exactly one), so a throw here is a blank
// tab the user cannot navigate out of.
//
// The mocks below are the same "native modules this environment doesn't have"
// set SettingsScreen.test.tsx installs, and for the same reason: none of them
// is what this test is about, they just let the tree exist.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signIn: jest.fn(), signOut: jest.fn() },
  statusCodes: {},
}));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  AppleAuthenticationScope: {},
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
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Feather: 'Feather', MaterialIcons: 'MaterialIcons' }));

import DashboardScreen from './DashboardScreen';
import StatsScreen from './StatsScreen';
import CalendarScreen from './CalendarScreen';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useScheduleStore } from '../store/useScheduleStore';
import { dayKey, type LoggedSession } from '../stats/sessionHistory';

const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 47, left: 0, right: 0, bottom: 34 };

const SCREENS: [string, React.ComponentType][] = [
  ['DashboardScreen', DashboardScreen],
  ['StatsScreen', StatsScreen],
  ['CalendarScreen', CalendarScreen],
];

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const session = (daysAgo: number, actualS: number, topic?: string): LoggedSession => ({
  startedAt: NOW - daysAgo * DAY,
  plannedS: actualS,
  actualS,
  outcome: 'completed',
  ...(topic ? { topic } : {}),
});

function mountAll(label: string) {
  for (const [name, Screen] of SCREENS) {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      act(() => {
        tree = TestRenderer.create(
          <SafeAreaProvider initialMetrics={{ frame, insets }}>
            <Screen />
          </SafeAreaProvider>,
        );
      });
      // Rendered something, rather than an empty tree from a swallowed throw.
      expect(tree!.toJSON()).toBeTruthy();
    } catch (e) {
      throw new Error(`${name} threw while rendering (${label}): ${(e as Error).message}`);
    } finally {
      act(() => {
        tree?.unmount();
      });
    }
  }
}

/** Puts every store this screen set reads into a known state. Set directly
 * rather than through each store's hydrate(), so a case is exactly the state
 * it names and nothing else. */
function setState(over: {
  sessions?: LoggedSession[];
  goals?: ReturnType<typeof useGoalsStore.getState>['goals'];
  customLabels?: { id: string; name: string; color: string }[];
  status?: ReturnType<typeof useStore.getState>['status'];
  scheduled?: ReturnType<typeof useScheduleStore.getState>['scheduled'];
}) {
  useStore.setState({
    sessions: over.sessions ?? [],
    status: over.status ?? null,
    conn: over.status ? 'connected' : 'idle',
    currentTopic: null,
    pendingBoxTopic: null,
  });
  useGoalsStore.setState({ hydrated: true, goals: over.goals ?? [] });
  useSettingsStore.setState({ hydrated: true, customLabels: over.customLabels ?? [] });
  useScheduleStore.setState({ hydrated: true, scheduled: over.scheduled ?? [], deletedIds: {} });
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test('render on a brand-new install with no data at all', () => {
  setState({});
  mountAll('empty install');
});

test('render with a realistic tagged history, goals, and a connected box', () => {
  setState({
    sessions: [
      session(0, 1500, 'work'),
      session(0, 3600, 'custom:reading'),
      session(1, 2700, 'study'),
      session(6, 1800, 'work'),
      session(40, 900, 'exercise'),
    ],
    goals: [
      { id: 'g1', topic: null, period: 'daily', targetS: 3600, createdAt: NOW - DAY, updatedAt: NOW - DAY, archived: false },
      { id: 'g2', topic: 'work', period: 'weekly', targetS: 18000, createdAt: NOW - DAY, updatedAt: NOW - DAY, archived: false },
    ],
    customLabels: [{ id: 'custom:reading', name: 'Reading', color: '#2563eb' }],
    status: { st: 'running', rem: 600, set: 1500, bat: 72, tp: 'work', fw: '1.2.0' },
  });
  mountAll('populated');
});

test('render when every session is untagged', () => {
  // Every breakdown/donut/dominant-topic path returns empty here, which is a
  // different code path from "no sessions at all" above.
  setState({ sessions: [session(0, 1500), session(2, 1800)] });
  mountAll('untagged history');
});

test('render when a session points at a custom label that was deleted', () => {
  // resolveTopic returns null for this id (the catalog entry is gone but the
  // session keeps it), so every consumer has to tolerate a tagged session
  // with nothing to render for its tag.
  setState({ sessions: [session(0, 1500, 'custom:gone')], customLabels: [] });
  mountAll('deleted label');
});

test('render when the box reports an unavailable battery', () => {
  // -1 is protocol.ts's documented "no battery reading" sentinel and reaches
  // batteryColor/BatteryIcon/the estimate as a real value, not as absent.
  setState({
    sessions: [session(0, 1500, 'work')],
    status: { st: 'closed', rem: 0, set: 1500, bat: -1, tp: '', fw: '1.2.0' },
  });
  mountAll('battery unavailable');
});

test('render with sessions sitting on the period filters boundaries', () => {
  // The exact MIN_LOGGED_SESSION_S floor, and entries that land on the
  // trailing 7/30/365-day edges the window filters compute.
  setState({
    sessions: [session(0, 60, 'work'), session(6, 60), session(29, 60, 'study'), session(364, 60, 'other')],
  });
  mountAll('boundary durations');
});

test('render with planned sessions on the calendar, including a done one', () => {
  // The Calendar's PlannedSessions/day-sheet rows read straight off
  // useScheduleStore, which every other case above leaves empty.
  const today = dayKey(NOW);
  setState({
    sessions: [session(0, 1500, 'work')],
    customLabels: [{ id: 'custom:reading', name: 'Reading', color: '#2563eb' }],
    scheduled: [
      { id: 'sched_a', date: today, time: '09:00', topic: 'work', leadMinutes: 10, plannedS: 1500, createdAt: NOW, updatedAt: NOW },
      { id: 'sched_b', date: today, time: '14:30', topic: 'custom:reading', leadMinutes: 0, note: 'chapter 3', done: true, createdAt: NOW, updatedAt: NOW },
      { id: 'sched_c', date: today, time: '20:00', topic: null, leadMinutes: 30, createdAt: NOW, updatedAt: NOW },
    ],
  });
  mountAll('planned sessions');
});

test('day keys used by the calendar grid stay well-formed for the seeded data', () => {
  // Guards the fixture itself: a NaN startedAt would make every assertion
  // above pass vacuously while the calendar silently bucketed nothing.
  for (const s of [session(0, 60), session(40, 60)]) {
    expect(dayKey(s.startedAt)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});
