// Unit tests for useGoalsStore.ts's persistence/clock behavior -- hydrate/
// storage round-trip, the goalsUpdatedAt logical clock stamped on every
// mutation, and the archived-tombstone pruning that happens on every local
// write (goals.ts's pruneArchivedGoals). CRUD *validation* itself
// (createGoal/updateGoal/archiveGoal's field checks) is goals-core's own
// coverage in goals/goals.test.ts -- this file only exercises what this
// store adds on top: persistence and the clock. Exercises the real
// AsyncStorage-backed storage.ts (mocked by jest.setup.js) rather than
// mocking getJSON/setJSON, same as sync/localDataOwner.test.ts.
//
// goalNotifications.ts's own syncGoalNotifications is mocked here -- this
// file only needs to confirm the STORE calls it at the right times (after
// hydrate, after every mutation) with the right (pruned) goals array;
// syncGoalNotifications's own scheduling/permission logic is goalNotifications.
// test.ts's coverage, not this file's. Run with `npm test`.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGoalsStore } from './useGoalsStore';
import { getJSON } from '../storage/storage';
import { Goal, ARCHIVED_GOAL_PRUNE_MS } from '../goals/goals';

const mockSyncGoalNotifications = jest.fn().mockResolvedValue(undefined);
jest.mock('../goals/goalNotifications', () => ({
  syncGoalNotifications: (...args: unknown[]) => mockSyncGoalNotifications(...args),
}));

const GOALS_KEY = 'focusGoals';
const GOALS_UPDATED_AT_KEY = 'goalsUpdatedAt';

const goal = (id: string, updatedAt: number, overrides: Partial<Goal> = {}): Goal => ({
  id,
  topic: null,
  period: 'daily',
  targetS: 3600,
  createdAt: updatedAt,
  updatedAt,
  archived: false,
  ...overrides,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  useGoalsStore.setState({ hydrated: false, goals: [], goalsUpdatedAt: 0 });
  mockSyncGoalNotifications.mockClear();
});

describe('hydrate', () => {
  it('defaults to no goals and a zero clock when storage is empty', async () => {
    await useGoalsStore.getState().hydrate();
    expect(useGoalsStore.getState().goals).toEqual([]);
    expect(useGoalsStore.getState().goalsUpdatedAt).toBe(0);
    expect(useGoalsStore.getState().hydrated).toBe(true);
  });

  it('loads whatever was previously persisted', async () => {
    const stored = [goal('goal:a', 500)];
    await AsyncStorage.setItem('phonebox:' + GOALS_KEY, JSON.stringify(stored));
    await AsyncStorage.setItem('phonebox:' + GOALS_UPDATED_AT_KEY, JSON.stringify(500));

    await useGoalsStore.getState().hydrate();

    expect(useGoalsStore.getState().goals).toEqual(stored);
    expect(useGoalsStore.getState().goalsUpdatedAt).toBe(500);
  });

  it('is a no-op on a second call (does not re-read storage over live state)', async () => {
    await useGoalsStore.getState().hydrate();
    useGoalsStore.getState().addGoal(null, 'daily', 120);
    const afterAdd = useGoalsStore.getState().goals;

    await useGoalsStore.getState().hydrate();

    expect(useGoalsStore.getState().goals).toBe(afterAdd);
  });
});

describe('addGoal', () => {
  it('appends a goal, stamps goalsUpdatedAt, and persists both to storage', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      useGoalsStore.getState().addGoal('work', 'daily', 1800);
    } finally {
      jest.restoreAllMocks();
    }

    const state = useGoalsStore.getState();
    expect(state.goals).toHaveLength(1);
    expect(state.goals[0]).toMatchObject({ topic: 'work', period: 'daily', targetS: 1800, createdAt: 1000, updatedAt: 1000 });
    expect(state.goalsUpdatedAt).toBe(1000);

    expect(await getJSON<Goal[]>(GOALS_KEY, [])).toEqual(state.goals);
    expect(await getJSON<number>(GOALS_UPDATED_AT_KEY, -1)).toBe(1000);
  });

  it('propagates goals.ts validation errors without mutating state or storage', () => {
    const before = useGoalsStore.getState().goals;
    expect(() => useGoalsStore.getState().addGoal('work', 'daily', 5)).toThrow(
      'Goal target must be between 60 and 86400 seconds for a daily goal.',
    );
    expect(useGoalsStore.getState().goals).toBe(before);
  });

  it('rejects a 21st goal the same way createGoal does', () => {
    for (let i = 0; i < 20; i += 1) {
      useGoalsStore.getState().addGoal(null, 'daily', 60);
    }
    expect(() => useGoalsStore.getState().addGoal(null, 'daily', 60)).toThrow('You can have at most 20 goals.');
  });
});

describe('updateGoal', () => {
  it('updates the matching goal and bumps its updatedAt + the store clock', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    useGoalsStore.getState().addGoal('work', 'daily', 1800);
    const id = useGoalsStore.getState().goals[0].id;

    jest.spyOn(Date, 'now').mockReturnValue(2000);
    useGoalsStore.getState().updateGoal(id, { targetS: 3600 });
    jest.restoreAllMocks();

    const updated = useGoalsStore.getState().goals[0];
    expect(updated.targetS).toBe(3600);
    expect(updated.updatedAt).toBe(2000);
    expect(useGoalsStore.getState().goalsUpdatedAt).toBe(2000);
  });

  it('silently no-ops for an unknown id', () => {
    useGoalsStore.getState().addGoal('work', 'daily', 1800);
    const before = useGoalsStore.getState().goals;

    useGoalsStore.getState().updateGoal('goal:does-not-exist', { targetS: 3600 });

    expect(useGoalsStore.getState().goals[0]).toEqual(before[0]);
  });
});

