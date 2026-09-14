// useStore.demoMode.test.ts -- the client swap behind demonstration mode.
//
// The demo box's own state machine is covered in ble/DemoBoxClient.test.ts.
// What is covered HERE is the wiring around it, which is where the failures
// are silent rather than visible:
//
//   * A swap performed on top of a live connection has to tear the outgoing
//     client down first. useStore keeps userDisconnected/reconnectTimer/
//     reconnectAttempts in a closure precisely because two overlapping
//     connection attempts corrupt each other, and a swap is the same hazard.
//   * CallMonitor was built with the client it holds. If the swap replaces
//     the object it captured, call alert-through stops working and nothing
//     on screen says so -- so it reads the client through an accessor, and
//     that accessor has to actually follow the swap.
//   * Nothing may drag the real radio back while demo mode is on, and a
//     connect attempt the swap abandoned must not report ITS failure over
//     the connection that replaced it.
//   * A demo session has to reach the durable log through the ordinary
//     intake path, carrying the provenance that keeps it off Firestore
//     (sync/sessionsSync.demo.test.ts covers the other end of that).
//   * The demo box's own settings must never land in the saved mirror of the
//     user's REAL box -- `unlk` there is a physical lock's remote-release
//     switch and ships off deliberately.
//
// Driven through the real store and the real DemoBoxClient; only the radio
// itself is a double.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from './useStore';
import { useSettingsStore } from './useSettingsStore';
import { CallMonitor } from '../calls/CallMonitor';
import { loadSessions } from '../stats/sessionHistory';
import { getJSON, setJSON } from '../storage/storage';
import { DEFAULT_BOX_SETTINGS } from './settingsPersistence';
import {
  DEMO_TICK_MS,
  DEMO_SECONDS_PER_TICK,
  DEMO_LOCK_PRESS_TICKS,
  DEMO_DEFAULT_SECONDS,
} from '../ble/DemoBoxClient';
import type { BoxClient } from '../ble/BoxClient';

// Statics on the mock class rather than outer `let`s: useStore constructs
// both its client and its monitor at module load, which is before any
// top-level binding in THIS file has initialized. A factory that closed over
// one would hit its temporal dead zone. (useStore.history.test.ts documents
// the same hoisting hazard from the other direction.)
jest.mock('../ble/PhoneBoxClient', () => {
  class PhoneBoxClient {
    static calls: string[] = [];
    deviceId: string | null = 'real-box';
    connected = false;
    async waitForPoweredOn() {}
    /** The real scan arms a 10s timeout that nothing cancels
     * (PhoneBoxClient.scanForBox). With `holdScan` set this one never
     * settles on its own, so a test can be the one that decides when that
     * timeout fires -- and what it does to a store that has moved on. */
    static holdScan = false;
    static settleScan: { resolve: (d: unknown) => void; reject: (e: Error) => void } | null = null;
    async scanForBox() {
      PhoneBoxClient.calls.push('scanForBox');
      if (!PhoneBoxClient.holdScan) return { id: 'real-box' };
      return new Promise((resolve, reject) => {
        PhoneBoxClient.settleScan = { resolve, reject };
      });
    }
    async connect() {
      PhoneBoxClient.calls.push('connect');
      this.connected = true;
    }
    async connectById() {
      PhoneBoxClient.calls.push('connectById');
      this.connected = true;
    }
    async disconnect() {
      PhoneBoxClient.calls.push('disconnect');
      this.connected = false;
    }
    /** This double never answers a settings read, which is what lets the
     * mirror tests below attribute what is on screen to the restore rather
     * than to a lucky reconnect. */
    async readSettings() {
      return null;
    }
    async writeSettings() {}
    async syncTime() {}
    async startLock() {}
    async setDuration() {}
    async lock() {}
    async unlock() {}
    async alertCall() {}
    async ackHistory() {}
    async setLabels() {}
    async setPendingTopic() {}
  }
  return { PhoneBoxClient };
});

