// Unit tests for goals.ts's CRUD-on-array helpers, cap/validation
// enforcement, tombstone pruning, and sanitizeRemoteGoals's hardening of
// untrusted input. Run with `npm test`.
import {
  makeGoalId,
  createGoal,
  updateGoal,
  archiveGoal,
  pruneArchivedGoals,
  sanitizeRemoteGoals,
  Goal,
  MAX_GOALS,
  MAX_GOAL_ID_LENGTH,
  MAX_TOPIC_LENGTH,
  MIN_TARGET_S,
  MAX_DAILY_TARGET_S,
  MAX_WEEKLY_TARGET_S,
  ARCHIVED_GOAL_PRUNE_MS,
} from './goals';

describe('makeGoalId', () => {
  it('generates a "goal:"-prefixed id well within MAX_GOAL_ID_LENGTH', () => {
    const id = makeGoalId();
    expect(id.startsWith('goal:')).toBe(true);
    expect(id.length).toBeLessThanOrEqual(MAX_GOAL_ID_LENGTH);
  });

  it('generates unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => makeGoalId()));
    expect(ids.size).toBe(20);
  });
});

describe('createGoal', () => {
  it('creates a daily goal with topic null (all focus time), stamping createdAt/updatedAt', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ topic: null, period: 'daily', targetS: 3600, createdAt: 1000, updatedAt: 1000, archived: false });
  });

  it('creates a weekly goal targeting a built-in topic key', () => {
    const goals = createGoal([], 'work', 'weekly', 18000, 1000);
    expect(goals[0]).toMatchObject({ topic: 'work', period: 'weekly' });
  });

  it('creates a goal targeting a custom label id', () => {
    const goals = createGoal([], 'custom:abc123', 'daily', 3600, 1000);
    expect(goals[0].topic).toBe('custom:abc123');
  });

  it('appends without disturbing existing goals', () => {
    const first = createGoal([], 'work', 'daily', 3600, 1000);
    const both = createGoal(first, 'study', 'daily', 3600, 1000);
    expect(both.map((g) => g.topic)).toEqual(['work', 'study']);
  });

  it('rejects an empty-string topic (use null for "all topics" instead)', () => {
    expect(() => createGoal([], '', 'daily', 3600)).toThrow();
  });

  it('rejects a topic longer than MAX_TOPIC_LENGTH', () => {
    const tooLong = 'x'.repeat(MAX_TOPIC_LENGTH + 1);
    expect(() => createGoal([], tooLong, 'daily', 3600)).toThrow();
  });

  it('accepts a topic exactly at MAX_TOPIC_LENGTH', () => {
    const atLimit = 'x'.repeat(MAX_TOPIC_LENGTH);
    const goals = createGoal([], atLimit, 'daily', 3600);
    expect(goals[0].topic).toHaveLength(MAX_TOPIC_LENGTH);
  });

  it('rejects an invalid period', () => {
    expect(() => createGoal([], null, 'monthly' as any, 3600)).toThrow();
  });

  it('rejects a non-integer targetS', () => {
    expect(() => createGoal([], null, 'daily', 60.5)).toThrow();
  });

  it('rejects a targetS below MIN_TARGET_S', () => {
    expect(() => createGoal([], null, 'daily', MIN_TARGET_S - 1)).toThrow();
  });

  it('accepts a targetS exactly at MIN_TARGET_S', () => {
    const goals = createGoal([], null, 'daily', MIN_TARGET_S);
    expect(goals[0].targetS).toBe(MIN_TARGET_S);
  });

  it('rejects a daily targetS above MAX_DAILY_TARGET_S', () => {
    expect(() => createGoal([], null, 'daily', MAX_DAILY_TARGET_S + 1)).toThrow();
  });

  it('accepts a daily targetS exactly at MAX_DAILY_TARGET_S', () => {
    const goals = createGoal([], null, 'daily', MAX_DAILY_TARGET_S);
    expect(goals[0].targetS).toBe(MAX_DAILY_TARGET_S);
  });

  it('rejects a weekly targetS above MAX_WEEKLY_TARGET_S', () => {
    expect(() => createGoal([], null, 'weekly', MAX_WEEKLY_TARGET_S + 1)).toThrow();
  });

  it('accepts a weekly targetS exactly at MAX_WEEKLY_TARGET_S', () => {
    const goals = createGoal([], null, 'weekly', MAX_WEEKLY_TARGET_S);
    expect(goals[0].targetS).toBe(MAX_WEEKLY_TARGET_S);
  });

  it('rejects a weekly targetS that would be valid for daily but exceeds the weekly-scaled bound check ordering (sanity: daily cap does not leak into weekly)', () => {
    // A targetS between MAX_DAILY_TARGET_S and MAX_WEEKLY_TARGET_S must be
    // accepted for weekly and rejected for daily -- confirms the two caps
    // are actually independent, not one shared bound.
    const midway = MAX_DAILY_TARGET_S + 1;
    expect(() => createGoal([], null, 'daily', midway)).toThrow();
    const goals = createGoal([], null, 'weekly', midway);
    expect(goals[0].targetS).toBe(midway);
  });

  it('rejects creating a goal past MAX_GOALS', () => {
    let goals: Goal[] = [];
    for (let i = 0; i < MAX_GOALS; i += 1) {
      goals = createGoal(goals, null, 'daily', 3600, 1000 + i);
    }
    expect(goals).toHaveLength(MAX_GOALS);
    expect(() => createGoal(goals, null, 'daily', 3600)).toThrow();
  });
});

