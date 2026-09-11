// deleteAllUserData.test.ts -- the account-deletion sweep, which is the
// mechanism behind App Store Review Guideline 5.1.1(v) (delete the account
// AND its data).
//
// Two properties here are load-bearing and neither is visible in ordinary
// use, because the only way to exercise this path for real is to destroy an
// account:
//
//   1. users/{uid} must be deleted BEFORE the sessions sweep. firestore.rules
//      permits a session delete only while that doc is absent, so the wrong
//      order silently leaves every session undeletable by anyone, forever.
//   2. A permission error on the sessions sweep must not abort the flow.
//      firestore.rules is deployed separately from the app binary, so a build
//      can reach a phone before the ruleset that lets it purge sessions.
import { deleteAllUserData } from './firestoreSync';

// One object, `mock`-prefixed, because Jest hoists jest.mock factories above
// every other binding in the file and only lets them close over names that
// start with `mock`.
const mockState: { calls: string[]; failCommitFor: string | null } = {
  calls: [],
  /** Set by a test to make that subcollection's batch commit reject. */
  failCommitFor: null,
};

jest.mock('../auth/firebase', () => ({
  getDb: () => ({ __db: true }),
  getFirebaseAuth: () => ({ currentUser: { uid: 'uid-1' } }),
}));

jest.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'ts',
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  // Path strings stand in for refs: what these tests assert on is the order
  // and the targets, not the SDK's opaque reference objects.
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  deleteDoc: jest.fn(async (path: string) => {
    mockState.calls.push(`deleteDoc:${path}`);
  }),
  getDocs: jest.fn(async (path: string) => ({
    // Two documents per subcollection, so a commit is always required.
    docs: [{ ref: `${path}/a` }, { ref: `${path}/b` }],
  })),
  writeBatch: () => {
    const staged: string[] = [];
    return {
      delete: (ref: string) => staged.push(ref),
      commit: async () => {
        const sub = staged[0]?.split('/')[2];
        if (sub && sub === mockState.failCommitFor) {
          const err: Error & { code?: string } = new Error('Missing or insufficient permissions.');
          err.code = 'permission-denied';
          throw err;
        }
        mockState.calls.push(`batch:${staged.join(',')}`);
      },
    };
  },
}));

// firestoreSync's module graph reaches the Zustand stores, which pull in
// expo-notifications and react-native-ble-plx at import time -- neither of
// which survives outside a native runtime, and neither of which is on
// deleteAllUserData's path. Stubbed so this suite can test six deletes
// without standing up a device.
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));
jest.mock('../store/useGoalsStore', () => ({ useGoalsStore: { getState: () => ({}) } }));
jest.mock('../store/useScheduleStore', () => ({ useScheduleStore: { getState: () => ({}) } }));
jest.mock('./sessionsSync', () => ({ syncSessions: jest.fn() }));
jest.mock('./scheduledSessionsSync', () => ({ syncScheduledSessions: jest.fn() }));
jest.mock('./localDataOwner', () => ({ ensureLocalDataScopedTo: jest.fn(), localDataGeneration: () => 0 }));

beforeEach(() => {
  mockState.calls.length = 0;
  mockState.failCommitFor = null;
});

/** Index into `calls` of the first entry mentioning `needle`, or -1. */
const indexOf = (needle: string) => mockState.calls.findIndex((c) => c.includes(needle));

describe('deleteAllUserData', () => {
  it('deletes the parent user doc before sweeping sessions', async () => {
    await deleteAllUserData('uid-1');

    const parent = indexOf('deleteDoc:users/uid-1');
    const sessions = indexOf('sessions/a');
    expect(parent).toBeGreaterThanOrEqual(0);
    expect(sessions).toBeGreaterThanOrEqual(0);
    expect(parent).toBeLessThan(sessions);
  });

  it('sweeps every subcollection that holds user data', async () => {
    await deleteAllUserData('uid-1');

    for (const sub of ['settings', 'devices', 'goals', 'pushTokens', 'scheduledSessions', 'sessions']) {
      expect(indexOf(`${sub}/a`)).toBeGreaterThanOrEqual(0);
    }
  });

  it('completes when a stale ruleset denies the sessions sweep', async () => {
    mockState.failCommitFor = 'sessions';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Must not reject: throwing here would strand the account with its user
    // doc gone and its Auth user still alive, which is worse than the
    // orphaned sessions this replaced.
    await expect(deleteAllUserData('uid-1')).resolves.toBeUndefined();

    expect(indexOf('settings/a')).toBeGreaterThanOrEqual(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still fails loudly when a required subcollection is denied', async () => {
    // Only sessions is tolerated. A denied settings sweep is a real fault and
    // must not be swallowed into a half-deleted account that looks finished.
    mockState.failCommitFor = 'settings';

    await expect(deleteAllUserData('uid-1')).rejects.toThrow(/permissions/);
  });
});
