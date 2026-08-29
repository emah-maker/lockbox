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
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Feather: 'Feather', MaterialIcons: 'MaterialIcons' }));

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
  // Control: mount/open/unmount with NO wheel drag at all -- whatever timer
  // count is left pending afterward is every OTHER effect's own business
  // (Sheet's own animations, auth listeners, etc.), not this one's.
  const control = mountAndOpenGoals();
  act(() => {
    control.unmount();
  });
  const controlLeak = jest.getTimerCount();

  // Same steps, but with a wheel drag started (onWheelActiveChange(true))
  // and never released before the screen unmounts -- simulates switching
  // tabs away from Settings mid-drag (App.tsx unmounts the outgoing tab's
  // screen outright). If the 600ms safety timer this arms is properly
  // cleared on unmount, this leaks exactly as many timers as the control
  // above; if it isn't, this leaks one more.
  const tree = mountAndOpenGoals();
  const goalsSection = tree.root.findAll((n) => typeof n.props?.onWheelActiveChange === 'function')[0];
  act(() => {
    goalsSection.props.onWheelActiveChange(true); // arms SettingsScreen's 600ms wheel-safety timer
  });
  act(() => {
    tree.unmount(); // simulates switching tabs away from Settings mid-drag
  });

  expect(jest.getTimerCount()).toBe(controlLeak);
});
