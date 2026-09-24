// useStore.history.test.ts -- the session-logging path: what happens between
// the box pushing a finished-session batch over BLE and those sessions
// existing in the durable log.
//
// This is the only path by which focus time ever gets recorded, and its
// failure modes are permanent rather than transient. The box holds each
// finished session in RAM and drops its queue ONLY when it hears an ack
// (firmware/lib/lock_log.py's SessionLog.ack), so acking a batch that was not
// actually stored loses those sessions for good, while not acking one that
// was stored is harmless -- the box simply resends and appendSessions dedupes.
// Every case below is about keeping that asymmetry pointing the right way.
//
// Driven through the real wiring rather than by reaching for a private
// function: the fake client below captures the callbacks useStore hands to
// connect(), which is exactly how a real box delivers a batch.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from './useStore';
import { loadSessions } from '../stats/sessionHistory';
import type { HistoryEntry } from '../ble/protocol';

/** Callbacks useStore passed to the client on its last connect(). */
let mockCaptured: { onStatus?: (s: unknown) => void; onHistory?: (e: HistoryEntry[]) => void; onDisconnect?: () => void } = {};
const mockAckHistory = jest.fn(async (_count: number) => {});
let mockAppendShouldFail = false;
let mockAppendGate: Promise<void> | null = null;

jest.mock('../ble/PhoneBoxClient', () => ({
  PhoneBoxClient: class {
    deviceId = 'box-1';
    connected = true;
    waitForPoweredOn = jest.fn(async () => {});
    scanForBox = jest.fn(async () => ({ id: 'box-1' }));
    connect = jest.fn(async (_device: unknown, cb: typeof mockCaptured) => {
      mockCaptured = cb;
    });
    connectById = jest.fn(async (_id: string, cb: typeof mockCaptured) => {
      mockCaptured = cb;
    });
    disconnect = jest.fn(async () => {});
    readSettings = jest.fn(async () => null);
    setLabels = jest.fn(async () => {});
    setPendingTopic = jest.fn(async () => {});
    syncTime = jest.fn(async () => {});
    // A prototype METHOD, not a field holding mockAckHistory: jest hoists
    // this factory above the `const` above it, and useStore constructs its
    // client at module load -- so a field initializer would capture the
    // still-uninitialized binding and store `undefined`. Calling through
    // resolves it at call time instead. (The symptom was silent: the failed
    // call landed in handleHistory's own catch, so sessions were stored and
    // the ack simply never happened.)
    ackHistory(count: number) {
      return mockAckHistory(count);
    }
  },
}));

jest.mock('../calls/CallMonitor', () => ({
  CallMonitor: class {
    available = false;
    start = jest.fn();
    stop = jest.fn();
    // handleStatus calls this on every box status notify now -- see
    // CallMonitor.checkNow for why the alert can't rely on the event alone.
    checkNow = jest.fn();
  },
}));

// Wraps the real module so the durable append can be made to fail on demand
// -- the one case where acking would actively lose data.
jest.mock('../stats/sessionHistory', () => {
  const actual = jest.requireActual('../stats/sessionHistory');
  return {
    ...actual,
    appendSessions: jest.fn(async (sessions) => {
      if (mockAppendShouldFail) throw new Error('storage full');
      // Lets a test hold the drain open at exactly the point where the
      // batch has been received but not yet acked -- the window in which
      // the connection underneath it can change.
      if (mockAppendGate) await mockAppendGate;
      return actual.appendSessions(sessions);
    }),
  };
});

/** Seconds since the epoch, as the box reports them. */
const endedAt = (msAgo: number) => Math.floor((Date.now() - msAgo) / 1000);

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  p: 1800,
  a: 1800,
  c: 1,
  t: endedAt(60_000),
  ...over,
});

/** Connects the store to the fake box and returns the mockCaptured callbacks. */
async function connectBox() {
  mockCaptured = {};
  await useStore.getState().connect();
  expect(mockCaptured.onHistory).toBeInstanceOf(Function);
  return mockCaptured;
}

/**
 * Delivers a batch and waits for the async handling chain to settle.
 *
 * handleHistory is fire-and-forget by design (nothing awaits it -- it hangs
 * off a BLE notify callback), and it goes storage read -> build -> storage
 * write -> ack, each of which yields. Drained by turning the macrotask queue
 * over a fixed number of times rather than by waiting for the ack itself,
 * because several cases below assert the ack NEVER comes and would otherwise
 * have nothing to wait for.
 */
async function deliver(entries: HistoryEntry[]) {
  mockCaptured.onHistory!(entries);
  for (let i = 0; i < 25; i += 1) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  // Before the storage wipe: switching demo mode off reconnects the real
  // client, which writes LAST_DEVICE_KEY on the way through.
  await useStore.getState().setDemoMode(false);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAppendShouldFail = false;
  mockAppendGate = null;
  useStore.setState({ sessions: [], conn: 'idle', status: null, currentTopic: null });
});

