// PhoneBoxClient.ts -- the app's BLE service layer over react-native-ble-plx.
// Scan by service UUID -> connect -> subscribe to status/stats notifications ->
// read/write the characteristics defined in protocol.ts. One box, one
// connection; auto-reconnect is left to the caller (see useStore).
import { BleManager, Device, Subscription, State } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import {
  SERVICE_UUID,
  CHAR,
  parseStatus,
  parseStats,
  parseSettings,
  Status,
  Stats,
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
  onStats?: (s: Stats) => void;
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
    if (cb.onStats) {
      this.subs.push(
        d.monitorCharacteristicForService(SERVICE_UUID, CHAR.stats, (err, c) => {
          if (err || !c) return;
          const s = parseStats(fromB64(c.value));
          if (s) cb.onStats!(s);
        }),
      );
    }
    // push the current wall clock so the box can date future history/schedules
    await this.syncTime();
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
