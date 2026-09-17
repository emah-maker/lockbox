// pushGoalsPatch.test.ts -- the incremental goals push, which is the only
// writer of users/{uid}/goals/config that does not read the document first.
//
// The invariant this file pins down: goals/config is a UNION document.
// goalMerge.ts's mergeGoals, goalsSyncPlan.ts's planGoalsSync and
// syncGoalsTwoWay all exist so that a goal created on one device and a goal
// edited on another BOTH survive -- goals is the only doc in this app whose
// merge is per-item rather than whole-document, precisely because a
// whole-document last-write-wins compare (settings/app's) would silently
// drop one side. Every writer of that document therefore has to respect the
// union, including this one.
//
// It did not. pushGoalsPatch was a blind setDoc of whatever array this
// device happens to hold, so the sequence "add a goal on the dashboard,
// then edit any goal on the phone before the phone's next full sync"
// deleted the dashboard's goal outright: the phone's array never contained
// it, the setDoc replaced the document with that array, and the next
// syncGoalsTwoWay then union-merged against a document the goal was already
// gone from -- so there was nothing left anywhere to restore it from.
//
// goalsSyncBridge.test.ts covers the other half of this path (WHICH store
// emissions get here at all); this file covers what the push then writes.
import { pushGoalsPatch } from './firestoreSync';
import type { Goal } from '../goals/goals';

// One object, `mock`-prefixed, because Jest hoists jest.mock factories above
// every other binding in the file and only lets them close over names that
// start with `mock` -- same shape as deleteAllUserData.test.ts's.
const mockState: {
  /** What users/{uid}/goals/config currently holds, or null if absent. */
  remote: { goals: unknown; updatedAt: number } | null;
  /** Every write this push made, in order, as `{ path, payload }`. */
  writes: { path: string; payload: { goals: Goal[]; updatedAt: number } }[];
  /** Set by a test to make the transaction's read reject. */
  failRead: boolean;
  signedIn: boolean;
} = { remote: null, writes: [], failRead: false, signedIn: true };

jest.mock('../auth/firebase', () => ({
  getDb: () => ({ __db: true }),
  getFirebaseAuth: () => ({ currentUser: mockState.signedIn ? { uid: 'uid-1' } : null }),
}));

jest.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'ts',
  // Path strings stand in for refs, as in deleteAllUserData.test.ts: what
  // these tests assert on is the document written and its contents, not the
  // SDK's opaque reference objects.
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: jest.fn(),
  deleteDoc: jest.fn(),
  getDocs: jest.fn(),
  writeBatch: jest.fn(),
  setDoc: jest.fn(async (path: string, payload: { goals: Goal[]; updatedAt: number }) => {
    mockState.writes.push({ path, payload });
    mockState.remote = payload;
  }),
  // A single-attempt stand-in for the real thing. The retry-on-contention
  // the SDK adds is not what these tests are about -- that the callback
  // READS before it writes is.
  runTransaction: jest.fn(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      get: async (path: string) => {
        if (mockState.failRead) throw new Error('read failed');
        void path;
        return { exists: () => mockState.remote !== null, data: () => mockState.remote };
      },
      set: (path: string, payload: { goals: Goal[]; updatedAt: number }) => {
        mockState.writes.push({ path, payload });
        mockState.remote = payload;
      },
    };
    return fn(tx);
  }),
}));

// firestoreSync's module graph reaches every Zustand store, which pull in
// expo-notifications and react-native-ble-plx at import time -- neither
// survives outside a native runtime and neither is on this push's path.
// useGoalsStore is the one that matters here, so it gets a settable state
// object rather than an empty stub.
const mockGoalsState: { goals: Goal[]; goalsUpdatedAt: number } = { goals: [], goalsUpdatedAt: 0 };
jest.mock('../store/useGoalsStore', () => ({ useGoalsStore: { getState: () => mockGoalsState } }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));
jest.mock('../store/useScheduleStore', () => ({ useScheduleStore: { getState: () => ({}) } }));
jest.mock('./sessionsSync', () => ({ syncSessions: jest.fn() }));
jest.mock('./scheduledSessionsSync', () => ({ syncScheduledSessions: jest.fn() }));
jest.mock('./localDataOwner', () => ({ ensureLocalDataScopedTo: jest.fn(), localDataGeneration: () => 0 }));

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'goal_1',
  topic: null,
  period: 'daily',
  targetS: 3600,
  createdAt: 1,
  updatedAt: 1,
  // Spelled out rather than left to `over` for the reason every other Goal
  // fixture in this repo does it (see goalMerge.test.ts): spreading a
  // Partial over a base that omits a required field widens it to
  // `boolean | undefined`.
  archived: false,
  ...over,
});

