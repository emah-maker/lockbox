// sessionsSync.demo.test.ts -- the one seam that keeps demonstration-mode
// sessions (ble/DemoBoxClient.ts) off Firestore.
//
// This is tested rather than trusted because getting it wrong is permanent.
// firestore.rules' sessions block allows a delete only while `users/{uid}`
// is absent -- a window only account deletion opens -- so a fake session
// that reaches an account is in that account's stats forever, with no
// in-app way to remove it. It lands hardest on the App Review demo account
// itself, which is seeded to tell a specific story about goals met and in
// progress (scripts/lib/demo-seed-data.js).
//
// The filter is keyed on the session's own durable `demo` flag rather than
// on whether demo mode happens to be switched on, and that distinction is
// what the last test here is about: the upload that matters is the full
// reconcile that runs on the NEXT sign-in, long after the toggle went back
// off.
//
// Firestore is mocked the same way deleteAllUserData.test.ts mocks it --
// path strings stand in for refs, because what these assert on is which
// documents get written, not the SDK's opaque reference objects.
import { replaceSessions, loadSessions, type LoggedSession } from '../stats/sessionHistory';

// One object, `mock`-prefixed, because Jest hoists jest.mock factories above
// every other binding in the file and only lets them close over names that
// start with `mock`.
const mockState: { written: string[]; updated: string[] } = { written: [], updated: [] };

jest.mock('../auth/firebase', () => ({
  getDb: () => ({ __db: true }),
  getFirebaseAuth: () => ({ currentUser: { uid: 'uid-1' } }),
}));

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => path,
  orderBy: () => 'orderBy',
  deleteField: () => 'deleteField',
  getDocs: jest.fn(async () => ({ docs: [] })),
  updateDoc: jest.fn(async (path: string) => {
    mockState.updated.push(path);
  }),
  writeBatch: () => {
    const staged: string[] = [];
    return {
      set: (ref: string) => staged.push(ref),
      update: (ref: string) => staged.push(ref),
      commit: async () => {
        mockState.written.push(...staged);
      },
    };
  },
}));

// useStore pulls in PhoneBoxClient and with it a real BleManager; only
// setSessions is reached from here.
jest.mock('../store/useStore', () => ({
  useStore: { getState: () => ({ setSessions: jest.fn() }) },
}));
jest.mock('./sessionsSyncBridge', () => ({ markSessionsSeen: jest.fn() }));

import { syncSessions, pushNewSessions, pushSessionRetag } from './sessionsSync';

const session = (over: Partial<LoggedSession> = {}): LoggedSession => ({
  startedAt: 1_700_000_000_000,
  plannedS: 1800,
  actualS: 1800,
  outcome: 'completed',
  ...over,
});

const real = session();
const demo = session({ startedAt: 1_700_003_600_000, demo: true });

/** Doc ids are `deviceId_startedAt_actualS`; nothing has ever recorded a
 * box id in these tests, so currentDeviceId() falls back the way it does on
 * a phone that has never connected to one. */
const docId = (s: LoggedSession) => `users/uid-1/sessions/unknown-device_${s.startedAt}_${s.actualS}`;

beforeEach(async () => {
  mockState.written = [];
  mockState.updated = [];
  await replaceSessions([]);
});

describe('pushNewSessions', () => {
  it('uploads a real session and skips the demo one beside it', async () => {
    await pushNewSessions([real, demo]);

    expect(mockState.written).toEqual([docId(real)]);
  });

  it('writes nothing at all when the batch is demo-only', async () => {
    await pushNewSessions([demo]);

    expect(mockState.written).toEqual([]);
  });
});

describe('syncSessions', () => {
  it('uploads only the real session, and leaves the demo one on the device', async () => {
    await replaceSessions([real, demo]);

    await syncSessions('uid-1', () => {});

    expect(mockState.written).toEqual([docId(real)]);
    // Filtered out of the UPLOAD set, not out of the merge -- the merged
    // list is written back over local storage, so dropping demo sessions on
    // the way in would delete them off the device the moment someone signed
    // in, taking the history a reviewer had just watched land with it.
    expect(await loadSessions()).toEqual(expect.arrayContaining([demo]));
  });

  // The flag is durable, so this holds on a later sign-in with demo mode
  // long since switched back off -- which is the sync that would otherwise
  // quietly upload everything the demo ever produced.
  it('still skips a demo session when nothing is in demo mode any more', async () => {
    await replaceSessions([demo]);

    await syncSessions('uid-1', () => {});

    expect(mockState.written).toEqual([]);
  });
});

describe('pushSessionRetag', () => {
  it('pushes a retag for a real session', async () => {
    await pushSessionRetag(real, 'study', 123);

    expect(mockState.updated).toEqual([docId(real)]);
  });

  // Retagging from the Calendar tab is an ordinary thing to try, and a demo
  // session has no remote doc to update -- this would be an updateDoc
  // against a path that does not exist, rejecting with not-found.
  it('does not push a retag for a demo session', async () => {
    await pushSessionRetag(demo, 'study', 123);

    expect(mockState.updated).toEqual([]);
  });
});
