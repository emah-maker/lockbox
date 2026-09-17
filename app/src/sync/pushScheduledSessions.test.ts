// pushScheduledSessions.test.ts -- what one plan edit actually commits, and
// where the deletion backlog belongs.
//
// The store keeps a tombstone for every plan ever deleted, for 30 days
// (useScheduleStore's pruneTombstones), because a tombstone is the only
// thing that stops a device which was offline at deletion time from pushing
// the plan -- and its reminder -- back. That retention is right. Replaying
// the whole set as batch deletes on every incremental push is not: it made
// a single "move this plan half an hour later" commit dozens of deletes for
// documents that were removed days ago and are long gone from Firestore.
//
// The division this file pins down:
//   - the incremental push carries only what this mutation did, which is
//     what its own docblock already says it is for (see its `notifiedAt`
//     reasoning for why a whole-set write is actively harmful here);
//   - the full sync is what reconciles the backlog, and it has the remote
//     listing in hand to do it against.
//
// The last describe covers a different property of the same module -- what
// fromRemote will and won't let in off the wire -- and lives here rather
// than in its own file for the reason deleteAccount.test.ts gives for the
// same arrangement: it needs this exact mock set, and jest.mock() is
// file-scoped.
import { pushScheduledSessions, syncScheduledSessions } from './scheduledSessionsSync';
import type { ScheduledSession } from '../schedule/scheduledSessions';

// One object, `mock`-prefixed, because Jest hoists jest.mock factories above
// every other binding in the file -- same shape as deleteAllUserData.test.ts's.
const mockState: {
  /** Every staged batch operation, as `set:<path>` / `delete:<path>`. */
  ops: string[];
  commits: number;
  signedIn: boolean;
  /** What the remote collection currently holds, as `{ id: rawDocData }`. */
  remote: Record<string, Record<string, unknown>>;
} = { ops: [], commits: 0, signedIn: true, remote: {} };

jest.mock('../auth/firebase', () => ({
  getDb: () => ({ __db: true }),
  getFirebaseAuth: () => ({ currentUser: mockState.signedIn ? { uid: 'uid-1' } : null }),
}));

