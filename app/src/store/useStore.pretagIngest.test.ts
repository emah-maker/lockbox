// useStore.pretagIngest.test.ts -- fix verification for the user report
// "goals do not update with the topic", scenario: "I just finished a
// session that was pretagged" on the Stats -> Goals view
// (screens/stats/GoalsProgressView.tsx).
//
// Drives the REAL useStore.ts wiring end to end -- tagCurrentSession/
// setPendingBoxTopic (the app-side pick), the fake box's status echo
// (handleStatus's freshRun/tp gate), and handleHistoryEntries's real
// buildLoggedSessions ingest -- the same fake-client-callback-capture
// harness useStore.history.test.ts already uses for this store's BLE
// wiring, extended here with a controllable Date.now() so the "how long
// between picking the topic and the box actually starting the timer" gap
// -- the exact variable this bug turns on -- can be pinned to an exact
// value instead of racing a real clock.
//
// ROOT CAUSE:
//
// A pre-session topic pick (DashboardScreen's DurationSheet, before LOCK is
// pressed) calls BOTH useStore.tagCurrentSession (writes
// PENDING_TOPIC_KEY = { topic, at: Date.now() } to storage immediately --
// the durable, connectivity-independent "backward" record) AND
// useStore.setPendingBoxTopic (the "forward" BLE push:
// `client.setPendingTopic(topic).catch(() => {})`).
//
// If that BLE write never lands on the box (not connected yet, write
// rejected, box busy -- the common case when a topic is picked before
// walking over to actually press LOCK), the box starts the session with NO
// topic: its own `_session_topic` stays None for the whole run (Box-code/
// lib/lock_controller.py), so every status broadcast's `tp` field is `''`
// for the entire session. Before the fix below, useStore.ts's handleStatus
// only refreshed PENDING_TOPIC_KEY's `at` when `status.tp` was truthy, so a
// `tp` stuck at `''` meant PENDING_TOPIC_KEY kept the ORIGINAL timestamp
// from the moment the topic was picked -- which can be (and, for anyone
// who doesn't press LOCK the instant they tap a topic chip, routinely is)
// more than PENDING_TOPIC_PRE_SLACK_MS (120s, ble/historyIntake.ts) before
// the session actually starts. buildLoggedSessions
// (stats/sessionHistory.ts, `pending.at >= startedAt - preSlackMs`) then
// rejected the stale tag as out of window, and the finished session landed
// with `topic: undefined` -- so a topic-scoped goal computed 0 for it, even
// though the user was certain they'd tagged it.
//
// THE FIX (useStore.ts's `refreshPendingTopicOnFreshRun`, called from
// handleStatus): on a freshRun where the box echoes no topic, refresh
// whichever tag is ALREADY stored in PENDING_TOPIC_KEY against the moment
// the session actually started, instead of leaving it dated to pick time.
// This makes the durable local tag the source of truth regardless of
// whether the forward BLE push ever landed. It goes through
// withPendingTopicLock (ble/historyIntake.ts), a queue shared with
// handleHistoryEntries's own consume-then-compare-and-clear of the same
// key, so the two read-modify-write sequences can never interleave -- see
// the "race" test at the bottom of this file.
//
// The contrast test below is identical to the primary one except the BLE
// push succeeds and the box echoes the topic back once LOCK is pressed,
// which lets handleStatus's *other* freshRun branch (tp truthy) refresh
// PENDING_TOPIC_KEY the same way. Same delay, same everything else -- the
// only variable is whether the forward BLE write happened to land -- and
// both must end up tagged correctly.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from './useStore';
import { computeGoalProgress } from '../goals/goalProgress';
import type { Goal } from '../goals/goals';
import type { HistoryEntry, Status } from '../ble/protocol';
import { PENDING_TOPIC_KEY, PENDING_TOPIC_PRE_SLACK_MS } from '../ble/historyIntake';
import { getJSON } from '../storage/storage';
import type { PendingTopicTag } from '../stats/sessionHistory';

type Captured = {
  onStatus?: (s: Status) => void;
  onHistory?: (e: HistoryEntry[]) => void;
  onDisconnect?: () => void;
};
let mockCaptured: Captured = {};
const mockAckHistory = jest.fn(async (_count: number) => {});
/** Flips whether the fake box's `setPendingTopic` BLE write actually lands
 * -- the one variable that distinguishes the primary and contrast tests. */
