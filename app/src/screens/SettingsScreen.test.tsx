// SettingsScreen.test.tsx -- regression test for the "wheel-drag safety
// timer outlives the screen" bug.
//
// GoalsSection's target/reminder wheels and NotificationsSection's
// quiet-hours wheels are vertical scrollers nested inside this screen's own
// Sheets -- SettingsScreen's onWheelActiveChange arms a 600ms
// wheelSafetyTimer (belt-and-suspenders against a WheelPicker's onDragEnd
// never firing) every time a drag starts, same pattern StatsScreen.tsx uses
// for its own identical GoalsSection/NotificationsSection wheels. StatsScreen
// clears that timer on unmount; SettingsScreen never did -- switching tabs
// away from Settings (App.tsx's tab switcher unmounts the outgoing screen,
// see App.tsx's `<Screen />`) mid-drag left the timer armed, and it fired
// `setWheelActive(false)` on the already-unmounted screen 600ms later.
//
// This renders the real SettingsScreen (not a synthetic stand-in) through
// react-test-renderer, same as GoalForm.test.tsx/WheelPicker.test.tsx --
// mounting it pulls in this app's full BLE/auth/notifications import graph,
// none of which has a registered Jest double, so every native module it
// transitively touches is mocked below purely so the component tree can
// exist in this environment; none of that mocking is what this test is
// actually about.
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
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
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
// jest-expo's expo-font mock (loadedNativeFonts) trips over @expo/vector-icons'
// own font-loaded check outside a real native runtime -- stood in with plain
// string components, the same "icons are opaque leaves" treatment this suite
// gives everything it doesn't otherwise care about rendering.
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

import SettingsScreen from './SettingsScreen';

const frame = { x: 0, y: 0, width: 320, height: 640 };
const insets = { top: 0, left: 0, right: 0, bottom: 0 };

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

/** Mounts SettingsScreen and opens the "Goals" sheet -- GoalsSection is what
 * actually calls `onWheelActiveChange`, the trigger for the timer this test
 * is about. */
function mountAndOpenGoals() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <SettingsScreen />
      </SafeAreaProvider>,
    );
  });
  const goalsRow = tree!.root.findAll(
    (n) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Goals,'),
  )[0];
  act(() => {
    goalsRow.props.onPress(); // opens the Goals sheet, mounting GoalsSection
  });
  return tree!;
}

test('clears the wheel-drag safety timer on unmount', () => {
  // Identified by its delay rather than by jest.getTimerCount(). Mounting
  // this screen leaves dozens of unrelated framework timers pending -- RN's
  // Animated schedules a rAF chain per animated component, and unmounting
  // doesn't drain them -- so an absolute count can't separate this screen's
  // one 600ms timer from that noise, and the count doesn't repeat exactly
  // between two mounts either. Watching setTimeout/clearTimeout for the
  // 600ms delay names the timer this test is actually about.
  const armed = new Set<unknown>();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const setSpy = jest
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation((...args: Parameters<typeof globalThis.setTimeout>) => {
      const id = realSetTimeout(...args);
      if (args[1] === 600) armed.add(id);
      return id;
    });
  const clearSpy = jest
    .spyOn(globalThis, 'clearTimeout')
    .mockImplementation((...args: Parameters<typeof globalThis.clearTimeout>) => {
      armed.delete(args[0]);
      return realClearTimeout(...args);
    });

  try {
    const tree = mountAndOpenGoals();
    // Only the drag arms the safety timer; whatever the mount itself queued
    // at 600ms is some other effect's business, not this one's.
    armed.clear();

    const goalsSection = tree.root.findAll((n) => typeof n.props?.onWheelActiveChange === 'function')[0];
    act(() => {
      goalsSection.props.onWheelActiveChange(true); // arms SettingsScreen's 600ms wheel-safety timer
    });
    expect(armed.size).toBe(1); // guards the test itself: the timer really is armed

    act(() => {
      tree.unmount(); // simulates switching tabs away from Settings mid-drag
    });

    expect(armed.size).toBe(0);
  } finally {
    setSpy.mockRestore();
    clearSpy.mockRestore();
  }
});