describe('updateGoal', () => {
  it('updates only the matching goal by id, re-stamping updatedAt', () => {
    const goals = createGoal(createGoal([], 'work', 'daily', 3600, 1000), 'study', 'daily', 3600, 1000);
    const updated = updateGoal(goals, goals[0].id, { targetS: 7200 }, 2000);
    expect(updated[0]).toMatchObject({ targetS: 7200, updatedAt: 2000 });
    expect(updated[1]).toEqual(goals[1]); // untouched
  });

  it('re-validates the merged result, not just the patched field in isolation', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    // Patching only the period to weekly must re-check targetS against the
    // *weekly* bound (still fine here) and reject a subsequent patch that
    // would violate the daily bound if switched back.
    const weekly = updateGoal(goals, goals[0].id, { period: 'weekly', targetS: MAX_WEEKLY_TARGET_S }, 2000);
    expect(weekly[0].targetS).toBe(MAX_WEEKLY_TARGET_S);
    expect(() => updateGoal(weekly, weekly[0].id, { period: 'daily' }, 3000)).toThrow();
  });

  it('rejects an invalid topic on update', () => {
    const goals = createGoal([], 'work', 'daily', 3600, 1000);
    expect(() => updateGoal(goals, goals[0].id, { topic: 'x'.repeat(MAX_TOPIC_LENGTH + 1) })).toThrow();
  });

  it('is a no-op for an id that does not exist', () => {
    const goals = createGoal([], 'work', 'daily', 3600, 1000);
    const result = updateGoal(goals, 'goal:does-not-exist', { targetS: 7200 }, 2000);
    expect(result).toEqual(goals);
  });
});

describe('archiveGoal', () => {
  it('tombstones the matching goal (archived: true) instead of removing it', () => {
    const goals = createGoal([], 'work', 'daily', 3600, 1000);
    const archived = archiveGoal(goals, goals[0].id, 2000);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ archived: true, updatedAt: 2000 });
  });

  it('is a no-op for an id that does not exist', () => {
    const goals = createGoal([], 'work', 'daily', 3600, 1000);
    const result = archiveGoal(goals, 'goal:does-not-exist', 2000);
    expect(result).toEqual(goals);
  });
});

describe('pruneArchivedGoals', () => {
  it('keeps a live (non-archived) goal regardless of age', () => {
    const goals: Goal[] = [{ id: 'goal:a', topic: null, period: 'daily', targetS: 3600, createdAt: 0, updatedAt: 0, archived: false }];
    const pruned = pruneArchivedGoals(goals, ARCHIVED_GOAL_PRUNE_MS * 10);
    expect(pruned).toEqual(goals);
  });

  it('keeps an archived goal younger than the prune horizon', () => {
    const goals: Goal[] = [{ id: 'goal:a', topic: null, period: 'daily', targetS: 3600, createdAt: 0, updatedAt: 1000, archived: true }];
    const pruned = pruneArchivedGoals(goals, 1000 + ARCHIVED_GOAL_PRUNE_MS);
    expect(pruned).toEqual(goals);
  });

  it('drops an archived goal older than the prune horizon', () => {
    const goals: Goal[] = [{ id: 'goal:a', topic: null, period: 'daily', targetS: 3600, createdAt: 0, updatedAt: 1000, archived: true }];
    const pruned = pruneArchivedGoals(goals, 1000 + ARCHIVED_GOAL_PRUNE_MS + 1);
    expect(pruned).toEqual([]);
  });
});

