// BoxClient.ts -- the box-facing surface the rest of the app actually
// depends on, as an interface rather than a concrete class.
//
// There used to be no interface at all: useStore held a PhoneBoxClient and
// CallMonitor took one. That was fine while there was exactly one
// implementation, and stopped being fine the moment a second one existed
// (ble/DemoBoxClient.ts, the no-hardware demonstration mode -- see
// docs/handoff/demo-mode-handoff.md). Naming the surface here is what keeps
// that substitution honest: the demo client has to satisfy a declared
// contract, instead of being cast into a position it only approximately
// fills, and anything added to PhoneBoxClient that useStore starts calling
// has to be added here too -- which is the point at which someone notices
// the demo client needs it as well.
//
// This module deliberately imports nothing but protocol types. Neither
// PhoneBoxClient's react-native-ble-plx dependency nor the demo client's
// timers belong in the file that merely says what a box client IS -- and
// keeping it clean is what lets CallMonitor (and its unit test) depend on
// the contract without dragging a BleManager into the module graph.
import type { Status, HistoryEntry, Settings } from './protocol';

export interface ClientCallbacks {
  onStatus?: (s: Status) => void;
  // Sessions the box finished while no phone was connected -- see
  // firmware/lib/lock_log.py. Fires at most once per connection since the
  // box clears its queue as soon as it pushes this notify.
  onHistory?: (entries: HistoryEntry[]) => void;
  onDisconnect?: () => void;
}

/**
 * Whatever `scanForBox()` handed back, handed straight back into `connect()`.
 *
 * Deliberately opaque rather than react-native-ble-plx's `Device`: useStore
 * passes the scan result into connect() and never reads a single field off
 * it, so naming the concrete type here would buy nothing and cost a lot --
 * every implementation of this interface would have to fabricate a real
 * `Device`, which for the demo client means standing up a peripheral object
 * whose ~40 members exist only to satisfy a type nobody calls.
 */
export type BoxDevice = object;

/**
 * Exactly what store/useStore.ts and calls/CallMonitor.ts call on a box
 * client -- no more (this is not a mirror of PhoneBoxClient's public API)
 * and no less.
 *
 * Every member below is written in method syntax, which TypeScript checks
 * bivariantly. That is what lets PhoneBoxClient keep its own precise
 * `connect(device: Device, ...)` signature for its own callers while still
 * satisfying the opaque `BoxDevice` above.
 */
export interface BoxClient {
  // ----- lifecycle -----
  waitForPoweredOn(timeoutMs?: number): Promise<void>;
  scanForBox(timeoutMs?: number): Promise<BoxDevice>;
  connect(device: BoxDevice, cb: ClientCallbacks, timeoutMs?: number): Promise<void>;
  connectById(deviceId: string, cb: ClientCallbacks, timeoutMs?: number): Promise<void>;
  disconnect(): Promise<void>;

  // ----- accessors -----
  /** The connected box's id, for remembering "the box" across app launches
   * (useStore's LAST_DEVICE_KEY). Null when there is nothing worth
   * remembering -- see DemoBoxClient's own getter. */
  readonly deviceId: string | null;
  readonly connected: boolean;

  // ----- commands -----
  // Typed as Promise<unknown> rather than Promise<void>: every caller either
  // awaits for sequencing or attaches a .catch, and none reads a value, so
  // an implementation is free to resolve with whatever its transport hands
  // back (PhoneBoxClient's writes resolve with a Characteristic).
  startLock(seconds: number): Promise<unknown>;
  setDuration(seconds: number): Promise<unknown>;
  lock(): Promise<unknown>;
  unlock(): Promise<unknown>;
  readSettings(): Promise<Settings | null>;
  writeSettings(s: Settings): Promise<unknown>;
  syncTime(): Promise<unknown>;
  alertCall(label: string): Promise<unknown>;
  ackHistory(seq: number): Promise<unknown>;
  setLabels(labels: { id: string; name: string; color: string }[]): Promise<unknown>;
  setPendingTopic(topicId: string | null): Promise<unknown>;
}