jest.mock('firebase/firestore', () => ({
  // Path strings stand in for refs. `doc` takes either the db or a
  // collection ref as its first argument, so the object form is dropped and
  // the string form (a collection path) is kept as a prefix.
  doc: (parent: unknown, ...segments: string[]) =>
    [...(typeof parent === 'string' ? [parent] : []), ...segments].join('/'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDocs: jest.fn(async (path: string) => ({
    docs: Object.entries(mockState.remote).map(([id, data]) => ({
      id,
      ref: `${path}/${id}`,
      data: () => data,
    })),
  })),
  deleteDoc: jest.fn(),
  writeBatch: () => ({
    set: (ref: string) => mockState.ops.push(`set:${ref}`),
    delete: (ref: string) => mockState.ops.push(`delete:${ref}`),
    commit: async () => {
      mockState.commits += 1;
    },
  }),
}));

const mockApplyRemote = jest.fn();
const mockScheduleState: {
  scheduled: ScheduledSession[];
  deletedIds: Record<string, number>;
  applyRemoteScheduledSessions: jest.Mock;
} = { scheduled: [], deletedIds: {}, applyRemoteScheduledSessions: mockApplyRemote };
jest.mock('../store/useScheduleStore', () => ({
  useScheduleStore: { getState: () => mockScheduleState },
}));

const plan = (over: Partial<ScheduledSession> = {}): ScheduledSession => ({
  id: 'plan_1',
  date: '2026-09-20',
  time: '09:00',
  topic: null,
  leadMinutes: 10,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

/** A well-formed document as the wire carries it (scheduledSessionsSync's
 * RemotePlan), for a test to spoil one field of. */
const remoteDoc = (over: Record<string, unknown> = {}) => ({
  date: '2026-09-20',
  time: '09:00',
  fireAtMs: 0,
  timeLabel: '9:00 AM',
  tz: 'America/Los_Angeles',
  topic: null,
  leadMinutes: 10,
  done: false,
  notifiedAt: null,
  updatedAt: 5,
  ...over,
});

const COL = 'users/uid-1/scheduledSessions';
const deletes = () => mockState.ops.filter((o) => o.startsWith('delete:'));
/** The ids syncScheduledSessions decided this device should now hold. */
const appliedIds = () =>
  (mockApplyRemote.mock.calls[0]?.[0] as ScheduledSession[]).map((p) => p.id);

beforeEach(() => {
  mockState.ops.length = 0;
  mockState.commits = 0;
  mockState.signedIn = true;
  mockState.remote = {};
  mockScheduleState.scheduled = [];
  mockScheduleState.deletedIds = {};
  jest.clearAllMocks();
});

describe('pushScheduledSessions', () => {
  it('commits only the plans handed to it', async () => {
    // Three plans deleted days ago, still inside the 30-day tombstone
    // window. None of them has anything to do with this edit.
    mockScheduleState.deletedIds = { gone_1: 1, gone_2: 2, gone_3: 3 };
    mockScheduleState.scheduled = [plan({ id: 'plan_1', updatedAt: 50 })];

    await pushScheduledSessions([plan({ id: 'plan_1', updatedAt: 50 })]);

    expect(mockState.ops).toEqual([`set:${COL}/plan_1`]);
    expect(deletes()).toHaveLength(0);
  });

  it('writes nothing at all when the mutation produced no plans', async () => {
    // A pure deletion: the bridge removes that one document itself
    // (deleteRemoteScheduledSession) and passes nothing here. The backlog
    // must not turn "nothing to push" into a batch commit.
    mockScheduleState.deletedIds = { gone_1: 1, gone_2: 2 };

    await pushScheduledSessions([]);

    expect(mockState.ops).toHaveLength(0);
    expect(mockState.commits).toBe(0);
  });

  it('writes nothing while signed out', async () => {
    mockState.signedIn = false;

    await pushScheduledSessions([plan()]);

    expect(mockState.ops).toHaveLength(0);
  });
});

describe('syncScheduledSessions still reconciles the backlog', () => {
  it('deletes every tombstoned document the remote side still holds', async () => {
    // The half that must NOT move: the full sync is where a deletion made
    // on this device while offline, or while signed out, finally reaches
    // Firestore.
    mockState.remote = { gone_1: remoteDoc(), keep_1: remoteDoc() };
    mockScheduleState.deletedIds = { gone_1: 1, gone_2: 2 };
    mockScheduleState.scheduled = [];

    await syncScheduledSessions('uid-1', () => {});

    expect(deletes()).toEqual(
      expect.arrayContaining([`delete:${COL}/gone_1`, `delete:${COL}/gone_2`]),
    );
    expect(appliedIds()).toEqual(['keep_1']);
  });
});

describe('what fromRemote lets in off the wire', () => {
  // The app's own authoring path rejects an impossible day
  // (createScheduledSession -> isValidDateKey), and firestore.rules checks
  // the SHAPE of these two fields -- but a shape is not a value, and
  // '2026-02-30' and '25:00' both satisfy the rules' regexes. fromRemote was
  // the last check before an inbound plan became a local one, and it only
  // asked whether the fields were strings.
  //
  // What that cost: sessionsOnDay and the calendar's day sheet key off the
  // date STRING, so the plan listed under a day cell the calendar never
  // renders, while scheduledStartMs rolled Feb 30 forward and armed its
  // reminder on Mar 2. Neither day told the user what would actually happen.
  it('rejects a plan naming a day that does not exist', async () => {
    mockState.remote = { bad_1: remoteDoc({ date: '2026-02-30' }) };

    await syncScheduledSessions('uid-1', () => {});

    expect(appliedIds()).toEqual([]);
    // Same treatment as any other malformed document: removed, so it
    // doesn't come back on the next sync.
    expect(deletes()).toEqual([`delete:${COL}/bad_1`]);
  });

  it('rejects a plan whose clock time is not a real time', async () => {
    mockState.remote = { bad_2: remoteDoc({ time: '25:00' }) };

    await syncScheduledSessions('uid-1', () => {});

    expect(appliedIds()).toEqual([]);
  });

  it('still accepts a real leap day', async () => {
    // The check has to be a real calendar round trip, not a stricter
    // regex -- Feb 29 exists in 2024 and does not in 2025.
    mockState.remote = { ok_1: remoteDoc({ date: '2024-02-29' }) };

    await syncScheduledSessions('uid-1', () => {});

    expect(appliedIds()).toEqual(['ok_1']);
    expect(deletes()).toHaveLength(0);
  });
});
