// scheduledSessions.test.ts -- the pure scheduled-session model: its
// local-time arithmetic (the part most likely to be quietly wrong), its
// caps, and its no-op-on-unknown-id contracts.
import {
  MAX_PER_DAY,
  MAX_SCHEDULED_SESSIONS,
  MAX_NOTE_LENGTH,
  SCHEDULED_PRUNE_MS,
  ScheduledSession,
  createScheduledSession,
  deleteScheduledSession,
  pruneScheduledSessions,
  reminderFireMs,
  scheduledStartMs,
  sessionsOnDay,
  setScheduledSessionDone,
  updateScheduledSession,
} from './scheduledSessions';

/** A valid distinct 'HH:MM' per index -- MAX_PER_DAY is under 24, so the
 * hour alone is enough to keep a day's fill loop inside the 24h clock. */
const hourSlot = (i: number) => `${String(i).padStart(2, '0')}:00`;

const input = (over: Partial<Parameters<typeof createScheduledSession>[1]> = {}) => ({
  date: '2026-09-01',
  time: '09:00',
  topic: null,
  leadMinutes: 10,
  ...over,
});

describe('scheduledStartMs / reminderFireMs', () => {
  // The bug sessionHistory.ts's dayKeyToDate exists to prevent, restated for
  // this module: `new Date('2026-09-01')` is UTC midnight per spec, which is
  // the PREVIOUS day west of UTC. Asserting against locally-constructed
  // Y/M/D pins the local reading without pinning the runner's timezone.
  it('reads the date/time as local, not UTC', () => {
    expect(scheduledStartMs({ date: '2026-09-01', time: '09:30' })).toBe(
      new Date(2026, 8, 1, 9, 30, 0, 0).getTime(),
    );
  });

  it('is NaN for a malformed date or time, never some fallback moment', () => {
    expect(scheduledStartMs({ date: 'tomorrow', time: '09:00' })).toBeNaN();
    expect(scheduledStartMs({ date: '2026-09-01', time: '9:00' })).toBeNaN();
    expect(scheduledStartMs({ date: '2026-13-01', time: '09:00' })).toBeNaN();
  });

  it('backs the fire time off by leadMinutes', () => {
    const start = scheduledStartMs({ date: '2026-09-01', time: '09:00' });
    expect(reminderFireMs({ date: '2026-09-01', time: '09:00', leadMinutes: 30 })).toBe(start - 30 * 60_000);
    expect(reminderFireMs({ date: '2026-09-01', time: '09:00', leadMinutes: 0 })).toBe(start);
  });

  // A lead that crosses midnight backwards is the case a naive
  // "subtract from the H:M fields" implementation gets wrong.
  it('crosses back over midnight correctly', () => {
    expect(reminderFireMs({ date: '2026-09-01', time: '00:15', leadMinutes: 30 })).toBe(
      new Date(2026, 7, 31, 23, 45, 0, 0).getTime(),
    );
  });
});

describe('createScheduledSession', () => {
  it('rejects malformed fields with a renderable message', () => {
    expect(() => createScheduledSession([], input({ date: 'nope' }))).toThrow(/valid date/i);
    expect(() => createScheduledSession([], input({ time: '25:00' }))).toThrow(/valid start time/i);
    expect(() => createScheduledSession([], input({ leadMinutes: -5 }))).toThrow(/lead time/i);
    expect(() => createScheduledSession([], input({ plannedS: 0 }))).toThrow(/longer than zero/i);
    expect(() => createScheduledSession([], input({ note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }))).toThrow(/characters/i);
  });

  it('omits optional fields rather than storing undefined-ish placeholders', () => {
    const [item] = createScheduledSession([], input());
    expect(item.plannedS).toBeUndefined();
    expect(item.note).toBeUndefined();
    expect(item.done).toBeUndefined();
  });

  it('enforces the per-day cap independently of the total cap', () => {
    let items: ScheduledSession[] = [];
    for (let i = 0; i < MAX_PER_DAY; i++) {
      items = createScheduledSession(items, input({ time: hourSlot(i) }));
    }
    expect(() => createScheduledSession(items, input({ time: '23:00' }))).toThrow(/one day/i);
    // A different day is still fine -- the total cap is far away.
    expect(items.length).toBeLessThan(MAX_SCHEDULED_SESSIONS);
    expect(() => createScheduledSession(items, input({ date: '2026-09-02' }))).not.toThrow();
  });

  // Ordering matters: a user who is both at the cap and has a bad field
  // should hear about the field, matching createGoal's own check order.
  it('validates fields before checking caps', () => {
    const full = Array.from({ length: MAX_SCHEDULED_SESSIONS }, (_, i) => ({
      id: `s${i}`,
      date: '2026-09-01',
      time: '09:00',
      topic: null,
      leadMinutes: 0,
      createdAt: 0,
      updatedAt: 0,
    }));
    expect(() => createScheduledSession(full, input({ time: 'nope' }))).toThrow(/valid start time/i);
  });
});

