// PhoneBoxClient.ts -- the app's BLE service layer over react-native-ble-plx.
// Scan by service UUID -> connect -> subscribe to status/history notifications
// -> read/write the characteristics defined in protocol.ts. One box, one
// connection; auto-reconnect is left to the caller (see useStore).
import { BleManager, Device, Subscription, State } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import {
  SERVICE_UUID,
  CHAR,
  parseStatus,
  parseHistoryEntries,
  parseSettings,
  Status,
  HistoryEntry,
  Settings,
  cmdStart,
  cmdLock,
  cmdUnlock,
  encodeSettings,
  encodeTime,
  encodeAlert,
} from './protocol';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const fromB64 = (s: string | null) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');

export interface ClientCallbacks {
  onStatus?: (s: Status) => void;
  // Sessions the box finished while no phone was connected -- see
  // Box-code/lib/lock_log.py. Fires at most once per connection since the
  // box clears its queue as soon as it pushes this notify.
  onHistory?: (entries: HistoryEntry[]) => void;
  onDisconnect?: () => void;
}

export class PhoneBoxClient {
  private manager = new BleManager();
  private device: Device | null = null;
  private subs: Subscription[] = [];
  private alertNonce = 0;

  /** Resolve once Bluetooth is powered on (iOS asks for permission here). */
  async waitForPoweredOn(): Promise<void> {
    const state = await this.manager.state();
    if (state === State.PoweredOn) return;
    await new Promise<void>((resolve) => {
      const sub = this.manager.onStateChange((s) => {
        if (s === State.PoweredOn) {
          sub.remove();
          resolve();
        }
      }, true);
    });
  }

  /** Scan for the first box advertising our service UUID. */
  scanForBox(timeoutMs = 10000): Promise<Device> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.manager.stopDeviceScan();
        reject(new Error('No PhoneBox found in range'));
      }, timeoutMs);
      this.manager.startDeviceScan([SERVICE_UUID], null, (error, device) => {
        if (error) {
          clearTimeout(timer);
          this.manager.stopDeviceScan();
          reject(error);
          return;
        }
        if (device) {
          clearTimeout(timer);
          this.manager.stopDeviceScan();
          resolve(device);
        }
      });
    });
  }

  async connect(device: Device, cb: ClientCallbacks): Promise<void> {
    const d = await device.connect();
    await this.afterConnect(d, cb);
  }

  /** Connect straight to a remembered device id (no scan) -- the autoconnect path. */
  async connectById(deviceId: string, cb: ClientCallbacks, timeoutMs = 6000): Promise<void> {
    const d = await this.manager.connectToDevice(deviceId, { timeout: timeoutMs });
    await this.afterConnect(d, cb);
  }

  private async afterConnect(d: Device, cb: ClientCallbacks): Promise<void> {
    await d.discoverAllServicesAndCharacteristics();
    this.device = d;

    d.onDisconnected(() => {
      this.subs.forEach((s) => s.remove());
      this.subs = [];
      this.device = null;
      cb.onDisconnect?.();
    });

    if (cb.onStatus) {
      this.subs.push(
        d.monitorCharacteristicForService(SERVICE_UUID, CHAR.status, (err, c) => {
          if (err || !c) return;
          const s = parseStatus(fromB64(c.value));
          if (s) cb.onStatus!(s);
        }),
      );
    }
    if (cb.onHistory) {
      this.subs.push(
        d.monitorCharacteristicForService(SERVICE_UUID, CHAR.history, (err, c) => {
          if (err || !c) return;
          const entries = parseHistoryEntries(fromB64(c.value));
          if (entries.length) cb.onHistory!(entries);
        }),
      );
    }
    // push the current wall clock so the box can date future history/schedules
    await this.syncTime();
  }

  /** The connected device's id, for remembering "the box" across app launches. */
  get deviceId(): string | null {
    return this.device?.id ?? null;
  }

  private async write(charUUID: string, value: string) {
    if (!this.device) throw new Error('Not connected');
    await this.device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      charUUID,
      b64(value),
    );
  }

  async readSettings(): Promise<Settings | null> {
    if (!this.device) return null;
    const c = await this.device.readCharacteristicForService(SERVICE_UUID, CHAR.settings);
    return parseSettings(fromB64(c.value));
  }

  startLock(seconds: number) {
    return this.write(CHAR.command, cmdStart(seconds));
  }
  lock() {
    return this.write(CHAR.command, cmdLock());
  }
  unlock() {
    return this.write(CHAR.command, cmdUnlock());
  }
  writeSettings(s: Settings) {
    return this.write(CHAR.settings, encodeSettings(s));
  }
  syncTime() {
    return this.write(CHAR.timeSync, encodeTime(Date.now() / 1000));
  }

  /** Tell the box an important call is ringing -> it lights up its screen. */
  alertCall(label: string) {
    this.alertNonce = (this.alertNonce + 1) % 100000;
    return this.write(CHAR.alert, encodeAlert(this.alertNonce, label));
  }

  get connected() {
    return this.device !== null;
  }

  async disconnect() {
    if (this.device) await this.manager.cancelDeviceConnection(this.device.id);
  }
}
