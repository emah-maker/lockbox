// Unit tests for website/js/goals.js -- the plain-ES-module twin of
// app/src/goals/{goals,goalSanitize,goalMerge,goalProgress}.ts. Cases are
// ported from that trio's own test suites (goals.test.ts, goalMerge.test.ts,
// goalProgress.test.ts) since this file exists specifically to keep the two
// surfaces from drifting (see commit d4ec592, which already fixed one such
// drift). Run with `npm test` from the repo root (node --test).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// For the text-form suite at the bottom of this file -- goalsPanel.js cannot
// be imported under `node --test` (it reaches the Firebase SDK through
// goals.js), so it is asserted on as source text instead.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  makeGoalId,
  createGoal,
  updateGoal,
  archiveGoal,
  pruneArchivedGoals,
  sanitizeRemoteGoals,
  mergeGoals,
  mergedGoalsDocUpdatedAt,
  MAX_GOALS,
  MAX_GOAL_ID_LENGTH,
  MAX_TOPIC_LENGTH,
  MIN_TARGET_S,
  MAX_DAILY_TARGET_S,
  MAX_WEEKLY_TARGET_S,
  MAX_MONTHLY_TARGET_S,
  MAX_TARGET_SESSIONS,
  ARCHIVED_GOAL_PRUNE_MS,
} from '../../website/js/goals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The window/progress math is its own module now, mirroring the app's
// goals.ts / goalProgress.ts split. Same functions, same cases below.
import { goalWindow, isGoalDueOn, computeGoalProgress, goalDisplayPercent } from '../../website/js/goalProgress.js';

describe('makeGoalId', () => {
  it('generates a "goal:"-prefixed id well within MAX_GOAL_ID_LENGTH', () => {
    const id = makeGoalId();
    assert.ok(id.startsWith('goal:'));
    assert.ok(id.length <= MAX_GOAL_ID_LENGTH);
  });

  it('generates unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => makeGoalId()));
    assert.equal(ids.size, 20);
  });
});

describe('createGoal', () => {
  it('creates a daily goal with topic null (all focus time), stamping createdAt/updatedAt', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    assert.equal(goals.length, 1);
    assert.deepEqual(
      { topic: goals[0].topic, period: goals[0].period, targetS: goals[0].targetS, createdAt: goals[0].createdAt, updatedAt: goals[0].updatedAt, archived: goals[0].archived },
      { topic: null, period: 'daily', targetS: 3600, createdAt: 1000, updatedAt: 1000, archived: false },
    );
  });

  it('creates a goal targeting a custom label id', () => {
    const goals = createGoal([], 'custom:abc123', 'daily', 3600, 1000);
    assert.equal(goals[0].topic, 'custom:abc123');
  });

  it('appends without disturbing existing goals', () => {
    const first = createGoal([], 'work', 'daily', 3600, 1000);
    const both = createGoal(first, 'study', 'daily', 3600, 1000);
    assert.deepEqual(both.map((g) => g.topic), ['work', 'study']);
  });

  it('rejects an empty-string topic (use null for "all topics" instead)', () => {
    assert.throws(() => createGoal([], '', 'daily', 3600));
  });

  it('accepts a topic exactly at MAX_TOPIC_LENGTH, rejects one over it', () => {
    const atLimit = 'x'.repeat(MAX_TOPIC_LENGTH);
    assert.equal(createGoal([], atLimit, 'daily', 3600)[0].topic.length, MAX_TOPIC_LENGTH);
    assert.throws(() => createGoal([], 'x'.repeat(MAX_TOPIC_LENGTH + 1), 'daily', 3600));
  });

  it('rejects an invalid period, accepts "monthly" (flexible-goals extension)', () => {
    assert.throws(() => createGoal([], null, 'yearly', 3600));
    assert.equal(createGoal([], null, 'monthly', 3600)[0].period, 'monthly');
  });

  it('rejects a non-integer targetS', () => {
    assert.throws(() => createGoal([], null, 'daily', 60.5));
  });

  it('enforces MIN_TARGET_S at the boundary', () => {
    assert.throws(() => createGoal([], null, 'daily', MIN_TARGET_S - 1));
    assert.equal(createGoal([], null, 'daily', MIN_TARGET_S)[0].targetS, MIN_TARGET_S);
  });

  it('enforces independent per-period max bounds (daily cap does not leak into weekly)', () => {
    const midway = MAX_DAILY_TARGET_S + 1;
    assert.throws(() => createGoal([], null, 'daily', midway));
    assert.equal(createGoal([], null, 'weekly', midway)[0].targetS, midway);
    assert.throws(() => createGoal([], null, 'weekly', MAX_WEEKLY_TARGET_S + 1));
    assert.equal(createGoal([], null, 'monthly', MAX_MONTHLY_TARGET_S)[0].targetS, MAX_MONTHLY_TARGET_S);
    assert.throws(() => createGoal([], null, 'monthly', MAX_MONTHLY_TARGET_S + 1));
  });

  it('rejects creating a goal past MAX_GOALS', () => {
    let goals = [];
    for (let i = 0; i < MAX_GOALS; i += 1) goals = createGoal(goals, null, 'daily', 3600, 1000 + i);
    assert.equal(goals.length, MAX_GOALS);
    assert.throws(() => createGoal(goals, null, 'daily', 3600));
  });

  // The cap counts LIVE goals. Archived entries are tombstones
  // pruneArchivedGoals keeps for 30 days so an archive can propagate through
  // mergeGoals' LWW union -- counting them meant a user whose visible list
  // was empty stayed locked out for a month. Ported from the app twin's own
  // cases in app/src/goals/goals.test.ts, which had the identical bug.
  it('still accepts a new goal when every existing one is archived', () => {
    let goals = [];
    for (let i = 0; i < MAX_GOALS; i += 1) goals = createGoal(goals, null, 'daily', 3600, 1000 + i);
    goals = goals.map((g) => ({ ...g, archived: true }));

    const after = createGoal(goals, null, 'daily', 3600, 9000);

    assert.equal(after.filter((g) => !g.archived).length, 1);
    // And the array itself stays within the cap: firestore.rules refuses
    // goals.size() > 20, so an over-long array would fail the sync on every retry.
    assert.equal(after.length, MAX_GOALS);
  });

  it('evicts the stalest tombstone, never a live goal', () => {
    let goals = [];
    for (let i = 0; i < MAX_GOALS; i += 1) goals = createGoal(goals, null, 'daily', 3600, 1000 + i);
    // Archive all but the newest, so exactly one live goal remains.
    goals = goals.map((g, i) => (i === MAX_GOALS - 1 ? g : { ...g, archived: true }));
    const stalestId = goals[0].id;
    const liveId = goals[MAX_GOALS - 1].id;

    const after = createGoal(goals, null, 'daily', 3600, 9000);

    assert.ok(!after.some((g) => g.id === stalestId), 'stalest tombstone should be gone');
    assert.ok(after.some((g) => g.id === liveId), 'the live goal must survive');
    assert.equal(after.length, MAX_GOALS);
  });

  it('leaves an under-cap list untouched and unreordered', () => {
    let goals = [];
    for (let i = 0; i < 3; i += 1) goals = createGoal(goals, null, 'daily', 3600, 1000 + i);
    const before = goals.map((g) => g.id);

    const after = createGoal(goals, null, 'daily', 3600, 9000);

    assert.deepEqual(after.slice(0, 3).map((g) => g.id), before);
    assert.equal(after.length, 4);
  });

  describe('flexible-goals extension fields', () => {
    it('omits daysOfWeek/targetSessions/notify/notifyAt entirely when not supplied', () => {
      const goals = createGoal([], null, 'daily', 3600, 1000);
      assert.ok(!('daysOfWeek' in goals[0]));
      assert.ok(!('targetSessions' in goals[0]));
      assert.ok(!('notify' in goals[0]));
      assert.ok(!('notifyAt' in goals[0]));
    });

    it('dedupes and sorts daysOfWeek, collapsing an empty array to undefined', () => {
      assert.deepEqual(createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [5, 1, 3, 1] })[0].daysOfWeek, [1, 3, 5]);
      assert.equal(createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [] })[0].daysOfWeek, undefined);
    });

    it('rejects daysOfWeek on a non-daily goal, or an entry outside 0-6', () => {
      assert.throws(() => createGoal([], null, 'weekly', 3600, 1000, { daysOfWeek: [1] }), /daysOfWeek only applies to a daily goal/);
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [7] }));
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [-1] }));
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [1.5] }));
    });

    it('bounds targetSessions to [1, MAX_TARGET_SESSIONS], integer only', () => {
      assert.equal(createGoal([], null, 'daily', 3600, 1000, { targetSessions: MAX_TARGET_SESSIONS })[0].targetSessions, MAX_TARGET_SESSIONS);
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { targetSessions: 0 }));
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { targetSessions: MAX_TARGET_SESSIONS + 1 }));
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { targetSessions: 1.5 }));
    });

    it('accepts a well-formed notifyAt at both boundary times, rejects malformed ones', () => {
      assert.equal(createGoal([], null, 'daily', 3600, 1000, { notifyAt: '00:00' })[0].notifyAt, '00:00');
      assert.equal(createGoal([], null, 'daily', 3600, 1000, { notifyAt: '23:59' })[0].notifyAt, '23:59');
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { notifyAt: '9:30' }));
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { notifyAt: '24:00' }));
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { notifyAt: '12:60' }));
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { notifyAt: 'noon' }));
    });

    it('rejects a non-boolean notify', () => {
      assert.throws(() => createGoal([], null, 'daily', 3600, 1000, { notify: 'yes' }));
    });
  });
});

