// useStore.boxSettings.test.ts -- reconciling the box-settings mirror with
// the box itself across a disconnect.
//
// The mirror (useSettingsStore.boxSettings) is what every control on the
// Settings screen renders, and the box is the thing those controls actually
// configure. Two writers, one value, and the link between them is down for
// most of the day: the interesting cases are all about who wins on the next
// reconnect, and the answer is not "always the box".
//
//   * A field the USER changed with no box in range has to survive the
//     reconnect and reach the box -- otherwise the switch silently flips
//     itself back and the change is lost with no error anywhere.
//   * A field the user did NOT touch still belongs to the box, which has its
//     own on-screen settings and may well have been changed there.
//   * A change made while looking at the SIMULATED box is a change to the
//     simulated box, and must never be replayed onto real hardware.
//
// Driven through the real store; only the radio is a double.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from './useStore';
import { useSettingsStore } from './useSettingsStore';
import type { Settings } from '../ble/protocol';

// Statics on the mock class rather than outer `let`s -- useStore builds its
// client at module load, before any top-level binding here has initialized.
// See useStore.demoMode.test.ts's own note on the same hoisting hazard.
jest.mock('../ble/PhoneBoxClient', () => {
  // The box's own copy. Not DEFAULT_BOX_SETTINGS: that binding is in its
  // temporal dead zone inside this hoisted factory.
  const factorySettings = {
    ovr: 3, auto: 1, sleep: 20, bright: 30, unlk: 0, ucal: 0,
    thm: 0, acc: 0, flip: 0, langle: 45, uangle: 0, ovrt: 10,
  };
  class PhoneBoxClient {
    /** What the box currently holds -- answered by readSettings, replaced by
     * writeSettings, exactly like the firmware's own NVM copy. */
    static boxSide: Record<string, number> = { ...factorySettings };
    /** Every settings payload the box was actually sent. */
    static writes: Record<string, number>[] = [];
    /** Makes the next writeSettings reject, the way a write landing in a
     * reconnect gap does. */
    static failNextWrite = false;
    static reset() {
      PhoneBoxClient.boxSide = { ...factorySettings };
      PhoneBoxClient.writes = [];
      PhoneBoxClient.failNextWrite = false;
    }
    deviceId: string | null = 'real-box';
    connected = false;
    async waitForPoweredOn() {}
    async scanForBox() {
      return { id: 'real-box' };
    }
    async connect() {
      this.connected = true;
    }
    async connectById() {
      this.connected = true;
    }
    async disconnect() {
      this.connected = false;
    }
    async readSettings() {
      return { ...PhoneBoxClient.boxSide };
    }
    async writeSettings(s: Record<string, number>) {
      if (PhoneBoxClient.failNextWrite) {
        PhoneBoxClient.failNextWrite = false;
        throw new Error('write rejected');
      }
      PhoneBoxClient.writes.push({ ...s });
      PhoneBoxClient.boxSide = { ...s };
    }
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

jest.mock('../calls/CallMonitor', () => ({
  CallMonitor: class {
    available = false;
    start = jest.fn();
    stop = jest.fn();
    checkNow = jest.fn();
  },
}));

const radio = () =>
  (
    jest.requireMock('../ble/PhoneBoxClient') as {
      PhoneBoxClient: {
        boxSide: Record<string, number>;
        writes: Record<string, number>[];
        failNextWrite: boolean;
        reset: () => void;
      };
    }
  ).PhoneBoxClient;

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

const mirror = (): Settings => useSettingsStore.getState().boxSettings;

/** A fresh launch against a cleared device: init() hydrates, autoconnects,
 * and reads the box's settings, leaving the mirror agreeing with the box. */
const relaunch = async () => {
  await useStore.getState().init();
  await flush();
};

beforeEach(async () => {
  await useStore.getState().setDemoMode(false);
  await useStore.getState().disconnect();
  await AsyncStorage.clear();
  radio().reset();
  await relaunch();
});

afterEach(async () => {
  await useStore.getState().setDemoMode(false);
});

describe('a box setting changed while the box is out of range', () => {
  // The user report this is: "the Allow-open switch turns itself back off".
  // pushBoxSettings mirrors the patch optimistically and then skips the BLE
  // write because nothing is connected -- so the change exists only in the
  // app. afterConnected then reads the box's settings on the next connection
  // and applies them over the mirror wholesale, which puts the old value
  // back. Nothing failed, nothing was reported, and the user's change is
  // gone.
  it('reaches the box on the next connection instead of being reverted by it', async () => {
    await useStore.getState().disconnect();

    await useStore.getState().pushBoxSettings({ unlk: 1 });
    expect(mirror().unlk).toBe(1);
    expect(radio().writes).toHaveLength(0); // nothing to write to

    await useStore.getState().connect();
    await flush();

    expect(mirror().unlk).toBe(1);
    expect(radio().boxSide.unlk).toBe(1);
  });

  it('survives the app being restarted before the box comes back', async () => {
    // An out-of-range box is usually out of range for hours, which is plenty
    // of time for iOS to terminate a backgrounded app. An in-memory-only
    // record of the change would not outlive that, and the reverting read
    // would happen on the relaunch's own autoconnect.
    await useStore.getState().disconnect();
    await useStore.getState().pushBoxSettings({ unlk: 1 });
    await flush();

    await useStore.getState().disconnect();
    await relaunch();

    expect(mirror().unlk).toBe(1);
    expect(radio().boxSide.unlk).toBe(1);
  });

  it('applies theme and accent the same way', async () => {
    await useStore.getState().disconnect();

    await useStore.getState().pushBoxSettings({ thm: 1 });
    await useStore.getState().pushBoxSettings({ acc: 4 });

    await useStore.getState().connect();
    await flush();

    expect(radio().boxSide.thm).toBe(1);
    expect(radio().boxSide.acc).toBe(4);
  });

  // The other half, and the reason this cannot just be "the mirror always
  // wins": the box has its own settings screen. A field nobody touched in
  // the app is still the box's to report.
  it('leaves fields the user did not touch to the box', async () => {
    await useStore.getState().disconnect();
    await useStore.getState().pushBoxSettings({ unlk: 1 });
    // Meanwhile, at the box: someone turns the brightness up on its own
    // settings screen.
    radio().boxSide.bright = 80;

    await useStore.getState().connect();
    await flush();

    expect(mirror().bright).toBe(80);
    expect(mirror().unlk).toBe(1);
  });

  it('keeps the change pending when the reconnect write is itself rejected', async () => {
    await useStore.getState().disconnect();
    await useStore.getState().pushBoxSettings({ unlk: 1 });

    radio().failNextWrite = true;
    await useStore.getState().connect();
    await flush();
    expect(radio().boxSide.unlk).toBe(0); // the box never heard it

    // Next connection: still owed, still sent.
    await useStore.getState().disconnect();
    await useStore.getState().connect();
    await flush();
    expect(radio().boxSide.unlk).toBe(1);
  });

  it('stops replaying a change once the box has it', async () => {
    await useStore.getState().disconnect();
    await useStore.getState().pushBoxSettings({ unlk: 1 });
    await useStore.getState().connect();
    await flush();

    // The user then turns it back off AT THE BOX. Nothing in the app is
    // owed any more, so that must stick.
    await useStore.getState().disconnect();
    radio().boxSide.unlk = 0;
    await useStore.getState().connect();
    await flush();

    expect(mirror().unlk).toBe(0);
  });
});

describe('a box setting changed in demo mode', () => {
  it('is never replayed onto the real box', async () => {
    await useStore.getState().setDemoMode(true);
    // The demo box is always connected, so this is not even the disconnected
    // path -- but a later real connection must not inherit it either way.
    await useStore.getState().pushBoxSettings({ unlk: 1, bright: 99 });

    await useStore.getState().setDemoMode(false);
    await flush();

    expect(radio().boxSide.bright).toBe(30);
    expect(radio().boxSide.unlk).toBe(0);
  });
});
