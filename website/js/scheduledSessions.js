/* =========================================================================
   scheduledSessions.js -- the dashboard's half of planned focus sessions:
   the model (mirroring app/src/schedule/scheduledSessions.ts) plus the
   Firestore read/write path for users/{uid}/scheduledSessions/{planId}.

   CROSS-RUNTIME MIRROR. Every bound and every field shape here has a twin in
   app/src/schedule/scheduledSessions.ts, exactly as this site's goals.js
   mirrors app/src/goals/goals.ts. Keep the numbers in step by hand: the
   Firestore rules enforce most of them server-side (app/firestore.rules'
   scheduledSessions block), so a value that drifts here doesn't corrupt
   anything -- it just makes the write fail with a permission error the user
   can't act on.

   WHY THIS EXISTS AT ALL. The dashboard can't schedule a local notification
   for a session hours from now -- a browser tab may not even be open then.
   Instead it writes the plan to Firestore and the backend
   (functions/src/index.ts) pushes the reminder when it comes due, to the
   phone app and/or to this browser (see webPush.js). That is the whole
   reason the push infrastructure exists.
   ========================================================================= */
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/* ---------- Bounds (mirror app/src/schedule/scheduledSessions.ts) ---------- */
export const MAX_SCHEDULED_SESSIONS = 200;
export const MAX_PER_DAY = 12;
export const MAX_NOTE_LENGTH = 120;
export const LEAD_MINUTE_OPTIONS = [0, 5, 10, 15, 30, 60];
/** Offered as chips rather than a free-form field, same as the app's form --
 * a planned session's length is a rough intention picked from a handful of
 * habitual values, and the box's real timer is set at the box anyway. */
export const DURATION_OPTIONS_S = [15 * 60, 25 * 60, 30 * 60, 45 * 60, 60 * 60, 90 * 60, 120 * 60];

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Same id shape the app mints (app/src/schedule/scheduledSessions.ts's
 * makeScheduledSessionId) -- ids from the two surfaces share one namespace
 * because they end up as document ids in the same collection. */