describe('sanitizeRemoteGoals', () => {
  const valid = (overrides: Partial<Goal> = {}): unknown => ({
    id: 'goal:abc',
    topic: null,
    period: 'daily',
    targetS: 3600,
    createdAt: 1000,
    updatedAt: 1000,
    archived: false,
    ...overrides,
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeRemoteGoals(null)).toEqual([]);
    expect(sanitizeRemoteGoals(undefined)).toEqual([]);
    expect(sanitizeRemoteGoals('not an array')).toEqual([]);
    expect(sanitizeRemoteGoals({ goals: [] })).toEqual([]);
  });

  it('passes through a well-formed entry unchanged', () => {
    const result = sanitizeRemoteGoals([valid()]);
    expect(result).toEqual([valid()]);
  });

  it('drops a non-object entry', () => {
    expect(sanitizeRemoteGoals([null, 42, 'x', valid()])).toEqual([valid()]);
  });

  it('drops an entry with a missing or non-string id', () => {
    expect(sanitizeRemoteGoals([valid({ id: undefined as any })])).toEqual([]);
    expect(sanitizeRemoteGoals([valid({ id: 123 as any })])).toEqual([]);
  });

  it('drops an entry whose id exceeds MAX_GOAL_ID_LENGTH', () => {
    expect(sanitizeRemoteGoals([valid({ id: 'goal:' + 'x'.repeat(MAX_GOAL_ID_LENGTH) })])).toEqual([]);
  });

  it('drops an entry with a wrong-typed topic', () => {
    expect(sanitizeRemoteGoals([valid({ topic: 42 as any })])).toEqual([]);
  });

  it('drops an entry with an over-length topic', () => {
    expect(sanitizeRemoteGoals([valid({ topic: 'x'.repeat(MAX_TOPIC_LENGTH + 1) })])).toEqual([]);
  });

  it('accepts a null topic and a valid string topic', () => {
    expect(sanitizeRemoteGoals([valid({ topic: null })])[0].topic).toBeNull();
    expect(sanitizeRemoteGoals([valid({ topic: 'custom:xyz' })])[0].topic).toBe('custom:xyz');
  });

  it('drops an entry with an invalid period', () => {
    expect(sanitizeRemoteGoals([valid({ period: 'monthly' as any })])).toEqual([]);
  });

  it('drops an entry whose targetS is not an integer', () => {
    expect(sanitizeRemoteGoals([valid({ targetS: 60.5 })])).toEqual([]);
    expect(sanitizeRemoteGoals([valid({ targetS: '3600' as any })])).toEqual([]);
    expect(sanitizeRemoteGoals([valid({ targetS: NaN })])).toEqual([]);
  });

  it('drops an entry whose targetS is out of bounds for its period', () => {
    expect(sanitizeRemoteGoals([valid({ targetS: MIN_TARGET_S - 1 })])).toEqual([]);
    expect(sanitizeRemoteGoals([valid({ period: 'daily', targetS: MAX_DAILY_TARGET_S + 1 })])).toEqual([]);
    // valid for weekly, invalid for daily -- confirms per-period bound, not a shared one
    expect(sanitizeRemoteGoals([valid({ period: 'weekly', targetS: MAX_DAILY_TARGET_S + 1 })])).toHaveLength(1);
  });

  it('defaults a missing/malformed createdAt to nowMs (sort-order only, safe to invent) rather than dropping the goal', () => {
    const nowMs = 5000;
    const result = sanitizeRemoteGoals([valid({ createdAt: undefined as any })], nowMs);
    expect(result).toEqual([valid({ createdAt: nowMs })]);
  });

  it('defaults a missing/malformed updatedAt to 0, NOT nowMs -- a clockless entry must fail closed and lose every LWW compare', () => {
    const nowMs = 5000;
    const result = sanitizeRemoteGoals([valid({ updatedAt: undefined as any })], nowMs);
    expect(result).toEqual([valid({ updatedAt: 0 })]);
    expect(sanitizeRemoteGoals([valid({ updatedAt: 'bad' as any })], nowMs)).toEqual([valid({ updatedAt: 0 })]);
    expect(sanitizeRemoteGoals([valid({ updatedAt: NaN })], nowMs)).toEqual([valid({ updatedAt: 0 })]);
  });

  it('coerces a non-boolean archived to false', () => {
    expect(sanitizeRemoteGoals([valid({ archived: 'true' as any })])[0].archived).toBe(false);
    expect(sanitizeRemoteGoals([valid({ archived: 1 as any })])[0].archived).toBe(false);
    expect(sanitizeRemoteGoals([valid({ archived: undefined as any })])[0].archived).toBe(false);
  });

  it('resolves duplicate ids by keeping the greater updatedAt, at the first occurrence\'s array position', () => {
    const older = valid({ id: 'goal:dup', updatedAt: 100, topic: 'work' });
    const newer = valid({ id: 'goal:dup', updatedAt: 200, topic: 'study' });
    const other = valid({ id: 'goal:other' });
    const result = sanitizeRemoteGoals([older, other, newer]);
    expect(result.map((g) => g.id)).toEqual(['goal:dup', 'goal:other']); // position preserved from first occurrence
    expect(result[0]).toMatchObject({ updatedAt: 200, topic: 'study' }); // value from the newer duplicate
  });

  it('caps the result to MAX_GOALS, keeping input order', () => {
    const many = Array.from({ length: MAX_GOALS + 5 }, (_, i) => valid({ id: `goal:${i}` }));
    const result = sanitizeRemoteGoals(many);
    expect(result).toHaveLength(MAX_GOALS);
    expect(result.map((g) => g.id)).toEqual(many.slice(0, MAX_GOALS).map((g: any) => g.id));
  });

  it('never throws on hostile input (mixed garbage, oversized array, wrong shapes)', () => {
    const hostile = [
      undefined,
      null,
      42,
      'garbage',
      [],
      { id: 'goal:ok', topic: null, period: 'daily', targetS: 3600, createdAt: 1, updatedAt: 1, archived: false },
      { id: 'goal:bad-period', period: 'yearly', targetS: 3600 },
      { id: {}, period: 'daily', targetS: 3600 },
    ];
    expect(() => sanitizeRemoteGoals(hostile)).not.toThrow();
    expect(sanitizeRemoteGoals(hostile).map((g) => g.id)).toEqual(['goal:ok']);
  });
});