describe('archiveGoal', () => {
  it('tombstones the matching goal instead of removing it', () => {
    useGoalsStore.getState().addGoal('work', 'daily', 1800);
    const id = useGoalsStore.getState().goals[0].id;

    useGoalsStore.getState().archiveGoal(id);

    expect(useGoalsStore.getState().goals).toHaveLength(1);
    expect(useGoalsStore.getState().goals[0].archived).toBe(true);
  });
});

describe('applyRemoteGoals', () => {
  it('replaces goals and sets goalsUpdatedAt to exactly the given value (no re-stamping)', () => {
    const remote = [goal('goal:a', 42)];
    useGoalsStore.getState().applyRemoteGoals(remote, 42);

    expect(useGoalsStore.getState().goals).toEqual(remote);
    expect(useGoalsStore.getState().goalsUpdatedAt).toBe(42);
  });

  it('persists the applied goals to storage', async () => {
    const remote = [goal('goal:a', 42)];
    useGoalsStore.getState().applyRemoteGoals(remote, 42);

    expect(await getJSON<Goal[]>(GOALS_KEY, [])).toEqual(remote);
    expect(await getJSON<number>(GOALS_UPDATED_AT_KEY, -1)).toBe(42);
  });

  it('prunes an archived tombstone older than ARCHIVED_GOAL_PRUNE_MS on write', () => {
    const now = 100_000_000;
    const staleTombstone = goal('goal:old', now - ARCHIVED_GOAL_PRUNE_MS - 1, { archived: true });
    const liveGoal = goal('goal:live', now);
    jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      useGoalsStore.getState().applyRemoteGoals([staleTombstone, liveGoal], now);
    } finally {
      jest.restoreAllMocks();
    }

    expect(useGoalsStore.getState().goals.map((g) => g.id)).toEqual(['goal:live']);
  });

  it('keeps an archived tombstone within the prune window', () => {
    const now = 100_000_000;
    const recentTombstone = goal('goal:recent', now - 1000, { archived: true });
    jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      useGoalsStore.getState().applyRemoteGoals([recentTombstone], now);
    } finally {
      jest.restoreAllMocks();
    }

    expect(useGoalsStore.getState().goals.map((g) => g.id)).toEqual(['goal:recent']);
  });
});

describe('resetGoals', () => {
  it('clears goals and zeroes the clock, including in storage', async () => {
    useGoalsStore.getState().addGoal('work', 'daily', 1800);

    useGoalsStore.getState().resetGoals();

    expect(useGoalsStore.getState().goals).toEqual([]);
    expect(useGoalsStore.getState().goalsUpdatedAt).toBe(0);
    expect(await getJSON<Goal[]>(GOALS_KEY, [{ id: 'sentinel' } as unknown as Goal])).toEqual([]);
    expect(await getJSON<number>(GOALS_UPDATED_AT_KEY, -1)).toBe(0);
  });
});

describe('syncGoalNotifications integration', () => {
  it('is called with the hydrated goals array after hydrate', async () => {
    const stored = [goal('goal:a', 500)];
    await AsyncStorage.setItem('phonebox:' + GOALS_KEY, JSON.stringify(stored));
    await AsyncStorage.setItem('phonebox:' + GOALS_UPDATED_AT_KEY, JSON.stringify(500));

    await useGoalsStore.getState().hydrate();

    expect(mockSyncGoalNotifications).toHaveBeenCalledWith(stored);
  });

  it('is called after addGoal, with the post-mutation (pruned) goals array', () => {
    useGoalsStore.getState().addGoal('work', 'daily', 1800);
    expect(mockSyncGoalNotifications).toHaveBeenCalledWith(useGoalsStore.getState().goals);
  });

  it('is called after updateGoal', () => {
    useGoalsStore.getState().addGoal('work', 'daily', 1800);
    mockSyncGoalNotifications.mockClear();
    const id = useGoalsStore.getState().goals[0].id;

    useGoalsStore.getState().updateGoal(id, { notify: true, notifyAt: '09:00' });

    expect(mockSyncGoalNotifications).toHaveBeenCalledWith(useGoalsStore.getState().goals);
  });

  it('is called after archiveGoal', () => {
    useGoalsStore.getState().addGoal('work', 'daily', 1800);
    mockSyncGoalNotifications.mockClear();
    const id = useGoalsStore.getState().goals[0].id;

    useGoalsStore.getState().archiveGoal(id);

    expect(mockSyncGoalNotifications).toHaveBeenCalledWith(useGoalsStore.getState().goals);
  });

  it('is called after applyRemoteGoals and after resetGoals', () => {
    useGoalsStore.getState().applyRemoteGoals([goal('goal:a', 42)], 42);
    expect(mockSyncGoalNotifications).toHaveBeenCalledWith(useGoalsStore.getState().goals);

    mockSyncGoalNotifications.mockClear();
    useGoalsStore.getState().resetGoals();
    expect(mockSyncGoalNotifications).toHaveBeenCalledWith([]);
  });

  it('is never called when addGoal throws (validation failure never triggers a reschedule)', () => {
    mockSyncGoalNotifications.mockClear();
    expect(() => useGoalsStore.getState().addGoal('work', 'daily', 5)).toThrow();
    expect(mockSyncGoalNotifications).not.toHaveBeenCalled();
  });
});