describe('updateGoal', () => {
  it('updates only the matching goal by id, re-stamping updatedAt', () => {
    const goals = createGoal(createGoal([], 'work', 'daily', 3600, 1000), 'study', 'daily', 3600, 1000);
    const updated = updateGoal(goals, goals[0].id, { targetS: 7200 }, 2000);
    assert.equal(updated[0].targetS, 7200);
    assert.equal(updated[0].updatedAt, 2000);
    assert.deepEqual(updated[1], goals[1]); // untouched
  });

  it('re-validates the merged result, not just the patched field in isolation', () => {
    const goals = createGoal([], null, 'daily', 3600, 1000);
    const weekly = updateGoal(goals, goals[0].id, { period: 'weekly', targetS: MAX_WEEKLY_TARGET_S }, 2000);
    assert.equal(weekly[0].targetS, MAX_WEEKLY_TARGET_S);
    // Switching back to daily without lowering targetS must fail the daily bound.
    assert.throws(() => updateGoal(weekly, weekly[0].id, { period: 'daily' }, 3000));
  });

  it('is a no-op for an id that does not exist', () => {
    const goals = createGoal([], 'work', 'daily', 3600, 1000);
    assert.deepEqual(updateGoal(goals, 'goal:does-not-exist', { targetS: 7200 }, 2000), goals);
  });

  describe('flexible-goals extension fields', () => {
    it('sets, then clears via null, daysOfWeek/targetSessions', () => {
      const goals = createGoal([], null, 'daily', 3600, 1000);
      const withDays = updateGoal(goals, goals[0].id, { daysOfWeek: [3, 1] }, 2000);
      assert.deepEqual(withDays[0].daysOfWeek, [1, 3]);
      assert.equal(updateGoal(withDays, goals[0].id, { daysOfWeek: null }, 3000)[0].daysOfWeek, undefined);

      const withTarget = updateGoal(goals, goals[0].id, { targetSessions: 5 }, 2000);
      assert.equal(withTarget[0].targetSessions, 5);
      assert.equal(updateGoal(withTarget, goals[0].id, { targetSessions: null }, 3000)[0].targetSessions, undefined);
    });

    it('leaves an extension field untouched when the patch omits it', () => {
      const goals = createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [1, 2] });
      const updated = updateGoal(goals, goals[0].id, { targetS: 7200 }, 2000);
      assert.deepEqual(updated[0].daysOfWeek, [1, 2]);
    });

    it('re-checks a goal\'s existing daysOfWeek when the patch switches period away from daily', () => {
      const goals = createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [1, 2] });
      assert.throws(() => updateGoal(goals, goals[0].id, { period: 'weekly' }, 2000), /daysOfWeek only applies to a daily goal/);
      const updated = updateGoal(goals, goals[0].id, { period: 'weekly', daysOfWeek: null }, 2000);
      assert.equal(updated[0].period, 'weekly');
      assert.equal(updated[0].daysOfWeek, undefined);
    });

    it('rejects an invalid extension field the same way create does', () => {
      const goals = createGoal([], null, 'daily', 3600, 1000);
      assert.throws(() => updateGoal(goals, goals[0].id, { notifyAt: 'bad' }));
      assert.throws(() => updateGoal(goals, goals[0].id, { targetSessions: -1 }));
    });

    // The whole-array setDoc in dashboard.js's writeGoals runs against a
    // getFirestore(app) instance with ignoreUndefinedProperties OFF, so an
    // `undefined`-VALUED key -- as opposed to an absent one -- makes the
    // write throw "Unsupported field value: undefined" in the browser before
    // it ever reaches the network. Every goal without the flexible-goals
    // extension fields (i.e. every weekly/monthly goal, and every daily one
    // with the reminder toggle off) went through this path, so Edit -> Save
    // failed and the edit was discarded. createGoal and sanitizeRemoteGoals
    // already build their objects with `...(x !== undefined ? { x } : {})`
    // conditional spreads for exactly this reason; updateGoal assigned all
    // four unconditionally. Asserted as "no key anywhere holds undefined"
    // rather than naming the four fields, so a fifth extension field added
    // later can't reintroduce this silently.
    const undefinedValuedKeys = (goal) => Object.keys(goal).filter((k) => goal[k] === undefined);

    it('omits an unset extension field rather than writing undefined, which Firestore rejects', () => {
      // A plain weekly goal -- none of the four extension fields set.
      const weekly = createGoal([], 'work', 'weekly', 3600, 1000);
      assert.deepEqual(undefinedValuedKeys(updateGoal(weekly, weekly[0].id, { targetS: 7200 }, 2000)[0]), []);

      // A plain daily goal with the reminder toggle off -- the same shape
      // goalsPanel.js's edit form submits (every extension field mapped to
      // an explicit null "clear").
      const daily = createGoal([], null, 'daily', 3600, 1000);
      const saved = updateGoal(
        daily,
        daily[0].id,
        { topic: null, period: 'daily', targetS: 3600, daysOfWeek: null, targetSessions: null, notify: false, notifyAt: null },
        2000,
      );
      assert.deepEqual(undefinedValuedKeys(saved[0]), []);
    });

    // The other half of the same fix: conditional spreads alone would be
    // WRONG here, because updateGoal builds on `...current` rather than from
    // scratch the way createGoal does -- skipping the key when the new value
    // is undefined would silently leave the goal's OLD value in place, so
    // clearing a field would no longer clear it. The key has to be deleted.
    it('deletes -- not merely skips -- an extension field the patch clears', () => {
      const goals = createGoal([], null, 'daily', 3600, 1000, { daysOfWeek: [1, 2], targetSessions: 3, notifyAt: '09:00' });
      const cleared = updateGoal(goals, goals[0].id, { daysOfWeek: null, targetSessions: null, notifyAt: null }, 2000)[0];
      assert.ok(!('daysOfWeek' in cleared), 'daysOfWeek should be removed, not left at its old value');
      assert.ok(!('targetSessions' in cleared), 'targetSessions should be removed, not left at its old value');
      assert.ok(!('notifyAt' in cleared), 'notifyAt should be removed, not left at its old value');
      assert.deepEqual(undefinedValuedKeys(cleared), []);
    });

    // The phone owns the multi-time reminder schedule (Goal.notifyTimes) and
    // treats notifyAt as a derived mirror of notifyTimes[0]; goalReminders.ts's
    // goalNotifyTimes ignores notifyAt outright whenever the list is non-empty.
    // This form only edits ONE time, so these four cases fix the rule for it:
    // moving the time collapses the schedule to that time (most recent edit
    // wins), and anything that does NOT move the time leaves the phone's
    // schedule alone.
    const multiTime = () => [{
      id: 'goal:a', topic: null, period: 'daily', targetS: 3600,
      createdAt: 1000, updatedAt: 1000, archived: false,
      notifyTimes: ['08:00', '12:00'], notifyAt: '08:00',
    }];

    it('collapses a multi-time schedule to the single new time when the time actually moves', () => {
      const updated = updateGoal(multiTime(), 'goal:a', { notifyAt: '09:00' }, 2000);
      assert.equal(updated[0].notifyAt, '09:00');
      assert.deepEqual(updated[0].notifyTimes, ['09:00']);
    });

    // The regression that motivated the rule: goalsPanel.js resubmits notifyAt
    // on EVERY save, so an edit to an unrelated field must not be read as an
    // edit to the reminder -- otherwise renaming a goal silently destroys a
    // schedule set on the phone.
    it('leaves the phone schedule untouched when an unrelated field is edited', () => {
      const updated = updateGoal(multiTime(), 'goal:a', { targetS: 7200, notifyAt: '08:00' }, 2000);
      assert.equal(updated[0].targetS, 7200);
      assert.equal(updated[0].notifyAt, '08:00');
      assert.deepEqual(updated[0].notifyTimes, ['08:00', '12:00']);
    });

    it('leaves the phone schedule untouched when the patch omits notifyAt entirely', () => {
      const updated = updateGoal(multiTime(), 'goal:a', { targetS: 7200 }, 2000);
      assert.deepEqual(updated[0].notifyTimes, ['08:00', '12:00']);
    });

    it('clears the whole schedule when the reminder is switched off', () => {
      const updated = updateGoal(multiTime(), 'goal:a', { notify: false, notifyAt: null }, 2000);
      assert.equal(updated[0].notifyAt, undefined);
      assert.ok(!('notifyTimes' in updated[0]), 'notifyTimes should be removed, not set to undefined');
    });

    it('never leaves notifyAt disagreeing with notifyTimes[0]', () => {
      for (const patch of [{ notifyAt: '09:00' }, { notifyAt: '08:00' }, { targetS: 7200 }, { notifyAt: null }]) {
        const g = updateGoal(multiTime(), 'goal:a', patch, 2000)[0];
        if (g.notifyTimes) assert.equal(g.notifyAt, g.notifyTimes[0], `patch ${JSON.stringify(patch)}`);
      }
    });
  });
});

