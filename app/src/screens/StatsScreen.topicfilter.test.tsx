// StatsScreen.topicfilter.test.tsx -- regression for "the whole Stats screen
// reads 0 after retagging the session you were filtered to".
//
// The retag affordance lives on this screen (SessionListSheet's onRetag), so
// relabelling the last session carrying the selected topic is an ordinary
// path, not an exotic one. `topics` dropped the topic; `selectedTopic` did
// not, and every card filters by the latter.
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

import StatsScreen from './StatsScreen';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import type { LoggedSession } from '../stats/sessionHistory';

const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 47, left: 0, right: 0, bottom: 34 };
const NOW = Date.now();

const session = (topic: string, actualS: number, daysAgo = 0): LoggedSession => ({
  startedAt: NOW - daysAgo * 86400000,
  plannedS: actualS,
  actualS,
  outcome: 'completed',
  topic,
});

function seed(sessions: LoggedSession[]) {
  useStore.setState({ sessions, status: null, conn: 'idle', currentTopic: null, pendingBoxTopic: null });
  useGoalsStore.setState({ hydrated: true, goals: [] });
  useSettingsStore.setState({ hydrated: true, customLabels: [] });
}

function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <StatsScreen />
      </SafeAreaProvider>,
    );
  });
  return tree;
}

/** The topic-breakdown card exposes the current filter as `selectedKey`. */
const filterKey = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.selectedKey !== undefined)[0]?.props.selectedKey ?? null;

const selectTopic = (tree: TestRenderer.ReactTestRenderer, topic: string) => {
  const node = tree.root.findAll((n) => typeof n.props?.onSelectTopic === 'function')[0];
  act(() => node.props.onSelectTopic(topic));
};

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test('clears a topic filter once no session anywhere still carries that topic', () => {
  seed([session('study', 1500), session('work', 900)]);
  const tree = mount();

  selectTopic(tree, 'study');
  expect(filterKey(tree)).toBe('study');

  // The retag the screen's own session sheets offer: this session was
  // mislabelled, so fix it to 'work'. Nothing carries 'study' any more.
  act(() => {
    useStore.setState({ sessions: [session('work', 1500), session('work', 900)] });
  });

  expect(filterKey(tree)).toBeNull();
  act(() => tree.unmount());
});

test('KEEPS a topic filter that still matches history but not the current period', () => {
  // The distinction that makes the fix correct rather than merely quieting
  // the symptom: "no study time today" is the right answer to a deliberate
  // filter, not a stale filter to discard.
  seed([session('study', 1500, 40), session('work', 900)]);
  const tree = mount();

  selectTopic(tree, 'study');
  expect(filterKey(tree)).toBe('study');

  // PeriodSelector's own props are `{ period, onSelect }`.
  const periodNode = tree.root.findAll(
    (n) => typeof n.props?.onSelect === 'function' && n.props?.period !== undefined,
  )[0];
  // Asserted, not `if`-guarded: a missing node would make the check below
  // pass without ever switching period, which is exactly the vacuous test
  // this case exists to avoid.
  expect(periodNode).toBeDefined();
  act(() => periodNode.props.onSelect('day'));

  expect(filterKey(tree)).toBe('study');
  act(() => tree.unmount());
});

test('leaves a filter alone while the session list is still empty', () => {
  // A deep link (useNav intent.topic) is consumed on mount, before the store
  // has hydrated -- clearing then would discard it.
  seed([]);
  const tree = mount();
  selectTopic(tree, 'study');
  expect(filterKey(tree)).toBe('study');
  act(() => tree.unmount());
});
