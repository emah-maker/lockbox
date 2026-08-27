// Unit tests for goalsSyncPlan.ts's pure merge-and-push decision (used by
// firestoreSync.ts's syncGoalsTwoWay, which itself talks to Firebase and
// isn't unit-tested -- same as the rest of sync/, see sessionMerge.test.ts).
// Run with `npm test`. Goal-model correctness itself (mergeGoals's LWW/
// eviction rules, sanitizeRemoteGoals's per-field validation) is
// goals-core's own coverage in goals/goalMerge.test.ts and goals/
// goals.test.ts -- this file only exercises the sync-protocol decision this
// module adds on top: what to apply locally, and whether a write-back is
// worth making.
import { planGoalsSync } from './goalsSyncPlan';
import { Goal } from '../goals/goals';

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

describe('planGoalsSync', () => {
  it('does not push back when the remote doc already reflects everything local has (nothing changed)', () => {
    const shared = goal('goal:a', 1000);
    const plan = planGoalsSync([shared], 1000, [shared], 1000);

    expect(plan.merged).toEqual([shared]);
    expect(plan.docUpdatedAt).toBe(1000);
    expect(plan.shouldPushBack).toBe(false);
  });

  // Regression test for a real bug: a doc-level clock compare alone is NOT
  // sufficient for goals (unlike syncSettingsTwoWay's identical-looking
  // compare, which IS sufficient for whole-doc-LWW settings/app -- see
  // goalsSyncPlan.ts's goalsDifferFrom comment for the full explanation).
  // Device A creates a goal at t=100 while offline (its local doc clock is
  // 100). Device B independently writes a DIFFERENT goal at t=200, so the
  // remote doc's clock is 200 and does NOT contain device A's goal. A
  // clock-only gate sees "remote (200) is newer than local (100)" and skips
  // the write-back, silently stranding device A's goal off Firestore
  // forever -- lost outright if device A is later lost or reset.
  it('pushes back a local-only goal even though the remote doc clock is ahead of the local one (offline-create-then-sync)', () => {
    const plan = planGoalsSync([goal('goal:a', 100)], 100, [goal('goal:b', 200)], 200);

    expect(plan.merged.map((x) => x.id).sort()).toEqual(['goal:a', 'goal:b']);
    expect(plan.shouldPushBack).toBe(true);
  });

  it('pushes back when local has a goal the remote doc does not, purely via the content check (local doc clock stays BELOW the remote clock, so the clock gate alone would say no push)', () => {
    const existing = goal('goal:a', 1000);
    const fresh = goal('goal:b', 1500);
    const plan = planGoalsSync([existing, fresh], 1500, [existing], 5000);

    expect(plan.merged.map((g) => g.id)).toEqual(['goal:a', 'goal:b']);
    expect(plan.docUpdatedAt).toBe(5000); // clock alone: nothing to push (5000 is not > 5000)
    expect(plan.shouldPushBack).toBe(true); // content check catches goal:b anyway
  });

  it('(a) does not push back when the merge is identical in content to the remote doc, even though the local doc clock is behind', () => {
    const shared = goal('goal:a', 1000);
    // localDocUpdatedAt (500) is behind remoteDocUpdatedAt (2000) -- if this
    // returned true, it would be because of the clock, not because there's
    // any actual content difference to push.
    const plan = planGoalsSync([shared], 500, [shared], 2000);

    expect(plan.merged).toEqual([shared]);
    expect(plan.shouldPushBack).toBe(false);
  });

  it('(b) pushes back a local archive tombstone the remote lacks, even when the clock gate alone would say no', () => {
    const tombstone = goal('goal:a', 50, { archived: true });
    const unrelatedRemote = goal('goal:b', 1000);
    // localDocUpdatedAt/tombstone.updatedAt (50) both sit well below
    // remoteDocUpdatedAt (1000), and mergedGoalsDocUpdatedAt's max() means
    // docUpdatedAt lands at exactly 1000 too -- the clock check
    // (1000 > 1000) is false, isolating the content check as what has to
    // catch this.
    const plan = planGoalsSync([tombstone], 50, [unrelatedRemote], 1000);

    expect(plan.docUpdatedAt).toBe(1000);
    expect(plan.merged.map((g) => g.id).sort()).toEqual(['goal:a', 'goal:b']);
    expect(plan.shouldPushBack).toBe(true);
  });

  it('(c) does not push back when the same id appears on both sides with identical fields', () => {
    const shared = goal('goal:a', 1000);
    const plan = planGoalsSync([shared], 1000, [{ ...shared }], 1000);

    expect(plan.merged).toEqual([shared]);
    expect(plan.shouldPushBack).toBe(false);
  });

  it('does not push back when the merge only pulls a remote-only goal INTO this device (nothing for the remote to gain)', () => {
    const local = goal('goal:a', 1000);
    const remoteOnly = goal('goal:b', 1500);
    // Remote doc's own clock (1500) already accounts for goal:b's updatedAt,
    // so merging it in locally doesn't move the doc-level clock past what's
    // already stored remotely, and the merge's content is identical to the
    // remote's content (nothing local-only survives).
    const plan = planGoalsSync([local], 1000, [local, remoteOnly], 1500);

    expect(plan.merged.map((g) => g.id)).toEqual(['goal:a', 'goal:b']);
    expect(plan.docUpdatedAt).toBe(1500);
    expect(plan.shouldPushBack).toBe(false);
  });

  it('pushes back when a local edit is newer than the remote doc clock, even if remote has other goals', () => {
    const remoteOnly = goal('goal:a', 1000);
    const localEdit = goal('goal:b', 5000);
    const plan = planGoalsSync([localEdit], 5000, [remoteOnly], 1000);

    expect(plan.docUpdatedAt).toBe(5000);
    expect(plan.shouldPushBack).toBe(true);
  });

  it('sanitizes the raw remote input before merging -- a malformed entry never survives into the plan', () => {
    const local = goal('goal:a', 1000);
    const malformed = { id: 'goal:bad', topic: null, period: 'daily', targetS: -5, createdAt: 1, updatedAt: 1, archived: false };
    const plan = planGoalsSync([local], 1000, [malformed], 900);

    expect(plan.merged).toEqual([local]);
    expect(plan.shouldPushBack).toBe(true); // local's clock (1000) is still ahead of remote's (900)
  });

  it('treats a non-array/garbage remote payload the same as an empty remote array', () => {
    const local = goal('goal:a', 1000);
    const plan = planGoalsSync([local], 1000, 'not-an-array', 0);

    expect(plan.merged).toEqual([local]);
    expect(plan.docUpdatedAt).toBe(1000);
    expect(plan.shouldPushBack).toBe(true);
  });

  it('an archived goal newer on the remote side wins the per-goal merge, and that alone does not force a push', () => {
    const localLive = goal('goal:a', 1000);
    const remoteArchived = goal('goal:a', 2000, { archived: true });
    const plan = planGoalsSync([localLive], 1000, [remoteArchived], 2000);

    expect(plan.merged).toEqual([remoteArchived]);
    expect(plan.docUpdatedAt).toBe(2000);
    expect(plan.shouldPushBack).toBe(false);
  });

  it('an empty local store just pulls down whatever the remote doc has, without pushing back', () => {
    const remoteA = goal('goal:a', 1000);
    const remoteB = goal('goal:b', 1500);
    const plan = planGoalsSync([], 0, [remoteA, remoteB], 1500);

    expect(plan.merged.map((g) => g.id)).toEqual(['goal:a', 'goal:b']);
    expect(plan.docUpdatedAt).toBe(1500);
    expect(plan.shouldPushBack).toBe(false);
  });

  describe('flexible-goals extension fields (daysOfWeek/targetSessions/notify/notifyAt)', () => {
    it('pushes back when only a flexible-goals extension field differs, even though the doc-level clock matches', () => {
      // Same trap as the topic/period/targetS content check above, just for
      // one of the newer fields -- a bump to `updatedAt` on its own already
      // covers most cases, but this isolates the *content* comparison
      // itself catching a difference on one of the four new fields.
      const shared = goal('goal:a', 1000, { notify: true, notifyAt: '09:00' });
      const remoteVersion = { ...shared, notifyAt: '18:00' }; // same updatedAt, different notifyAt
      const plan = planGoalsSync([shared], 1000, [remoteVersion], 1000);

      expect(plan.merged).toEqual([shared]); // local wins the updatedAt tie
      expect(plan.shouldPushBack).toBe(true); // but the remote's notifyAt still needs correcting
    });

    it('does not push back when a shared goal is identical including its daysOfWeek', () => {
      const shared = goal('goal:a', 1000, { period: 'daily', daysOfWeek: [1, 3, 5] });
      const plan = planGoalsSync([shared], 1000, [{ ...shared }], 1000);

      expect(plan.shouldPushBack).toBe(false);
    });

    it('pushes back when daysOfWeek differs even though every other field is identical', () => {
      const local = goal('goal:a', 1000, { period: 'daily', daysOfWeek: [1, 3, 5] });
      const remote = { ...local, daysOfWeek: [1, 3] };
      const plan = planGoalsSync([local], 1000, [remote], 1000);

      expect(plan.shouldPushBack).toBe(true);
    });

    it('treats undefined and an empty daysOfWeek as equal for the content diff (both mean "every day")', () => {
      const local = goal('goal:a', 1000, { period: 'daily' }); // daysOfWeek undefined
      const remote = { ...local, daysOfWeek: [] as number[] };
      const plan = planGoalsSync([local], 1000, [remote], 1000);

      expect(plan.shouldPushBack).toBe(false);
    });

    it('pushes back when targetSessions differs', () => {
      const local = goal('goal:a', 1000, { targetSessions: 3 });
      const remote = { ...local, targetSessions: 5 };
      const plan = planGoalsSync([local], 1000, [remote], 1000);

      expect(plan.shouldPushBack).toBe(true);
    });
  });
});
