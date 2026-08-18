// PhoneBoxClient.ts -- the app's BLE service layer over react-native-ble-plx.
// Scan by service UUID -> connect -> subscribe to status/history notifications
// -> read/write the characteristics defined in protocol.ts. One box, one
// connection; auto-reconnect is left to the caller (see useStore).
import { BleManager, BleRestoredState, Device, Subscription, State } from 'react-native-ble-plx';
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
  cmdSetDuration,
  cmdLock,
  cmdUnlock,
  encodeSettings,
  encodeTime,
  encodeAlert,
  cmdHistoryAck,
  cmdSetLabels,
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
  // restoreStateIdentifier/restoreStateFunction opt this BleManager into iOS
  // CoreBluetooth state restoration (see
  // docs/rfcs/ios-background-wake-and-call-notification-architecture.md §3.2,
  // §5.1): when the OS cold-launches the app for a qualifying BLE event after
  // a system-initiated termination, it hands the *same* identifier's central
  // manager back its connecting/connected peripherals. We don't need to do
  // anything with the restored peripherals ourselves here -- connectById()'s
  // call to manager.connectToDevice() on the same remembered device id
  // (see useStore.ts) reattaches to whatever CoreBluetooth just handed back;
  // connecting to an already-connected/connecting CBPeripheral is a no-op at
  // the OS level that still resolves normally. This callback mainly needs to
  // exist at all -- BleManager only restores state when both
  // restoreStateIdentifier and restoreStateFunction are provided together.
  private manager = new BleManager({
    restoreStateIdentifier: 'phonebox-central',
    restoreStateFunction: (restoredState: BleRestoredState | null) => {
      if (restoredState?.connectedPeripherals?.length) {
        console.log(
          '[PhoneBoxClient] BLE state restored:',
          restoredState.connectedPeripherals.map((p) => p.id),
        );
      }
    },
  });
  private device: Device | null = null;
  private subs: Subscription[] = [];
  private alertNonce = 0;
  // The device id of a connect() / connectById() call that's still awaiting
  // the native connect promise, i.e. before it has landed in `this.device`.
  // Without this, disconnect() called while a connection attempt is in
  // flight (user taps Disconnect right after Connect, or a manual
  // disconnect races an auto-reconnect) has nothing to cancel -- `device` is
  // still null, so the pending connectToDevice() keeps running in the
  // background and silently re-establishes the very connection the user
  // just asked to tear down. See disconnect() below.
  private pendingDeviceId: string | null = null;

  /** Resolve once Bluetooth is powered on (iOS asks for permission here).
   * Rejects after `timeoutMs` if it never does -- previously had no timeout
   * at all, so Bluetooth left off/denied left `conn` stuck on 'scanning'
   * forever with no error surfaced and no way out short of a manual
   * disconnect (see useStore.ts's connect(), which already treats any
   * rejection here the same as a connect failure). */
  async waitForPoweredOn(timeoutMs = 10000): Promise<void> {
    const state = await this.manager.state();
    if (state === State.PoweredOn) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.remove();
        reject(new Error('Bluetooth did not turn on -- check that Bluetooth is enabled and permitted.'));
      }, timeoutMs);
      const sub = this.manager.onStateChange((s) => {
        if (s === State.PoweredOn) {
          clearTimeout(timer);
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

  // timeoutMs defaults match connectById's below -- previously this path had
  // no timeout at all, so a peripheral that accepted the GATT connection but
  // never finished negotiating could leave the app stuck in "Connecting"
  // indefinitely with no error and (before the pendingDeviceId fix above) no
  // way to cancel via Disconnect either.
  async connect(device: Device, cb: ClientCallbacks, timeoutMs = 6000): Promise<void> {
    this.pendingDeviceId = device.id;
    try {
      // pendingDeviceId must stay set through afterConnect too, not just the
      // native connect() promise -- afterConnect doesn't assign `this.device`
      // until after discoverAllServicesAndCharacteristics() resolves, so a
      // disconnect() racing that window used to see neither `this.device` nor
      // `pendingDeviceId` set and silently no-op, letting a user-cancelled
      // connect complete anyway (production readiness review, Medium:
      // "connect-cancel race"). Clearing pendingDeviceId only in this
      // `finally` -- once the whole try, including afterConnect, has settled
      // -- closes that window.
      const d = await device.connect({ timeout: timeoutMs });
      await this.afterConnect(d, cb);
    } finally {
      this.pendingDeviceId = null;
    }
  }

  /** Connect straight to a remembered device id (no scan) -- the autoconnect path. */
  async connectById(deviceId: string, cb: ClientCallbacks, timeoutMs = 6000): Promise<void> {
    this.pendingDeviceId = deviceId;
    try {
      // See connect()'s comment above -- same fix, same reason.
      const d = await this.manager.connectToDevice(deviceId, { timeout: timeoutMs });
      await this.afterConnect(d, cb);
    } finally {
      this.pendingDeviceId = null;
    }
  }

  private async afterConnect(d: Device, cb: ClientCallbacks): Promise<void> {
    await d.discoverAllServicesAndCharacteristics();
    this.device = d;
    // Own array per connection session, not the shared `this.subs` field --
    // see the onDisconnected guard below for why.
    const sessionSubs: Subscription[] = [];
    this.subs = sessionSubs;

    d.onDisconnected(() => {
      // A native disconnect event for THIS device object can arrive after
      // it's already been superseded by a newer connection (reconnect raced
      // ahead of a delayed callback for the old session -- observed in
      // practice on both platforms' BLE stacks). If `this.device` has moved
      // on, this event is stale: acting on it would tear down the new
      // connection's subscriptions and flip the store back to disconnected
      // out from under a connection that's actually fine -- exactly the
      // "sometimes it just won't reconnect" symptom, since the app then
      // looks connected but silently stops receiving status/history.
      if (this.device !== d) return;
      sessionSubs.forEach((s) => s.remove());
      this.subs = [];
      this.device = null;
      cb.onDisconnect?.();
    });

    if (cb.onStatus) {
      sessionSubs.push(
        d.monitorCharacteristicForService(SERVICE_UUID, CHAR.status, (err, c) => {
          // A dropped notify subscription used to fail this silently, leaving
          // the app sitting in 'connected' with no further status updates --
          // indistinguishable from healthy in the UI (production readiness
          // review, Medium: "silent BLE notify-subscription failures"). This
          // doesn't attempt automatic recovery (the subscription itself is
          // one-shot per connection -- a real fix is reconnecting, which
          // onDisconnected/scheduleReconnect already handle for an actual
          // disconnect); logging at least makes the failure observable
          // instead of indistinguishable from a healthy, quiet connection.
          if (err) console.warn('[PhoneBoxClient] status notify error:', err.message);
          if (err || !c) return;
          const s = parseStatus(fromB64(c.value));
          if (s) cb.onStatus!(s);
        }),
      );
    }
    if (cb.onHistory) {
      sessionSubs.push(
        d.monitorCharacteristicForService(SERVICE_UUID, CHAR.history, (err, c) => {
          if (err) console.warn('[PhoneBoxClient] history notify error:', err.message);
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
  /** Pushes the picked duration to the box without starting the countdown --
   * see protocol.ts's cmdSetDuration for why this is a separate opcode from
   * startLock above. */
  setDuration(seconds: number) {
    return this.write(CHAR.command, cmdSetDuration(seconds));
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

  /** Tell the box an important call is ringing -> it alerts (or, if the box's
   * "unlock when called" setting is on, unlocks) -- see lock_controller.notify_call. */
  alertCall(label: string) {
    this.alertNonce = (this.alertNonce + 1) % 100000;
    return this.write(CHAR.alert, encodeAlert(this.alertNonce, label));
  }

  /** Ack a drained `history` batch (by entry count) once it's durably stored
   * locally -- see protocol.ts's cmdHistoryAck and
   * Box-code/lib/lock_log.py's SessionLog.ack for why the box waits for this
   * before clearing its own pending queue. Call from onHistory's consumer
   * only after the batch has actually been persisted (see useStore.ts's
   * handleHistory), not just received. */
  ackHistory(seq: number) {
    return this.write(CHAR.command, cmdHistoryAck(seq));
  }

  /** Best-effort, one-way push of the custom-label catalog -- see
   * protocol.ts's cmdSetLabels for the wire format. Its own dedicated
   * characteristic, not CHAR.command -- the box reads this one directly
   * (lock_ble.py's _drain_inbound), not through apply_ble_command's opcode
   * dispatcher. */
  setLabels(labels: { id: string; name: string; color: string }[]) {
    return this.write(CHAR.labels, cmdSetLabels(labels));
  }

  get connected() {
    return this.device !== null;
  }

  async disconnect() {
    // Cancel whichever of "already connected" or "still connecting" applies
    // -- see pendingDeviceId's comment above for why the latter matters.
    const targetId = this.device?.id ?? this.pendingDeviceId;
    if (!targetId) return;
    try {
      await this.manager.cancelDeviceConnection(targetId);
    } catch {
      // Nothing to cancel (never actually connected/connecting) -- fine.
    }
  }
}
