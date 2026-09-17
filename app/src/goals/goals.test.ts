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
  MAX_MONTHLY_TARGET_S,
  MAX_TARGET_SESSIONS,
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
    expect(() => createGoal([], null, 'yearly' as any, 3600)).toThrow();
  });

  it('accepts the "monthly" period added by the flexible-goals extension', () => {
    const goals = createGoal([], null, 'monthly', 3600);
    expect(goals[0].period).toBe('monthly');
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

  it('accepts a monthly targetS up to MAX_MONTHLY_TARGET_S and rejects above it', () => {
    const goals = createGoal([], null, 'monthly', MAX_MONTHLY_TARGET_S);
    expect(goals[0].targetS).toBe(MAX_MONTHLY_TARGET_S);
    expect(() => createGoal([], null, 'monthly', MAX_MONTHLY_TARGET_S + 1)).toThrow();
  });

  it('rejects creating a goal past MAX_GOALS', () => {
    let goals: Goal[] = [];
    for (let i = 0; i < MAX_GOALS; i += 1) {
      goals = createGoal(goals, null, 'daily', 3600, 1000 + i);
    }
    expect(goals).toHaveLength(MAX_GOALS);
    expect(() => createGoal(goals, null, 'daily', 3600)).toThrow();
  });

  // A "deleted" goal stays in the array as a tombstone for the full
  // ARCHIVED_GOAL_PRUNE_MS horizon (see Goal.archived), so counting raw array
  // length against the cap let a list the user sees as EMPTY refuse a new
  // goal for 30 days, with no way out from inside the app.
  describe('the cap counts live goals, not tombstones', () => {
    const archiveAll = (goals: Goal[], nowMs: number): Goal[] =>
      goals.reduce((acc, g) => archiveGoal(acc, g.id, nowMs), goals);

    const fillToCap = (): Goal[] => {
      let goals: Goal[] = [];
      for (let i = 0; i < MAX_GOALS; i += 1) goals = createGoal(goals, null, 'daily', 3600, 1000 + i);
      return goals;
    };

    it('accepts a new goal when every existing entry is an archived tombstone', () => {
      const tombstones = archiveAll(fillToCap(), 5000);
      expect(tombstones.filter((g) => !g.archived)).toHaveLength(0);
      // Nothing is old enough to prune, so the array really is still full.
      expect(pruneArchivedGoals(tombstones, 5000)).toHaveLength(MAX_GOALS);

      const next = createGoal(tombstones, 'work', 'daily', 3600, 6000);
      expect(next.filter((g) => !g.archived).map((g) => g.topic)).toEqual(['work']);
    });

    it('still keeps the array itself within MAX_GOALS, which firestore.rules requires of goals/config', () => {
      // A local array over the cap is not a cosmetic overflow: an
      // account whose goals/config doc does not exist yet is written with
      // setDoc(local.goals) verbatim (firestoreSync.ts's syncGoalsTwoWay),
      // and the rules reject goals.size() > 20 outright.
      const next = createGoal(archiveAll(fillToCap(), 5000), 'work', 'daily', 3600, 6000);
      expect(next).toHaveLength(MAX_GOALS);
    });

    it('evicts the stalest tombstone to make that room, never a live goal', () => {
      let goals: Goal[] = [];
      for (let i = 0; i < MAX_GOALS - 1; i += 1) goals = createGoal(goals, null, 'daily', 3600, 1000 + i);
      // One extra goal, archived long enough ago to be the stalest entry but
      // not long enough for pruneArchivedGoals to have dropped it.
      goals = createGoal(goals, 'doomed', 'daily', 3600, 2000);
      goals = archiveGoal(goals, goals[goals.length - 1].id, 2500);
      expect(goals).toHaveLength(MAX_GOALS);

      const next = createGoal(goals, 'work', 'daily', 3600, 6000);
      expect(next).toHaveLength(MAX_GOALS);
      expect(next.map((g) => g.topic)).not.toContain('doomed');
      expect(next.filter((g) => !g.archived)).toHaveLength(MAX_GOALS);
    });

    it('still refuses a new goal once MAX_GOALS of them are live', () => {
      const live = fillToCap();
      expect(() => createGoal(live, 'work', 'daily', 3600, 6000)).toThrow(/at most/);
    });

    it('leaves an under-cap list appended in place, with no eviction or reordering', () => {
      const goals = archiveGoal(
        createGoal(createGoal([], 'a', 'daily', 3600, 1000), 'b', 'daily', 3600, 2000),
        'nope',
        3000,
      );
      const next = createGoal(goals, 'c', 'daily', 3600, 4000);
      expect(next.map((g) => g.topic)).toEqual(['a', 'b', 'c']);
    });
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

describe('createGoal -- flexible-goals extension fields', () => {
  it('creates a plain goal with none of the new fields present at all (not even as undefined keys implied by tests below)', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    expect(goals[0]).not.toHaveProperty('daysOfWeek');
    expect(goals[0]).not.toHaveProperty('targetSessions');
    expect(goals[0]).not.toHaveProperty('notify');
    expect(goals[0]).not.toHaveProperty('notifyAt');
  });

  it('accepts a daily goal restricted to specific weekdays, deduped and sorted', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [5, 1, 3, 1] });
    expect(goals[0].daysOfWeek).toEqual([1, 3, 5]);
  });

  it('collapses an empty daysOfWeek array to undefined ("every day" has one canonical form)', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [] });
    expect(goals[0].daysOfWeek).toBeUndefined();
  });

  it('rejects daysOfWeek on a non-daily goal', () => {
    expect(() => createGoal([], null, 'weekly', 3600, 1000, { daysOfWeek: [1] })).toThrow(
      'daysOfWeek only applies to a daily goal.',
    );
  });

  it('rejects a daysOfWeek entry outside 0-6', () => {
    expect(() => createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [7] })).toThrow();
    expect(() => createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [-1] })).toThrow();
    expect(() => createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [1.5] })).toThrow();
  });

  it('accepts a targetSessions within bounds', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000, { targetSessions: 3 });
    expect(goals[0].targetSessions).toBe(3);
  });

  it('rejects a targetSessions below 1 or above MAX_TARGET_SESSIONS, or non-integer', () => {
    expect(() => createGoal([], null, 'daily', 3600, 1000, { targetSessions: 0 })).toThrow();
    expect(() => createGoal([], null, 'daily', 3600, 1000, { targetSessions: MAX_TARGET_SESSIONS + 1 })).toThrow();
    expect(() => createGoal([], null, 'daily', 3600, 1000, { targetSessions: 1.5 })).toThrow();
  });

  it('accepts targetSessions exactly at MAX_TARGET_SESSIONS', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000, { targetSessions: MAX_TARGET_SESSIONS });
    expect(goals[0].targetSessions).toBe(MAX_TARGET_SESSIONS);
  });

  it('accepts notify/notifyAt together', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000, { notify: true, notifyAt: '09:30' });
    expect(goals[0]).toMatchObject({ notify: true, notifyAt: '09:30' });
  });

  it('rejects a malformed notifyAt', () => {
    expect(() => createGoal([], null, 'daily', 3600, 1000, { notify: true, notifyAt: '9:30' })).toThrow();
    expect(() => createGoal([], null, 'daily', 3600, 1000, { notify: true, notifyAt: '24:00' })).toThrow();
    expect(() => createGoal([], null, 'daily', 3600, 1000, { notify: true, notifyAt: '12:60' })).toThrow();
    expect(() => createGoal([], null, 'daily', 3600, 1000, { notify: true, notifyAt: 'noon' })).toThrow();
  });

  it('accepts notifyAt at both boundary times', () => {
    expect(createGoal([], null, 'daily', 3600, 1000, { notifyAt: '00:00' })[0].notifyAt).toBe('00:00');
    expect(createGoal([], null, 'daily', 3600, 1000, { notifyAt: '23:59' })[0].notifyAt).toBe('23:59');
  });

  it('rejects a non-boolean notify', () => {
    expect(() => createGoal([], null, 'daily', 3600, 1000, { notify: 'yes' as any })).toThrow();
  });
});

