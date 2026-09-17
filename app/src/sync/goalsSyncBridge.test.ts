// goalsSyncBridge.test.ts -- which useGoalsStore changes reach Firestore,
// and which must not. settingsSyncBridge.test.ts's header describes the
// hazard in full; goals inherit all of it (pushGoalsPatch is the same
// unconditional whole-document setDoc) and add one of their own.
//
// The extra one: goals/config is the only document in this app whose merge
// is per-item rather than whole-document (goalMerge.ts's mergeGoals, via
// goalsSyncPlan.ts) -- precisely so a goal created on the dashboard and a
// goal edited on the phone both survive. An emission this bridge mistakes
// for an edit throws that away, because the push it triggers replaces the
// whole array with this device's copy alone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setJSON } from '../storage/storage';
import { pushGoalsPatch } from './firestoreSync';
import { useGoalsStore } from '../store/useGoalsStore';
import { startGoalsSyncBridge } from './goalsSyncBridge';
import type { Goal } from '../goals/goals';

jest.mock('./firestoreSync', () => ({ pushGoalsPatch: jest.fn(async () => {}) }));

// The OS scheduler is the goals store's business, not this file's -- stubbed
// so no native notifications module is needed, matching
// useGoalsStore.test.ts's own treatment of it.
jest.mock('../goals/goalNotifications', () => ({
  syncGoalNotifications: jest.fn(async () => {}),
}));

// See settingsSyncBridge.test.ts's note: isSignedIn() is the bridge's early
// out, and every scenario here is a device with an account to push to.
jest.mock('../auth/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: (globalThis as any).__signedIn ? { uid: 'uid-a' } : null }),
}));

const pushMock = pushGoalsPatch as jest.MockedFunction<typeof pushGoalsPatch>;

const storedGoal = (over: Partial<Goal> = {}): Goal => ({
  id: 'goal_1',
  topic: null,
  period: 'daily',
  targetS: 3600,
  createdAt: 1,
  updatedAt: 1,
  // Required on Goal, and spelled out here rather than left to `over` for
  // the same reason every other Goal fixture in this repo does it (see
  // goalMerge.test.ts): spreading a Partial over a base that omits a
  // required field widens it to `boolean | undefined`.
  archived: false,
  ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  (globalThis as any).__signedIn = true;
  useGoalsStore.setState({ hydrated: true, goals: [], goalsUpdatedAt: 0, localWrites: 0 });
  jest.clearAllMocks();
  startGoalsSyncBridge(); // idempotent; the first test starts it
});

describe('what gets pushed', () => {
  it('pushes a newly added goal', () => {
    useGoalsStore.getState().addGoal(null, 'daily', 3600);
    expect(pushMock).toHaveBeenCalled();
  });

  it('pushes an edit to an existing goal', () => {
    useGoalsStore.getState().addGoal(null, 'daily', 3600);
    const [g] = useGoalsStore.getState().goals;
    pushMock.mockClear();

    useGoalsStore.getState().updateGoal(g.id, { targetS: 7200 });
    expect(pushMock).toHaveBeenCalled();
  });

  it('pushes an archive', () => {
    useGoalsStore.getState().addGoal(null, 'daily', 3600);
    const [g] = useGoalsStore.getState().goals;
    pushMock.mockClear();

    useGoalsStore.getState().archiveGoal(g.id);
    expect(pushMock).toHaveBeenCalled();
  });

  it('does not push while signed out', () => {
    (globalThis as any).__signedIn = false;
    useGoalsStore.getState().addGoal(null, 'daily', 3600);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('what must NOT get pushed', () => {
  // The data-loss case, goals half: a goal created while signed out, then a
  // sign-in to an account that already has goals. ensureLocalDataScopedTo
  // wipes local storage (resetGoals -> `{ goals: [], updatedAt: 0 }`) while
  // already authenticated as that account, and this bridge used to mirror
  // the empty array straight into users/{uid}/goals/config.
  it('does not push the wipe that signing in performs', () => {
    useGoalsStore.getState().addGoal(null, 'daily', 3600);
    pushMock.mockClear();

    useGoalsStore.getState().resetGoals();

    expect(pushMock).not.toHaveBeenCalled();
  });

  // syncGoalsTwoWay applies the merge locally and then does its OWN
  // write-back when the plan says one is needed. An echo from here is a
  // second whole-array write of the same content -- and once that push has
  // to read-modify-write to stay per-goal safe, a wasted round trip on every
  // merge as well.
  it('does not push a remote merge back to the server', () => {
    useGoalsStore.getState().applyRemoteGoals([storedGoal({ id: 'goal_remote', updatedAt: 9 })], 9);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does not push on hydration', async () => {
    await setJSON('focusGoals', [storedGoal()]);
    await setJSON('goalsUpdatedAt', 5);
    useGoalsStore.setState({ hydrated: false, goals: [], goalsUpdatedAt: 0, localWrites: 0 });

    await useGoalsStore.getState().hydrate();

    expect(useGoalsStore.getState().goals).toHaveLength(1);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