let mockSetPendingTopicShouldFail = false;

jest.mock('../ble/PhoneBoxClient', () => ({
  PhoneBoxClient: class {
    deviceId = 'box-1';
    connected = true;
    waitForPoweredOn = jest.fn(async () => {});
    scanForBox = jest.fn(async () => ({ id: 'box-1' }));
    connect = jest.fn(async (_device: unknown, cb: Captured) => {
      mockCaptured = cb;
    });
    connectById = jest.fn(async (_id: string, cb: Captured) => {
      mockCaptured = cb;
    });
    disconnect = jest.fn(async () => {});
    readSettings = jest.fn(async () => null);
    setLabels = jest.fn(async () => {});
    setPendingTopic = jest.fn(async (_topic: string | null) => {
      if (mockSetPendingTopicShouldFail) throw new Error('BLE write did not land');
    });
    syncTime = jest.fn(async () => {});
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
  },
}));

async function connectBox() {
  mockCaptured = {};
  await useStore.getState().connect();
  expect(mockCaptured.onHistory).toBeInstanceOf(Function);
  expect(mockCaptured.onStatus).toBeInstanceOf(Function);
  return mockCaptured;
}

/** Drains handleHistory's storage-read -> build -> storage-write -> ack
 * microtask chain, same technique (and same reasoning) as
 * useStore.history.test.ts's own `deliver`. Also used to drain
 * handleStatus's refreshPendingTopicOnFreshRun, which is the same shape of
 * chain (lock -> read -> read -> write). */
async function drain() {
  for (let i = 0; i < 25; i += 1) await new Promise((r) => setTimeout(r, 0));
}

async function deliverHistory(entries: HistoryEntry[]) {
  mockCaptured.onHistory!(entries);
  await drain();
}

const status = (over: Partial<Status>): Status => ({ st: 'idle', rem: 0, set: 0, bat: 80, tp: '', fw: '1.0', ...over });

