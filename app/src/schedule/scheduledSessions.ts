// scheduledSessions.ts -- the pure model behind "schedule a focus session"
// on the calendar: a planned session at a specific local day + time, with an
// optional duration and label, that fires a one-off local notification some
// minutes beforehand.
//
// Same leaf-module discipline goals/goals.ts describes for itself: no RN
// import, no store read, no expo-notifications, and every time-dependent
// input is a parameter (`nowMs`) rather than a Date.now() of its own. The
// store (store/useScheduleStore.ts) owns persistence, schedule/
// sessionReminderPlan.ts owns which of these become notifications, and
// schedule/sessionReminders.ts owns the native side -- exactly the
// goals.ts / goalNotificationPlan.ts / goalNotifications.ts split, which is
// what let that feature stay unit-testable with no native module registered.
//
// Deliberately NOT a Goal and deliberately not a LoggedSession:
//   - A Goal is a recurring TARGET measured against sessions that already
//     happened; this is a single intention about a session that hasn't.
//   - A LoggedSession (stats/sessionHistory.ts) is written by the box after
//     the fact and is the source of truth for every stat in the app. A
//     planned session must never be mistaken for one, or scheduling a
//     session tomorrow would silently inflate today's focus time and every
//     goal computed from it. Nothing here is ever appended to that log.
//
// Local-only, and there are no archived tombstones: unlike goals (which
// two-way merge with Firestore, so a deletion has to be representable as a
// tombstone the other device can observe), these never leave the device --
// see this feature's note in useScheduleStore.ts. A delete is therefore a
// plain removal, and the only pruning is of plans whose time has long
// passed.

/** 'YYYY-MM-DD' local, matching stats/sessionHistory.ts's dayKey shape, and
 * 'HH:MM' local 24h, matching Goal.notifyAt's. Both are validated below. */
export interface ScheduledSession {
  id: string;
  /** Local calendar day, 'YYYY-MM-DD' -- the same key CalendarScreen's grid
   * and groupByDay are already keyed by, so a day cell can look its plans up
   * without any date math of its own. */
  date: string;
  /** Local start time, 'HH:MM' 24h. */
  time: string;
  /** Intended lock duration in seconds, or undefined for "however long I
   * end up locking it". Purely descriptive -- nothing here ever drives the
   * box's own timer, which is set at the box (see DurationSheet.tsx's own
   * comment on why locking can't be initiated from the app). */
  plannedS?: number;
  /** Label id (customLabels.ts) this session is planned for, or null for
   * untagged -- the same `string | null` convention Goal.topic uses. */
  topic: string | null;
  /** Minutes before `time` at which to remind. 0 means "at the start time".
   * One number rather than a list: a plan for a specific moment wants a
   * heads-up, not a nagging schedule -- that's what a goal reminder is for. */
  leadMinutes: number;
  /** Free-text note, e.g. "thesis chapter 3". Optional and length-capped. */
  note?: string;
  /** Set when the user ticks the plan off. A done plan keeps its row (so the
   * day still reads as "I planned this and did it") but stops scheduling. */
  done?: boolean;
  createdAt: number;
  updatedAt: number;
}

const ID_PREFIX = 'sched_';

// Caps. MAX_SCHEDULED_SESSIONS bounds what this store can ever hold; the
// smaller MAX_PER_DAY is what actually keeps a single day's list readable.
// Neither is the cap that matters most for notifications -- iOS allows only
// 64 PENDING local notifications per app, shared with goal reminders, so
// sessionReminderPlan.ts applies its own separate, smaller cap to what it
// hands the OS. These two only bound the data.
export const MAX_SCHEDULED_SESSIONS = 200;
export const MAX_PER_DAY = 12;
export const MAX_NOTE_LENGTH = 120;
/** Longest heads-up offered, in minutes. Anything longer stops being a
 * reminder about a specific session and starts being a separate plan. */