describe('archiveGoal', () => {
  it('tombstones the matching goal (archived: true) instead of removing it', () => {
    const goals = createGoal([], 'work', 'daily', 3600, 1000);
    const archived = archiveGoal(goals, goals[0].id, 2000);
    assert.equal(archived.length, 1);
    assert.equal(archived[0].archived, true);
    assert.equal(archived[0].updatedAt, 2000);
  });

  it('is a no-op for an id that does not exist', () => {
    const goals = createGoal([], 'work', 'daily', 3600, 1000);
    assert.deepEqual(archiveGoal(goals, 'goal:does-not-exist', 2000), goals);
  });
});

describe('pruneArchivedGoals', () => {
  const base = { id: 'goal:a', topic: null, period: 'daily', targetS: 3600, createdAt: 0 };

  it('keeps a live goal regardless of age', () => {
    const goals = [{ ...base, updatedAt: 0, archived: false }];
    assert.deepEqual(pruneArchivedGoals(goals, ARCHIVED_GOAL_PRUNE_MS * 10), goals);
  });

  it('keeps an archived goal younger than the prune horizon, drops one clearly older', () => {
    const goals = [{ ...base, updatedAt: 1000, archived: true }];
    assert.deepEqual(pruneArchivedGoals(goals, 1000 + ARCHIVED_GOAL_PRUNE_MS - 1), goals);
    assert.deepEqual(pruneArchivedGoals(goals, 1000 + ARCHIVED_GOAL_PRUNE_MS + 1), []);
  });

  // Boundary is INCLUSIVE, matching app/src/goals/goals.ts's
  // `nowMs - g.updatedAt <= ARCHIVED_GOAL_PRUNE_MS`. This module used a strict
  // `<` and dropped a tombstone exactly at the horizon one tick earlier than
  // the phone did; the two are aligned now, and this pins that.
  it('keeps an archived goal exactly AT the prune horizon, same as the app', () => {
    const goals = [{ ...base, updatedAt: 1000, archived: true }];
    assert.deepEqual(pruneArchivedGoals(goals, 1000 + ARCHIVED_GOAL_PRUNE_MS), goals);
  });
});

