// settingsWriteRace.test.ts -- regression tests for the one thing that could
// silently undo a settings change: a local mutation landing while the two-way
// sync's own write to users/{uid}/settings/app is in flight.
//
// Both writers rewrite the whole document. Before settingsWriteQueue.ts they
// could be crossing the network simultaneously, each carrying a payload
// snapshotted when it was issued, and the account was left holding whichever
// the server applied LAST -- so changing the accent during a sign-in merge
// could put the previous accent back into the account under a stale clock,
// with nothing visibly wrong on the device that did it. These tests drive the
// real firestoreSync against a fake Firestore whose write completion the test
// controls, which is the only way to hold a write open long enough for the
// mutation to land inside it.
//
// The two properties they pin down are the two halves of the fix (see
// firestoreSync's pushLocalSettings): writes are serialized, and each one
// reads the store when it goes out rather than when it was decided.
import AsyncStorage from '@react-native-async-storage/async-storage';

/** path -> document, i.e. what the server currently holds. */
const mockServer: Record<string, Record<string, unknown>> = {};

/** Writes that have been issued and not yet acknowledged. The test decides
 * when each one lands, which is what makes the race constructible at all. */
const mockWrites: {
  path: string;
  data: Record<string, unknown>;
  /** Land this write on the fake server. */
  ack: () => void;
  /** Reject it instead -- offline, or a denied write. */
  fail: (message: string) => void;
  settled: boolean;
}[] = [];

jest.mock('firebase/firestore', () => ({
  // The fake server is keyed by path, so `doc()` may as well BE the path.
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: async (path: string) => ({
    exists: () => path in mockServer,
    data: () => mockServer[path],
  }),
  setDoc: (path: string, data: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => {
      const entry = {
        path,
        data,
        settled: false,
        ack: () => {
          entry.settled = true;
          // Applied on ACK, not on issue: "which write the server kept" is
          // exactly what this file is about.
          mockServer[path] = data;
          resolve();
        },
        fail: (message: string) => {
          entry.settled = true;
          reject(new Error(message));
        },
      };
      mockWrites.push(entry);
    }),
  serverTimestamp: () => 0,
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDocs: async () => ({ docs: [] }),
  writeBatch: () => ({ delete: () => {}, commit: async () => {} }),
  deleteDoc: async () => {},
}));

jest.mock('../auth/firebase', () => ({
  getDb: () => ({}),
  getFirebaseAuth: () => ({ currentUser: { uid: 'uid-a', email: null, displayName: null, photoURL: null } }),
}));

// Neither half of the sync under test, and both drag native modules in.
jest.mock('./sessionsSync', () => ({ syncSessions: jest.fn(async () => {}) }));
jest.mock('./scheduledSessionsSync', () => ({ syncScheduledSessions: jest.fn(async () => {}) }));
jest.mock('../schedule/sessionReminders', () => ({
  syncSessionReminders: jest.fn(async () => ({ scheduled: [], suppressed: [] })),
}));
jest.mock('../push/pushRegistration', () => ({
  reportLocalCoverage: jest.fn(async () => {}),
  registerPushToken: jest.fn(async () => {}),
  unregisterPushToken: jest.fn(async () => {}),
}));

import { runMigrationAndSync } from './firestoreSync';
import { startSettingsSyncBridge } from './settingsSyncBridge';
import { resetSettingsWriteQueue } from './settingsWriteQueue';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';
import { useScheduleStore } from '../store/useScheduleStore';
import { LOCAL_DATA_OWNER_KEY } from './localDataOwner';
import { setJSON } from '../storage/storage';
import type { AccentKey } from '../theme/theme';

const SETTINGS = 'users/uid-a/settings/app';

/** Drain the microtask queue (and any zero-delay timer) so every promise
 * chain that can advance without a server ack has advanced. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The writes to settings/app that have been issued but not acknowledged. */
function inFlight() {
  return mockWrites.filter((w) => w.path === SETTINGS && !w.settled);
}

/** Every unacknowledged write, whatever the document -- teardown only. */
function inFlightAnywhere() {
  return mockWrites.filter((w) => !w.settled);
}

/** Waits for the sync to reach its settings write, then hands it over still
 * unacknowledged -- the window a local change has to land inside. */
async function awaitSettingsWrite() {
  for (let i = 0; i < 50 && inFlight().length === 0; i += 1) await flush();
  const pending = inFlight();
  expect(pending).toHaveLength(1);
  return pending[0];
}

function settingsWrites() {
  return mockWrites.filter((w) => w.path === SETTINGS);
}

/** Every issued settings write, acknowledged oldest-first. */
async function ackAll() {
  for (let i = 0; i < 20; i += 1) {
    const pending = inFlight();
    if (pending.length === 0) break;
    pending[0].ack();
    await flush();
  }
}

/** Run until no write is outstanding and nothing new is being issued. */
async function drain() {
  for (let i = 0; i < 20; i += 1) {
    await flush();
    const pending = inFlightAnywhere();
    if (pending.length === 0) break;
    for (const write of pending) write.ack();
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  // The owner tag has to already be uid-a's: ensureLocalDataScopedTo would
  // otherwise treat this as a first sign-in and wipe the very local settings
  // these tests are about.
  await setJSON(LOCAL_DATA_OWNER_KEY, 'uid-a');
  useSettingsStore.setState({
    hydrated: true,
    themeMode: 'dark',
    accent: 'mint',
    callAlertsEnabled: true,
    customLabels: [],
    settingsUpdatedAt: 1000,
  });
  useGoalsStore.setState({ hydrated: true, goals: [], goalsUpdatedAt: 0 });
  useScheduleStore.setState({ hydrated: true, scheduled: [], deletedIds: {}, localWrites: 0 });
  // Idempotent; the first test to run installs the subscription that turns a
  // local mutation into a push, which is the other half of the race.
  startSettingsSyncBridge();

  // Settling the world BEFORE the ledger is cleared, not after. Two things
  // outlive a test otherwise, and both look like the write the next test is
  // waiting for: a continuation the previous run's queue chain still has
  // scheduled (resetSettingsWriteQueue replaces the chain, it cannot
  // unschedule that), and the push the setState above just triggered through
  // the bridge -- resetting the store IS a settings change as far as the
  // subscription is concerned.
  await drain();
  for (const key of Object.keys(mockServer)) delete mockServer[key];
  mockWrites.length = 0;
  resetSettingsWriteQueue();
});

