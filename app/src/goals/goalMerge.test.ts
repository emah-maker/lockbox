// Unit tests for goalMerge.ts's pure per-goal union/LWW merge and its
// doc-level updatedAt helper. Run with `npm test`.
import { mergeGoals, mergedGoalsDocUpdatedAt } from './goalMerge';
import { Goal, MAX_GOALS, sanitizeRemoteGoals } from './goals';

const g = (overrides: Partial<Goal>): Goal => ({
  id: 'goal:a',
  topic: null,
  period: 'daily',
  targetS: 3600,
  createdAt: 1000,
  updatedAt: 1000,
  archived: false,
  ...overrides,
});

describe('mergeGoals', () => {
  it('unions a goal that only exists locally', () => {
    const local = [g({ id: 'goal:a' })];
    expect(mergeGoals(local, [])).toEqual(local);
  });

  it('unions a goal that only exists remotely (e.g. created on the dashboard)', () => {
    const remote = [g({ id: 'goal:a' })];
    expect(mergeGoals([], remote)).toEqual(remote);
  });

  it('for an id on both sides, keeps the copy with the greater updatedAt', () => {
    const local = [g({ id: 'goal:a', updatedAt: 1000, targetS: 3600 })];
    const remote = [g({ id: 'goal:a', updatedAt: 2000, targetS: 7200 })];
    const merged = mergeGoals(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].targetS).toBe(7200);
  });

  it('prefers local on a tie', () => {
    const local = [g({ id: 'goal:a', updatedAt: 1000, targetS: 3600 })];
    const remote = [g({ id: 'goal:a', updatedAt: 1000, targetS: 7200 })];
    const merged = mergeGoals(local, remote);
    expect(merged[0].targetS).toBe(3600);
  });

  it('a clockless remote entry (updatedAt sanitized to 0) never overrides a real, newer local edit of the same id', () => {
    // A hostile/corrupt remote goals array with no updatedAt on this entry
    // -- sanitizeRemoteGoals is the real path this would arrive through.
    const rawRemote = [{ id: 'goal:a', topic: 'work', period: 'daily', targetS: 3600, createdAt: 100, archived: false }];
    const remote = sanitizeRemoteGoals(rawRemote);
    expect(remote[0].updatedAt).toBe(0); // confirms the defect-2 fix this test depends on

    const local = [g({ id: 'goal:a', topic: 'study', updatedAt: 500 })]; // a real, later edit
    const merged = mergeGoals(local, remote);

    expect(merged[0]).toMatchObject({ topic: 'study', updatedAt: 500 }); // local edit survives
  });

  it('resolves an archived-vs-live conflict by updatedAt like any other field -- newer archive wins', () => {
    const local = [g({ id: 'goal:a', updatedAt: 2000, archived: true })];
    const remote = [g({ id: 'goal:a', updatedAt: 1000, archived: false })];
    const merged = mergeGoals(local, remote);
    expect(merged[0].archived).toBe(true);
  });

  it('resolves an archived-vs-live conflict by updatedAt -- newer un-archive (or edit) wins over an older archive', () => {
    const local = [g({ id: 'goal:a', updatedAt: 1000, archived: true })];
    const remote = [g({ id: 'goal:a', updatedAt: 2000, archived: false })];
    const merged = mergeGoals(local, remote);
    expect(merged[0].archived).toBe(false);
  });

  it('sorts the merged result by createdAt then id', () => {
    const local = [g({ id: 'goal:b', createdAt: 2000 }), g({ id: 'goal:a', createdAt: 2000 }), g({ id: 'goal:z', createdAt: 1000 })];
    const merged = mergeGoals(local, []);
    expect(merged.map((x) => x.id)).toEqual(['goal:z', 'goal:a', 'goal:b']);
  });

  describe('MAX_GOALS cap', () => {
    it('caps a union of two disjoint full-cap sides to exactly MAX_GOALS', () => {
      const local = Array.from({ length: MAX_GOALS }, (_, i) => g({ id: `goal:local-${i}`, createdAt: i, updatedAt: i }));
      const remote = Array.from({ length: MAX_GOALS }, (_, i) => g({ id: `goal:remote-${i}`, createdAt: 1000 + i, updatedAt: 1000 + i }));
      const merged = mergeGoals(local, remote);
      expect(merged).toHaveLength(MAX_GOALS);
    });

    it('evicts archived tombstones before any live goal when over cap', () => {
      // MAX_GOALS live goals plus one archived tombstone: the tombstone must
      // be the one dropped, never a live goal, regardless of updatedAt.
      const live = Array.from({ length: MAX_GOALS }, (_, i) =>
        g({ id: `goal:live-${i}`, createdAt: i, updatedAt: 9999, archived: false }),
      );
      const tombstone = g({ id: 'goal:tombstone', createdAt: 500, updatedAt: 10000, archived: true });
      const merged = mergeGoals([...live, tombstone], []);
      expect(merged).toHaveLength(MAX_GOALS);
      expect(merged.some((x) => x.id === 'goal:tombstone')).toBe(false);
      expect(merged.map((x) => x.id).sort()).toEqual(live.map((x) => x.id).sort());
    });

    it('evicts the stalest (lowest updatedAt) entries first among same-archived-status goals over cap', () => {
      const goals = Array.from({ length: MAX_GOALS + 3 }, (_, i) => g({ id: `goal:${i}`, createdAt: i, updatedAt: i }));
      const merged = mergeGoals(goals, []);
      expect(merged).toHaveLength(MAX_GOALS);
      // The 3 lowest-updatedAt (goal:0, goal:1, goal:2) must be the ones evicted.
      expect(merged.map((x) => x.id)).not.toEqual(expect.arrayContaining(['goal:0', 'goal:1', 'goal:2']));
    });

    it('is identical when the two arguments are swapped, except for the documented local-wins tie-break', () => {
      const shared = g({ id: 'goal:shared', updatedAt: 500, topic: 'work' });
      const local = [shared, ...Array.from({ length: MAX_GOALS }, (_, i) => g({ id: `goal:local-${i}`, createdAt: 100 + i, updatedAt: 100 + i }))];
      const remote = [{ ...shared, topic: 'study' }, ...Array.from({ length: MAX_GOALS }, (_, i) => g({ id: `goal:remote-${i}`, createdAt: 200 + i, updatedAt: 200 + i }))];

      const asLocal = mergeGoals(local, remote);
      const swapped = mergeGoals(remote, local);

      // Same ids kept, same order, in both directions...
      expect(swapped.map((x) => x.id)).toEqual(asLocal.map((x) => x.id));
      // ...except the shared tied-updatedAt goal resolves to whichever side
      // was passed as `local` in that call.
      expect(asLocal.find((x) => x.id === 'goal:shared')?.topic).toBe('work');
      expect(swapped.find((x) => x.id === 'goal:shared')?.topic).toBe('study');
    });
  });
});

describe('mergedGoalsDocUpdatedAt', () => {
  it('is the max of every merged goal\'s updatedAt and both doc-level clocks', () => {
    const merged = [g({ updatedAt: 500 }), g({ id: 'goal:b', updatedAt: 1500 })];
    expect(mergedGoalsDocUpdatedAt(merged, 1000, 100)).toBe(1500);
    expect(mergedGoalsDocUpdatedAt(merged, 9000, 100)).toBe(9000);
  });

  it('falls back to the doc-level clocks when there are no goals at all', () => {
    expect(mergedGoalsDocUpdatedAt([], 1000, 2000)).toBe(2000);
  });
});
