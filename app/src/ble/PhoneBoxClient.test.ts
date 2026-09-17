// Unit tests for the BLE service layer itself -- the connect/teardown
// bookkeeping and the writes it sends, as opposed to protocol.test.ts's
// codecs or DemoBoxClient.test.ts's simulated box.
//
// react-native-ble-plx is mocked rather than stubbed at the boundary: this
// class IS the boundary, so there is nothing left to test if the Device and
// BleManager objects it drives are replaced by something simpler. The fakes
// below therefore imitate the real library's observable behaviour as closely
// as the failures being pinned down require -- in particular that
// `cancelDeviceConnection` is the ONLY thing that hands a GATT link back to
// the OS, and that a peripheral which is still connected can be neither
// re-connected nor re-discovered by a scan.
// Imported explicitly rather than leaning on the ambient Node global, for
// the same reason PhoneBoxClient.ts itself does: this project's tsconfig
// does not include @types/node, so the global is not in scope here.
import { Buffer } from 'buffer';
import { CHAR } from './protocol';

// ----- the fake radio -----
// Shared between the mock factory and the tests. Declared with `var` and a
// `mock` prefix because jest.mock's factory is hoisted above every `const`
// in this file; only `mock*` identifiers are exempt from that check.
// eslint-disable-next-line no-var
var mockLinks: Set<string>;
// eslint-disable-next-line no-var
var mockCancelled: string[];
// Scan bookkeeping. Both startDeviceScan and stopDeviceScan return
// Promise<void> in react-native-ble-plx and are documented as rejecting
// "if the operation is impossible to perform" -- an Android build without
// the runtime BLUETOOTH_SCAN grant being the everyday case.
// eslint-disable-next-line no-var
var mockScan: {
  startError: Error | null;
  stopError: Error | null;
  listener: ((e: unknown, d: unknown) => void) | null;
  stops: number;
};

jest.mock('react-native-ble-plx', () => {
  mockLinks = new Set<string>();
  mockCancelled = [];
  mockScan = { startError: null, stopError: null, listener: null, stops: 0 };
  return {
    State: { PoweredOn: 'PoweredOn' },
    BleManager: class {
      onStateChange(cb: (s: string) => void, emitCurrent?: boolean) {
        if (emitCurrent) cb('PoweredOn');
        return { remove: jest.fn() };
      }
      async state() {
        return 'PoweredOn';
      }
      startDeviceScan(_uuids: unknown, _opts: unknown, listener: (e: unknown, d: unknown) => void) {
        mockScan.listener = listener;
        return mockScan.startError ? Promise.reject(mockScan.startError) : Promise.resolve();
      }
      stopDeviceScan() {
        mockScan.stops += 1;
        return mockScan.stopError ? Promise.reject(mockScan.stopError) : Promise.resolve();
      }
      async connectToDevice() {
        throw new Error('not used by these tests');
      }
      async cancelDeviceConnection(id: string) {
        mockCancelled.push(id);
        mockLinks.delete(id);
      }
    },
  };
});

// Imported AFTER the mock above, so the BleManager its field initialiser
// constructs is the fake one.
// eslint-disable-next-line import/first
import { PhoneBoxClient } from './PhoneBoxClient';

const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');
const encode = (s: string) => Buffer.from(s, 'utf8').toString('base64');

interface FakeDevice {
  id: string;
  writes: { char: string; value: string }[];
  connect: jest.Mock;
  discoverAllServicesAndCharacteristics: jest.Mock;
  onDisconnected: jest.Mock;
  monitorCharacteristicForService: jest.Mock;
  writeCharacteristicWithResponseForService: jest.Mock;
  readCharacteristicForService: jest.Mock;
  /** Deliver a notification on `char`, the way the peripheral does -- but
   * only to a monitor that is still subscribed, which is the whole point
   * of the teardown tests below. */
  notify: (char: string, json: string) => void;
}