describe('updateGoal -- flexible-goals extension fields', () => {
  it('sets daysOfWeek on an existing daily goal', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    const updated = updateGoal(goals, goals[0].id, { daysOfWeek: [3, 1] }, 2000);
    expect(updated[0].daysOfWeek).toEqual([1, 3]);
  });

  it('clears daysOfWeek back to "every day" via null', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [1, 2] });
    const updated = updateGoal(goals, goals[0].id, { daysOfWeek: null }, 2000);
    expect(updated[0].daysOfWeek).toBeUndefined();
  });

  it('leaves daysOfWeek untouched when the patch omits it', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [1, 2] });
    const updated = updateGoal(goals, goals[0].id, { targetS: 7200 }, 2000);
    expect(updated[0].daysOfWeek).toEqual([1, 2]);
  });

  it('re-checks a goal\'s existing daysOfWeek when the patch switches period away from daily', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [1, 2] });
    expect(() => updateGoal(goals, goals[0].id, { period: 'weekly' }, 2000)).toThrow(
      'daysOfWeek only applies to a daily goal.',
    );
    // Clearing it explicitly alongside the period change succeeds.
    const updated = updateGoal(goals, goals[0].id, { period: 'weekly', daysOfWeek: null }, 2000);
    expect(updated[0].period).toBe('weekly');
    expect(updated[0].daysOfWeek).toBeUndefined();
  });

  it('sets and clears targetSessions via null', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    const withTarget = updateGoal(goals, goals[0].id, { targetSessions: 5 }, 2000);
    expect(withTarget[0].targetSessions).toBe(5);
    const cleared = updateGoal(withTarget, goals[0].id, { targetSessions: null }, 3000);
    expect(cleared[0].targetSessions).toBeUndefined();
  });

  it('sets notify and notifyAt, and clears notifyAt via null while leaving notify alone', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    const withNotify = updateGoal(goals, goals[0].id, { notify: true, notifyAt: '08:00' }, 2000);
    expect(withNotify[0]).toMatchObject({ notify: true, notifyAt: '08:00' });
    const clearedTime = updateGoal(withNotify, goals[0].id, { notifyAt: null }, 3000);
    expect(clearedTime[0].notify).toBe(true);
    expect(clearedTime[0].notifyAt).toBeUndefined();
  });

  it('rejects an invalid extension field the same way create does', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    expect(() => updateGoal(goals, goals[0].id, { notifyAt: 'bad' })).toThrow();
    expect(() => updateGoal(goals, goals[0].id, { targetSessions: -1 })).toThrow();
  });
});