/** The account doc already exists, so runMigrationAndSync skips creating it. */
function seedAccount(remoteUpdatedAt: number, accent: AccentKey = 'amber') {
  mockServer['users/uid-a'] = { email: null };
  mockServer[SETTINGS] = {
    themeMode: 'dark',
    accent,
    callAlertsEnabled: true,
    customLabels: [],
    updatedAt: remoteUpdatedAt,
  };
}

describe('a local mutation during an in-flight two-way sync write', () => {
  // The original bug, end to end. The merge decides "this device is newer,
  // push", and while that push is crossing the network the user picks a new
  // accent. The account must not end up holding the accent the merge saw.
  it('is not overwritten by the merge push it landed inside', async () => {
    seedAccount(500); // older than local's 1000 -> plan is 'push'
    const run = runMigrationAndSync('uid-a');
    const mergeWrite = await awaitSettingsWrite();

    useSettingsStore.getState().setAccent('coral');
    await flush();

    // Serialized: the mutation's own push cannot be racing the merge's.
    expect(inFlight()).toHaveLength(1);
    expect(inFlight()[0]).toBe(mergeWrite);

    await ackAll();
    await run;
    await ackAll();

    expect(mockServer[SETTINGS].accent).toBe('coral');
    expect(mockServer[SETTINGS].updatedAt).toBe(useSettingsStore.getState().settingsUpdatedAt);
    // And the device that made the change still holds it.
    expect(useSettingsStore.getState().accent).toBe('coral');
  });

  // Same window, on the branch that creates the document for the first time
  // -- a brand new account, whose first write is issued by the merge itself.
  it('is not overwritten by the first-write branch either', async () => {
    mockServer['users/uid-a'] = { email: null }; // account exists, settings/app does not
    const run = runMigrationAndSync('uid-a');
    const createWrite = await awaitSettingsWrite();

    useSettingsStore.getState().setThemeMode('light');
    await flush();
    expect(inFlight()).toHaveLength(1);
    expect(inFlight()[0]).toBe(createWrite);

    await ackAll();
    await run;
    await ackAll();

    expect(mockServer[SETTINGS].themeMode).toBe('light');
  });

  // The half the queue alone does not buy: a write that is merely QUEUED has
  // not read anything yet, so it must send what the store holds when its turn
  // comes -- not what its caller decided from. The merge decides 'push' from
  // a store holding 'coral'; by the time its write actually goes out the user
  // is on 'violet', and 'violet' is what belongs in the account.
  it('is what the queued merge write sends, not the state the merge decided from', async () => {
    seedAccount(500);
    // An incremental push already occupying the wire -- issued by the bridge,
    // the same way a real accent change issues one.
    useSettingsStore.getState().setAccent('coral');
    const bridgeWrite = await awaitSettingsWrite();
    expect(bridgeWrite.data.accent).toBe('coral');

    // The merge runs and queues its push behind that write.
    const run = runMigrationAndSync('uid-a');
    await flush();
    expect(inFlight()).toHaveLength(1);

    // The user changes their mind while the merge's write is still queued.
    useSettingsStore.getState().setAccent('violet');
    await flush();

    bridgeWrite.ack();
    await flush();
    await ackAll();
    await run;
    await ackAll();

    const last = settingsWrites()[settingsWrites().length - 1];
    expect(last.data.accent).toBe('violet');
    expect(mockServer[SETTINGS].accent).toBe('violet');
  });

  // Consequence of the same re-read: a burst of changes behind one in-flight
  // write costs one catch-up write, not one per change, and the catch-up
  // carries the last of them.
  it('collapses a burst of changes behind one in-flight write', async () => {
    seedAccount(500);
    const run = runMigrationAndSync('uid-a');
    const mergeWrite = await awaitSettingsWrite();

    useSettingsStore.getState().setAccent('coral');
    useSettingsStore.getState().setAccent('teal');
    useSettingsStore.getState().setCallAlertsEnabled(false);
    await flush();

    mergeWrite.ack();
    await flush();
    await ackAll();
    await run;
    await ackAll();

    expect(settingsWrites()).toHaveLength(2); // the merge's, plus one catch-up
    expect(mockServer[SETTINGS].accent).toBe('teal');
    expect(mockServer[SETTINGS].callAlertsEnabled).toBe(false);
  });
});

describe('a settings write that fails', () => {
  // Best-effort pushes are allowed to fail; what they are not allowed to do
  // is wedge the queue, because the next write is the one that would have
  // repaired the account.
  it('does not block the write that follows it', async () => {
    seedAccount(500);
    const run = runMigrationAndSync('uid-a');
    const mergeWrite = await awaitSettingsWrite();

    const failed = run.then(
      () => 'resolved',
      () => 'rejected',
    );
    mergeWrite.fail('offline');
    await flush();

    useSettingsStore.getState().setAccent('rose');
    await flush();
    await ackAll();

    expect(await failed).toBe('rejected');
    expect(mockServer[SETTINGS].accent).toBe('rose');
  });
});
