// DemoBoxClient.test.ts -- the fake box's state machine, on fake timers.
//
// What these pin down is not "the demo looks right" but the two properties
// the rest of the app silently depends on being true of ANY box client:
// that a session walks idle -> closed -> running -> done on a real clock
// (nothing downstream has a code path for a session that completes
// instantly), and that a finished one arrives as a HistoryEntry batch that
// is held until it is acked (ble/historyIntake.ts is what acks, and the
// asymmetry -- acking an unstored batch loses it forever, not acking a
// stored one costs a deduped resend -- is the reason the queue exists at
// all). A demo that shortcut either would demonstrate a code path no real
// box takes, which is the one thing a demonstration mode must not do.
//
// Run with `npm test`.
import {
  DemoBoxClient,
  DEMO_TICK_MS,
  DEMO_SECONDS_PER_TICK,
  DEMO_LOCK_PRESS_TICKS,
  DEMO_DONE_TICKS,
  DEMO_DEFAULT_SECONDS,
} from './DemoBoxClient';
import type { ClientCallbacks } from './BoxClient';
import { MIN_LOGGED_SESSION_S } from '../stats/sessionHistory';
import type { HistoryEntry, Status } from './protocol';

/** The shortest lock the app's own duration picker can produce
 * (stats/stats.ts's MIN_LOCK_SECONDS), which is the one a reviewer with no
 * time to spare will pick. */
const SHORTEST_PICKABLE_S = 5 * 60;

/** Ticks a full run of `seconds` takes at the demo's own rate. */
const ticksFor = (seconds: number) => Math.ceil(seconds / DEMO_SECONDS_PER_TICK);

let active: DemoBoxClient | null = null;

function setup() {
  const statuses: Status[] = [];
  const batches: HistoryEntry[][] = [];
  const onDisconnect = jest.fn();
  const client = new DemoBoxClient();
  active = client;
  const cb: ClientCallbacks = {
    onStatus: (s) => statuses.push(s),
    onHistory: (entries) => batches.push(entries),
    onDisconnect,
  };
  return { client, cb, statuses, batches, onDisconnect };
}

/** Connects the way useStore's scan path does. */
async function connected() {
  const ctx = setup();
  await ctx.client.connect(await ctx.client.scanForBox(), ctx.cb);
  return ctx;
}

const ticks = (n: number) => jest.advanceTimersByTime(n * DEMO_TICK_MS);
const latest = (statuses: Status[]): Status => statuses[statuses.length - 1];

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  // Every client owns a live setInterval until it is disconnected; one left
  // running would keep firing into the next test's environment.
  await active?.disconnect();
  active = null;
  jest.useRealTimers();
});

describe('connecting', () => {
  it('needs no radio and reports the box straight away', async () => {
    const { client, statuses } = await connected();

    expect(client.connected).toBe(true);
    expect(latest(statuses)).toMatchObject({ st: 'idle', set: DEMO_DEFAULT_SECONDS, rem: 0 });
  });

  // Trap 2 of the handoff, and the reason it is a test rather than a
  // comment: useStore's afterConnected writes client.deviceId to
  // LAST_DEVICE_KEY, and sync/sessionMerge.ts builds every session's
  // Firestore document id out of that same value. A demo client that
  // claimed an id would displace the real box's and move everything logged
  // afterwards into a different doc-id namespace.
  it('never claims a device id, connected or running', async () => {
    const { client } = await connected();
    expect(client.deviceId).toBeNull();

    await client.startLock(SHORTEST_PICKABLE_S);
    ticks(2);
    expect(client.deviceId).toBeNull();
  });

  // battery/batterySamplingBridge.ts records every status.bat CHANGE into
  // the persisted log a real box's runtime estimate is fitted from.
  it('holds its battery still, so no fake discharge curve is recorded', async () => {
    const { client, statuses } = await connected();
    await client.startLock(SHORTEST_PICKABLE_S);
    ticks(ticksFor(SHORTEST_PICKABLE_S));

    expect(new Set(statuses.map((s) => s.bat)).size).toBe(1);
  });
});

describe('starting a session', () => {
  // A real session starts when someone presses LOCK on the box with the
  // phone inside it; the app has no remote start (DashboardScreen's control
  // row). Without this the demo would stop at "Closed" and a reviewer would
  // never see a countdown at all.
  it('presses its own LOCK a beat after the lid shuts', async () => {
    const { client, statuses } = await connected();

    await client.lock();
    expect(latest(statuses).st).toBe('closed');

    ticks(DEMO_LOCK_PRESS_TICKS - 1);
    expect(latest(statuses).st).toBe('closed');

    ticks(1);
    expect(latest(statuses)).toMatchObject({ st: 'running', rem: DEMO_DEFAULT_SECONDS });
  });

  it('counts down on the clock rather than jumping to the end', async () => {
    const { client, statuses } = await connected();

    await client.startLock(SHORTEST_PICKABLE_S);
    expect(latest(statuses)).toMatchObject({ st: 'running', rem: SHORTEST_PICKABLE_S });

    ticks(1);
    expect(latest(statuses).rem).toBe(SHORTEST_PICKABLE_S - DEMO_SECONDS_PER_TICK);
    ticks(5);
    expect(latest(statuses).rem).toBe(SHORTEST_PICKABLE_S - 6 * DEMO_SECONDS_PER_TICK);
    expect(latest(statuses).st).toBe('running');
  });

  // The whole reason DEMO_SECONDS_PER_TICK is not 1: an App Review sitting
  // will not wait out the five real minutes the app's own picker floors at.
  it('gets the shortest pickable lock done well inside a review sitting', () => {
    const wallClockMs = ticksFor(SHORTEST_PICKABLE_S) * DEMO_TICK_MS;
    expect(wallClockMs).toBeLessThanOrEqual(90_000);
  });

  // The firmware's "dur" opcode is ignored while running for a concrete
  // reason: set_seconds is read back at go_done to compute what gets logged.
  it('ignores a duration change while a countdown is running', async () => {
    const { client, statuses } = await connected();

    await client.startLock(SHORTEST_PICKABLE_S);
    ticks(2);
    await client.setDuration(30 * 60);

    expect(latest(statuses).set).toBe(SHORTEST_PICKABLE_S);
  });

  // Mirrors lock_controller.go_running's `topic` argument: the app pushes a
  // pre-session pick over BLE, the box echoes it back once running, and
  // useStore's handleStatus turns that echo into the tag the finished
  // session carries into Stats and the calendar.
  it('echoes a pre-session topic back, once, on the run that consumes it', async () => {
    const { client, statuses } = await connected();

    await client.setPendingTopic('deep-work');
    await client.startLock(SHORTEST_PICKABLE_S);
    expect(latest(statuses).tp).toBe('deep-work');

    ticks(ticksFor(SHORTEST_PICKABLE_S) + DEMO_DONE_TICKS);
    await client.startLock(SHORTEST_PICKABLE_S);
    expect(latest(statuses).tp).toBe('');
  });
});