jest.mock('../calls/CallMonitor', () => {
  class CallMonitor {
    /** The options object useStore built this monitor with. */
    static opts: { getClient: () => BoxClient } | null = null;
    available = false;
    constructor(opts: { getClient: () => BoxClient }) {
      CallMonitor.opts = opts;
    }
    start = jest.fn();
    stop = jest.fn();
    checkNow = jest.fn();
  }
  return { CallMonitor };
});

/** Everything the real (mocked) radio client has been asked to do. */
const realClientCalls = (): string[] =>
  (jest.requireMock('../ble/PhoneBoxClient') as { PhoneBoxClient: { calls: string[] } }).PhoneBoxClient.calls;

const monitorClient = (): BoxClient =>
  (CallMonitor as unknown as { opts: { getClient: () => BoxClient } }).opts.getClient();

/** Lets the intake's storage promise chain settle -- it is several awaits
 * deep (pending-topic lock -> buildLoggedSessions -> appendSessions ->
 * persist -> ack), so this drains the whole microtask queue repeatedly
 * rather than counting turns. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

beforeEach(async () => {
  // Reset FIRST, then wipe storage: turning demo mode off reconnects the
  // real client, which writes LAST_DEVICE_KEY on the way through.
  await useStore.getState().setDemoMode(false);
  await AsyncStorage.clear();
  realClientCalls().length = 0;
});

afterEach(async () => {
  jest.useRealTimers();
  await useStore.getState().setDemoMode(false);
});

describe('switching demo mode on', () => {
  it('persists the flag as a device-local preference and connects to the fake box', async () => {
    await useStore.getState().setDemoMode(true);

    expect(useSettingsStore.getState().demoModeEnabled).toBe(true);
    expect(await getJSON<boolean>('demoModeEnabled', false)).toBe(true);
    expect(useStore.getState().conn).toBe('connected');
    // Demo mode's whole premise is that it works with no box anywhere and
    // (trap 6 of the handoff) without signing in -- so nothing may have gone
    // near the radio to get here.
    expect(realClientCalls()).not.toContain('scanForBox');
    expect(realClientCalls()).not.toContain('connect');
  });

  // Trap 3: whichever client was live has to come down through the store's
  // own disconnect(), so userDisconnected/monitor/reconnect bookkeeping lands
  // rather than being abandoned mid-flight.
  it('tears the real client down before installing the fake one', async () => {
    await useStore.getState().connect();
    expect(useStore.getState().conn).toBe('connected');

    await useStore.getState().setDemoMode(true);

    expect(realClientCalls()).toContain('disconnect');
    expect(useStore.getState().conn).toBe('connected');
  });

  // Trap 2: useStore's afterConnected only writes LAST_DEVICE_KEY when the
  // client claims an id, and sync/sessionMerge.ts builds every session's
  // Firestore doc id out of that value.
  it('leaves the remembered box id alone', async () => {
    await useStore.getState().setDemoMode(true);

    expect(await getJSON<string | null>('lastDeviceId', null)).toBeNull();
  });
});

describe('the call monitor across a swap', () => {
  // Trap 4. The monitor is built once, at module load, and reads
  // client.connected on every poll -- a captured instance would go on
  // answering for a client nobody is talking to any more.
  it('follows the client the store is actually talking to', async () => {
    expect(monitorClient().deviceId).toBe('real-box');

    await useStore.getState().setDemoMode(true);
    expect(monitorClient().deviceId).toBeNull();
    expect(monitorClient().connected).toBe(true);

    await useStore.getState().setDemoMode(false);
    expect(monitorClient().deviceId).toBe('real-box');
  });
});

describe('switching demo mode back off', () => {
  it('returns to the real client with no demo connection left standing', async () => {
    await useStore.getState().setDemoMode(true);
    const demoClient = monitorClient();

    await useStore.getState().setDemoMode(false);

    expect(useSettingsStore.getState().demoModeEnabled).toBe(false);
    expect(demoClient.connected).toBe(false);
    expect(realClientCalls()).toContain('connect');
  });
});

describe('a demo lock, end to end', () => {
  it('lands in the durable session log, marked as demo', async () => {
    // Fake timers BEFORE connecting: the demo box arms its status interval
    // as part of connect(), and an interval scheduled on the real clock is
    // not one advanceTimersByTime can drive.
    jest.useFakeTimers();
    await useStore.getState().setDemoMode(true);

    // The same two things a reviewer does on Home: pick a duration, tap
    // Close. There is deliberately no remote start in this app -- the demo
    // box presses its own LOCK a beat later (DEMO_LOCK_PRESS_TICKS).
    await useStore.getState().setDuration(DEMO_DEFAULT_SECONDS);
    await useStore.getState().closeBox();
    expect(useStore.getState().status?.st).toBe('closed');

    jest.advanceTimersByTime(DEMO_LOCK_PRESS_TICKS * DEMO_TICK_MS);
    expect(useStore.getState().status?.st).toBe('running');

    jest.advanceTimersByTime((DEMO_DEFAULT_SECONDS / DEMO_SECONDS_PER_TICK) * DEMO_TICK_MS);
    expect(useStore.getState().status?.st).toBe('done');

    jest.useRealTimers();
    await flush();

    // Through the ordinary intake path -- historyIntake -> sessionHistory --
    // which is what makes it show up in Home's history, Stats, the calendar
    // and goal progress without any of them knowing demo mode exists.
    const stored = await loadSessions();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      plannedS: DEMO_DEFAULT_SECONDS,
      actualS: DEMO_DEFAULT_SECONDS,
      outcome: 'completed',
      demo: true,
    });
    expect(useStore.getState().sessions).toEqual(stored);
  });
});

describe('the box-settings mirror', () => {
  /** The user's real box, with remote unlock OFF -- the firmware default,
   * and the setting that matters if this mirror lies. */
  const realBox = { ...DEFAULT_BOX_SETTINGS, unlk: 0 as const, bright: 30 };

  beforeEach(async () => {
    await setJSON('boxSettings', realBox);
    useSettingsStore.getState().setBoxSettings(realBox);
  });

  it('is not overwritten on disk by the demo box', async () => {
    await useStore.getState().setDemoMode(true);

    // Shown, so Home does not warn that Open will not release a box the
    // demo box will happily open...
    expect(useSettingsStore.getState().boxSettings.unlk).toBe(1);
    // ...but never written over the real box's saved copy.
    expect(await getJSON('boxSettings', DEFAULT_BOX_SETTINGS)).toEqual(realBox);
  });

  it('is not overwritten by a settings change made while in demo mode', async () => {
    await useStore.getState().setDemoMode(true);

    await useStore.getState().pushBoxSettings({ bright: 100 });

    expect(useSettingsStore.getState().boxSettings.bright).toBe(100);
    expect(await getJSON('boxSettings', DEFAULT_BOX_SETTINGS)).toEqual(realBox);
  });

  it('is put back in front of the user when demo mode is switched off', async () => {
    await useStore.getState().setDemoMode(true);
    expect(useSettingsStore.getState().boxSettings.unlk).toBe(1);

    await useStore.getState().setDemoMode(false);

    // The real client answers no settings read in this double, so what is on
    // screen has to come from the restore rather than from a lucky reconnect.
    expect(useSettingsStore.getState().boxSettings).toEqual(realBox);
  });
});

