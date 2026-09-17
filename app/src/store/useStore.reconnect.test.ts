// useStore.reconnect.test.ts -- the auto-reconnect ladder, and where it is
// allowed to start over.
//
// reconnectPolicy.ts owns the arithmetic and is tested on its own; what is
// tested here is the counter feeding it, which lives in useStore's closure
// and is the part that can silently disagree with its own documentation.
// A backoff that never grows costs the phone's battery; a backoff that
// never resets costs the user a minute of staring at a Connect button that
// looks like it did nothing.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from './useStore';

/** Fails every attempt, so the ladder keeps climbing. */
let mockScanShouldFail = true;
const mockScanForBox = jest.fn(async () => {
  if (mockScanShouldFail) throw new Error('No PhoneBox found in range');
  return { id: 'box-1' };
});

jest.mock('../ble/PhoneBoxClient', () => ({
  PhoneBoxClient: class {
    deviceId: string | null = null; // never connected, so no remembered id
    connected = false;
    waitForPoweredOn = jest.fn(async () => {});
    scanForBox() {
      return mockScanForBox();
    }
    connect = jest.fn(async () => {});
    connectById = jest.fn(async () => {});
    disconnect = jest.fn(async () => {});
    readSettings = jest.fn(async () => null);
    setLabels = jest.fn(async () => {});
    setPendingTopic = jest.fn(async () => {});
    syncTime = jest.fn(async () => {});
    ackHistory = jest.fn(async () => {});
    alertCall = jest.fn(async () => {});
  },
}));

jest.mock('../calls/CallMonitor', () => ({
  CallMonitor: class {
    available = false;
    start = jest.fn();
    stop = jest.fn();
    checkNow = jest.fn();
  },
}));

/** Drains microtasks without advancing the fake clock. */
const microFlush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

/** One full failed attempt: let it run, let it reject, let it arm the next. */
const failOnce = async () => {
  await microFlush();
};

beforeEach(async () => {
  jest.useRealTimers();
  await useStore.getState().disconnect();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockScanShouldFail = true;
  useStore.setState({ autoConnect: true, conn: 'idle', status: null, error: null });
  jest.useFakeTimers();
});

afterEach(async () => {
  jest.useFakeTimers();
  await useStore.getState().disconnect();
  jest.useRealTimers();
});

describe('the reconnect backoff ladder', () => {
  /** Climb `rungs` failed auto-reconnects, returning with a timer armed for
   * the next one. */
  const climb = async (rungs: number) => {
    useStore.getState().connect();
    await failOnce();
    for (let i = 0; i < rungs; i += 1) {
      // Each armed delay doubles from 4s; running the clock well past the
      // 60s cap fires whichever one is pending without having to restate
      // the curve reconnectPolicy.test.ts already pins.
      jest.advanceTimersByTime(60_000);
      await failOnce();
    }
  };

  it('grows the delay between automatic retries', async () => {
    await climb(0);
    expect(mockScanForBox).toHaveBeenCalledTimes(1);

    // The first retry is armed for 4s: three seconds is not enough.
    jest.advanceTimersByTime(3_000);
    await failOnce();
    expect(mockScanForBox).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1_000);
    await failOnce();
    expect(mockScanForBox).toHaveBeenCalledTimes(2);

    // The second is armed for 8s, so the same 4s no longer suffices.
    jest.advanceTimersByTime(4_000);
    await failOnce();
    expect(mockScanForBox).toHaveBeenCalledTimes(2);
  });

  // reconnectAttempts' own declaration says it is reset "on any successful
  // connect (afterConnected) or a fresh user-initiated connect() call", and
  // only the first of those was ever implemented. Once the ladder has
  // climbed to its 60s cap -- a box switched off for a few minutes gets
  // there -- tapping Connect and having it fail left the NEXT attempt a
  // full minute away. To the user that is a button that did nothing and
  // stays doing nothing; the app looks broken at exactly the moment they
  // asked it for help.
  it('starts the ladder over when the user asks to connect by hand', async () => {
    await climb(5); // well past the 60s cap
    mockScanForBox.mockClear();

    // The user taps Connect. It fails too -- the box really is off.
    useStore.getState().connect();
    await failOnce();
    expect(mockScanForBox).toHaveBeenCalledTimes(1);

    // ...but the automatic retry behind it is back at the bottom rung,
    // not still at the cap.
    jest.advanceTimersByTime(4_000);
    await failOnce();
    expect(mockScanForBox).toHaveBeenCalledTimes(2);
  });

  it('does not let an automatic retry reset the ladder for itself', async () => {
    // The other half: connect() is the same entry point the timer uses, so
    // resetting unconditionally would flatten the curve back to a fixed 4s
    // forever -- the behaviour the backoff was added to remove.
    await climb(3);
    mockScanForBox.mockClear();

    jest.advanceTimersByTime(4_000);
    await failOnce();
    expect(mockScanForBox).not.toHaveBeenCalled();
  });
});