/** A peripheral that behaves like a real one in the single respect these
 * tests turn on: `connect()` establishes a GATT link that outlives any
 * failure further up, and only cancelDeviceConnection takes it down. */
function makeDevice(id = 'box-1', opts: { discoverFails?: boolean } = {}): FakeDevice {
  const monitors = new Map<string, (err: unknown, c: { value: string } | null) => void>();
  const device: FakeDevice = {
    id,
    writes: [],
    connect: jest.fn(async () => {
      mockLinks.add(id);
      return device;
    }),
    discoverAllServicesAndCharacteristics: jest.fn(async () => {
      if (opts.discoverFails) throw new Error('GATT discovery failed');
      return device;
    }),
    onDisconnected: jest.fn(() => ({ remove: jest.fn() })),
    monitorCharacteristicForService: jest.fn(
      (_svc: string, char: string, cb: (err: unknown, c: { value: string } | null) => void) => {
        monitors.set(char, cb);
        return { remove: () => monitors.delete(char) };
      },
    ),
    writeCharacteristicWithResponseForService: jest.fn(async (_svc: string, char: string, value: string) => {
      if (!mockLinks.has(id)) throw new Error('device disconnected');
      device.writes.push({ char, value: decode(value) });
      return {};
    }),
    readCharacteristicForService: jest.fn(async () => ({ value: null })),
    notify: (char, json) => monitors.get(char)?.(null, { value: encode(json) }),
  };
  return device;
}

