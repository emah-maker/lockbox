// batterySamplingBridge.test.ts -- what does and does not get into the
// persisted battery-sample log.
//
// The log is not a display buffer. dischargeRatePerHour fits a least-
// squares line through it and estimateRemainingMs divides by the result,
// so one wrong reading is not one wrong pixel -- it is a wrong slope for
// as long as that reading stays inside the six-hour fitting window.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startBatterySampling } from './batterySamplingBridge';
import { useBatteryStore } from './useBatteryStore';
import { useStore } from '../store/useStore';
import { DEMO_BATTERY_PCT } from '../ble/DemoBoxClient';
import type { Status } from '../ble/protocol';

jest.mock('../ble/PhoneBoxClient', () => ({
  PhoneBoxClient: class {
    deviceId: string | null = 'real-box';
    connected = false;
    waitForPoweredOn = jest.fn(async () => {});
    scanForBox = jest.fn(async () => ({ id: 'real-box' }));
    connect = jest.fn(async () => {
      this.connected = true;
    });
    connectById = jest.fn(async () => {
      this.connected = true;
    });
    disconnect = jest.fn(async () => {
      this.connected = false;
    });
    readSettings = jest.fn(async () => null);
    writeSettings = jest.fn(async () => {});
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

const status = (bat: number): Status => ({ st: 'idle', rem: 0, set: 0, bat, tp: '', fw: '1.0' });

const recordedPcts = () => useBatteryStore.getState().samples.map((s) => s.pct);

// recordBatterySample drops any sample whose timestamp does not move the
// log forward (a slope fit assumes monotonic time), so a minute is stepped
// between readings rather than letting two land in the same millisecond.
let now = Date.parse('2026-01-15T09:00:00.000Z');
const minuteLater = () => {
  now += 60_000;
};

/** The box reports a percent, a minute after whatever came before. */
const reports = (bat: number) => {
  minuteLater();
  useStore.setState({ status: status(bat) });
};

beforeAll(() => {
  startBatterySampling();
});

beforeEach(async () => {
  await useStore.getState().setDemoMode(false);
  await AsyncStorage.clear();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  useBatteryStore.setState({ hydrated: true, samples: [], lastRecordedPct: null });
  useStore.setState({ status: null });
});

afterEach(async () => {
  await useStore.getState().setDemoMode(false);
  jest.restoreAllMocks();
});

describe('what reaches the persisted sample log', () => {
  it('records the real box as its reported percent changes', () => {
    reports(95);
    reports(94);

    expect(recordedPcts()).toEqual([95, 94]);
  });

  it('records nothing for the "unavailable" sentinel', () => {
    reports(-1);

    expect(recordedPcts()).toEqual([]);
  });

  // The simulated box reports a fixed, invented percent. It reaches this
  // bridge by exactly the same route a real reading does -- useStore's
  // `status` -- and there is nothing in a sample to say where it came
  // from, so once written it is indistinguishable from the user's own box.
  //
  // The damage is not the one bogus point. A real box sitting at 95%
  // followed by a step down to 87 is, to dischargeRatePerHour, a perfectly
  // legal discharge happening in the second it took to flip the toggle:
  // the fit's guards throw out sharp jumps UP (a plug-in), never down. So
  // the fitted slope becomes a cliff, and estimateRemainingMs divides by
  // it and reports minutes of runtime for a box with days left -- for the
  // whole six-hour window that sample stays inside.
  it('records nothing from the simulated box', async () => {
    reports(95);
    expect(recordedPcts()).toEqual([95]);

    minuteLater();
    await useStore.getState().setDemoMode(true);
    // The demo box really did report its number -- this is about the log,
    // not about hiding it from the screen.
    expect(useStore.getState().status?.bat).toBe(DEMO_BATTERY_PCT);

    expect(recordedPcts()).toEqual([95]);
  });

  it('picks the real box back up where it left off once demo mode is switched off', async () => {
    reports(95);
    minuteLater();
    await useStore.getState().setDemoMode(true);
    minuteLater();
    await useStore.getState().setDemoMode(false);

    reports(94);

    // No 87 wedged in between to fit a cliff through.
    expect(recordedPcts()).toEqual([95, 94]);
  });
});