describe('sanitizeRemoteGoals', () => {
  const valid = (overrides = {}) => ({
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
    assert.deepEqual(sanitizeRemoteGoals(null), []);
    assert.deepEqual(sanitizeRemoteGoals(undefined), []);
    assert.deepEqual(sanitizeRemoteGoals('not an array'), []);
    assert.deepEqual(sanitizeRemoteGoals({ goals: [] }), []);
  });

  it('passes through a well-formed entry unchanged', () => {
    assert.deepEqual(sanitizeRemoteGoals([valid()]), [valid()]);
  });

  it('drops a non-object entry', () => {
    assert.deepEqual(sanitizeRemoteGoals([null, 42, 'x', valid()]), [valid()]);
  });

  it('drops an entry with a missing/non-string id, or one exceeding MAX_GOAL_ID_LENGTH', () => {
    assert.deepEqual(sanitizeRemoteGoals([valid({ id: undefined })]), []);
    assert.deepEqual(sanitizeRemoteGoals([valid({ id: 123 })]), []);
    assert.deepEqual(sanitizeRemoteGoals([valid({ id: 'goal:' + 'x'.repeat(MAX_GOAL_ID_LENGTH) })]), []);
  });

  it('drops an entry with a wrong-typed or over-length topic, accepts null/valid string', () => {
    assert.deepEqual(sanitizeRemoteGoals([valid({ topic: 42 })]), []);
    assert.deepEqual(sanitizeRemoteGoals([valid({ topic: 'x'.repeat(MAX_TOPIC_LENGTH + 1) })]), []);
    assert.equal(sanitizeRemoteGoals([valid({ topic: null })])[0].topic, null);
    assert.equal(sanitizeRemoteGoals([valid({ topic: 'custom:xyz' })])[0].topic, 'custom:xyz');
  });

  it('drops an entry with an invalid period, keeps "monthly"', () => {
    assert.deepEqual(sanitizeRemoteGoals([valid({ period: 'yearly' })]), []);
    assert.equal(sanitizeRemoteGoals([valid({ period: 'monthly' })]).length, 1);
  });

  it('drops an entry whose targetS is not an integer', () => {
    assert.deepEqual(sanitizeRemoteGoals([valid({ targetS: 60.5 })]), []);
    assert.deepEqual(sanitizeRemoteGoals([valid({ targetS: '3600' })]), []);
    assert.deepEqual(sanitizeRemoteGoals([valid({ targetS: NaN })]), []);
  });

  it('drops an entry whose targetS is out of bounds for its OWN period (per-period bound, not shared)', () => {
    assert.deepEqual(sanitizeRemoteGoals([valid({ targetS: MIN_TARGET_S - 1 })]), []);
    assert.deepEqual(sanitizeRemoteGoals([valid({ period: 'daily', targetS: MAX_DAILY_TARGET_S + 1 })]), []);
    assert.equal(sanitizeRemoteGoals([valid({ period: 'weekly', targetS: MAX_DAILY_TARGET_S + 1 })]).length, 1);
  });

  it('defaults a missing/malformed createdAt to nowMs (sort-order only, safe to invent)', () => {
    const nowMs = 5000;
    assert.deepEqual(sanitizeRemoteGoals([valid({ createdAt: undefined })], nowMs), [valid({ createdAt: nowMs })]);
  });

  it('defaults a missing/malformed updatedAt to 0, NOT nowMs -- a clockless entry must fail closed and lose every LWW compare', () => {
    const nowMs = 5000;
    assert.deepEqual(sanitizeRemoteGoals([valid({ updatedAt: undefined })], nowMs), [valid({ updatedAt: 0 })]);
    assert.deepEqual(sanitizeRemoteGoals([valid({ updatedAt: 'bad' })], nowMs), [valid({ updatedAt: 0 })]);
    assert.deepEqual(sanitizeRemoteGoals([valid({ updatedAt: NaN })], nowMs), [valid({ updatedAt: 0 })]);
  });

  it('coerces a non-boolean archived to false', () => {
    assert.equal(sanitizeRemoteGoals([valid({ archived: 'true' })])[0].archived, false);
    assert.equal(sanitizeRemoteGoals([valid({ archived: 1 })])[0].archived, false);
    assert.equal(sanitizeRemoteGoals([valid({ archived: undefined })])[0].archived, false);
  });

  it('resolves duplicate ids by keeping the greater updatedAt, at the first occurrence\'s array position', () => {
    const older = valid({ id: 'goal:dup', updatedAt: 100, topic: 'work' });
    const newer = valid({ id: 'goal:dup', updatedAt: 200, topic: 'study' });
    const other = valid({ id: 'goal:other' });
    const result = sanitizeRemoteGoals([older, other, newer]);
    assert.deepEqual(result.map((g) => g.id), ['goal:dup', 'goal:other']); // position from first occurrence
    assert.equal(result[0].updatedAt, 200);
    assert.equal(result[0].topic, 'study'); // value from the newer duplicate
  });

  it('caps the result to MAX_GOALS, keeping input order', () => {
    const many = Array.from({ length: MAX_GOALS + 5 }, (_, i) => valid({ id: `goal:${i}` }));
    const result = sanitizeRemoteGoals(many);
    assert.equal(result.length, MAX_GOALS);
    assert.deepEqual(result.map((g) => g.id), many.slice(0, MAX_GOALS).map((g) => g.id));
  });

  it('never throws on hostile input (mixed garbage, wrong shapes)', () => {
    const hostile = [
      undefined, null, 42, 'garbage', [],
      valid({ id: 'goal:ok' }),
      { id: 'goal:bad-period', period: 'yearly', targetS: 3600 },
      { id: {}, period: 'daily', targetS: 3600 },
    ];
    assert.doesNotThrow(() => sanitizeRemoteGoals(hostile));
    assert.deepEqual(sanitizeRemoteGoals(hostile).map((g) => g.id), ['goal:ok']);
  });

  describe('old-shape compatibility (pre-flexible-goals entries)', () => {
    it('accepts an entry with none of the extension fields, and never invents them', () => {
      const result = sanitizeRemoteGoals([valid()]);
      assert.deepEqual(result, [valid()]);
      assert.ok(!('daysOfWeek' in result[0]));
      assert.ok(!('targetSessions' in result[0]));
      assert.ok(!('notify' in result[0]));
      assert.ok(!('notifyAt' in result[0]));
    });
  });

  describe('flexible-goals extension fields -- strict per-field validation, never rejects the whole goal', () => {
    it('keeps a valid daysOfWeek on a daily entry, deduped and sorted', () => {
      assert.deepEqual(sanitizeRemoteGoals([valid({ daysOfWeek: [3, 1, 1, 5] })])[0].daysOfWeek, [1, 3, 5]);
    });

    it('drops (only) an invalid daysOfWeek: out-of-range, wrong type, empty, or daily-only on a non-daily goal', () => {
      assert.equal(sanitizeRemoteGoals([valid({ daysOfWeek: [7] })])[0].daysOfWeek, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ daysOfWeek: [-1] })])[0].daysOfWeek, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ daysOfWeek: 'mon' })])[0].daysOfWeek, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ daysOfWeek: [] })])[0].daysOfWeek, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ period: 'weekly', targetS: 3600, daysOfWeek: [1, 2] })])[0].daysOfWeek, undefined);
    });

    it('keeps a valid targetSessions, drops an out-of-range or non-integer one', () => {
      assert.equal(sanitizeRemoteGoals([valid({ targetSessions: 4 })])[0].targetSessions, 4);
      assert.equal(sanitizeRemoteGoals([valid({ targetSessions: 0 })])[0].targetSessions, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ targetSessions: MAX_TARGET_SESSIONS + 1 })])[0].targetSessions, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ targetSessions: 1.5 })])[0].targetSessions, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ targetSessions: '3' })])[0].targetSessions, undefined);
    });

    it('keeps a valid notify/notifyAt pair; coerces a non-boolean notify to undefined', () => {
      const result = sanitizeRemoteGoals([valid({ notify: true, notifyAt: '18:45' })]);
      assert.equal(result[0].notify, true);
      assert.equal(result[0].notifyAt, '18:45');
      assert.equal(sanitizeRemoteGoals([valid({ notify: 'true' })])[0].notify, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ notify: false })])[0].notify, false);
    });

    it('drops (only) a malformed notifyAt', () => {
      assert.equal(sanitizeRemoteGoals([valid({ notifyAt: '9:30' })])[0].notifyAt, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ notifyAt: '24:00' })])[0].notifyAt, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ notifyAt: 'noon' })])[0].notifyAt, undefined);
      assert.equal(sanitizeRemoteGoals([valid({ notifyAt: 123 })])[0].notifyAt, undefined);
    });

    it('an invalid extension field never drops the whole goal -- the core fields still come through', () => {
      const result = sanitizeRemoteGoals([valid({ topic: 'work', notifyAt: 'garbage' })]);
      assert.equal(result.length, 1);
      assert.equal(result[0].topic, 'work');
      assert.equal(result[0].notifyAt, undefined);
    });

    // The multi-time reminder schedule (app/src/goals/goalReminders.ts):
    // the website's own goal form doesn't edit these, but sanitizeRemoteGoals
    // must still carry them through untouched -- this is the exact class of
    // bug commit d4ec592 fixed (a stripped field silently collapsing a
    // phone-set schedule on the next website-triggered sync).
    it('carries notifyTimes through, deduped/sorted/capped to MAX_NOTIFY_TIMES, and re-derives the legacy notifyAt mirror from it', () => {
      const result = sanitizeRemoteGoals([valid({ notifyTimes: ['12:00', '08:00', '08:00'], notifyAt: '20:00' })]);
      assert.deepEqual(result[0].notifyTimes, ['08:00', '12:00']);
      assert.equal(result[0].notifyAt, '08:00'); // derived from the list, not the stale legacy field
    });

    it('drops invalid entries from notifyTimes without rejecting the valid ones or the goal', () => {
      const result = sanitizeRemoteGoals([valid({ notifyTimes: ['08:00', 'bad', 123, '24:00'] })]);
      assert.deepEqual(result[0].notifyTimes, ['08:00']);
    });

    it('falls back to the legacy notifyAt when no notifyTimes list survives', () => {
      const result = sanitizeRemoteGoals([valid({ notifyAt: '07:15' })]);
      assert.equal(result[0].notifyAt, '07:15');
    });

    it('carries notifyDays through, deduped/sorted, and drops invalid entries', () => {
      assert.deepEqual(sanitizeRemoteGoals([valid({ notifyDays: [3, 1, 1] })])[0].notifyDays, [1, 3]);
      assert.equal(sanitizeRemoteGoals([valid({ notifyDays: [7, -1] })])[0].notifyDays, undefined);
    });

    it('carries notifyOnlyIfBehind through as a strict boolean', () => {
      assert.equal(sanitizeRemoteGoals([valid({ notifyOnlyIfBehind: true })])[0].notifyOnlyIfBehind, true);
      assert.equal(sanitizeRemoteGoals([valid({ notifyOnlyIfBehind: 'true' })])[0].notifyOnlyIfBehind, undefined);
    });
  });
});

