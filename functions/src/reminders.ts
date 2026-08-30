// reminders.ts -- the PURE half of server-side reminder delivery: the shape
// of a scheduled-session document, which push tokens a given reminder should
// actually be sent to, and the copy that goes in it. No firebase-admin
// import, no network, no Date.now() of its own -- every time-dependent input
// is a parameter.
//
// Same split the clients already use (app/src/schedule/sessionReminderPlan.ts
// decides what should fire, sessionReminders.ts talks to the OS), and for the
// same reason: this is the part with the interesting rules, so it is the part
// that has to be unit-testable without standing up Firestore.
//
// DUPLICATION NOTE. The copy below deliberately mirrors
// app/src/schedule/sessionReminderPlan.ts's contentFor. It cannot import it
// -- that module lives in a React Native bundle, this one runs on Node -- so
// this is the same cross-runtime mirroring website/js/goals.js already has
// with app/src/goals/goals.ts. Keep the two in step by hand; a drift shows up
// as the same reminder reading differently depending on whether the phone
// fired it locally or the server pushed it.

/** One `users/{uid}/scheduledSessions/{id}` document, as written by either
 * client. Only the fields this function actually reads are listed. */
export interface RemoteScheduledSession {
  /** Absolute epoch ms at which the reminder should fire. The clients
   * compute this from the plan's LOCAL calendar day + start time minus its
   * lead (app/src/schedule/scheduledSessions.ts's reminderFireMs), because
   * only they know the device's timezone. It is the one field this backend
   * queries on -- see the index in firestore.indexes.json.
   *
   * Consequence worth knowing: a user who changes timezone (or crosses a DST
   * boundary) between scheduling and firing gets the reminder at the
   * absolute moment that was correct when they scheduled it, not at the same
   * wall-clock time in the new zone. Re-resolving would mean recomputing
   * from `date`/`time`/`tz` on every run, which needs a tz database here and
   * changes what "9:00" means without the user asking. The clients' own
   * local notifications behave identically (an expo-notifications DATE
   * trigger is likewise absolute), so at least the two agree. */
  fireAtMs: number;
  /** Pre-formatted local clock time ("2:30 PM" / "14:30"), written by the
   * client that created the plan. Deliberately NOT re-derived here: only the
   * client knows the user's locale, and a server that guessed would tell a
   * 24h-locale user their session starts at "2:30 PM". */
  timeLabel: string;
  leadMinutes: number;
  plannedS?: number;
  note?: string;
  done?: boolean;
  /** Server-written, epoch ms, once this reminder has been pushed. `null`
   * means "still pending" and is what the due-query filters on -- it must be
   * an explicit null on the document, since Firestore cannot query for an
   * absent field. */
  notifiedAt?: number | null;
}

/** One `users/{uid}/pushTokens/{id}` document. */
export interface PushTokenDoc {
  /** Which delivery service this token belongs to. 'expo' is the phone app
   * (Expo's push service fans out to APNs/FCM); 'webpush' is a browser tab
   * that granted permission on the dashboard, delivered through FCM. */
  transport: 'expo' | 'webpush';
  token: string;
  platform?: 'ios' | 'android' | 'web';
  /**
   * Plan ids this device has ALREADY scheduled as local notifications.
   *
   * This is the whole duplicate-suppression mechanism, and it is device-side
   * on purpose. The phone app schedules its own local notification for every
   * plan it knows about -- that is strictly better than a push (it is exact,
   * it needs no network at fire time, and it works when the push service is
   * down), so the server must not send a second copy of something the phone
   * is already going to show. A browser token carries an empty list and
   * therefore always receives the push, which is what makes a plan created
   * on the dashboard actually arrive somewhere.
   *
   * Absent/undefined is treated as "covers nothing", which is the safe
   * direction: a reminder that arrives twice is annoying, but one that never
   * arrives at all is the failure this whole feature exists to prevent, so a
   * token doc written by an older client version still gets pushed to.
   */
  localReminderIds?: string[];
}

/** A reminder paired with the user it belongs to and the document id that
 * identifies it -- what the query layer hands to the sender. */
export interface DueReminder {
  uid: string;
  planId: string;
  plan: RemoteScheduledSession;
}

/** Short "1h 20m" / "45m" phrasing, mirroring the clients' own. */
export function shortDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** Reminder copy. Says WHEN the session starts rather than "now", because
 * the point of `leadMinutes` is that this arrives early -- a body reading
 * "time to focus" when the session is 30 minutes away would be actively
 * misleading. The note leads when there is one: it is the user's own words
 * for what the session is for, and the thing that makes the reminder
 * actionable. */
export function reminderContent(plan: RemoteScheduledSession): { title: string; body: string } {
  const lead = plan.leadMinutes;
  const what = plan.note ? `${plan.note} -- ` : '';
  const duration = plan.plannedS ? ` (${shortDuration(plan.plannedS)})` : '';
  return {
    title: lead === 0 ? 'Focus session now' : `Focus session in ${lead === 60 ? '1 hour' : `${lead} min`}`,
    body: `${what}${lead === 0 ? 'Starting' : 'Starts'} at ${plan.timeLabel}${duration}. Time to box your phone.`,
  };
}

/**
 * Which of a user's registered tokens should receive `planId`.
 *
 * Skips any token whose device reports it already holds this plan as a local
 * notification (see PushTokenDoc.localReminderIds), and skips a token with no
 * `token` string at all -- a half-written doc from an interrupted
 * registration would otherwise be sent to the push service as an empty
 * address and come back as an error every single run.
 */
export function tokensForReminder(planId: string, tokens: PushTokenDoc[]): PushTokenDoc[] {
  return tokens.filter((t) => {
    if (typeof t.token !== 'string' || t.token.length === 0) return false;
    return !(t.localReminderIds ?? []).includes(planId);
  });
}

/**
 * Whether a due document should actually be sent, given the moment the run
 * started. Belt-and-braces on top of the Firestore query (which already
 * filters `done`/`notifiedAt`/`fireAtMs`): a document written by a client
 * with a clock skew, or one whose fields are malformed, must not be able to
 * make this function push something absurd.
 *
 * `graceMs` is what stops a reminder that went un-sent for hours -- a
 * function outage, a project that ran out of quota -- arriving long after
 * the session it was about had already come and gone. Past that window the
 * reminder is marked handled without being delivered, which is the honest
 * outcome: there is nothing useful left to say.
 */
export function isSendable(plan: RemoteScheduledSession, nowMs: number, graceMs: number): boolean {
  if (plan.done) return false;
  if (plan.notifiedAt != null) return false;
  if (typeof plan.fireAtMs !== 'number' || !Number.isFinite(plan.fireAtMs)) return false;
  if (typeof plan.timeLabel !== 'string' || plan.timeLabel.length === 0) return false;
  if (plan.fireAtMs > nowMs) return false;
  return nowMs - plan.fireAtMs <= graceMs;
}

/** Splits `items` into runs of at most `size` -- both push services cap how
 * many messages one request may carry. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
