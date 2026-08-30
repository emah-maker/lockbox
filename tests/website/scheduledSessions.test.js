// Unit tests for website/js/scheduledSessions.js -- the plain-ES-module twin
// of app/src/schedule/scheduledSessions.ts. Cases are ported from that
// module's own scheduledSessions.test.ts, because the whole point of this
// file is that the two surfaces write the same documents: both clients mint
// ids into one Firestore collection, both compute the `fireAtMs` the backend
// queries on, and both validate against bounds the rules enforce server-side.
// A drift here doesn't corrupt anything -- it makes one surface refuse, or
// mis-time, a plan the other considers perfectly ordinary.
//
// Testable at all only since the Firestore read/write path moved to
// scheduledSessionsSync.js: a `https://www.gstatic.com/...` import at the top
// of this module made it unimportable under `node --test`, which is why this
// half of the feature had no coverage while the app's had twenty cases.
// Run with `npm test` from the repo root.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATE_RE,
  LEAD_MINUTE_OPTIONS,
  MAX_LEAD_MINUTES,
  MAX_NOTE_LENGTH,
  MAX_PER_DAY,
  MAX_SCHEDULED_SESSIONS,
  fromRemote,
  leadLabel,
  makeScheduledSessionId,
  reminderFireMs,
  scheduledStartMs,
  sessionsOnDay,
  toRemote,
  validatePlan,
} from '../../website/js/scheduledSessions.js';

const plan = (over = {}) => ({
  id: 'sched_1',
  date: '2026-09-01',
  time: '10:00',
  topic: null,
  leadMinutes: 10,
  updatedAt: 1,
  ...over,
});

const input = (over = {}) => ({ date: '2026-09-01', time: '10:00', topic: null, leadMinutes: 10, ...over });

describe('scheduledStartMs / reminderFireMs', () => {
  // A bare date string is parsed as UTC by the spec, which is a whole day off
  // west of UTC -- the same trap focusStats.js's dayKeyToDate documents.
  it('reads the date/time as local, not UTC', () => {
    assert.equal(scheduledStartMs({ date: '2026-09-01', time: '09:30' }), new Date(2026, 8, 1, 9, 30, 0, 0).getTime());
  });

  it('is NaN for a malformed date or time, never some fallback moment', () => {
    assert.ok(Number.isNaN(scheduledStartMs({ date: 'nope', time: '09:30' })));
    assert.ok(Number.isNaN(scheduledStartMs({ date: '2026-09-01', time: 'noon' })));
    assert.ok(Number.isNaN(scheduledStartMs({ date: '2026-13-01', time: '09:30' })));
  });

  it('backs the fire time off by leadMinutes', () => {
    const start = scheduledStartMs({ date: '2026-09-01', time: '09:30' });
    assert.equal(reminderFireMs({ date: '2026-09-01', time: '09:30', leadMinutes: 30 }), start - 30 * 60000);
    assert.equal(reminderFireMs({ date: '2026-09-01', time: '09:30', leadMinutes: 0 }), start);
  });

  // The reminder for an early-morning session belongs to the previous day,
  // and the arithmetic has to cross that boundary rather than clamp to it.
  it('crosses back over midnight correctly', () => {
    const fire = reminderFireMs({ date: '2026-09-01', time: '00:15', leadMinutes: 30 });
    assert.equal(fire, new Date(2026, 7, 31, 23, 45, 0, 0).getTime());
  });
});