describe('mergeGoals', () => {
  const g = (overrides = {}) => ({
    id: 'goal:a', topic: null, period: 'daily', targetS: 3600,
    createdAt: 1000, updatedAt: 1000, archived: false, ...overrides,
  });

  it('unions a goal that only exists on one side', () => {
    assert.deepEqual(mergeGoals([g({ id: 'goal:a' })], []), [g({ id: 'goal:a' })]);
    assert.deepEqual(mergeGoals([], [g({ id: 'goal:a' })]), [g({ id: 'goal:a' })]);
  });

  it('for an id on both sides, keeps the copy with the greater updatedAt', () => {
    const local = [g({ updatedAt: 1000, targetS: 3600 })];
    const remote = [g({ updatedAt: 2000, targetS: 7200 })];
    assert.equal(mergeGoals(local, remote)[0].targetS, 7200);
  });

  it('prefers local on an updatedAt tie', () => {
    const local = [g({ updatedAt: 1000, targetS: 3600 })];
    const remote = [g({ updatedAt: 1000, targetS: 7200 })];
    assert.equal(mergeGoals(local, remote)[0].targetS, 3600);
  });

  it('a clockless remote entry (updatedAt sanitized to 0) never overrides a real, newer local edit', () => {
    const remote = sanitizeRemoteGoals([{ id: 'goal:a', topic: 'work', period: 'daily', targetS: 3600, createdAt: 100, archived: false }]);
    assert.equal(remote[0].updatedAt, 0);
    const local = [g({ topic: 'study', updatedAt: 500 })];
    const merged = mergeGoals(local, remote);
    assert.equal(merged[0].topic, 'study');
    assert.equal(merged[0].updatedAt, 500);
  });

  it('resolves an archived-vs-live conflict by updatedAt like any other field, in either direction', () => {
    assert.equal(mergeGoals([g({ updatedAt: 2000, archived: true })], [g({ updatedAt: 1000, archived: false })])[0].archived, true);
    assert.equal(mergeGoals([g({ updatedAt: 1000, archived: true })], [g({ updatedAt: 2000, archived: false })])[0].archived, false);
  });

  it('sorts the merged result by createdAt then id', () => {
    const local = [g({ id: 'goal:b', createdAt: 2000 }), g({ id: 'goal:a', createdAt: 2000 }), g({ id: 'goal:z', createdAt: 1000 })];
    assert.deepEqual(mergeGoals(local, []).map((x) => x.id), ['goal:z', 'goal:a', 'goal:b']);
  });

  describe('MAX_GOALS cap', () => {
    it('caps a union of two disjoint full-cap sides to exactly MAX_GOALS', () => {
      const local = Array.from({ length: MAX_GOALS }, (_, i) => g({ id: `goal:local-${i}`, createdAt: i, updatedAt: i }));
      const remote = Array.from({ length: MAX_GOALS }, (_, i) => g({ id: `goal:remote-${i}`, createdAt: 1000 + i, updatedAt: 1000 + i }));
      assert.equal(mergeGoals(local, remote).length, MAX_GOALS);
    });

    it('evicts archived tombstones before any live goal when over cap', () => {
      const live = Array.from({ length: MAX_GOALS }, (_, i) => g({ id: `goal:live-${i}`, createdAt: i, updatedAt: 9999, archived: false }));
      const tombstone = g({ id: 'goal:tombstone', createdAt: 500, updatedAt: 10000, archived: true });
      const merged = mergeGoals([...live, tombstone], []);
      assert.equal(merged.length, MAX_GOALS);
      assert.ok(!merged.some((x) => x.id === 'goal:tombstone'));
    });

    it('evicts the stalest (lowest updatedAt) entries first among same-archived-status goals over cap', () => {
      const goals = Array.from({ length: MAX_GOALS + 3 }, (_, i) => g({ id: `goal:${i}`, createdAt: i, updatedAt: i }));
      const merged = mergeGoals(goals, []);
      assert.equal(merged.length, MAX_GOALS);
      const ids = merged.map((x) => x.id);
      assert.ok(!ids.includes('goal:0') && !ids.includes('goal:1') && !ids.includes('goal:2'));
    });

    it('mergeGoals(A, B) and mergeGoals(B, A) keep the same set of ids, differing only on a genuine tie', () => {
      const shared = g({ id: 'goal:shared', updatedAt: 500, topic: 'work' });
      const local = [shared, ...Array.from({ length: MAX_GOALS }, (_, i) => g({ id: `goal:local-${i}`, createdAt: 100 + i, updatedAt: 100 + i }))];
      const remote = [{ ...shared, topic: 'study' }, ...Array.from({ length: MAX_GOALS }, (_, i) => g({ id: `goal:remote-${i}`, createdAt: 200 + i, updatedAt: 200 + i }))];

      const asLocal = mergeGoals(local, remote);
      const swapped = mergeGoals(remote, local);
      assert.deepEqual(swapped.map((x) => x.id), asLocal.map((x) => x.id));
      assert.equal(asLocal.find((x) => x.id === 'goal:shared').topic, 'work');
      assert.equal(swapped.find((x) => x.id === 'goal:shared').topic, 'study');
    });
  });
});

