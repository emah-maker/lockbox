// DashboardScreen.duration.test.tsx -- regression tests for the box-sync /
// duration-push effect pair.
//
// The two effects coordinate through a ref: the box-sync effect sets it when
// it moves the wheels itself, so the push effect knows not to send that value
// straight back to the box it just came from. As a one-shot boolean that
// handshake leaked, because the setter and the consumer run on different
// dependency arrays -- the token could be stranded (never consumed, then
// eating the next real user edit) or spent by the wrong render. It is now
// keyed on the value the box supplied, which is what these tests pin down.
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-haptics', () => ({
  // Must resolve, not return undefined -- this screen chains .catch() onto it.
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
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
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

import DashboardScreen from './DashboardScreen';
import { useStore } from '../store/useStore';

const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 47, left: 0, right: 0, bottom: 34 };

let setDuration: jest.Mock;
const mounted: TestRenderer.ReactTestRenderer[] = [];

/** Idle + connected is the only state the duration picker is live in. */
function setBoxStatus(set: number) {
  act(() => {
    useStore.setState({ status: { st: 'idle', set, rem: 0 } as never });
  });
}

beforeEach(() => {
  setDuration = jest.fn().mockResolvedValue(undefined);
  act(() => {
    useStore.setState({
      conn: 'connected',
      status: { st: 'idle', set: 0, rem: 0 } as never,
      setDuration,
    } as never);
  });
});

afterEach(() => {
  act(() => {
    mounted.forEach((t) => t.unmount());
  });
  mounted.length = 0;
  jest.clearAllMocks();
});

function mount() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <DashboardScreen />
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree!);
  return tree!;
}

/** Drives the hours wheel the way a finger would, by invoking the onChange
 * DurationSheet wires to it. The sheet must be open for the wheel to exist. */
function dragHoursTo(tree: TestRenderer.ReactTestRenderer, index: number) {
  const wheel = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === 'Lock duration, hours' && !!n.props?.onChange,
  )[0];
  act(() => wheel.props.onChange(index));
}

function openDurationSheet(tree: TestRenderer.ReactTestRenderer) {
  const hero = tree.root.findAll((n) => typeof n.props?.onPressIdle === 'function')[0];
  act(() => hero.props.onPressIdle());
}

/** Seconds handed to the box, in call order. */
function pushed() {
  return setDuration.mock.calls.map((c: unknown[]) => c[0]);
}

describe('box-sync must not swallow the next user edit', () => {
  it('pushes a user edit made after a sync that left pickSeconds unchanged', () => {
    const tree = mount();
    openDurationSheet(tree);
    setDuration.mockClear();

    // 310s snaps to {0h, 05m}, whose clampLockSeconds is 300 -- the value
    // `pick` already held. So the sync fires (310 !== 300) but produces NO
    // pickSeconds change, and the push effect, keyed on pickSeconds, never
    // re-runs. A one-shot boolean set here is therefore never consumed.
    setBoxStatus(310);
    expect(pushed()).toEqual([]); // nothing to push -- the value didn't move

    // The stranded token used to be spent right here, silently dropping the
    // user's edit: the wheels showed 2h while the box stayed where it was.
    // 2h against the 05m the sync snapped the minutes wheel to.
    dragHoursTo(tree, 2);
    expect(pushed()).toEqual([2 * 3600 + 5 * 60]);
  });

  it('still suppresses the echo for a sync that does move the wheels', () => {
    const tree = mount();
    openDurationSheet(tree);
    setDuration.mockClear();

    // A plain box-side change: 2h00m. The wheels must follow it without
    // bouncing the same number straight back at the box.
    setBoxStatus(2 * 3600);
    expect(pushed()).toEqual([]);
  });

  it('pushes when the user lands back on the value the box supplied', () => {
    const tree = mount();
    openDurationSheet(tree);

    setBoxStatus(2 * 3600); // box says 2h; suppressed as above
    setDuration.mockClear();

    // Away and back again. The second edit re-selects exactly the box's own
    // number -- a value-keyed guard must not mistake that for the echo it
    // already consumed, or the box never hears the user confirm it.
    dragHoursTo(tree, 3);
    dragHoursTo(tree, 2);
    expect(pushed()).toEqual([3 * 3600, 2 * 3600]);
  });
});

describe('mounting against a box that already holds a duration', () => {
  /** Puts the box where a real one sits when the app comes back to Home:
   * connected, idle, and already holding a duration that is not the picker's
   * 5-minute default -- before this screen has ever rendered. */
  function boxAlreadyHolding(seconds: number) {
    act(() => {
      useStore.setState({ status: { st: 'idle', set: seconds, rem: 0 } as never } as never);
    });
  }

  it('does not push the picker default over the duration the box is holding', () => {
    boxAlreadyHolding(45 * 60);
    mount();

    // Both effects run in the SAME commit on mount. The box-sync effect goes
    // first and records 2700 in the ref, but the push effect behind it still
    // sees the pre-sync pickSeconds (300, the hardcoded default), and 2700
    // !== 300, so a value-equality guard doesn't stop it -- it pushed 5m at a
    // box that was sitting on 45m, the box echoed 300 back, and the wheels
    // followed it down. Connecting to a box must never be what changes the
    // box's own duration.
    expect(pushed()).toEqual([]);
  });

  it('leaves the wheels on the box value and still pushes the next user edit', () => {
    boxAlreadyHolding(45 * 60);
    const tree = mount();
    openDurationSheet(tree);
    setDuration.mockClear();

    // The suppressed push must not leave the ref armed forever: the guard is
    // spent once the wheels have actually caught up to the box's number, so a
    // genuine edit on top of it still reaches the box. 3h against the 45m the
    // sync parked the minute wheel on.
    dragHoursTo(tree, 3);
    expect(pushed()).toEqual([3 * 3600 + 45 * 60]);
  });
});