// A goal's optional fields must be ABSENT, never present-and-undefined.
// This is not tidiness: sync/firestoreSync.ts hands the goals array straight
// to setDoc, and auth/firebase.ts builds Firestore without
// `ignoreUndefinedProperties`, so one present-but-undefined key makes the
// whole doc write reject with "Unsupported field value: undefined". The
// reject is swallowed by goalsSyncBridge's fire-and-forget push, so the user
// never sees an error on the edit itself -- what they see is every later
// sync failing account-wide, until a restart re-hydrates the JSON-stripped
// copy from storage. createGoal and sanitizeOneGoal both already build this
// shape with conditional spreads; updateGoal is the third writer and has to
// agree with them.
describe('updateGoal writes a Firestore-serialisable shape', () => {
  const OPTIONAL_KEYS = [
    'daysOfWeek',
    'targetSessions',
    'notify',
    'notifyAt',
    'notifyTimes',
    'notifyDays',
    'notifyOnlyIfBehind',
  ] as const;

  it('omits every optional field the goal does not carry, rather than setting it to undefined', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    const updated = updateGoal(goals, goals[0].id, { targetS: 7200 }, 2000);
    for (const key of OPTIONAL_KEYS) expect(updated[0]).not.toHaveProperty(key);
  });

  it('drops the key entirely when a patch clears a field via null', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [1, 2], targetSessions: 4 });
    const cleared = updateGoal(goals, goals[0].id, { daysOfWeek: null, targetSessions: null }, 2000);
    expect(cleared[0]).not.toHaveProperty('daysOfWeek');
    expect(cleared[0]).not.toHaveProperty('targetSessions');
  });

  it('survives a JSON round-trip byte-for-byte, the check a Firestore write effectively applies', () => {
    const goals = createGoal([], 'work', 'weekly', 7200, 1000, { notify: true, notifyTimes: ['09:00'] });
    const updated = updateGoal(goals, goals[0].id, { targetS: 10800 }, 2000);
    // toStrictEqual (unlike toEqual) fails on a key whose value is
    // undefined, which is exactly the distinction JSON.stringify -- and
    // Firestore's serializer -- draws.
    expect(updated[0]).toStrictEqual(JSON.parse(JSON.stringify(updated[0])));
  });

  it('produces the same key set as an equivalent freshly created goal', () => {
    const created = createGoal([], null, 'daily', 3600, 1000)[0];
    const goals = createGoal([], null, 'daily', 1800, 1000);
    const updated = updateGoal(goals, goals[0].id, { targetS: 3600 }, 2000)[0];
    expect(Object.keys(updated).sort()).toEqual(Object.keys(created).sort());
  });

  it('keeps id/createdAt/archived from the goal it edits', () => {
    const goals = archiveGoal(createGoal([], 'work', 'daily', 3600, 1000), 'nope', 1500);
    const updated = updateGoal(goals, goals[0].id, { targetS: 7200 }, 2000);
    expect(updated[0].id).toBe(goals[0].id);
    expect(updated[0].createdAt).toBe(1000);
    expect(updated[0].archived).toBe(false);
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
    expect(sanitizeRemoteGoals([valid({ period: 'yearly' as any })])).toEqual([]);
  });

  it('keeps an entry with the "monthly" period added by the flexible-goals extension', () => {
    expect(sanitizeRemoteGoals([valid({ period: 'monthly' as any, targetS: 3600 })])).toHaveLength(1);
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

  describe('old-shape compatibility (pre-flexible-goals entries)', () => {
    it('accepts an entry with none of the four new fields at all, and never invents them', () => {
      const result = sanitizeRemoteGoals([valid()]);
      expect(result).toEqual([valid()]);
      expect(result[0]).not.toHaveProperty('daysOfWeek');
      expect(result[0]).not.toHaveProperty('targetSessions');
      expect(result[0]).not.toHaveProperty('notify');
      expect(result[0]).not.toHaveProperty('notifyAt');
    });

    it('never throws on an entry with the new fields simply absent (undefined via destructuring, not explicitly set)', () => {
      const bareOldShape = { id: 'goal:old', topic: 'work', period: 'daily', targetS: 1800, createdAt: 1, updatedAt: 1, archived: false };
      expect(() => sanitizeRemoteGoals([bareOldShape])).not.toThrow();
      expect(sanitizeRemoteGoals([bareOldShape])).toEqual([bareOldShape]);
    });
  });

  describe('flexible-goals extension fields -- strict per-field validation, never rejects the whole goal', () => {
    it('keeps a valid daysOfWeek on a daily entry, deduped and sorted', () => {
      const result = sanitizeRemoteGoals([valid({ daysOfWeek: [3, 1, 1, 5] } as any)]);
      expect(result[0].daysOfWeek).toEqual([1, 3, 5]);
    });

    it('drops (only) an invalid daysOfWeek -- out-of-range entries, wrong type, or a daily-only field on a non-daily goal', () => {
      expect(sanitizeRemoteGoals([valid({ daysOfWeek: [7] } as any)])[0].daysOfWeek).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ daysOfWeek: [-1] } as any)])[0].daysOfWeek).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ daysOfWeek: 'mon' as any } as any)])[0].daysOfWeek).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ period: 'weekly', targetS: 3600, daysOfWeek: [1, 2] } as any)])[0].daysOfWeek).toBeUndefined();
    });

    it('collapses an empty remote daysOfWeek to undefined, same as the create/update path', () => {
      expect(sanitizeRemoteGoals([valid({ daysOfWeek: [] } as any)])[0].daysOfWeek).toBeUndefined();
    });

    it('keeps a valid targetSessions', () => {
      expect(sanitizeRemoteGoals([valid({ targetSessions: 4 } as any)])[0].targetSessions).toBe(4);
    });

    it('drops (only) an out-of-range or non-integer targetSessions', () => {
      expect(sanitizeRemoteGoals([valid({ targetSessions: 0 } as any)])[0].targetSessions).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ targetSessions: MAX_TARGET_SESSIONS + 1 } as any)])[0].targetSessions).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ targetSessions: 1.5 } as any)])[0].targetSessions).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ targetSessions: '3' as any } as any)])[0].targetSessions).toBeUndefined();
    });

    it('keeps a valid notify/notifyAt pair', () => {
      const result = sanitizeRemoteGoals([valid({ notify: true, notifyAt: '18:45' } as any)]);
      expect(result[0]).toMatchObject({ notify: true, notifyAt: '18:45' });
    });

    it('coerces a non-boolean notify to undefined (only true/false literals survive)', () => {
      expect(sanitizeRemoteGoals([valid({ notify: 'true' as any } as any)])[0].notify).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ notify: false } as any)])[0].notify).toBe(false);
    });

    it('drops (only) a malformed notifyAt', () => {
      expect(sanitizeRemoteGoals([valid({ notifyAt: '9:30' } as any)])[0].notifyAt).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ notifyAt: '24:00' } as any)])[0].notifyAt).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ notifyAt: 'noon' } as any)])[0].notifyAt).toBeUndefined();
      expect(sanitizeRemoteGoals([valid({ notifyAt: 123 as any } as any)])[0].notifyAt).toBeUndefined();
    });

    it('an invalid extension field never drops the whole goal -- the core fields still come through', () => {
      const result = sanitizeRemoteGoals([valid({ topic: 'work', notifyAt: 'garbage' } as any)]);
      expect(result).toHaveLength(1);
      expect(result[0].topic).toBe('work');
      expect(result[0].notifyAt).toBeUndefined();
    });
  });
});