describe('mergedGoalsDocUpdatedAt', () => {
  const g = (overrides = {}) => ({
    id: 'goal:a', topic: null, period: 'daily', targetS: 3600,
    createdAt: 1000, updatedAt: 1000, archived: false, ...overrides,
  });

  it('is the max of every merged goal\'s updatedAt and both doc-level clocks', () => {
    const merged = [g({ updatedAt: 500 }), g({ id: 'goal:b', updatedAt: 1500 })];
    assert.equal(mergedGoalsDocUpdatedAt(merged, 1000, 100), 1500);
    assert.equal(mergedGoalsDocUpdatedAt(merged, 9000, 100), 9000);
  });

  it('falls back to the doc-level clocks when there are no goals at all', () => {
    assert.equal(mergedGoalsDocUpdatedAt([], 1000, 2000), 2000);
  });
});

// NOW is Wed 2024-01-10 12:00:00 local time; that week's Sunday-start window
// runs 2024-01-07 (Sun) 00:00 through 2024-01-14 (Sun) 00:00.
const NOW = new Date(2024, 0, 10, 12, 0, 0).getTime();
const DAY_START = new Date(2024, 0, 10, 0, 0, 0).getTime();
const DAY_END = new Date(2024, 0, 11, 0, 0, 0).getTime();
const WEEK_START = new Date(2024, 0, 7, 0, 0, 0).getTime();
const WEEK_END = new Date(2024, 0, 14, 0, 0, 0).getTime();
const MONTH_START = new Date(2024, 0, 1, 0, 0, 0).getTime();
const MONTH_END = new Date(2024, 1, 1, 0, 0, 0).getTime();