export const MAX_LEAD_MINUTES = 24 * 60;
/** The lead times the UI offers. Exported so SessionReminderForm.tsx's chips
 * and this module's validation can't drift apart -- the same "derive the
 * picker's range from the model's own constants" rule GoalForm.tsx's header
 * describes for its target wheels. */
export const LEAD_MINUTE_OPTIONS = [0, 5, 10, 15, 30, 60];

/** Plans whose start is older than this are dropped on the next local write
 * -- long enough that a day you're looking back at still shows what you had
 * planned for it, short enough that the array can't grow without bound. */
export const SCHEDULED_PRUNE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// Identical shape to goals.ts's NOTIFY_AT_RE, re-derived rather than
// imported for the same reason that file's own comment gives for
// goalNotifications.ts re-deriving it: these are leaf modules that stay out
// of each other's import graphs on purpose.
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function makeScheduledSessionId(): string {
  return `${ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The absolute local epoch-ms this plan starts at. Built from the local
 * Y/M/D + H:M rather than `new Date('2026-08-28T09:00')` for exactly the
 * reason sessionHistory.ts's dayKeyToDate exists: a bare date string is
 * parsed as UTC by the spec, which is off by a full day west of UTC.
 *
 * Returns NaN for a malformed date/time, which every caller treats as "not
 * schedulable" rather than as some fallback moment.
 */
export function scheduledStartMs(item: Pick<ScheduledSession, 'date' | 'time'>): number {
  if (!DATE_RE.test(item.date) || !TIME_RE.test(item.time)) return NaN;
  const [y, m, d] = item.date.split('-').map(Number);
  const [hh, mm] = item.time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/** When the reminder for this plan should fire: `leadMinutes` before its
 * start. NaN propagates from scheduledStartMs for a malformed plan. */
export function reminderFireMs(item: Pick<ScheduledSession, 'date' | 'time' | 'leadMinutes'>): number {
  return scheduledStartMs(item) - item.leadMinutes * 60_000;
}

/** Everything a caller can set on a plan. Shared by create and update, since
 * a plan's editable surface is exactly its creatable one (same reasoning
 * GoalForm.tsx's header gives for one form serving both). */
export interface ScheduledSessionInput {
  date: string;
  time: string;
  topic: string | null;
  leadMinutes: number;
  plannedS?: number;
  note?: string;
}

/** Throws the same caller-renderable Error convention goals.ts and
 * customLabels.ts use ("Label name is required.") -- the form renders
 * `e.message` inline rather than mapping error codes. */
function validate(input: ScheduledSessionInput): void {
  if (!DATE_RE.test(input.date)) throw new Error('Pick a valid date for this session.');
  if (!TIME_RE.test(input.time)) throw new Error('Pick a valid start time for this session.');
  if (input.topic !== null && (typeof input.topic !== 'string' || !input.topic)) {
    throw new Error('Session label is invalid.');
  }
  if (!Number.isInteger(input.leadMinutes) || input.leadMinutes < 0 || input.leadMinutes > MAX_LEAD_MINUTES) {
    throw new Error('That reminder lead time is out of range.');
  }
  if (input.plannedS !== undefined) {
    if (!Number.isFinite(input.plannedS) || input.plannedS <= 0) {
      throw new Error('Planned duration must be longer than zero.');
    }
    if (input.plannedS > 24 * 60 * 60) throw new Error('Planned duration must be 24 hours or less.');
  }
  if (input.note !== undefined && input.note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  }
}

/** Plans on `date`, soonest first -- the order the day sheet lists them in
 * and the order this module's per-day cap counts against. */
export function sessionsOnDay(items: ScheduledSession[], date: string): ScheduledSession[] {
  return items.filter((s) => s.date === date).sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Appends a plan. Caps are checked LAST, after the field validation, so a
 * user who is both at the cap and has a malformed field hears about the
 * field first -- same ordering createGoal uses for MAX_GOALS.
 */
export function createScheduledSession(
  items: ScheduledSession[],
  input: ScheduledSessionInput,
  nowMs: number = Date.now(),
): ScheduledSession[] {
  validate(input);
  if (items.length >= MAX_SCHEDULED_SESSIONS) {
    throw new Error(`You can have at most ${MAX_SCHEDULED_SESSIONS} scheduled sessions.`);
  }
  if (sessionsOnDay(items, input.date).length >= MAX_PER_DAY) {
    throw new Error(`You can schedule at most ${MAX_PER_DAY} sessions on one day.`);
  }
  const item: ScheduledSession = {
    id: makeScheduledSessionId(),
    date: input.date,
    time: input.time,
    topic: input.topic,
    leadMinutes: input.leadMinutes,
    ...(input.plannedS !== undefined ? { plannedS: input.plannedS } : {}),
    ...(input.note ? { note: input.note } : {}),
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  return [...items, item];
}

/**
 * Replaces one plan's editable fields wholesale -- the form always submits
 * every field (see ScheduledSessionInput), so there's no partial-patch
 * `null`-clears convention to mirror from GoalPatch here. `done` is
 * deliberately not part of the input: it's toggled through
 * setScheduledSessionDone below, which is a different user action from
 * editing the plan.
 *
 * Unknown id is a no-op returning the SAME array reference, so a stale row
 * can't produce a pointless persist + notification reconcile.
 */
export function updateScheduledSession(
  items: ScheduledSession[],
  id: string,
  input: ScheduledSessionInput,
  nowMs: number = Date.now(),
): ScheduledSession[] {
  const existing = items.find((s) => s.id === id);
  if (!existing) return items;
  validate(input);
  // The per-day cap is re-checked only when the plan MOVES to a different
  // day -- an edit that stays put is already counted in that day's total,
  // so re-checking would reject the 12th plan on a full day for editing its
  // own note.
  if (input.date !== existing.date && sessionsOnDay(items, input.date).length >= MAX_PER_DAY) {
    throw new Error(`You can schedule at most ${MAX_PER_DAY} sessions on one day.`);
  }
  return items.map((s) =>
    s.id === id
      ? {
          ...s,
          date: input.date,
          time: input.time,
          topic: input.topic,
          leadMinutes: input.leadMinutes,
          plannedS: input.plannedS,
          note: input.note ? input.note : undefined,
          updatedAt: nowMs,
        }
      : s,
  );
}

/** Ticking a plan off (or un-ticking it). A done plan stops being scheduled
 * (sessionReminderPlan.ts skips it) but keeps its row, so a past day still
 * reads as "I planned this, and did it". */
export function setScheduledSessionDone(
  items: ScheduledSession[],
  id: string,
  done: boolean,
  nowMs: number = Date.now(),
): ScheduledSession[] {
  if (!items.some((s) => s.id === id)) return items;
  return items.map((s) => (s.id === id ? { ...s, done, updatedAt: nowMs } : s));
}

/** Plain removal, not a tombstone -- see this file's header for why these
 * need no tombstone semantics. Unknown id returns the same array. */
export function deleteScheduledSession(items: ScheduledSession[], id: string): ScheduledSession[] {
  if (!items.some((s) => s.id === id)) return items;
  return items.filter((s) => s.id !== id);
}

/** Drops plans whose start is more than SCHEDULED_PRUNE_MS in the past.
 * Called from the store's one persist choke-point, so pruning happens
 * exactly once per write rather than on every read -- the same placement
 * useGoalsStore's own `persist` uses for pruneArchivedGoals. A malformed
 * entry (NaN start, e.g. hand-edited storage) is dropped too: it can never
 * be scheduled or usefully rendered. */
export function pruneScheduledSessions(
  items: ScheduledSession[],
  nowMs: number = Date.now(),
): ScheduledSession[] {
  return items.filter((s) => {
    const start = scheduledStartMs(s);
    if (!Number.isFinite(start)) return false;
    return nowMs - start <= SCHEDULED_PRUNE_MS;
  });
}