beforeEach(() => {
  mockLinks.clear();
  mockCancelled.length = 0;
  mockScan.startError = null;
  mockScan.stopError = null;
  mockScan.listener = null;
  mockScan.stops = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('alert nonce', () => {
  /** One cold launch: a brand-new client (and so a brand-new process's worth
   * of in-memory state), connected, alerting a single call. */
  const launchAndAlert = async (): Promise<string> => {
    const client = new PhoneBoxClient();
    const device = makeDevice();
    await client.connect(device as never, {});
    await client.alertCall('Call');
    const alert = device.writes.filter((w) => w.char === CHAR.alert);
    expect(alert).toHaveLength(1);
    return alert[0].value;
  };

  // The box drops a repeated alert payload, by design: lock_ble.py's
  // _drain_inbound only acts when `alert != self._last_alert`, and a GATT
  // characteristic keeps whatever was last written to it. That dedupe is
  // right -- the app writes the same characteristic on a cadence -- but it
  // makes an app-side nonce that restarts from 0 on every launch silently
  // fatal: the second launch's first alert is byte-for-byte the first
  // launch's, so the box ignores it and notify_call never runs. The box's
  // own _last_alert is set once at boot and is NOT cleared in _on_connected,
  // so reconnecting does not clear it either.
  //
  // This is the designed-for case, not an edge case: iOS terminating a
  // backgrounded app and cold-launching it again for a BLE event is exactly
  // what CoreBluetooth state restoration exists for (see the manager's
  // restoreStateIdentifier). And there is no retry behind it -- CallMonitor
  // marks the call alerted because the WRITE succeeded; only a rejected
  // write is un-marked.
  it('never repeats a previous launch payload for the same caller', async () => {
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_758_000_000_000);
    const firstLaunch = await launchAndAlert();

    // Relaunched some time later -- the app has forgotten everything, the
    // box has not.
    nowSpy.mockReturnValue(1_758_000_612_000);
    const secondLaunch = await launchAndAlert();

    expect(secondLaunch).not.toBe(firstLaunch);
    nowSpy.mockRestore();
  });

  it('still varies every alert within one launch', async () => {
    const client = new PhoneBoxClient();
    const device = makeDevice();
    await client.connect(device as never, {});
    await client.alertCall('Call');
    await client.alertCall('Call');
    const alerts = device.writes.filter((w) => w.char === CHAR.alert).map((w) => w.value);
    expect(new Set(alerts).size).toBe(2);
  });

  it('leaves the label the box actually displays untouched', async () => {
    const client = new PhoneBoxClient();
    const device = makeDevice();
    await client.connect(device as never, {});
    await client.alertCall('Call');
    const [alert] = device.writes.filter((w) => w.char === CHAR.alert);
    // lock_ble.py: `label = alert.split("|", 1)[-1]`.
    expect(alert.value.split('|').slice(-1)[0]).toBe('Call');
    expect(alert.value).toMatch(/^\d+\|Call$/);
  });
});

// A connection that fails PART WAY is the dangerous shape, because
// device.connect() has already taken a real GATT link out of the OS by then.
// Rejecting without handing that link back does not merely fail this
// attempt: a connected peripheral stops advertising, so scanForBox can no
// longer see it, and connectById rejects with DeviceAlreadyConnected. There
// is no route back short of power-cycling the box.
describe('a connect attempt that fails after the link is up', () => {
  it('hands the GATT link back when service discovery rejects', async () => {
    const client = new PhoneBoxClient();
    const device = makeDevice('box-1', { discoverFails: true });

    await expect(client.connect(device as never, {})).rejects.toThrow('GATT discovery failed');

    expect(mockCancelled).toEqual(['box-1']);
    expect(mockLinks.has('box-1')).toBe(false);
    expect(client.connected).toBe(false);
  });

  it('leaves nothing for a later disconnect() to clean up, because there is nothing left', async () => {
    // The teardown has to happen inside the failing attempt. By the time the
    // caller could react, disconnect() has nothing to work with: `device` was
    // never assigned and connect()'s `finally` has already cleared
    // pendingDeviceId, so its `targets` list is empty.
    const client = new PhoneBoxClient();
    const device = makeDevice('box-1', { discoverFails: true });
    await expect(client.connect(device as never, {})).rejects.toThrow();

    mockCancelled.length = 0;
    await client.disconnect();
    expect(mockCancelled).toEqual([]);
    expect(mockLinks.has('box-1')).toBe(false);
  });

  it('still tears down when the clock sync at the end of the handshake rejects', async () => {
    // The pre-existing half of the same guarantee -- everything above
    // syncTime is committed by then, so "connect failed" has to mean
    // disconnected for this path too.
    const client = new PhoneBoxClient();
    const device = makeDevice('box-2');
    device.writeCharacteristicWithResponseForService.mockRejectedValueOnce(new Error('radio stalled'));

    await expect(client.connect(device as never, {})).rejects.toThrow('radio stalled');

    expect(mockCancelled).toEqual(['box-2']);
    expect(client.connected).toBe(false);
  });

  it('removes the notify subscriptions it had already installed', async () => {
    // A monitor left live on a link the caller believes is gone keeps
    // pushing status into a store that has moved on -- the same
    // double-delivery closeSession() exists to prevent.
    const client = new PhoneBoxClient();
    const device = makeDevice('box-3');
    const removes = [
      jest.fn(),
      jest.fn(),
      jest.fn(),
    ];
    let i = 0;
    device.onDisconnected.mockImplementation(() => ({ remove: removes[i++] }));
    device.monitorCharacteristicForService.mockImplementation(() => ({ remove: removes[i++] }));
    device.writeCharacteristicWithResponseForService.mockRejectedValueOnce(new Error('radio stalled'));

    await expect(
      client.connect(device as never, { onStatus: jest.fn(), onHistory: jest.fn() }),
    ).rejects.toThrow('radio stalled');

    for (const remove of removes) expect(remove).toHaveBeenCalled();
  });
});

// scanForBox's only failure report used to be its own timeout. Both scan
// calls return promises that "may be rejected if the operation is
// impossible to perform" (react-native-ble-plx), and both were called
// bare -- so a scan that could not start at all did not fail the scan, it
// produced an unhandled rejection and then, ten seconds later, the
// misleading "No PhoneBox found in range".
describe('scanForBox', () => {
  it('rejects with the real reason when the scan cannot be started at all', async () => {
    // Fake timers so nothing here can be rescued by the 10s timeout: the
    // rejection has to come from the failed start itself. Android without
    // a runtime BLUETOOTH_SCAN grant is the everyday version of this, and
    // "No PhoneBox found in range" sends the user hunting for the box.
    jest.useFakeTimers();
    const client = new PhoneBoxClient();
    mockScan.startError = new Error('Missing BLUETOOTH_SCAN permission');

    await expect(client.scanForBox(10_000)).rejects.toThrow('Missing BLUETOOTH_SCAN permission');
  });

  it('still reports its own timeout when the scan started fine and found nothing', async () => {
    jest.useFakeTimers();
    const client = new PhoneBoxClient();
    const scan = client.scanForBox(10_000);
    const settled = expect(scan).rejects.toThrow('No PhoneBox found in range');
    jest.advanceTimersByTime(10_000);
    await settled;
  });

  it('resolves with the box even if stopping the scan rejects', async () => {
    // The stop is cleanup, not part of the result. Its rejection is
    // swallowed rather than allowed to escape as an unhandled rejection --
    // which is all that changes here, so this pins the outcome that must
    // NOT change with it.
    jest.useFakeTimers();
    const client = new PhoneBoxClient();
    mockScan.stopError = new Error('scan already stopped');

    const scan = client.scanForBox(10_000);
    mockScan.listener!(null, { id: 'box-1' });

    await expect(scan).resolves.toEqual({ id: 'box-1' });
    expect(mockScan.stops).toBe(1);
  });

  it('surfaces a scan error delivered through the listener', async () => {
    jest.useFakeTimers();
    const client = new PhoneBoxClient();
    const scan = client.scanForBox(10_000);
    mockScan.listener!(new Error('scan failed mid-flight'), null);

    await expect(scan).rejects.toThrow('scan failed mid-flight');
  });
});

// disconnect() cancelled the GATT link and stopped there, leaving this
// object's own view of the world untouched until the OS got round to
// calling onDisconnected. In between -- an interval nobody controls -- the
// client still reported `connected`, still had both notify monitors
// subscribed, and would still attempt writes down a link it had just asked
// to be torn down.
describe('disconnect', () => {
  const connected = async (cb = {}) => {
    const client = new PhoneBoxClient();
    const device = makeDevice();
    await client.connect(device as never, cb);
    return { client, device };
  };

  it('reports disconnected as soon as it returns, not when the OS gets round to it', async () => {
    const { client } = await connected();
    expect(client.connected).toBe(true);

    await client.disconnect();

    // Every command in useStore is guarded on this (`if (!client.connected)
    // return`), so a stale `true` is the difference between an action
    // quietly doing nothing and one that reports a write failure.
    expect(client.connected).toBe(false);
  });

  it('stops delivering box status into a caller that has already let go', async () => {
    const onStatus = jest.fn();
    const { client, device } = await connected({ onStatus });
    device.notify(CHAR.status, '{"st":"running","rem":10,"set":60,"bat":50,"tp":"","fw":"1.0"}');
    expect(onStatus).toHaveBeenCalledTimes(1);

    await client.disconnect();
    // A frame already in flight when the cancel went out. The store has
    // just set `status: null`; this would put a live countdown back on a
    // screen the user disconnected from.
    device.notify(CHAR.status, '{"st":"running","rem":9,"set":60,"bat":50,"tp":"","fw":"1.0"}');

    expect(onStatus).toHaveBeenCalledTimes(1);
  });

  it('stops delivering history batches too', async () => {
    const onHistory = jest.fn();
    const { client, device } = await connected({ onHistory });
    await client.disconnect();

    device.notify(CHAR.history, '[{"p":1800,"a":1800,"c":1,"t":1700000000}]');

    expect(onHistory).not.toHaveBeenCalled();
  });

  it('is safe to call twice', async () => {
    const { client } = await connected();
    await client.disconnect();
    await expect(client.disconnect()).resolves.toBeUndefined();
    expect(client.connected).toBe(false);
  });
});