const goal = (overrides = {}) => ({
  id: 'goal:a', topic: null, period: 'daily', targetS: 3600,
  createdAt: 0, updatedAt: 0, archived: false, ...overrides,
});
const session = (startedAt, actualS, topic) => ({ startedAt, plannedS: actualS, actualS, outcome: 'completed', topic });

describe('goalWindow', () => {
  it('computes the daily window as local midnight to next local midnight', () => {
    assert.deepEqual(goalWindow('daily', NOW), { startMs: DAY_START, endMs: DAY_END });
  });

  it('computes the weekly window as Sunday-start', () => {
    assert.deepEqual(goalWindow('weekly', NOW), { startMs: WEEK_START, endMs: WEEK_END });
  });

  it('computes the monthly window as the 1st through the 1st of next month', () => {
    assert.deepEqual(goalWindow('monthly', NOW), { startMs: MONTH_START, endMs: MONTH_END });
  });

  it('rolls the monthly window into January of the next year for a December nowMs', () => {
    const decemberNow = new Date(2024, 11, 15).getTime();
    assert.deepEqual(goalWindow('monthly', decemberNow), {
      startMs: new Date(2024, 11, 1).getTime(),
      endMs: new Date(2025, 0, 1).getTime(),
    });
  });
});

describe('computeGoalProgress -- window boundaries (half-open [start, end))', () => {
  it('daily: counts at start, excludes at end, excludes start-1ms, counts end-1ms', () => {
    const g = goal({ targetS: 3600 });
    assert.equal(computeGoalProgress([g], [session(DAY_START, 100)], NOW)[0].focusS, 100);
    assert.equal(computeGoalProgress([g], [session(DAY_END, 100)], NOW)[0].focusS, 0);
    assert.equal(computeGoalProgress([g], [session(DAY_START - 1, 100)], NOW)[0].focusS, 0);
    assert.equal(computeGoalProgress([g], [session(DAY_END - 1, 100)], NOW)[0].focusS, 100);
  });

  it('weekly: counts at Sunday-start, excludes at next-Sunday end', () => {
    const g = goal({ period: 'weekly', targetS: 36000 });
    assert.equal(computeGoalProgress([g], [session(WEEK_START, 100)], NOW)[0].focusS, 100);
    assert.equal(computeGoalProgress([g], [session(WEEK_END, 100)], NOW)[0].focusS, 0);
    assert.equal(computeGoalProgress([g], [session(WEEK_START - 1, 100)], NOW)[0].focusS, 0);
    assert.equal(computeGoalProgress([g], [session(WEEK_END - 1, 100)], NOW)[0].focusS, 100);
  });

  it('monthly: counts at the 1st, excludes at the 1st of next month', () => {
    const g = goal({ period: 'monthly', targetS: 100000 });
    assert.equal(computeGoalProgress([g], [session(MONTH_START, 100)], NOW)[0].focusS, 100);
    assert.equal(computeGoalProgress([g], [session(MONTH_END, 100)], NOW)[0].focusS, 0);
    assert.equal(computeGoalProgress([g], [session(MONTH_START - 1, 100)], NOW)[0].focusS, 0);
    assert.equal(computeGoalProgress([g], [session(MONTH_END - 1, 100)], NOW)[0].focusS, 100);
  });
});

describe('computeGoalProgress -- topic matching', () => {
  it('topic: null counts every in-window session including untagged', () => {
    const sessions = [session(NOW, 100, 'work'), session(NOW, 200, 'custom:abc'), session(NOW, 300, undefined)];
    assert.equal(computeGoalProgress([goal({ topic: null, targetS: 3600 })], sessions, NOW)[0].focusS, 600);
  });

  it('a built-in-topic goal only counts sessions with that exact topic string', () => {
    const sessions = [session(NOW, 100, 'work'), session(NOW, 200, 'study')];
    assert.equal(computeGoalProgress([goal({ topic: 'work', targetS: 3600 })], sessions, NOW)[0].focusS, 100);
  });

  it('a custom:-topic goal still matches sessions tagged with a since-deleted custom label id (raw string compare)', () => {
    const sessions = [session(NOW, 100, 'custom:deleted-label')];
    assert.equal(computeGoalProgress([goal({ topic: 'custom:deleted-label', targetS: 3600 })], sessions, NOW)[0].focusS, 100);
  });

  it('an untagged session never counts toward a topic-specific goal', () => {
    assert.equal(computeGoalProgress([goal({ topic: 'work', targetS: 3600 })], [session(NOW, 100, undefined)], NOW)[0].focusS, 0);
  });
});

describe('computeGoalProgress -- output shape and archived exclusion', () => {
  it('reports remainingS/ratio/met for a partially-met goal, and met/remainingS=0 exactly at target', () => {
    const partial = computeGoalProgress([goal({ targetS: 1000 })], [session(NOW, 400)], NOW)[0];
    assert.equal(partial.remainingS, 600);
    assert.equal(partial.ratio, 0.4);
    assert.equal(partial.met, false);

    const atTarget = computeGoalProgress([goal({ targetS: 1000 })], [session(NOW, 1000)], NOW)[0];
    assert.equal(atTarget.remainingS, 0);
    assert.equal(atTarget.ratio, 1);
    assert.equal(atTarget.met, true);
  });

  it('leaves ratio unclamped above 1 when exceeded, while remainingS floors at 0', () => {
    const p = computeGoalProgress([goal({ targetS: 1000 })], [session(NOW, 1800)], NOW)[0];
    assert.equal(p.ratio, 1.8);
    assert.equal(p.remainingS, 0);
    assert.equal(p.met, true);
  });

  it('excludes archived goals from the result entirely', () => {
    const goals = [goal({ id: 'goal:live' }), goal({ id: 'goal:gone', archived: true })];
    assert.deepEqual(computeGoalProgress(goals, [session(NOW, 100)], NOW).map((p) => p.goalId), ['goal:live']);
  });

  it('computes independent progress per goal in input order', () => {
    const goals = [goal({ id: 'goal:a', topic: 'work', targetS: 1000 }), goal({ id: 'goal:b', topic: 'study', targetS: 2000 })];
    const sessions = [session(NOW, 100, 'work'), session(NOW, 200, 'study')];
    const result = computeGoalProgress(goals, sessions, NOW);
    assert.deepEqual(result.map((p) => p.goalId), ['goal:a', 'goal:b']);
    assert.equal(result[0].focusS, 100);
    assert.equal(result[1].focusS, 200);
  });
});