// The input behind Home's demo-mode invitation (DashboardScreen's
// offerDemoMode). "Not connected right now" is true during every scan and
// every reconnect gap; this is the flag that separates that from "there is
// no box here", so a user reaching for the box they own is never the one
// being offered the fake one.
describe('the remembered-box flag', () => {
  beforeEach(async () => {
    await useStore.getState().disconnect();
    useStore.setState({ rememberedBox: false });
  });

  it('is set once a real connection completes, and survives the disconnect after it', async () => {
    await useStore.getState().connect();
    expect(useStore.getState().rememberedBox).toBe(true);

    await useStore.getState().disconnect();
    expect(useStore.getState().rememberedBox).toBe(true);
  });

  // The other side of the demo client's null deviceId (trap 2): a demo
  // connection is not evidence that this device has a box, so it must not
  // switch off the very invitation that got the reviewer here.
  it('is not set by a demo connection', async () => {
    await useStore.getState().setDemoMode(true);

    expect(useStore.getState().conn).toBe('connected');
    expect(useStore.getState().rememberedBox).toBe(false);
  });
});

// Trap 3 in its likeliest form. autoConnect fires a scan the moment the app
// launches, PhoneBoxClient.scanForBox arms a 10s timeout that nothing
// cancels, and Home shows "No box? Try demo mode" for exactly the reason
// that scan is doomed -- so the reviewer taps it a second or two in. Ten
// seconds later the abandoned scan settles, into a store that has been
// happily running a demo box ever since.
//
// The damage was not cosmetic: `conn: 'error'` makes `connected` false, and
// DashboardScreen derives canOpen/canClose from it, so Open -- which the App
// Store review notes tell the reviewer to press -- goes dead on a session
// that is still counting down.
describe('a connect attempt the demo swap abandoned', () => {
  const radio = () =>
    (
      jest.requireMock('../ble/PhoneBoxClient') as {
        PhoneBoxClient: {
          holdScan: boolean;
          settleScan: { resolve: (d: unknown) => void; reject: (e: Error) => void } | null;
        };
      }
    ).PhoneBoxClient;

  /** Drains microtasks. Everything in flight here is promise-based (the
   * AsyncStorage mock included), and setImmediate is faked. */
  const microFlush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  /**
   * Leaves a real scan hanging, then switches to demo mode on top of it --
   * the launch-scan-then-tap-the-CTA sequence, up to the moment the scan
   * finally settles.
   *
   * Hands the abandoned attempt back wrapped in an object, deliberately: an
   * async function that RETURNS a pending promise has its own promise adopt
   * it, so `await` here would wait for the very thing the caller is about to
   * settle by hand.
   */
  async function swapMidScan(): Promise<{ attempt: Promise<void> }> {
    jest.useFakeTimers();
    radio().holdScan = true;
    await useStore.getState().disconnect();

    const attempt = useStore.getState().connect();
    await microFlush();
    expect(useStore.getState().conn).toBe('scanning');

    await useStore.getState().setDemoMode(true);
    expect(useStore.getState().conn).toBe('connected');
    return { attempt };
  }

  afterEach(() => {
    radio().holdScan = false;
    radio().settleScan = null;
  });

  it('does not report its own failure over the demo box that replaced it', async () => {
    const { attempt } = await swapMidScan();

    radio().settleScan!.reject(new Error('No PhoneBox found in range'));
    await attempt;

    expect(useStore.getState().conn).toBe('connected');
    expect(useStore.getState().error).toBeNull();

    // And nothing was armed to come back and undo that a few seconds later.
    jest.advanceTimersByTime(120_000);
    expect(useStore.getState().conn).toBe('connected');
  });

  it('does not connect a box it finds after the swap', async () => {
    const { attempt } = await swapMidScan();
    // The live client is the demo one; if the abandoned attempt carried on
    // reading the live binding, this is what it would reach for.
    const demoConnect = jest.spyOn(monitorClient(), 'connect');
    realClientCalls().length = 0;

    radio().settleScan!.resolve({ id: 'real-box' });
    await attempt;

    // Neither client: not the demo one (which would be handed a real
    // peripheral and re-run afterConnected over a healthy connection), and
    // not the radio (a second, real connection nobody asked for).
    expect(demoConnect).not.toHaveBeenCalled();
    expect(realClientCalls()).not.toContain('connect');
    expect(useStore.getState().conn).toBe('connected');
  });
});