describe('updateScheduledSession', () => {
  it('returns the same array reference for an unknown id', () => {
    const items = createScheduledSession([], input());
    expect(updateScheduledSession(items, 'missing', input({ time: '10:00' }))).toBe(items);
  });

  it('clears an optional field the form submitted as empty', () => {
    const items = createScheduledSession([], input({ plannedS: 1800, note: 'thesis' }));
    const next = updateScheduledSession(items, items[0].id, input());
    expect(next[0].plannedS).toBeUndefined();
    expect(next[0].note).toBeUndefined();
  });

  // The per-day cap must not fire for an edit that stays on its own day --
  // otherwise the 12th plan on a full day could never have its note fixed.
  it('re-checks the per-day cap only when the plan moves days', () => {
    let items: ScheduledSession[] = [];
    for (let i = 0; i < MAX_PER_DAY; i++) {
      items = createScheduledSession(items, input({ time: hourSlot(i) }));
    }
    const target = items[0];
    expect(() => updateScheduledSession(items, target.id, input({ note: 'edited' }))).not.toThrow();
    // Fill a second day, then try to move into it.
    let full = items;
    for (let i = 0; i < MAX_PER_DAY; i++) {
      full = createScheduledSession(full, input({ date: '2026-09-02', time: hourSlot(i) }));
    }
    expect(() => updateScheduledSession(full, target.id, input({ date: '2026-09-02' }))).toThrow(/one day/i);
  });
});

describe('setScheduledSessionDone / deleteScheduledSession', () => {
  it('keeps the row when a plan is ticked done', () => {
    const items = createScheduledSession([], input());
    const next = setScheduledSessionDone(items, items[0].id, true);
    expect(next).toHaveLength(1);
    expect(next[0].done).toBe(true);
  });

  it('removes outright on delete -- no tombstone, since nothing syncs these', () => {
    const items = createScheduledSession([], input());
    expect(deleteScheduledSession(items, items[0].id)).toEqual([]);
    expect(deleteScheduledSession(items, 'missing')).toBe(items);
  });
});

describe('pruneScheduledSessions', () => {
  const at = (date: string, time: string): ScheduledSession => ({
    id: `${date}:${time}`,
    date,
    time,
    topic: null,
    leadMinutes: 0,
    createdAt: 0,
    updatedAt: 0,
  });

  it('keeps recent and future plans, drops long-past ones', () => {
    const now = new Date(2026, 8, 30, 12, 0, 0, 0).getTime();
    const recent = at('2026-09-29', '09:00');
    const future = at('2026-10-05', '09:00');
    const ancient = at('2026-06-01', '09:00');
    expect(now - scheduledStartMs(ancient)).toBeGreaterThan(SCHEDULED_PRUNE_MS);
    expect(pruneScheduledSessions([recent, future, ancient], now)).toEqual([recent, future]);
  });

  it('drops an entry whose stored date/time no longer parses', () => {
    const now = Date.now();
    const broken = { ...at('2026-09-01', '09:00'), time: 'noon' };
    expect(pruneScheduledSessions([broken], now)).toEqual([]);
  });
});

describe('sessionsOnDay', () => {
  it('filters to the day and orders soonest-first', () => {
    let items = createScheduledSession([], input({ time: '14:00' }));
    items = createScheduledSession(items, input({ time: '08:30' }));
    items = createScheduledSession(items, input({ date: '2026-09-02', time: '07:00' }));
    expect(sessionsOnDay(items, '2026-09-01').map((s) => s.time)).toEqual(['08:30', '14:00']);
  });
});