// NOW is a Wednesday (2024-01-10, Date#getDay() === 3).
describe('isGoalDueOn / dueToday -- day-restricted daily goals', () => {
  it('is always true for a daily goal with no restriction, or for weekly/monthly regardless of a stray daysOfWeek', () => {
    assert.equal(isGoalDueOn(goal({ period: 'daily' }), NOW), true);
    assert.equal(isGoalDueOn(goal({ period: 'daily', daysOfWeek: [] }), NOW), true);
    assert.equal(isGoalDueOn(goal({ period: 'weekly' }), NOW), true);
    assert.equal(isGoalDueOn({ ...goal({ period: 'weekly' }), daysOfWeek: [0] }, NOW), true);
  });

  it('is true only on a selected weekday for a day-restricted daily goal', () => {
    assert.equal(isGoalDueOn(goal({ period: 'daily', daysOfWeek: [1, 3, 5] }), NOW), true); // Wednesday
    assert.equal(isGoalDueOn(goal({ period: 'daily', daysOfWeek: [2, 4] }), NOW), false); // not selected
  });

  it('still counts a session logged on an off day toward focusS -- dueToday only flags the day', () => {
    const offDayGoal = goal({ period: 'daily', daysOfWeek: [2, 4], targetS: 1000 });
    const p = computeGoalProgress([offDayGoal], [session(NOW, 500)], NOW)[0];
    assert.equal(p.dueToday, false);
    assert.equal(p.focusS, 500);
  });
});

describe('computeGoalProgress -- session-count target and combined `met`', () => {
  it('always reports sessionCount, undefined targetSessions/sessionsMet for a time-only goal', () => {
    const p = computeGoalProgress([goal({})], [session(NOW, 100), session(NOW, 200)], NOW)[0];
    assert.equal(p.sessionCount, 2);
    assert.equal(p.targetSessions, undefined);
    assert.equal(p.sessionsMet, undefined);
  });

  it('met requires BOTH the time and session-count targets when the goal has one', () => {
    const withTarget = goal({ targetSessions: 2, targetS: 100 });
    const under = computeGoalProgress([withTarget], [session(NOW, 1000)], NOW)[0]; // time met, 1 of 2 sessions
    assert.equal(under.sessionsMet, false);
    assert.equal(under.met, false);

    const atTarget = computeGoalProgress([withTarget], [session(NOW, 1000), session(NOW, 1000)], NOW)[0];
    assert.equal(atTarget.sessionsMet, true);
    assert.equal(atTarget.met, true);
  });

  it('a time-only goal keeps the pre-extension met semantics exactly: met iff focusS >= targetS', () => {
    const p = computeGoalProgress([goal({ targetS: 1000 })], [session(NOW, 1000)], NOW)[0];
    assert.equal(p.met, true);
    assert.equal(p.sessionsMet, undefined);
  });
});

// ---------------------------------------------------------------------------
// Ported from app/src/goals/goalProgress.test.ts's suite of the same name.
// goalsPanel.js's row used to print its own `Math.round(ratio * 100)` off the
// deliberately-unclamped `ratio`, so a 1h daily goal with 1h48m logged read
// "180%" -- in the visible readout AND in the track's aria-label -- beside a
// bar barGeometry had already saturated at full. Every app surface
// (GoalRow.tsx, GoalsProgressView.tsx, useHomeGoalRing.ts) routes through
// goalDisplayPercent precisely so the label cannot disagree with the bar.
// ---------------------------------------------------------------------------
describe('goalDisplayPercent', () => {
  it('caps an over-target ratio at 100, matching an already-full bar', () => {
    assert.equal(goalDisplayPercent(6480 / 3600), 100); // 1h48m of a 1h goal -- read "180%"
    assert.equal(goalDisplayPercent(26100 / 1500), 100); // the app's own 7h15m-of-25m case
  });

  it('reports 100 exactly at target', () => {
    assert.equal(goalDisplayPercent(1), 100);
  });

  it('reports 0 for zero progress', () => {
    assert.equal(goalDisplayPercent(0), 0);
  });

  it('clamps a negative ratio to 0 rather than printing a negative percent', () => {
    assert.equal(goalDisplayPercent(-0.5), 0);
  });

  it('guards a non-finite ratio, showing 0 rather than NaN%/Infinity%', () => {
    assert.equal(goalDisplayPercent(NaN), 0);
    assert.equal(goalDisplayPercent(Infinity), 0);
    assert.equal(goalDisplayPercent(-Infinity), 0);
  });

  it('leaves every under-target reading byte-identical to the old Math.round', () => {
    assert.equal(goalDisplayPercent(15 / 25), 60);
    assert.equal(goalDisplayPercent(0.615), 62); // still plain rounding, not floor
  });
});

// The clamp only helps if the row actually calls it. goalsPanel.js is read as
// TEXT -- it reaches the Firebase SDK through goals.js, which the default ESM
// loader refuses to import from `https://www.gstatic.com/...`.
describe('goalsPanel row percent', () => {
  const panel = readFileSync(
    path.join(__dirname, '..', '..', 'website', 'js', 'goalsPanel.js'),
    'utf8',
  );

  it('derives the row percent from goalDisplayPercent, not its own Math.round', () => {
    assert.ok(panel.includes('goalDisplayPercent(ratio)'), 'row should clamp via goalDisplayPercent');
    assert.ok(!panel.includes('Math.round(ratio * 100)'), 'the unclamped derivation should be gone');
  });

  // One `percent` feeds both the visible readout and the track's aria-label,
  // so a screen-reader user and a sighted user cannot be told different
  // numbers. Asserted so a future edit does not re-split them.
  it('uses that one clamped value for both the visible readout and the aria-label', () => {
    assert.ok(panel.includes('${percent} percent'), 'aria-label should use the shared percent');
    assert.ok(panel.includes('${percent}%'), 'visible readout should use the shared percent');
  });
});