describe('validatePlan', () => {
  it('rejects malformed fields with a message meant to be rendered as-is', () => {
    assert.throws(() => validatePlan(input({ date: 'nope' }), [], null), /valid date/);
    assert.throws(() => validatePlan(input({ time: 'noon' }), [], null), /valid start time/);
    assert.throws(() => validatePlan(input({ note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }), [], null), /characters or fewer/);
    assert.throws(() => validatePlan(input({ plannedS: 0 }), [], null), /zero and 24 hours/);
    assert.throws(() => validatePlan(input({ plannedS: 86401 }), [], null), /zero and 24 hours/);
  });

  // The picker offers a handful of leads; the VALIDATOR has to accept the
  // whole range the app and the rules accept. It used to test membership of
  // LEAD_MINUTE_OPTIONS, so a plan carrying any other lead -- perfectly legal
  // in the app, and stored happily by the rules -- could not be edited here
  // at all: changing its note was refused with a complaint about its reminder
  // time.
  it('accepts any lead in range, not only the ones the picker offers', () => {
    for (const minutes of LEAD_MINUTE_OPTIONS) {
      assert.doesNotThrow(() => validatePlan(input({ leadMinutes: minutes }), [], null));
    }
    assert.doesNotThrow(() => validatePlan(input({ leadMinutes: 45 }), [], null));
    assert.doesNotThrow(() => validatePlan(input({ leadMinutes: MAX_LEAD_MINUTES }), [], null));
  });

  it('still rejects a lead outside the range the rules allow', () => {
    assert.throws(() => validatePlan(input({ leadMinutes: -1 }), [], null), /out of range/);
    assert.throws(() => validatePlan(input({ leadMinutes: MAX_LEAD_MINUTES + 1 }), [], null), /out of range/);
    assert.throws(() => validatePlan(input({ leadMinutes: 10.5 }), [], null), /out of range/);
  });

  it('enforces the per-day cap independently of the total cap', () => {
    const full = Array.from({ length: MAX_PER_DAY }, (_, i) => plan({ id: `sched_${i}`, time: `${String(i).padStart(2, '0')}:00` }));
    assert.throws(() => validatePlan(input(), full, null), new RegExp(`${MAX_PER_DAY} sessions on one day`));
    // Same count, spread over other days: fine.
    assert.doesNotThrow(() => validatePlan(input({ date: '2026-09-02' }), full, null));
  });

  it('enforces the total cap', () => {
    const many = Array.from({ length: MAX_SCHEDULED_SESSIONS }, (_, i) => plan({ id: `sched_${i}`, date: '2026-10-01' }));
    assert.throws(() => validatePlan(input(), many, null), new RegExp(`at most ${MAX_SCHEDULED_SESSIONS}`));
  });

  // Editing a plan on a full day must not be rejected for occupying the slot
  // it already occupies -- the cap is re-checked only when the plan lands on
  // a day it is not already counted in.
  it('re-checks the per-day cap only when the plan moves days', () => {
    const dayFull = (date) =>
      Array.from({ length: MAX_PER_DAY }, (_, i) => plan({ id: `${date}_${i}`, date, time: `${String(i).padStart(2, '0')}:00` }));
    const twoFullDays = [...dayFull('2026-09-01'), ...dayFull('2026-09-03')];

    // Same day, editing its note: allowed, even though that day is full.
    assert.doesNotThrow(() => validatePlan(input({ note: 'edited' }), twoFullDays, '2026-09-01_0'));
    // Moving it onto a day that is ALSO full: refused.
    assert.throws(
      () => validatePlan(input({ date: '2026-09-03' }), twoFullDays, '2026-09-01_0'),
      new RegExp(`${MAX_PER_DAY} sessions on one day`),
    );
    // Moving it onto a day with room: allowed.
    assert.doesNotThrow(() => validatePlan(input({ date: '2026-09-04' }), twoFullDays, '2026-09-01_0'));
  });
});

describe('toRemote / fromRemote', () => {
  it('writes an explicit null notifiedAt, which is what the due-query filters on', () => {
    // Firestore cannot query for an absent field, so a plan saved without
    // this is one the backend can never find.
    assert.equal(toRemote(plan()).notifiedAt, null);
  });

  it('omits optional fields rather than writing undefined, which Firestore rejects', () => {
    const out = toRemote(plan());
    assert.ok(!('plannedS' in out));
    assert.ok(!('note' in out));
    assert.deepEqual(Object.keys(toRemote(plan({ plannedS: 900, note: 'hi' }))).sort(), [
      'date', 'done', 'fireAtMs', 'leadMinutes', 'note', 'notifiedAt', 'plannedS', 'time', 'timeLabel', 'topic', 'tz', 'updatedAt',
    ]);
  });

  it('computes the fire time the backend queries on', () => {
    assert.equal(toRemote(plan({ time: '09:30', leadMinutes: 30 })).fireAtMs, new Date(2026, 8, 1, 9, 0, 0, 0).getTime());
  });

  it('drops a document it cannot trust rather than admitting a broken plan', () => {
    assert.equal(fromRemote('id', null), null);
    assert.equal(fromRemote('id', { time: '10:00', leadMinutes: 10 }), null); // no date
    assert.equal(fromRemote('id', { date: '2026-09-01', leadMinutes: 10 }), null); // no time
    assert.equal(fromRemote('id', { date: '2026-09-01', time: '10:00' }), null); // no lead
  });

  it('round-trips a plan through the wire shape', () => {
    const back = fromRemote('sched_1', toRemote(plan({ plannedS: 900, note: 'hi', topic: 'work' })));
    assert.deepEqual(back, {
      id: 'sched_1',
      date: '2026-09-01',
      time: '10:00',
      topic: 'work',
      leadMinutes: 10,
      plannedS: 900,
      note: 'hi',
      done: false,
      notifiedAt: null,
      updatedAt: back.updatedAt,
    });
  });
});

describe('the rest of the model', () => {
  it('mints ids in the same namespace the app does', () => {
    // Both surfaces write into one collection, so the shapes must not collide
    // or be distinguishable by origin.
    assert.match(makeScheduledSessionId(), /^sched_[0-9a-z]+$/);
    assert.notEqual(makeScheduledSessionId(), makeScheduledSessionId());
  });

  it('filters to the day and orders soonest-first', () => {
    const plans = [
      plan({ id: 'b', time: '14:00' }),
      plan({ id: 'a', time: '09:00' }),
      plan({ id: 'other', date: '2026-09-02', time: '01:00' }),
    ];
    assert.deepEqual(sessionsOnDay(plans, '2026-09-01').map((p) => p.id), ['a', 'b']);
  });

  it('names the lead the way the app does', () => {
    assert.equal(leadLabel(0), 'At start');
    assert.equal(leadLabel(60), '1 hour before');
    assert.equal(leadLabel(10), '10 min before');
  });

  it('accepts only real calendar dates', () => {
    assert.ok(DATE_RE.test('2026-09-01'));
    assert.ok(!DATE_RE.test('2026-13-01'));
    assert.ok(!DATE_RE.test('2026-09-32'));
    assert.ok(!DATE_RE.test('26-09-01'));
  });
});