const readingGoal: Goal = {
  id: 'goal:reading',
  topic: 'reading',
  period: 'daily',
  targetS: 1800,
  createdAt: 0,
  updatedAt: 0,
  archived: false,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockSetPendingTopicShouldFail = false;
  useStore.setState({ sessions: [], conn: 'idle', status: null, currentTopic: null, pendingBoxTopic: null });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a pre-session topic pick that finishes as a logged session', () => {
  it('FIXED: still lands tagged (and the goal it should count toward updates) when the forward BLE push to the box never lands and >120s pass before the box actually starts', async () => {
    mockSetPendingTopicShouldFail = true; // the box never learns the pick
    await connectBox();

    const pickAt = Date.parse('2026-01-15T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(pickAt);

    // The exact pair DashboardScreen.tsx's handleSelectTopic calls for ANY
    // topic pick, pre-session or in-session (line ~334-335).
    useStore.getState().tagCurrentSession('reading');
    useStore.getState().setPendingBoxTopic('reading');
    // setPendingTopic's rejection is swallowed (`.catch(() => {})`,
    // useStore.ts) -- let that microtask settle so it doesn't leak into the
    // next test as an unhandled rejection.
    await Promise.resolve();
    await Promise.resolve();

    // Walk-to-the-box delay: comfortably past PENDING_TOPIC_PRE_SLACK_MS
    // (120s) between picking the topic and the box actually starting the
    // timer -- an ordinary amount of time to walk across a room.
    const startedAt = pickAt + PENDING_TOPIC_PRE_SLACK_MS + 10_000;
    expect(startedAt - pickAt).toBeGreaterThan(PENDING_TOPIC_PRE_SLACK_MS);

    // The box starts the session with NO topic, since it never received
    // the pick (`_session_topic` stays None for the whole run) -- every
    // status broadcast's `tp` is '' the entire time. Before the fix,
    // handleStatus never had a truthy `status.tp` to refresh
    // PENDING_TOPIC_KEY's stale `at` through; now `refreshPendingTopicOnFreshRun`
    // refreshes it anyway, because this is a freshRun (state.status was
    // null, this tick is 'running').
    (Date.now as jest.Mock).mockReturnValue(startedAt);
    mockCaptured.onStatus!(status({ st: 'running', tp: '', rem: 1799, set: 1800 }));
    await drain();

    // The refreshed tag should now read `at: startedAt`, not `at: pickAt`.
    const refreshed = await getJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
    expect(refreshed).toEqual({ topic: 'reading', at: startedAt });

    const actualS = 1800;
    const endedAt = startedAt + actualS * 1000;
    (Date.now as jest.Mock).mockReturnValue(endedAt);
    await deliverHistory([{ p: 1800, a: actualS, c: 1, t: Math.floor(endedAt / 1000) }]);

    const sessions = useStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    // The fix, pinned exactly: session.topic now equals 'reading' even
    // though the forward BLE write never landed.
    expect(sessions[0].topic).toBe('reading');

    const progress = computeGoalProgress([readingGoal], sessions, endedAt + 1000, [], []);
    // The user-visible fix: the goal scoped to 'reading' now counts this
    // session's full focus time.
    expect(progress[0].focusS).toBe(actualS);
  });

  it('CONTRAST: lands correctly tagged (and the goal updates) when the identical delay elapses but the forward BLE push succeeds and the box echoes the topic back', async () => {
    mockSetPendingTopicShouldFail = false; // the box DOES learn the pick
    await connectBox();

    const pickAt = Date.parse('2026-01-15T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(pickAt);

    useStore.getState().tagCurrentSession('reading');
    useStore.getState().setPendingBoxTopic('reading');
    await Promise.resolve();
    await Promise.resolve();

    // The SAME >120s walk-to-the-box delay as the primary case above.
    const startedAt = pickAt + PENDING_TOPIC_PRE_SLACK_MS + 10_000;

    // This time the box DID learn the pick (LOCK press validates and
    // applies `_pending_app_topic`, Box-code/lib/lock_controller_ble.py),
    // so its status echoes tp: 'reading' once running -- handleStatus's
    // tp-truthy freshRun branch refreshes PENDING_TOPIC_KEY's `at` to right
    // now, comfortably inside buildLoggedSessions' window.
    (Date.now as jest.Mock).mockReturnValue(startedAt);
    mockCaptured.onStatus!(status({ st: 'running', tp: 'reading', rem: 1799, set: 1800 }));

    const actualS = 1800;
    const endedAt = startedAt + actualS * 1000;
    (Date.now as jest.Mock).mockReturnValue(endedAt);
    await deliverHistory([{ p: 1800, a: actualS, c: 1, t: Math.floor(endedAt / 1000) }]);

    const sessions = useStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].topic).toBe('reading');

    const progress = computeGoalProgress([readingGoal], sessions, endedAt + 1000, [], []);
    expect(progress[0].focusS).toBe(actualS);
  });

  it('lands tagged when the session finishes entirely while disconnected and the whole history batch only arrives after reconnecting', async () => {
    await connectBox();

    const pickAt = Date.parse('2026-01-15T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(pickAt);
    useStore.getState().tagCurrentSession('reading');
    useStore.getState().setPendingBoxTopic('reading');
    await Promise.resolve();
    await Promise.resolve();

    // A short pick-to-start gap -- well inside the pre-slack window on its
    // own, so this test isolates "disconnected the whole time, history
    // arrives on reconnect" from the separate stale-timestamp scenario
    // above. No onStatus tick is ever delivered for this session: the app
    // was not connected to receive one.
    const startedAt = pickAt + 5_000;
    const actualS = 1800;
    const endedAt = startedAt + actualS * 1000;

    // Simulate the drop and the reconnect that only happens once the
    // session (and the box queuing its history) is already done.
    await useStore.getState().disconnect();
    await connectBox();

    (Date.now as jest.Mock).mockReturnValue(endedAt);
    await deliverHistory([{ p: 1800, a: actualS, c: 1, t: Math.floor(endedAt / 1000) }]);

    const sessions = useStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].topic).toBe('reading');
    const progress = computeGoalProgress([readingGoal], sessions, endedAt + 1000, [], []);
    expect(progress[0].focusS).toBe(actualS);
  });

  it('lands tagged when reconnecting mid-session, where the first status tick already reads running with no prior status (freshRun) and no echoed topic', async () => {
    await connectBox();

    const pickAt = Date.parse('2026-01-15T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(pickAt);
    useStore.getState().tagCurrentSession('reading');
    useStore.getState().setPendingBoxTopic('reading');
    await Promise.resolve();
    await Promise.resolve();

    // The session actually starts well past the pre-slack window (the box
    // never got the pick, so tp stays '' this whole run), and the app then
    // drops and reconnects WHILE that same session is still running.
    const startedAt = pickAt + PENDING_TOPIC_PRE_SLACK_MS + 10_000;
    const actualS = 1800;
    const endedAt = startedAt + actualS * 1000;
    const reconnectAt = startedAt + 60_000; // mid-session, well before endedAt

    await useStore.getState().disconnect();
    // state.status is reset to null by disconnect(), so the very first
    // status tick after reconnecting is a freshRun by definition (no prior
    // 'running' to compare against), even though the session had already
    // been running for a minute.
    await connectBox();

    (Date.now as jest.Mock).mockReturnValue(reconnectAt);
    mockCaptured.onStatus!(status({ st: 'running', tp: '', rem: 1200, set: 1800 }));
    await drain();

    const refreshed = await getJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
    expect(refreshed).toEqual({ topic: 'reading', at: reconnectAt });

    (Date.now as jest.Mock).mockReturnValue(endedAt);
    await deliverHistory([{ p: 1800, a: actualS, c: 1, t: Math.floor(endedAt / 1000) }]);

    const sessions = useStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].topic).toBe('reading');
    const progress = computeGoalProgress([readingGoal], sessions, endedAt + 1000, [], []);
    expect(progress[0].focusS).toBe(actualS);
  });

  it('race regression: a tag historyIntake just consumed for one session must not be resurrected by a freshRun refresh and applied to a later session', async () => {
    await connectBox();

    const pickAt = Date.parse('2026-01-15T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(pickAt);
    useStore.getState().tagCurrentSession('reading');
    await Promise.resolve();

    // Session A: starts soon after the pick (comfortably inside the
    // pre-slack window), so its history entry will legitimately consume
    // this tag once delivered.
    const startedAtA = pickAt + 5_000;
    const actualSA = 1800;
    const endedAtA = startedAtA + actualSA * 1000;

    // Session B: an entirely separate, never-tagged session that starts
    // right as A's history is being processed -- e.g. both `onHistory` (for
    // A, queued while disconnected) and `onStatus` (B's fresh run) fire
    // back to back right after a reconnect, the exact "onHistory/onStatus
    // both fire right after connect" ordering historyIntake.ts's own
    // comment warns about.
    const startedAtB = endedAtA + 1_000;
    const actualSB = 900;
    const endedAtB = startedAtB + actualSB * 1000;

    (Date.now as jest.Mock).mockReturnValue(startedAtB);

    // Fire both, synchronously back to back with no intervening await, so
    // their internal getJSON/setJSON promise chains are given every chance
    // to interleave via the microtask queue -- exactly what
    // withPendingTopicLock must serialize away. If it didn't, B's freshRun
    // refresh could read A's tag before historyIntake's compare-and-clear
    // re-read runs, causing historyIntake to see a mismatched `.at` and
    // skip its clear -- leaving a stale-but-now-fresh-looking tag in
    // storage that this test's later assertions would catch.
    mockCaptured.onHistory!([{ p: 1800, a: actualSA, c: 1, t: Math.floor(endedAtA / 1000) }]);
    mockCaptured.onStatus!(status({ st: 'running', tp: '', rem: 900, set: 900 }));
    await drain();

    // A must have consumed the tag...
    const afterRace = useStore.getState().sessions;
    expect(afterRace).toHaveLength(1);
    expect(afterRace[0].topic).toBe('reading');
    // ...and the tag must be gone from storage -- not resurrected with a
    // refreshed timestamp for B to pick up later.
    const stored = await getJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
    expect(stored).toBeNull();

    // Session B finishes, untagged (nothing was ever picked for it, and no
    // resurrected tag should have survived to be misapplied to it).
    (Date.now as jest.Mock).mockReturnValue(endedAtB);
    await deliverHistory([{ p: 900, a: actualSB, c: 1, t: Math.floor(endedAtB / 1000) }]);

    const sessions = useStore.getState().sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[1].topic).toBeUndefined();
  });
});