// The demo client runs a real setInterval for its clock, so leaving demo
// mode on at the end of the run keeps the worker alive after the last
// assertion. (beforeEach covers every test but the last one.)
afterAll(async () => {
  await useStore.getState().setDemoMode(false);
});

describe('a history batch from the box', () => {
  it('lands in the durable log and is acked by entry count', async () => {
    await connectBox();
    await deliver([entry({ a: 1800 }), entry({ a: 900 })]);

    const stored = await loadSessions();
    expect(stored).toHaveLength(2);
    expect(useStore.getState().sessions).toHaveLength(2);
    // Acked by the count the box sent, which is how it knows which queue to
    // drop -- see firmware/lib/lock_log.py's SessionLog.ack.
    expect(mockAckHistory).toHaveBeenCalledWith(2);
  });

  // Sub-minute records are accidental taps, not focus time. They are dropped
  // before the log -- but the box still has to be told the batch was handled,
  // by its ORIGINAL count, or it resends the same batch forever.
  it('drops sub-minute entries and still acks the whole batch', async () => {
    await connectBox();
    await deliver([entry({ a: 1800 }), entry({ a: 10 })]);

    expect(await loadSessions()).toHaveLength(1);
    expect(mockAckHistory).toHaveBeenCalledWith(2);
  });

  it('acks a batch that was entirely dropped, rather than leaving it queued', async () => {
    await connectBox();
    await deliver([entry({ a: 5 }), entry({ a: 10 })]);

    expect(await loadSessions()).toHaveLength(0);
    expect(mockAckHistory).toHaveBeenCalledWith(2);
  });

  // The asymmetry that matters. An ack tells the box to forget these
  // sessions; sending one after the local write failed loses them for good.
  // Staying silent costs one duplicate delivery, which dedupes.
  it('does NOT ack when the local write failed', async () => {
    mockAppendShouldFail = true;
    await connectBox();
    await deliver([entry({ a: 1800 })]);

    expect(mockAckHistory).not.toHaveBeenCalled();
    expect(await loadSessions()).toHaveLength(0);
  });

  // What the missing ack above leads to: the box resends next connection.
  // That must not double-count the session.
  it('does not double-count a batch the box resends', async () => {
    await connectBox();
    const batch = [entry({ a: 1800, t: endedAt(60_000) })];
    await deliver(batch);
    await deliver(batch);

    expect(await loadSessions()).toHaveLength(1);
    expect(useStore.getState().sessions).toHaveLength(1);
  });

  it('ignores an empty batch entirely', async () => {
    await connectBox();
    await deliver([]);
    expect(mockAckHistory).not.toHaveBeenCalled();
  });

  // A box that has never had a phone connect reports t = -1 rather than a
  // wall clock. Those sessions still have to be logged -- dropping them would
  // silently lose every session recorded before the first sync.
  it('logs a session from a box whose clock was never set', async () => {
    await connectBox();
    await deliver([entry({ a: 1800, t: -1 })]);

    const stored = await loadSessions();
    expect(stored).toHaveLength(1);
    expect(Number.isFinite(stored[0].startedAt)).toBe(true);
    expect(mockAckHistory).toHaveBeenCalledWith(1);
  });
  // The ack has to reach the box that SENT the batch, and the two can stop
  // being the same thing: the drain is several storage round-trips long,
  // and demo mode swaps the store's whole client out from under whatever
  // is in flight (ble/DemoBoxClient.ts). onStatus/onHistory already guard
  // on that with their own `owner !== client` checks; the ack read the
  // live binding instead and so followed the swap.
  //
  // Both halves of the result are wrong. The box that is owed the ack
  // never hears it, so it holds the batch -- recoverable, since it resends
  // and appendSessions dedupes. The other box is told to drop entries it
  // was never asked about, which SessionLog.ack only refuses because it
  // checks the count against the batch it last sent; two batches of equal
  // length is all it takes for that guard to agree.
  it('acks the client that delivered the batch, not whichever one is installed by the time it lands', async () => {
    await connectBox();
    let release!: () => void;
    mockAppendGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    mockCaptured.onHistory!([entry({ a: 1800 })]);
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(mockAckHistory).not.toHaveBeenCalled(); // held at the durable write

    // The user taps "try demo mode" while that write is still going.
    await useStore.getState().setDemoMode(true);

    release();
    mockAppendGate = null;
    for (let i = 0; i < 25; i += 1) await new Promise((r) => setTimeout(r, 0));

    expect(mockAckHistory).toHaveBeenCalledWith(1);
  });
});
