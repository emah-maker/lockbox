// sessionsSyncBridge.test.ts -- what this bridge may push, and the one
// emission it must never mistake for new work.
//
// The hazard this file exists for is the session-history twin of the one
// settingsSyncBridge.test.ts documents for preferences, and it turns on
// App.tsx's start-up ordering. App.tsx calls useStore.init() fire-and-forget
// and starts this bridge on the very next line, so the bridge snapshots an
// EMPTY session list and the persisted history lands afterwards as an
// ordinary store emission. Read as "these were all just logged", every cold
// launch re-pushes the whole history.
//
// Wasted writes are the harmless half. The damaging half is that a local
// history routinely contains sessions another device logged -- syncSessions
// writes its merged cross-device list back over local storage -- and
// pushNewSessions keys a create by sessionDocId(deviceId, ...). So the
// re-push files another device's session under THIS device's id, and one real
// session becomes two Firestore docs that every device then counts twice,
// permanently. markSessionsSeen was written to prevent exactly that; the
// fix under test is that hydration no longer arrives too late for it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setJSON } from '../storage/storage';
import type { LoggedSession } from '../stats/sessionHistory';

// Read lazily by the factory below so a fresh module registry (see
// freshBridge) still reports into these same spies.
const mockPushNew = jest.fn(async (_sessions: LoggedSession[]) => {});
const mockPushRetag = jest.fn(
  async (_s: LoggedSession, _topic: string | undefined, _topicUpdatedAt: number) => {},
);

jest.mock('./sessionsSync', () => ({
  pushNewSessions: (sessions: LoggedSession[]) => mockPushNew(sessions),
  pushSessionRetag: (s: LoggedSession, topic: string | undefined, topicUpdatedAt: number) =>
    mockPushRetag(s, topic, topicUpdatedAt),
}));

// useStore builds a BleManager and a CallMonitor at module scope, neither of
// which exists under jest -- stubbed so requiring the store is possible at
// all. Nothing here connects to anything.
jest.mock('../ble/PhoneBoxClient', () => ({
  PhoneBoxClient: class {
    deviceId = 'box-1';
    connected = false;
    waitForPoweredOn = jest.fn(async () => {});
    scanForBox = jest.fn(async () => null);
    connect = jest.fn(async () => {});
    connectById = jest.fn(async () => {});
    disconnect = jest.fn(async () => {});
    readSettings = jest.fn(async () => null);
    setLabels = jest.fn(async () => {});
    setPendingTopic = jest.fn(async () => {});
    syncTime = jest.fn(async () => {});
    ackHistory = jest.fn(async () => {});
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

const s = (startedAt: number, topic?: string, topicUpdatedAt?: number): LoggedSession =>
  ({ startedAt, plannedS: 1800, actualS: 1800, outcome: 'completed', ...(topic ? { topic } : {}), ...(topicUpdatedAt ? { topicUpdatedAt } : {}) }) as LoggedSession;

/**
 * A bridge that has never been started, paired with the store instance it
 * subscribes to. Both `started` and `seen` are module-level in the bridge,
 * so a shared registry would let the first test's subscription decide every
 * later one -- and the whole subject here is what the FIRST emission after a
 * start does.
 */
function freshBridge() {
  let start!: () => void;
  let useStore!: typeof import('../store/useStore').useStore;
  jest.isolateModules(() => {
    useStore = require('../store/useStore').useStore;
    start = require('./sessionsSyncBridge').startSessionsSyncBridge;
  });
  return { start, useStore };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  // autoConnect off: init() reaches for the radio otherwise, which is
  // irrelevant here and pulls the stubbed client into the assertion.
  await setJSON('autoConnect', false);
  jest.clearAllMocks();
});

describe('hydration is not new work', () => {
  it('does not push the persisted history that lands after the bridge starts', async () => {
    await setJSON('sessionHistory', [s(1000), s(2000), s(3000)]);
    const { start, useStore } = freshBridge();

    // App.tsx's exact ordering: init() fire-and-forget, bridge immediately.
    const init = useStore.getState().init();
    start();
    await init;

    expect(mockPushNew).not.toHaveBeenCalled();
  });

  it('does not push a hydrated session that another device logged', async () => {
    // The damaging case: this history came back from syncSessions' merge, so
    // it already exists remotely under the OTHER device's doc id. A create
    // from here would be a second doc for the same session.
    await setJSON('sessionHistory', [s(1000, 'Thesis', 500)]);
    const { start, useStore } = freshBridge();

    const init = useStore.getState().init();
    start();
    await init;

    expect(mockPushNew).not.toHaveBeenCalled();
    expect(mockPushRetag).not.toHaveBeenCalled();
  });

  it('marks the hydrated history seen, so a later identical emission is still silent', async () => {
    await setJSON('sessionHistory', [s(1000), s(2000)]);
    const { start, useStore } = freshBridge();

    const init = useStore.getState().init();
    start();
    await init;
    // A re-render/re-emission carrying the same sessions in a new array.
    useStore.setState({ sessions: [s(1000), s(2000)] });

    expect(mockPushNew).not.toHaveBeenCalled();
  });
});

describe('real changes after hydration still push', () => {
  it('pushes a session logged after hydration', async () => {
    await setJSON('sessionHistory', [s(1000)]);
    const { start, useStore } = freshBridge();

    const init = useStore.getState().init();
    start();
    await init;
    useStore.setState({ sessions: [s(1000), s(4000)] });

    expect(mockPushNew).toHaveBeenCalledTimes(1);
    expect(mockPushNew.mock.calls[0][0]).toEqual([s(4000)]);
  });

  it('pushes a retag of a hydrated session', async () => {
    await setJSON('sessionHistory', [s(1000)]);
    const { start, useStore } = freshBridge();

    const init = useStore.getState().init();
    start();
    await init;
    useStore.setState({ sessions: [s(1000, 'Thesis', 900)] });

    expect(mockPushRetag).toHaveBeenCalledTimes(1);
    expect(mockPushNew).not.toHaveBeenCalled();
  });
});

describe('a bridge started after hydration', () => {
  it('pushes nothing for the history already in hand', async () => {
    await setJSON('sessionHistory', [s(1000), s(2000)]);
    const { start, useStore } = freshBridge();

    // The other legal ordering: init() has already settled (initialized is
    // true) before anything subscribes.
    await useStore.getState().init();
    start();

    expect(mockPushNew).not.toHaveBeenCalled();
  });

  it('still notices the next genuinely-new session', async () => {
    await setJSON('sessionHistory', [s(1000)]);
    const { start, useStore } = freshBridge();

    await useStore.getState().init();
    start();
    useStore.setState({ sessions: [s(1000), s(5000)] });

    expect(mockPushNew).toHaveBeenCalledTimes(1);
    expect(mockPushNew.mock.calls[0][0]).toEqual([s(5000)]);
  });
});
