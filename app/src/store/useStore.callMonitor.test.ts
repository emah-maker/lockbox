// useStore.callMonitor.test.ts -- the call monitor's lifecycle across a BLE
// drop, driven through the real store AND the real CallMonitor.
//
// Deliberately not mocked here, unlike the other useStore tests: the whole
// behaviour under test lives in the seam between the two. useStore decides
// when to start and stop the monitor; CallMonitor decides what a start
// means (re-subscribe, take an immediate snapshot, forget which calls have
// already been alerted). Mock either side and the seam disappears.
//
// Only the two things this process genuinely cannot have are doubles: the
// radio, and iOS's CXCallObserver.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from './useStore';
import { getCurrentCalls, CallEvent } from '../../modules/call-observer';
import type { Status } from '../ble/protocol';

type Captured = { onStatus?: (s: Status) => void; onDisconnect?: () => void };
let mockCaptured: Captured = {};
const mockAlertCall = jest.fn(async (_label: string) => {});

jest.mock('../ble/PhoneBoxClient', () => ({
  PhoneBoxClient: class {
    deviceId = 'box-1';
    connected = true;
    waitForPoweredOn = jest.fn(async () => {});
    scanForBox = jest.fn(async () => ({ id: 'box-1' }));
    connect = jest.fn(async (_device: unknown, cb: Captured) => {
      mockCaptured = cb;
    });
    connectById = jest.fn(async (_id: string, cb: Captured) => {
      mockCaptured = cb;
    });
    disconnect = jest.fn(async () => {});
    readSettings = jest.fn(async () => null);
    setLabels = jest.fn(async () => {});
    setPendingTopic = jest.fn(async () => {});
    syncTime = jest.fn(async () => {});
    ackHistory = jest.fn(async () => {});
    // A prototype method rather than a field, so the hoisted factory does
    // not capture a still-uninitialized binding -- see the same note in
    // useStore.history.test.ts.
    alertCall(label: string) {
      return mockAlertCall(label);
    }
  },
}));

jest.mock('../../modules/call-observer', () => ({
  isCallObserverAvailable: jest.fn(() => true),
  addCallListener: jest.fn(() => ({ remove: jest.fn() })),
  getCurrentCalls: jest.fn(() => []),
}));

const mockGetCurrentCalls = getCurrentCalls as jest.Mock;

const ringing = (uuid = 'call-1'): CallEvent => ({ state: 'incoming', outgoing: false, uuid });

const status = (over: Partial<Status>): Status => ({
  st: 'idle', rem: 0, set: 0, bat: 80, tp: '', fw: '1.0', ...over,
});

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

beforeEach(async () => {
  // disconnect() is what stops the monitor, so this also puts the shared
  // module-level instance back to a known state between tests.
  await useStore.getState().disconnect();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockGetCurrentCalls.mockReturnValue([]);
  useStore.setState({ status: null, conn: 'idle' });
});

afterEach(async () => {
  await useStore.getState().disconnect();
});

describe('a BLE drop while a call is ringing', () => {
  /** Connect, then have the box report a running lock -- the state the
   * alert-through feature is gated on. */
  const connectLocked = async () => {
    await useStore.getState().connect();
    mockCaptured.onStatus!(status({ st: 'running', rem: 1500, set: 1800 }));
    await flush();
  };

  // The monitor is started on every connect but was only ever stopped by a
  // user-initiated disconnect() -- a dropped link left it running. That is
  // not merely untidy: CallMonitor.start() is a no-op while it still holds
  // a subscription (`if (this.sub) return`), so the reconnect skipped both
  // the immediate snapshot start() exists to take AND the clearing of
  // `alerted` that stop() exists to do. CallMonitor's own
  // "clears dedupe so a reconnect can alert a call that is still ringing"
  // test proves the mechanism works; this is the half that decides whether
  // it is ever invoked.
  it('re-alerts a call that outlived the drop, once the box is back', async () => {
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    await connectLocked();
    expect(mockAlertCall).toHaveBeenCalledTimes(1);

    // The link drops on its own -- not the user tapping Disconnect.
    mockCaptured.onDisconnect!();
    await flush();

    // Back a moment later, same call still ringing. The box on the other
    // end has no memory of an alert it may never have drained.
    await connectLocked();

    expect(mockAlertCall).toHaveBeenCalledTimes(2);
  });

  it('does not re-alert the same call while the connection simply stays up', async () => {
    // The other side of the same coin: within one connection the dedupe
    // must still hold, or a 20-second ring becomes twenty writes.
    mockGetCurrentCalls.mockReturnValue([ringing()]);
    await connectLocked();

    for (let i = 0; i < 5; i += 1) {
      mockCaptured.onStatus!(status({ st: 'running', rem: 1400 - i, set: 1800 }));
    }
    await flush();

    expect(mockAlertCall).toHaveBeenCalledTimes(1);
  });
});
