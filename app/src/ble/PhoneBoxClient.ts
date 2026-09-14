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
  cmdSetPendingTopic,
} from './protocol';
// ClientCallbacks was declared in this file until a second implementation of
// the same surface existed; it lives in BoxClient.ts now, next to the
// interface it is part of, and is imported back here rather than re-exported
// -- nothing outside this file ever imported it from here.
import type { BoxClient, ClientCallbacks } from './BoxClient';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const fromB64 = (s: string | null) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');

// `implements BoxClient` is not decoration: this class is no longer the only
// thing useStore can be holding (see ble/DemoBoxClient.ts), and without the
// clause a method whose shape drifts away from the contract would only be
// caught at the one assignment in useStore -- or, if that assignment were
// ever widened, not at all.
export class PhoneBoxClient implements BoxClient {
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
      // __DEV__-gated for the same reason App.tsx's capability probe is:
      // a restoration callback firing is expected behavior, not a fault, so
      // it has no business writing to a release build's log.
      if (__DEV__ && restoredState?.connectedPeripherals?.length) {
        console.log(
          '[PhoneBoxClient] BLE state restored:',
          restoredState.connectedPeripherals.map((p) => p.id),
        );
      }
    },
  });
  private device: Device | null = null;
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
  // Every listener belonging to the CURRENT connection session: the
  // onDisconnected handler plus whichever status/history notify monitors the
  // caller asked for. Lives on the instance rather than as a local in
  // afterConnect so a session that gets superseded by a newer connect can be
  // torn down by the session replacing it -- see closeSession().
  private sessionSubs: Subscription[] = [];

  /** Drop every listener from the current session. Safe to call repeatedly,
   * and safe to call from inside one of the very subscriptions it removes.
   *
   * A session's listeners used to be removed in exactly one place: its own
   * `onDisconnected` handler, which bails out early if `this.device` has
   * already moved on to a newer connection. So whenever a session WAS
   * superseded -- the reconnect race in disconnect() below, or iOS handing
   * back the same underlying peripheral through CoreBluetooth state
   * restoration -- that early return was reached and the old session's
   * status/history monitors were never removed at all. Both generations then
   * stayed live on the same connection, so every box status tick and history
   * push ran the caller's onStatus/onHistory twice (double-counting a
   * session), and one more monitor leaked on every such reconnect for the
   * life of the app. */
  private closeSession() {
    const subs = this.sessionSubs;
    this.sessionSubs = [];
    subs.forEach((s) => s.remove());
  }

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
    // Whatever session this one is replacing does not get to keep listening.
    // Its own onDisconnected can't do this for us -- by the time it fires,
    // the guard below sees `this.device` has moved on and returns early.
    this.closeSession();
    this.device = d;
    const sessionSubs = this.sessionSubs;

    sessionSubs.push(
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
        this.closeSession();
        this.device = null;
        cb.onDisconnect?.();
      }),
    );

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
    try {
      await this.syncTime();
    } catch (e) {
      // This rejection propagates out of connect()/connectById(), and every
      // caller (useStore's connect/autoconnect) reads that as "the connection
      // failed" -- re-enabling Connect, surfacing an error. Everything above
      // is already committed by this point though, so without this the client
      // was left in the opposite state from what the caller had just been
      // told: `connected` true, both notify monitors live and still firing
      // onStatus/onHistory into a UI that believes there is no connection,
      // and a user-tapped retry stacking a second live session on top of it.
      // Tear the half-built session back down so "connect failed" means
      // disconnected.
      this.closeSession();
      if (this.device === d) this.device = null;
      try {
        await this.manager.cancelDeviceConnection(d.id);
      } catch {
        // Already gone -- the radio stall that failed syncTime may well have
        // been the link dropping in the first place.
      }
      throw e;
    }
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

  /** Best-effort, one-way push of the topic already picked in the app, ahead
   * of a session existing -- see protocol.ts's cmdSetPendingTopic for the
   * wire format and rationale. Its own dedicated characteristic, same
   * reasoning as setLabels above: the box's apply_ble_command opcode path is
   * rate-limited and this shouldn't have to wait behind it. */
  setPendingTopic(topicId: string | null) {
    return this.write(CHAR.pendingTopic, cmdSetPendingTopic(topicId));
  }

  get connected() {
    return this.device !== null;
  }

  async disconnect() {
    // Cancel BOTH "already connected" and "still connecting" when both are
    // set, rather than picking one -- see pendingDeviceId's comment above for
    // why the pending one matters at all.
    //
    // This used to be `this.device?.id ?? this.pendingDeviceId`, which only
    // ever cancelled one. That is fine when only one exists, but the two
    // overlap exactly when it matters most: the link is flapping, the
    // caller's auto-reconnect has already started a fresh connectById() (now
    // the pending id) while the old Device object is still sitting in
    // `this.device` because its onDisconnected hasn't fired yet. `??` picked
    // the old one, so the user's Disconnect tore down a connection that was
    // already dying and left the in-flight attempt running -- it resolved
    // through afterConnect moments later and reassigned `this.device`, and
    // the app silently reconnected to the box the user had just disconnected
    // from. That is the same class of bug pendingDeviceId was added for, just
    // the case where `this.device` is non-null rather than null.
    const targets = [this.device?.id, this.pendingDeviceId].filter(
      (id, i, all): id is string => !!id && all.indexOf(id) === i,
    );
    for (const id of targets) {
      try {
        await this.manager.cancelDeviceConnection(id);
      } catch {
        // Nothing to cancel (never actually connected/connecting) -- fine.
      }
    }
  }
}