export function makeScheduledSessionId() {
  return `sched_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The plan's start, as absolute local epoch ms. Built from local Y/M/D +
 * H:M rather than `new Date('2026-09-01T09:00')`, for the same reason
 * focusStats.js's dayKeyToDate exists: a bare date string is parsed as UTC by
 * the spec, which is a full day off west of UTC. NaN for a malformed plan,
 * which every caller treats as "not schedulable". */
export function scheduledStartMs({ date, time }) {
  if (!DATE_RE.test(date || '') || !TIME_RE.test(time || '')) return NaN;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/** When the reminder fires: `leadMinutes` before the start. */
export function reminderFireMs(plan) {
  return scheduledStartMs(plan) - (plan.leadMinutes || 0) * 60000;
}

/** 'HH:MM' -> the viewer's own locale ("2:30 PM" / "14:30"). Mirrors
 * app/src/ui/time.ts's formatClockTime. */
export function formatClockTime(value) {
  const [h, m] = String(value).split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "At start" / "10 min before" / "1 hour before". */
export function leadLabel(minutes) {
  if (minutes === 0) return 'At start';
  if (minutes === 60) return '1 hour before';
  return `${minutes} min before`;
}

/** Plans on `dateKey`, soonest first. */
export function sessionsOnDay(plans, dateKey) {
  return plans.filter((p) => p.date === dateKey).sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Throws an Error whose `message` is meant to be rendered as-is -- the same
 * convention goals.js uses, and the reason the panel can just show
 * `err.message` instead of mapping codes.
 */
export function validatePlan(input, existing, editingId) {
  if (!DATE_RE.test(input.date || '')) throw new Error('Pick a valid date for this session.');
  if (!TIME_RE.test(input.time || '')) throw new Error('Pick a valid start time for this session.');
  if (!LEAD_MINUTE_OPTIONS.includes(input.leadMinutes)) throw new Error('That reminder lead time is out of range.');
  if (input.note && input.note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  }
  if (input.plannedS !== undefined && !(input.plannedS > 0 && input.plannedS <= 86400)) {
    throw new Error('Planned duration must be between zero and 24 hours.');
  }
  const others = (existing || []).filter((p) => p.id !== editingId);
  if (!editingId && others.length >= MAX_SCHEDULED_SESSIONS) {
    throw new Error(`You can have at most ${MAX_SCHEDULED_SESSIONS} scheduled sessions.`);
  }
  // Only checked when the plan is landing on a day it isn't already counted
  // in -- otherwise editing the 12th plan on a full day would be rejected for
  // changing its own note (the same carve-out the app's updateScheduledSession
  // makes).
  const prior = editingId ? (existing || []).find((p) => p.id === editingId) : undefined;
  const movingToNewDay = !prior || prior.date !== input.date;
  if (movingToNewDay && sessionsOnDay(others, input.date).length >= MAX_PER_DAY) {
    throw new Error(`You can schedule at most ${MAX_PER_DAY} sessions on one day.`);
  }
}

/** The IANA zone `fireAtMs`/`timeLabel` were derived in. Diagnostic only --
 * nothing reads it -- but without it a mis-fired reminder is undebuggable
 * after the fact. */
function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Local shape -> the document the backend reads. `fireAtMs` and `timeLabel`
 * are computed here, on the machine that knows the user's timezone and
 * locale, because the server can't: see functions/src/reminders.ts for what
 * it does with them and why it doesn't re-derive either.
 */
export function toRemote(plan) {
  const out = {
    date: plan.date,
    time: plan.time,
    fireAtMs: reminderFireMs(plan),
    timeLabel: formatClockTime(plan.time),
    tz: localTimeZone(),
    topic: plan.topic ?? null,
    leadMinutes: plan.leadMinutes,
    done: !!plan.done,
    // Written as an explicit null, never omitted: Firestore cannot query for
    // an absent field, and the backend's due-query is
    // `where('notifiedAt', '==', null)`. A plan saved without it would never
    // be found, and its reminder would never be sent.
    notifiedAt: null,
    updatedAt: Date.now(),
  };
  // Firestore rejects `undefined` outright, and the rules' hasOnly allow-list
  // means an unexpected key is rejected too -- so optional fields are added
  // only when they have a value.
  if (plan.plannedS !== undefined) out.plannedS = plan.plannedS;
  if (plan.note) out.note = plan.note;
  return out;
}

/** Untrusted document -> local shape, or null if it can't be trusted. Same
 * boundary-validation posture goals.js's sanitizeRemoteGoals takes. */
export function fromRemote(id, data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.date !== 'string' || typeof data.time !== 'string') return null;
  if (typeof data.leadMinutes !== 'number') return null;
  return {
    id,
    date: data.date,
    time: data.time,
    topic: typeof data.topic === 'string' ? data.topic : null,
    leadMinutes: Math.round(data.leadMinutes),
    plannedS: typeof data.plannedS === 'number' ? data.plannedS : undefined,
    note: typeof data.note === 'string' ? data.note : undefined,
    done: !!data.done,
    notifiedAt: typeof data.notifiedAt === 'number' ? data.notifiedAt : null,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

/* ---------- Firestore ---------- */

/** Every plan for this user, malformed documents dropped. */
export async function loadScheduledSessions(db, uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'scheduledSessions'));
  return snap.docs.map((d) => fromRemote(d.id, d.data())).filter(Boolean);
}

/** Creates or replaces one plan. Whole-document writes, not merges: the
 * rules validate the complete shape (`hasOnly` plus per-field checks), and a
 * partial merge could leave a document that satisfies the rule on its own
 * delta while being incoherent overall. */
export async function writeScheduledSession(db, uid, plan) {
  await setDoc(doc(db, 'users', uid, 'scheduledSessions', plan.id), toRemote(plan));
}

export async function removeScheduledSession(db, uid, planId) {
  await deleteDoc(doc(db, 'users', uid, 'scheduledSessions', planId));
}
