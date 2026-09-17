// runMigrationAndSync.test.ts -- the sign-in orchestration's own preamble:
// the profile document it creates on a first sign-in, and what it does when
// the user stops being signed in partway through.
//
// The invariant, stated in makeSyncGuard's comment and enforced everywhere
// below it: a run whose local side stopped belonging to this uid is NOT a
// failure. It throws LocalDataSuperseded, which runMigrationAndSync swallows,
// because nothing went wrong -- the remote side is untouched and correct,
// there is simply no longer a local side to merge into. Anything else
// propagates and SyncStatusSection puts "sync failed" on the Account page.
//
// The preamble was outside that rule. `auth.currentUser!` was read four
// awaits after requireUid(uid) had checked it -- three hydrate()s and
// ensureLocalDataScopedTo, any of which can span a sign-out, an account
// switch or an account deletion -- and the non-null assertion turned that
// expected case into a TypeError on `user.email`, reported to the user as a
// generic sync failure for a sign-out they performed on purpose.
import { runMigrationAndSync } from './firestoreSync';

// One object, `mock`-prefixed, because Jest hoists jest.mock factories above
// every other binding in the file and only lets them close over names that
// start with `mock` -- same shape as deleteAllUserData.test.ts's.
const mockState: {
  /** null stands for "nobody is signed in any more". */
  currentUser: { uid: string; email: string | null; displayName: string | null; photoURL: string | null } | null;
  writes: string[];
  /** Runs inside ensureLocalDataScopedTo, i.e. mid-preamble. */
  duringScoping: (() => void) | null;
} = { currentUser: null, writes: [], duringScoping: null };

jest.mock('../auth/firebase', () => ({
  getDb: () => ({ __db: true }),
  getFirebaseAuth: () => ({ currentUser: mockState.currentUser }),
}));

jest.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'ts',
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  // Every document is absent, which is the first-sign-in shape this
  // preamble is about.
  getDoc: jest.fn(async () => ({ exists: () => false, data: () => undefined })),
  setDoc: jest.fn(async (path: string) => {
    mockState.writes.push(path);
  }),
  deleteDoc: jest.fn(),
  getDocs: jest.fn(),
  writeBatch: jest.fn(),
  runTransaction: jest.fn(),
}));

const mockHydrate = jest.fn(async () => {});
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      hydrate: mockHydrate,
      themeMode: 'system',
      accent: 'blue',
      callAlertsEnabled: true,
      customLabels: [],
      excludedTopicKeys: [],
      settingsUpdatedAt: 0,
    }),
  },
}));
jest.mock('../store/useGoalsStore', () => ({
  useGoalsStore: { getState: () => ({ hydrate: mockHydrate, goals: [], goalsUpdatedAt: 0 }) },
}));
jest.mock('../store/useScheduleStore', () => ({ useScheduleStore: { getState: () => ({ hydrate: mockHydrate }) } }));
jest.mock('./sessionsSync', () => ({ syncSessions: jest.fn(async () => {}) }));
jest.mock('./scheduledSessionsSync', () => ({ syncScheduledSessions: jest.fn(async () => {}) }));
jest.mock('./localDataOwner', () => ({
  // The exact await the sign-out has to land inside: it is the last thing
  // before the profile write, and on a first sign-in it is also the
  // slowest (it wipes local storage).
  ensureLocalDataScopedTo: jest.fn(async () => {
    mockState.duringScoping?.();
  }),
  localDataGeneration: () => 0,
}));

beforeEach(() => {
  mockState.currentUser = { uid: 'uid-1', email: 'a@b.com', displayName: null, photoURL: null };
  mockState.writes.length = 0;
  mockState.duringScoping = null;
  jest.clearAllMocks();
});

describe('runMigrationAndSync', () => {
  it('creates the profile document on a first sign-in', async () => {
    await runMigrationAndSync('uid-1');

    expect(mockState.writes).toContain('users/uid-1');
  });

  it('abandons the run, without reporting a failure, when the user signs out mid-preamble', async () => {
    mockState.duringScoping = () => {
      mockState.currentUser = null;
    };

    // Must RESOLVE. A rejection here is what SyncStatusSection renders as
    // "sync failed", for a user who simply signed out.
    await expect(runMigrationAndSync('uid-1')).resolves.toBeUndefined();

    expect(mockState.writes).toHaveLength(0);
  });

  it('abandons the run when a different account signed in mid-preamble', async () => {
    // The same window, with worse stakes: writing uid-1's profile fields --
    // and then merging its settings, goals and sessions -- into whatever
    // account is signed in now.
    mockState.duringScoping = () => {
      mockState.currentUser = { uid: 'uid-2', email: 'other@b.com', displayName: null, photoURL: null };
    };

    await expect(runMigrationAndSync('uid-1')).resolves.toBeUndefined();

    expect(mockState.writes).toHaveLength(0);
  });
});