const CONFIG = 'users/uid-1/goals/config';
/** The payload of the last write this push made. */
const lastWrite = () => mockState.writes[mockState.writes.length - 1];
const writtenIds = () => lastWrite().payload.goals.map((g) => g.id).sort();

beforeEach(() => {
  mockState.remote = null;
  mockState.writes.length = 0;
  mockState.failRead = false;
  mockState.signedIn = true;
  mockGoalsState.goals = [];
  mockGoalsState.goalsUpdatedAt = 0;
});

describe('pushGoalsPatch', () => {
  it('keeps a goal this device has not pulled yet', async () => {
    // The dashboard created goal_dash and this phone has not synced since.
    mockState.remote = { goals: [goal({ id: 'goal_dash', createdAt: 10, updatedAt: 10 })], updatedAt: 10 };
    // The user then edits an unrelated goal here.
    mockGoalsState.goals = [goal({ id: 'goal_phone', createdAt: 20, updatedAt: 20, targetS: 7200 })];
    mockGoalsState.goalsUpdatedAt = 20;

    await pushGoalsPatch();

    expect(writtenIds()).toEqual(['goal_dash', 'goal_phone']);
    expect(lastWrite().path).toBe(CONFIG);
  });

  it('still writes the local edit, and wins the per-goal clock compare', async () => {
    mockState.remote = { goals: [goal({ id: 'goal_1', updatedAt: 10, targetS: 3600 })], updatedAt: 10 };
    mockGoalsState.goals = [goal({ id: 'goal_1', updatedAt: 30, targetS: 7200 })];
    mockGoalsState.goalsUpdatedAt = 30;

    await pushGoalsPatch();

    expect(lastWrite().payload.goals).toHaveLength(1);
    expect(lastWrite().payload.goals[0].targetS).toBe(7200);
    // The doc clock must never go backwards -- another device compares it.
    expect(lastWrite().payload.updatedAt).toBeGreaterThanOrEqual(30);
  });

  it('creates the document when the account has never had one', async () => {
    mockState.remote = null;
    mockGoalsState.goals = [goal({ id: 'goal_1', updatedAt: 30 })];
    mockGoalsState.goalsUpdatedAt = 30;

    await pushGoalsPatch();

    expect(writtenIds()).toEqual(['goal_1']);
  });

  it('drops a malformed remote entry rather than writing it back', async () => {
    // The remote side is untrusted input like any other -- goalSanitize.ts's
    // boundary applies to a read this push makes just as much as to one the
    // full sync makes. Writing an unsanitized blob back would also risk
    // tripping firestore.rules' own shape checks on goals/config, which
    // would then fail every later push.
    mockState.remote = { goals: [{ id: 'bad', period: 'yearly' }, goal({ id: 'goal_ok', updatedAt: 5 })], updatedAt: 5 };
    mockGoalsState.goals = [goal({ id: 'goal_1', updatedAt: 30 })];
    mockGoalsState.goalsUpdatedAt = 30;

    await pushGoalsPatch();

    expect(writtenIds()).toEqual(['goal_1', 'goal_ok']);
  });

  it('writes nothing while signed out', async () => {
    mockState.signedIn = false;
    mockGoalsState.goals = [goal({ id: 'goal_1', updatedAt: 30 })];
    mockGoalsState.goalsUpdatedAt = 30;

    await pushGoalsPatch();

    expect(mockState.writes).toHaveLength(0);
  });

  it('writes nothing when the merge would change nothing', async () => {
    // Both sides already hold the same goal at the same clock: the bridge
    // fired for a field this document does not carry. A read-modify-write
    // that always writes would cost a round trip and bump the doc clock for
    // every other device to re-merge against, for no content change.
    mockState.remote = { goals: [goal({ id: 'goal_1', updatedAt: 30 })], updatedAt: 30 };
    mockGoalsState.goals = [goal({ id: 'goal_1', updatedAt: 30 })];
    mockGoalsState.goalsUpdatedAt = 30;

    await pushGoalsPatch();

    expect(mockState.writes).toHaveLength(0);
  });

  it('propagates a failed read instead of writing blind', async () => {
    // Best-effort is the BRIDGE's policy (it swallows this rejection and
    // lets the next full sync catch up), not this function's. Falling back
    // to an unmerged whole-array write here would reintroduce exactly the
    // deletion this read exists to prevent.
    mockState.failRead = true;
    mockGoalsState.goals = [goal({ id: 'goal_1', updatedAt: 30 })];
    mockGoalsState.goalsUpdatedAt = 30;

    await expect(pushGoalsPatch()).rejects.toThrow(/read failed/);
    expect(mockState.writes).toHaveLength(0);
  });
});