describe('finishing a session', () => {
  it('walks idle -> closed -> running -> done -> idle', async () => {
    const { client, statuses } = await connected();

    await client.lock();
    ticks(DEMO_LOCK_PRESS_TICKS);
    ticks(ticksFor(DEMO_DEFAULT_SECONDS));
    expect(latest(statuses).st).toBe('done');

    ticks(DEMO_DONE_TICKS);
    expect(latest(statuses).st).toBe('idle');

    // Every state the box reported, in order, with the repeats collapsed.
    const walk = statuses.map((s) => s.st).filter((st, i, all) => st !== all[i - 1]);
    expect(walk).toEqual(['idle', 'closed', 'running', 'done', 'idle']);
  });

  it('reports the duration that was picked, not the wall clock it took', async () => {
    const { client, batches } = await connected();

    await client.startLock(SHORTEST_PICKABLE_S);
    ticks(ticksFor(SHORTEST_PICKABLE_S));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      { p: SHORTEST_PICKABLE_S, a: SHORTEST_PICKABLE_S, c: 1, t: expect.any(Number) },
    ]);
  });

  it('records an early open as time actually served, marked overridden', async () => {
    const { client, batches } = await connected();

    await client.startLock(SHORTEST_PICKABLE_S);
    ticks(12);
    await client.unlock();

    const served = 12 * DEMO_SECONDS_PER_TICK;
    expect(batches[0]).toEqual([
      { p: SHORTEST_PICKABLE_S, a: served, c: 0, t: expect.any(Number) },
    ]);
  });

  // Without the floor in finish(), an Open this early serves under
  // MIN_LOGGED_SESSION_S and buildLoggedSessions drops the session outright
  // -- the reviewer presses the button the review notes point at and nothing
  // reaches their history.
  it('never reports a session short enough for the log to throw away', async () => {
    const { client, batches } = await connected();

    await client.startLock(SHORTEST_PICKABLE_S);
    ticks(1);
    await client.unlock();

    expect(batches[0][0].a).toBeGreaterThanOrEqual(MIN_LOGGED_SESSION_S);
    expect(batches[0][0].c).toBe(0);
  });

  // Same gate lock_controller_ble.apply_ble_command puts on "unlock", so a
  // reviewer who switches "Allow open from this phone" off in Settings sees
  // the box refuse exactly the way a real one would.
  it('refuses a remote open while the box has remote unlock switched off', async () => {
    const { client, statuses, batches } = await connected();
    await client.writeSettings({ ...(await client.readSettings()), unlk: 0 });

    await client.startLock(SHORTEST_PICKABLE_S);
    ticks(12);
    await client.unlock();

    expect(latest(statuses).st).toBe('running');
    expect(batches).toHaveLength(0);
  });

  // go_done only logs `if self.state == "running"` -- a lid opened before
  // LOCK was ever pressed has no elapsed time worth recording.
  it('logs nothing for a box opened before the countdown ever started', async () => {
    const { client, statuses, batches } = await connected();

    await client.lock();
    await client.unlock();

    expect(latest(statuses).st).toBe('done');
    expect(batches).toHaveLength(0);
  });
});

describe('the history queue', () => {
  it('re-offers an unacked batch on the next connection, and drops it once acked', async () => {
    const { client, cb, batches } = await connected();

    await client.startLock(SHORTEST_PICKABLE_S);
    ticks(ticksFor(SHORTEST_PICKABLE_S));
    expect(batches).toHaveLength(1);

    await client.disconnect();
    await client.connectById('demo', cb);
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual(batches[0]);

    await client.ackHistory(1);
    await client.disconnect();
    await client.connectById('demo', cb);
    expect(batches).toHaveLength(2);
  });
});

describe('disconnecting', () => {
  it('stops the clock and says nothing about it', async () => {
    const { client, statuses, onDisconnect } = await connected();
    await client.startLock(SHORTEST_PICKABLE_S);
    const seen = statuses.length;

    await client.disconnect();
    ticks(10);

    expect(client.connected).toBe(false);
    expect(statuses).toHaveLength(seen);
    // The caller asked for this teardown and already knows; firing the
    // callback would re-enter useStore's own disconnect handling from
    // inside the call that requested it.
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
